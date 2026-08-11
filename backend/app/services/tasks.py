from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Task
from app.models.task import TaskStatus
from app.schemas.task import TaskCreate, TaskUpdate
from app.services import analytics
from app.services import events as event_service
from app.services import tags as tag_service
from app.services import routines as routine_service


async def list_tasks(
    session: AsyncSession,
    *,
    status: TaskStatus | None = None,
    is_floating: bool | None = None,
    floating_only: bool = False,
    include_archived: bool = False,
) -> list[Task]:
    stmt = select(Task).order_by(Task.created_at.desc(), Task.id.desc())
    if status is not None:
        stmt = stmt.where(Task.status == status)
    if is_floating is not None:
        stmt = stmt.where(Task.is_floating.is_(is_floating))
    if floating_only:
        # The real Floating list: flagged floating AND not yet scheduled. A floating
        # task that has since been given events belongs under Scheduled.
        stmt = stmt.where(
            Task.is_floating.is_(True),
            ~Task.id.in_(select(Event.task_id)),
        )
    if not include_archived and status != TaskStatus.ARCHIVED:
        stmt = stmt.where(Task.status != TaskStatus.ARCHIVED)
    return list((await session.scalars(stmt)).all())


async def get_task(session: AsyncSession, task_id: int) -> Task | None:
    return await session.get(Task, task_id)


async def task_stats(
    session: AsyncSession, task_id: int, today: date | None = None
) -> dict | None:
    """Hour rollups and the occurrence lists the Task detail page shows.

    `today` is injectable so the result is testable without patching the clock; it
    defaults to the real current date.
    """
    task = await session.get(Task, task_id)
    if task is None:
        return None

    anchor = today or date.today()
    week_start, week_end = routine_service.week_bounds(anchor)
    month_start = anchor.replace(day=1)
    month_end = date(
        anchor.year + (anchor.month == 12), (anchor.month % 12) + 1, 1
    )
    now = datetime.combine(anchor, datetime.min.time())

    rows = await event_service.list_events(session, task_id=task_id)

    def minutes_within(lo: date, hi: date) -> int:
        return sum(
            analytics.minutes_in_window(
                analytics.EventSlice(e.id, e.start_at, e.end_at, tuple(e.tag_ids)),
                datetime.combine(lo, datetime.min.time()),
                datetime.combine(hi, datetime.min.time()),
            )
            for e in rows
        )

    upcoming = [e for e in rows if e.start_at >= now][:10]
    recent = [e for e in reversed(rows) if e.start_at < now][:10]

    return {
        "task_id": task_id,
        "minutes_this_week": minutes_within(week_start, week_end),
        "minutes_this_month": minutes_within(month_start, month_end),
        "minutes_all_time": sum(e.duration_minutes for e in rows),
        "event_count": len(rows),
        "upcoming": upcoming,
        "recent": recent,
    }


async def create_task(session: AsyncSession, data: TaskCreate) -> Task:
    await tag_service.assert_tags_exist(session, data.tag_ids)
    payload = data.model_dump()
    task = Task(**payload)
    if task.status == TaskStatus.DONE:
        task.completed_at = datetime.now()
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def update_task(session: AsyncSession, task_id: int, data: TaskUpdate) -> Task | None:
    task = await session.get(Task, task_id)
    if task is None:
        return None
    fields = data.model_dump(exclude_unset=True)
    if "tag_ids" in fields:
        await tag_service.assert_tags_exist(session, fields["tag_ids"])
    for key, value in fields.items():
        setattr(task, key, value)
    if "status" in fields:
        task.completed_at = datetime.now() if fields["status"] == TaskStatus.DONE else None
    await session.commit()
    await session.refresh(task)
    return task


async def archive_task(session: AsyncSession, task_id: int) -> Task | None:
    """Tasks are never hard-deleted. Events freeze onto a task and carry the minutes
    every ratio is computed from, so removing the row would silently rewrite history —
    the same reason tags archive rather than delete. Idempotent.
    """
    task = await session.get(Task, task_id)
    if task is None:
        return None
    task.status = TaskStatus.ARCHIVED
    await session.commit()
    await session.refresh(task)
    return task


async def create_by_name(session: AsyncSession, name: str, tag_ids: list[int]) -> Task:
    """Always mints a new Task. Used where reuse would be wrong — see create_event."""
    task = Task(name=name, tag_ids=list(tag_ids))
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def find_or_create_by_name(
    session: AsyncSession, name: str, tag_ids: list[int]
) -> Task:
    """Used by event creation and routine materialization to keep one Task per name.

    Archived tasks are skipped deliberately: matching them would let the Sunday roll
    re-attach a fresh week of events to a task the user archived, undoing the archive
    every week and showing events whose task appears in no picker.
    """
    stmt = (
        select(Task)
        .where(Task.name == name, Task.status != TaskStatus.ARCHIVED)
        .order_by(Task.id)
    )
    existing = (await session.scalars(stmt)).first()
    if existing is not None:
        return existing
    return await create_by_name(session, name, tag_ids)
