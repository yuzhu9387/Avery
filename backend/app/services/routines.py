from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Task, Routine, RoutineBlock
from app.models.event import EventSource
from app.models.task import TaskStatus
from app.schemas.routine import (
    RoutineBlockCreate,
    RoutineBlockUpdate,
    RoutineCreate,
    RoutineUpdate,
)
from app.services import events as event_service
from app.services import tags as tag_service
from app.services import tasks as task_service


class NoActiveRoutine(Exception):
    """Raised when materialization is requested but no active routine exists."""


def week_bounds(any_day: date) -> tuple[date, date]:
    """Monday and the following Monday for the week containing `any_day`."""
    monday = any_day - timedelta(days=any_day.isoweekday() - 1)
    return monday, monday + timedelta(days=7)


async def list_routines(session: AsyncSession) -> list[Routine]:
    stmt = select(Routine).order_by(Routine.id)
    return list((await session.scalars(stmt)).all())


async def get_routine(session: AsyncSession, routine_id: int) -> Routine | None:
    # populate_existing re-runs the selectin load of `blocks`. Without it, a Routine
    # already in the identity map returns a stale block list after an add or delete.
    stmt = (
        select(Routine)
        .where(Routine.id == routine_id)
        .execution_options(populate_existing=True)
    )
    return (await session.scalars(stmt)).first()


async def get_active_routine(session: AsyncSession) -> Routine | None:
    stmt = (
        select(Routine)
        .where(Routine.is_active.is_(True))
        .order_by(Routine.id.desc())
        .execution_options(populate_existing=True)
    )
    return (await session.scalars(stmt)).first()


async def create_routine(session: AsyncSession, data: RoutineCreate) -> Routine:
    routine = Routine(**data.model_dump())
    session.add(routine)
    await session.commit()
    await session.refresh(routine)
    return routine


async def update_routine(
    session: AsyncSession, routine_id: int, data: RoutineUpdate
) -> Routine | None:
    routine = await session.get(Routine, routine_id)
    if routine is None:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(routine, key, value)
    await session.commit()
    return await get_routine(session, routine_id)


async def delete_routine(session: AsyncSession, routine_id: int) -> bool:
    routine = await session.get(Routine, routine_id)
    if routine is None:
        return False
    await session.delete(routine)
    await session.commit()
    return True


async def create_block(
    session: AsyncSession, routine_id: int, data: RoutineBlockCreate
) -> RoutineBlock | None:
    if await session.get(Routine, routine_id) is None:
        return None
    await tag_service.assert_tags_exist(session, data.tag_ids)
    block = RoutineBlock(routine_id=routine_id, **data.model_dump())
    session.add(block)
    await session.commit()
    await session.refresh(block)
    return block


async def update_block(
    session: AsyncSession, block_id: int, data: RoutineBlockUpdate
) -> RoutineBlock | None:
    block = await session.get(RoutineBlock, block_id)
    if block is None:
        return None
    fields = data.model_dump(exclude_unset=True)
    if "tag_ids" in fields:
        await tag_service.assert_tags_exist(session, fields["tag_ids"])
    for key, value in fields.items():
        setattr(block, key, value)
    await session.commit()
    await session.refresh(block)
    return block


async def delete_block(session: AsyncSession, block_id: int) -> bool:
    block = await session.get(RoutineBlock, block_id)
    if block is None:
        return False
    await session.delete(block)
    await session.commit()
    return True


