from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Task
from app.schemas.event import EventCreate, EventUpdate
from app.services import tasks as task_service


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
    if data.task_id is not None:
        task = await session.get(Task, data.task_id)
        if task is None:
            raise ValueError(f"task {data.task_id} not found")
    else:
        task = await task_service.find_or_create_by_name(session, data.task_name, tag_ids)
    if not tag_ids:
        tag_ids = list(task.tag_ids)

    event = Event(
        task_id=task.id,
        start_at=data.start_at,
        end_at=data.end_at,
        tag_ids=tag_ids,
        source=data.source,
        template_block_id=data.template_block_id,
        notes=data.notes,
    )
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return event


async def update_event(session: AsyncSession, event_id: int, data: EventUpdate) -> Event | None:
    event = await session.get(Event, event_id)
    if event is None:
        return None
    fields = data.model_dump(exclude_unset=True)
    for key, value in fields.items():
        setattr(event, key, value)
    if event.end_at <= event.start_at:
        raise ValueError("end_at must be after start_at")
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
