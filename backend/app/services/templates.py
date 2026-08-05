from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Task, Template, TemplateBlock
from app.models.event import EventSource
from app.schemas.template import TemplateBlockCreate, TemplateCreate
from app.services import events as event_service
from app.services import tasks as task_service


class NoActiveTemplate(Exception):
    """Raised when materialization is requested but no active template exists."""


def week_bounds(any_day: date) -> tuple[date, date]:
    """Monday and the following Monday for the week containing `any_day`."""
    monday = any_day - timedelta(days=any_day.isoweekday() - 1)
    return monday, monday + timedelta(days=7)


async def list_templates(session: AsyncSession) -> list[Template]:
    stmt = select(Template).order_by(Template.id)
    return list((await session.scalars(stmt)).all())


async def get_template(session: AsyncSession, template_id: int) -> Template | None:
    # populate_existing re-runs the selectin load of `blocks`. Without it, a Template
    # already in the identity map returns a stale block list after an add or delete.
    stmt = (
        select(Template)
        .where(Template.id == template_id)
        .execution_options(populate_existing=True)
    )
    return (await session.scalars(stmt)).first()


async def get_active_template(session: AsyncSession) -> Template | None:
    stmt = (
        select(Template)
        .where(Template.is_active.is_(True))
        .order_by(Template.id.desc())
        .execution_options(populate_existing=True)
    )
    return (await session.scalars(stmt)).first()


async def create_template(session: AsyncSession, data: TemplateCreate) -> Template:
    template = Template(**data.model_dump())
    session.add(template)
    await session.commit()
    await session.refresh(template)
    return template


async def delete_template(session: AsyncSession, template_id: int) -> bool:
    template = await session.get(Template, template_id)
    if template is None:
        return False
    await session.delete(template)
    await session.commit()
    return True


async def create_block(
    session: AsyncSession, template_id: int, data: TemplateBlockCreate
) -> TemplateBlock | None:
    if await session.get(Template, template_id) is None:
        return None
    block = TemplateBlock(template_id=template_id, **data.model_dump())
    session.add(block)
    await session.commit()
    await session.refresh(block)
    return block


async def update_block(
    session: AsyncSession, block_id: int, data: TemplateBlockCreate
) -> TemplateBlock | None:
    block = await session.get(TemplateBlock, block_id)
    if block is None:
        return None
    for key, value in data.model_dump().items():
        setattr(block, key, value)
    await session.commit()
    await session.refresh(block)
    return block


async def delete_block(session: AsyncSession, block_id: int) -> bool:
    block = await session.get(TemplateBlock, block_id)
    if block is None:
        return False
    await session.delete(block)
    await session.commit()
    return True


async def _days_with_events(session: AsyncSession, monday: date, next_monday: date) -> set[date]:
    rows = await event_service.list_events(
        session,
        start=datetime.combine(monday, datetime.min.time()),
        end=datetime.combine(next_monday, datetime.min.time()),
    )
    return {e.start_at.date() for e in rows}


async def materialize_week(
    session: AsyncSession, any_day: date, template: Template | None = None
) -> tuple[date, list[Event], list[date]]:
    """Create template events for the week containing `any_day`.

    Days that already hold any event are skipped entirely, so materialization never
    merges into a day the user has already touched, and a re-run is a no-op.

    **The whole week's events land in a single commit.** Committing per event would
    let an interrupted run leave a day half-filled — and because the guard above skips
    any day holding *any* event, that day would then be skipped forever, permanently
    missing its remaining blocks. Task 13 runs this unattended from cron, so that
    failure mode has to be impossible rather than merely unlikely.
    """
    if template is None:
        template = await get_active_template(session)
    if template is None:
        raise NoActiveTemplate()

    monday, next_monday = week_bounds(any_day)
    occupied = await _days_with_events(session, monday, next_monday)
    skipped = sorted(occupied)

    wanted: list[tuple[date, TemplateBlock]] = []
    for offset in range(7):
        day = monday + timedelta(days=offset)
        if day in occupied:
            continue
        for block in template.blocks:
            if day.isoweekday() in block.days:
                wanted.append((day, block))

    # Resolve every task name FIRST. find_or_create_by_name commits, and a commit
    # flushes whatever else is pending in the session — so no Event may exist in the
    # session while these run, or the "single commit" guarantee is silently broken.
    tasks_by_name: dict[str, Task] = {}
    for _, block in wanted:
        if block.task_name not in tasks_by_name:
            tasks_by_name[block.task_name] = await task_service.find_or_create_by_name(
                session, block.task_name, list(block.tag_ids)
            )

    created: list[Event] = []
    for day, block in wanted:
        task = tasks_by_name[block.task_name]
        start = datetime.combine(day, block.start_time)
        end = datetime.combine(day, block.end_time)
        if end <= start:  # crosses midnight
            end += timedelta(days=1)
        event = Event(
            task_id=task.id,
            start_at=start,
            end_at=end,
            # Mirrors create_event: a block carrying no tags of its own inherits the
            # task's. Building Event directly is exactly where this fallback gets
            # lost, and an untagged event falls into "unassigned" — silently absent
            # from every 6:3:1 ratio rather than visibly wrong.
            tag_ids=list(block.tag_ids) or list(task.tag_ids),
            source=EventSource.TEMPLATE,
            template_block_id=block.id,
        )
        session.add(event)
        created.append(event)

    if created:
        await session.commit()

    return monday, created, skipped