async def _days_with_events(session: AsyncSession, monday: date, next_monday: date) -> set[date]:
    """Days on which the user already has something scheduled.

    Occupancy is judged by where an event *starts*, not by every day it touches.
    Judging by touch looked safer and was catastrophic: the seeded rest block runs
    23:00->07:00 nightly, so Sunday's rest always bled into Monday, marked it occupied,
    and silently dropped Monday's eight blocks from every week after the first.

    The cost of this choice is that a long manual event spilling past midnight can now
    have routine blocks materialized over it, producing an overlap. Overlaps are a
    condition this system already detects (`Evaluation.overlaps`) and the Review page
    warns about, so they are visible and fixable. Silent loss is neither. This also makes
    the rule agree with `get_week`'s gate instead of contradicting it.
    """
    rows = await event_service.list_events(
        session,
        start=datetime.combine(monday, datetime.min.time()),
        end=datetime.combine(next_monday, datetime.min.time()),
    )
    return {
        e.start_at.date() for e in rows if monday <= e.start_at.date() < next_monday
    }


async def preview_week(
    session: AsyncSession, any_day: date, routine: Routine | None = None
) -> tuple[date, list[dict]] | None:
    """What materialize_week WOULD create, without writing anything.

    Deliberately shares the day/block selection and the midnight-wrap arithmetic with
    materialize_week rather than reimplementing it — a preview that disagrees with what
    actually gets created is worse than no preview.
    """
    if routine is None:
        routine = await get_active_routine(session)
    if routine is None:
        return None

    monday, next_monday = week_bounds(any_day)
    occupied = await _days_with_events(session, monday, next_monday)

    # Mirror materialize_week's tag fallback: a block declaring no tags of its own
    # inherits the resolved task's. Resolve read-only — never create — so preview stays
    # a pure read while still predicting the tags materialization will really assign.
    # Archived tasks are skipped for the same reason find_or_create_by_name skips them.
    task_tags: dict[str, list[int]] = {}

    async def tags_for(block: RoutineBlock) -> list[int]:
        if block.tag_ids:
            return list(block.tag_ids)
        if block.task_name not in task_tags:
            existing = (
                await session.scalars(
                    select(Task)
                    .where(Task.name == block.task_name, Task.status != TaskStatus.ARCHIVED)
                    .order_by(Task.id)
                )
            ).first()
            task_tags[block.task_name] = list(existing.tag_ids) if existing else []
        return list(task_tags[block.task_name])

    rows: list[dict] = []
    for offset in range(7):
        day = monday + timedelta(days=offset)
        if day in occupied:
            continue
        for block in routine.blocks:
            if day.isoweekday() not in block.days:
                continue
            start = datetime.combine(day, block.start_time)
            end = datetime.combine(day, block.end_time)
            if end <= start:
                end += timedelta(days=1)
            rows.append(
                {
                    "task_name": block.task_name,
                    "start_at": start.isoformat(timespec="seconds"),
                    "end_at": end.isoformat(timespec="seconds"),
                    "tag_ids": await tags_for(block),
                    "routine_block_id": block.id,
                }
            )
    rows.sort(key=lambda r: r["start_at"])
    return monday, rows


async def materialize_week(
    session: AsyncSession, any_day: date, routine: Routine | None = None
) -> tuple[date, list[Event], list[date]]:
    """Create routine events for the week containing `any_day`.

    Days that already hold any event are skipped entirely, so materialization never
    merges into a day the user has already touched, and a re-run is a no-op.

    **The whole week's events land in a single commit.** Committing per event would
    let an interrupted run leave a day half-filled — and because the guard above skips
    any day holding *any* event, that day would then be skipped forever, permanently
    missing its remaining blocks. Task 13 runs this unattended from cron, so that
    failure mode has to be impossible rather than merely unlikely.
    """
    if routine is None:
        routine = await get_active_routine(session)
    if routine is None:
        raise NoActiveRoutine()

    monday, next_monday = week_bounds(any_day)
    occupied = await _days_with_events(session, monday, next_monday)
    skipped = sorted(occupied)

    wanted: list[tuple[date, RoutineBlock]] = []
    for offset in range(7):
        day = monday + timedelta(days=offset)
        if day in occupied:
            continue
        for block in routine.blocks:
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
            source=EventSource.ROUTINE,
            routine_block_id=block.id,
        )
        session.add(event)
        created.append(event)

    if created:
        await session.commit()

    return monday, created, skipped
