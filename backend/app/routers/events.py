from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.event import EventCreate, EventMove, EventOut, EventUpdate
from app.services import events as service
from app.services.tags import UnknownTagIds

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=list[EventOut])
async def list_events(
    start: datetime | None = None,
    end: datetime | None = None,
    task_id: int | None = None,
    session: AsyncSession = Depends(get_session),
):
    return await service.list_events(session, start=start, end=end, task_id=task_id)


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
async def create_event(data: EventCreate, session: AsyncSession = Depends(get_session)):
    try:
        return await service.create_event(session, data)
    except service.TaskNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    except UnknownTagIds as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}")
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.get("/{event_id}", response_model=EventOut)
async def get_event(event_id: int, session: AsyncSession = Depends(get_session)):
    event = await service.get_event(session, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return event


@router.patch("/{event_id}", response_model=EventOut)
async def update_event(
    event_id: int, data: EventUpdate, session: AsyncSession = Depends(get_session)
):
    try:
        event = await service.update_event(session, event_id, data)
    except UnknownTagIds as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}")
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return event


@router.post("/{event_id}/move", response_model=EventOut)
async def move_event(event_id: int, data: EventMove, session: AsyncSession = Depends(get_session)):
    event = await service.move_event(session, event_id, data.start_at)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event_id: int, session: AsyncSession = Depends(get_session)):
    if not await service.delete_event(session, event_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
