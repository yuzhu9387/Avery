from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Task
from app.models.event import EventKind, EventSource
from app.services import calendar_links, google_calendar
from app.models.task import TaskStatus
from app.schemas.event import EventCreate, EventUpdate
from app.services import tasks as task_service
from app.services.tags import assert_tags_exist


class TaskNotFound(Exception):
    """Raised when create_event is given a task_id that does not exist."""


class RollOverRejected(Exception):
    """Raised when a roll-over request names something it may not move."""


async def list_events(
    session: AsyncSession,
    user_id: int | None,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    task_id: int | None = None,
) -> list[Event]:
    """Returns events overlapping [start, end). Half-open so adjacent days never double-count.

    user_id stays typed as optional because callers thread it through from
    Event.user_id / Routine.user_id, but every real row now carries a real owner
    (user_id is NOT NULL at the DB level) — there is no pre-account data left to
    reach this with None.
    """
    stmt = (
        select(Event)
        .where(Event.user_id == user_id)
        .order_by(Event.start_at, Event.id)
    )
    if start is not None:
        stmt = stmt.where(Event.end_at > start)
    if end is not None:
        stmt = stmt.where(Event.start_at < end)
    if task_id is not None:
        stmt = stmt.where(Event.task_id == task_id)
    return list((await session.scalars(stmt)).all())


async def get_event(session: AsyncSession, event_id: int, user_id: int) -> Event | None:
    """Another user's event is indistinguishable from no event at all."""
    stmt = select(Event).where(Event.id == event_id, Event.user_id == user_id)
    return (await session.scalars(stmt)).first()


async def create_event(session: AsyncSession, data: EventCreate, user_id: int) -> Event:
    tag_ids = list(data.tag_ids)
    # Validate explicit tag ids before create_by_name can commit a new Task —
    # otherwise a typo'd tag id leaves a real Task row behind even though the event
    # creation itself 422s.
    if tag_ids:
        await assert_tags_exist(session, tag_ids, user_id)

    task: Task | None = None
    if data.task_id is not None:
        # Either scheduling an existing to-do (kind='event') or a kind='task' card
        # naming a task explicitly — either way, honour the caller's task as-is.
        # Scoped lookup: naming another user's task must read as "not found".
        task = await task_service.get_task(session, data.task_id, user_id)
        if task is None:
            raise TaskNotFound(f"task {data.task_id} not found")
    elif data.kind == EventKind.TASK:
        # A task card is 1:1 with its Task so completion can sync without two cards
        # fighting over one status. The freshly minted Task's due date defaults to
        # the card's own end date — a task card is a to-do with a slot, so the
        # slot's end is naturally when it's due, rather than leaving it undated
        # until the user sets one by hand. The schema guarantees task_name OR
        # title is present; fall back to title so a title-only task card names
        # its Task after the card instead of crashing on a None name.
        task = await task_service.create_by_name(
            session, data.task_name or data.title, tag_ids, user_id,
            due_date=data.end_at.date(),
        )
    # else: a plain event (kind='event') named without a task_id mints nothing —
    # it carries its own title and stands on its own, task stays None.

    if not tag_ids and task is not None:
        tag_ids = list(task.tag_ids)

    # title falls back to the caller's task_name, then to the resolved task's own
    # name -- the latter covers the explicit-task_id path, which never supplies
    # task_name at all. One of data.title/task_name/task is guaranteed non-empty
    # here: the schema requires task_id or task_name, and task_id resolves to a
    # real task above.
    title = data.title or data.task_name or (task.name if task is not None else "")

    event = Event(
        user_id=user_id,
        task_id=task.id if task is not None else None,
        title=title,
        start_at=data.start_at,
        end_at=data.end_at,
        tag_ids=tag_ids,
        kind=data.kind,
        source=data.source,
        routine_block_id=data.routine_block_id,
        notes=data.notes,
    )
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return event


async def _push_back_if_external(
    session: AsyncSession,
    event,
    *,
    title: str,
    start_at: datetime,
    end_at: datetime,
) -> None:
    """For a mirrored external event, write the prospective values to the provider
    BEFORE the local commit. Ordering is the point: if the provider refuses, the
    local row must stay exactly as the provider last said it was — the alternative
    is Avery quietly showing times the real calendar does not have.
    """
    if event.source not in (EventSource.GOOGLE, EventSource.LARK) or not event.external_id:
        return
    if event.source == EventSource.LARK:
        # Lark write-back does not exist yet; refusing beats pretending.
        raise google_calendar.PushUnsupported(
            "this event lives on your Lark calendar — Avery can't edit it yet. "
            "Change it in Lark and it will sync back."
        )
    connection = await calendar_links.get_connection(session, event.user_id, event.source)
    if connection is None:
        raise google_calendar.PushFailed(
            "the calendar this event belongs to is no longer connected"
        )
    await google_calendar.push_update(
        session, connection, event.external_id,
        title=title, start_at=start_at, end_at=end_at,
    )


