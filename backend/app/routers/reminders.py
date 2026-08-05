from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.reminder import ReminderCreate, ReminderOut, ReminderUpdate
from app.services import reminders as service

router = APIRouter(prefix="/api/reminders", tags=["reminders"])


@router.get("", response_model=list[ReminderOut])
async def list_reminders(
    task_id: int | None = None,
    pending_only: bool = False,
    session: AsyncSession = Depends(get_session),
):
    return await service.list_reminders(session, task_id=task_id, pending_only=pending_only)


@router.post("", response_model=ReminderOut, status_code=status.HTTP_201_CREATED)
async def create_reminder(data: ReminderCreate, session: AsyncSession = Depends(get_session)):
    try:
        return await service.create_reminder(session, data)
    except service.TaskNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")


@router.get("/{reminder_id}", response_model=ReminderOut)
async def get_reminder(reminder_id: int, session: AsyncSession = Depends(get_session)):
    reminder = await service.get_reminder(session, reminder_id)
    if reminder is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "reminder not found")
    return reminder


@router.patch("/{reminder_id}", response_model=ReminderOut)
async def update_reminder(
    reminder_id: int, data: ReminderUpdate, session: AsyncSession = Depends(get_session)
):
    reminder = await service.update_reminder(session, reminder_id, data)
    if reminder is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "reminder not found")
    return reminder


@router.delete("/{reminder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reminder(reminder_id: int, session: AsyncSession = Depends(get_session)):
    if not await service.delete_reminder(session, reminder_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "reminder not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
