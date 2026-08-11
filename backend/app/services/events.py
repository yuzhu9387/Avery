from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Task
from app.models.event import EventKind
from app.schemas.event import EventCreate, EventUpdate
from app.services import tasks as task_service
from app.services.tags import assert_tags_exist


class TaskNotFound(Exception):
    """Raised when create_event is given a task_id that does not exist."""


async def list_events(
    session: AsyncSession,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    task_id: int | None = None,
) -> list[Event]:
    """Returns events overlapping [start, end). Half-open so adjacent days never double-count."""
    stmt = select(Event).order_by(Event.start_at, Event.id)
    if start is not None:
        stmt = stmt.where(Event.end_at > start)
    if end is not None:
        stmt = stmt.where(Event.start_at < end)
    if task_id is not None:
        stmt = stmt.where(Event.task_id == task_id)
    return list((await session.scalars(stmt)).all())


async def get_event(session: AsyncSession, event_id: int) -> Event | None:
    return await session.get(Event, event_id)


async def create_event(session: AsyncSession, data: EventCreate) -> Event:
    tag_ids = list(data.tag_ids)
    # Validate explicit tag ids before find_or_create_by_name can commit a new Task —
    # otherwise a typo'd tag id leaves a real Task row behind even though the event
    # creation itself 422s.
    if tag_ids:
        await assert_tags_exist(session, tag_ids)
    if data.task_id is not None:
        task = await session.get(Task, data.task_id)
        if task is None:
            raise TaskNotFound(f"task {data.task_id} not found")
    elif data.kind == EventKind.TASK:
        # A task card is 1:1 with its Task so completion can sync without two cards
        # fighting over one status. Event cards keep reusing a Task by name, so
        # repeated "Standup" blocks still roll up to a single task's minutes.
        task = await task_service.create_by_name(session, data.task_name, tag_ids)
    else:
        task = await task_service.find_or_create_by_name(session, data.task_name, tag_ids)
    if not tag_ids:
        tag_ids = list(task.tag_ids)

    event = Event(
        task_id=task.id,
        start_at=data.start_at,
        end_at=data.end_at,
        tag_ids=tag_ids,
        kind=data.kind,
        source=data.source,
        template_block_id=data.template_block_id,
        notes=data.notes,
    )
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return event


async def update_event(session: AsyncSession, event_id: int, data: EventUpdate) -> Event | None:
    """Validate against the PROSPECTIVE values before mutating anything.

    Assigning first and checking afterwards leaves the ORM object dirty in the
    session when the check fails: the caller gets its 422, but the next commit on
    that same session flushes the invalid row anyway. Requests share one session,
    so that is a real corruption path, not a theoretical one.
    """
    event = await session.get(Event, event_id)
    if event is None:
        return None
    fields = data.model_dump(exclude_unset=True)

    new_start = fields.get("start_at", event.start_at)
    new_end = fields.get("end_at", event.end_at)
    if new_end <= new_start:
        raise ValueError("end_at must be after start_at")

    if fields.get("tag_ids") == []:
        task = await session.get(Task, event.task_id)
        if task is not None:
            fields["tag_ids"] = list(task.tag_ids)
    elif "tag_ids" in fields:
        await assert_tags_exist(session, fields["tag_ids"])

    for key, value in fields.items():
        setattr(event, key, value)
    await session.commit()
    await session.refresh(event)
    return event


async def move_event(session: AsyncSession, event_id: int, new_start: datetime) -> Event | None:
    event = await session.get(Event, event_id)
    if event is None:
        return None
    duration = event.end_at - event.start_at
    event.start_at = new_start
    event.end_at = new_start + duration
    await session.commit()
    await session.refresh(event)
    return event


async def delete_event(session: AsyncSession, event_id: int) -> bool:
    event = await session.get(Event, event_id)
    if event is None:
        return False
    await session.delete(event)
    await session.commit()
    return True