async def update_event(
    session: AsyncSession, event_id: int, data: EventUpdate, user_id: int
) -> Event | None:
    """Validate against the PROSPECTIVE values before mutating anything.

    Assigning first and checking afterwards leaves the ORM object dirty in the
    session when the check fails: the caller gets its 422, but the next commit on
    that same session flushes the invalid row anyway. Requests share one session,
    so that is a real corruption path, not a theoretical one.
    """
    event = await get_event(session, event_id, user_id)
    if event is None:
        return None
    fields = data.model_dump(exclude_unset=True)

    new_start = fields.get("start_at", event.start_at)
    new_end = fields.get("end_at", event.end_at)
    if new_end <= new_start:
        raise ValueError("end_at must be after start_at")

    if fields.get("tag_ids") == []:
        # A task-less plain event has nothing to inherit from; [] just stays [].
        task = (
            await task_service.get_task(session, event.task_id, user_id)
            if event.task_id is not None
            else None
        )
        if task is not None:
            fields["tag_ids"] = list(task.tag_ids)
    elif "tag_ids" in fields:
        await assert_tags_exist(session, fields["tag_ids"], user_id)

    # Push back only when a provider-owned field actually changed. Tags, notes and
    # completion are Avery's own; pushing on those would round-trip to Google for
    # nothing — and fail the whole edit if Google hiccups on an edit it never needed.
    new_title = fields.get("title", event.title)
    provider_fields_changed = (
        new_title != event.title or new_start != event.start_at or new_end != event.end_at
    )
    if provider_fields_changed:
        await _push_back_if_external(
            session, event, title=new_title, start_at=new_start, end_at=new_end
        )
    for key, value in fields.items():
        setattr(event, key, value)
    await session.commit()
    await session.refresh(event)
    return event


async def move_event(
    session: AsyncSession, event_id: int, new_start: datetime, user_id: int
) -> Event | None:
    event = await get_event(session, event_id, user_id)
    if event is None:
        return None
    duration = event.end_at - event.start_at
    await _push_back_if_external(
        session, event,
        title=event.title, start_at=new_start, end_at=new_start + duration,
    )
    event.start_at = new_start
    event.end_at = new_start + duration
    await session.commit()
    await session.refresh(event)
    return event


async def delete_event(session: AsyncSession, event_id: int, user_id: int) -> bool:
    event = await get_event(session, event_id, user_id)
    if event is None:
        return False
    if event.source in (EventSource.GOOGLE, EventSource.LARK) and event.external_id:
        if event.source == EventSource.LARK:
            raise google_calendar.PushUnsupported(
                "this event lives on your Lark calendar — Avery can't delete it yet. "
                "Delete it in Lark and the mirror will go with it."
            )
        connection = await calendar_links.get_connection(session, event.user_id, event.source)
        if connection is None:
            raise google_calendar.PushFailed(
                "the calendar this event belongs to is no longer connected"
            )
        # Remote first: a local delete that outlives a failed remote one would just
        # come back on the next sync looking like a bug.
        await google_calendar.push_delete(session, connection, event.external_id)
    await session.delete(event)
    await session.commit()
    return True


async def complete_event(session: AsyncSession, event_id: int, user_id: int) -> Event | None:
    """Idempotent: an already-complete event keeps its original timestamp."""
    event = await get_event(session, event_id, user_id)
    if event is None:
        return None
    if event.completed_at is None:
        event.completed_at = datetime.now()
    if event.task_id is not None:
        task = await task_service.get_task(session, event.task_id, user_id)
        # An archived task stays archived: completion must not un-archive it.
        if task is not None and task.status != TaskStatus.ARCHIVED:
            task.status = TaskStatus.DONE
            task.completed_at = event.completed_at
    await session.commit()
    await session.refresh(event)
    return event


async def uncomplete_event(session: AsyncSession, event_id: int, user_id: int) -> Event | None:
    event = await get_event(session, event_id, user_id)
    if event is None:
        return None
    event.completed_at = None
    if event.task_id is not None:
        task = await task_service.get_task(session, event.task_id, user_id)
        # Guarded on DONE rather than "not archived": reopening a card must not drag
        # an archived task back into the active list.
        if task is not None and task.status == TaskStatus.DONE:
            task.status = TaskStatus.TODO
            task.completed_at = None
    await session.commit()
    await session.refresh(event)
    return event


async def roll_over(
    session: AsyncSession, event_ids: list[int], to_date: date, user_id: int
) -> list[Event]:
    """Shift whole task cards onto another date, keeping wall-clock time and duration.

    All-or-nothing on purpose: every id is validated before anything moves, so a
    request with one bad id leaves the calendar exactly as it was. Another user's
    event id counts as unknown — it must not even be reported as "not a task card".
    """
    stmt = (
        select(Event)
        .where(Event.id.in_(event_ids), Event.user_id == user_id)
        .order_by(Event.start_at, Event.id)
    )
    events = list((await session.scalars(stmt)).all())

    found = {e.id for e in events}
    missing = [i for i in event_ids if i not in found]
    if missing:
        raise RollOverRejected(f"unknown event ids: {missing}")
    not_tasks = [e.id for e in events if e.kind != EventKind.TASK]
    if not_tasks:
        raise RollOverRejected(f"not task cards, will not be moved: {not_tasks}")
    already_done = [e.id for e in events if e.completed_at is not None]
    if already_done:
        raise RollOverRejected(f"already complete: {already_done}")

    for event in events:
        # A whole-day delta, so an event that runs past midnight keeps its shape.
        delta = to_date - event.start_at.date()
        event.start_at = event.start_at + delta
        event.end_at = event.end_at + delta

    await session.commit()
    for event in events:
        await session.refresh(event)
    return events
