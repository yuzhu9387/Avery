from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.deps import get_current_user
from app.models import User
from app.schemas.event import EventCreate, EventMove, EventOut, EventRollOver, EventUpdate
from app.services import events as service
from app.services.calendar_links import RefreshFailed
from app.services.google_calendar import PushFailed
from app.services.tags import UnknownTagIds

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=list[EventOut])
async def list_events(
    start: datetime | None = None,
    end: datetime | None = None,
    task_id: int | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return await service.list_events(session, user.id, start=start, end=end, task_id=task_id)


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
async def create_event(data: EventCreate, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        return await service.create_event(session, data, user.id)
    except service.TaskNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except UnknownTagIds as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}")
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("/roll-over", response_model=list[EventOut])
async def roll_over(data: EventRollOver, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        return await service.roll_over(session, data.event_ids, data.to_date, user.id)
    except service.RollOverRejected as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.get("/{event_id}", response_model=EventOut)
async def get_event(event_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    event = await service.get_event(session, event_id, user.id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return event


@router.patch("/{event_id}", response_model=EventOut)
async def update_event(
    event_id: int, data: EventUpdate, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)
):
    try:
        event = await service.update_event(session, event_id, data, user.id)
    except UnknownTagIds as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}")
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except PushFailed as exc:
        # The provider refused the write-back, so nothing changed locally either.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    except RefreshFailed as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return event


@router.post("/{event_id}/move", response_model=EventOut)
async def move_event(event_id: int, data: EventMove, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        event = await service.move_event(session, event_id, data.start_at, user.id)
    except PushFailed as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    except RefreshFailed as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return event


@router.post("/{event_id}/complete", response_model=EventOut)
async def complete_event(event_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    event = await service.complete_event(session, event_id, user.id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return event


@router.post("/{event_id}/uncomplete", response_model=EventOut)
async def uncomplete_event(event_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    event = await service.uncomplete_event(session, event_id, user.id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        deleted = await service.delete_event(session, event_id, user.id)
    except PushFailed as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    except RefreshFailed as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
