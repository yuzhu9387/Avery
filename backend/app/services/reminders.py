from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Reminder, Task
from app.schemas.reminder import ReminderCreate, ReminderUpdate


class TaskNotFound(Exception):
    """Raised when a reminder references a task that does not exist."""


async def list_reminders(
    session: AsyncSession, *, task_id: int | None = None, pending_only: bool = False
) -> list[Reminder]:
    stmt = select(Reminder).order_by(Reminder.remind_at)
    if task_id is not None:
        stmt = stmt.where(Reminder.task_id == task_id)
    if pending_only:
        stmt = stmt.where(Reminder.sent_at.is_(None), Reminder.dismissed_at.is_(None))
    return list((await session.scalars(stmt)).all())


async def get_reminder(session: AsyncSession, reminder_id: int) -> Reminder | None:
    return await session.get(Reminder, reminder_id)


async def create_reminder(session: AsyncSession, data: ReminderCreate) -> Reminder:
    if await session.get(Task, data.task_id) is None:
        raise TaskNotFound(data.task_id)
    reminder = Reminder(**data.model_dump())
    session.add(reminder)
    await session.commit()
    await session.refresh(reminder)
    return reminder


async def update_reminder(
    session: AsyncSession, reminder_id: int, data: ReminderUpdate
) -> Reminder | None:
    reminder = await session.get(Reminder, reminder_id)
    if reminder is None:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(reminder, key, value)
    await session.commit()
    await session.refresh(reminder)
    return reminder


async def delete_reminder(session: AsyncSession, reminder_id: int) -> bool:
    reminder = await session.get(Reminder, reminder_id)
    if reminder is None:
        return False
    await session.delete(reminder)
    await session.commit()
    return True


async def list_due(session: AsyncSession, now: datetime) -> list[Reminder]:
    stmt = (
        select(Reminder)
        .where(
            Reminder.remind_at <= now,
            Reminder.sent_at.is_(None),
            Reminder.dismissed_at.is_(None),
        )
        .order_by(Reminder.remind_at)
    )
    return list((await session.scalars(stmt)).all())


async def mark_sent(session: AsyncSession, reminder_id: int, when: datetime) -> Reminder | None:
    reminder = await session.get(Reminder, reminder_id)
    if reminder is None:
        return None
    reminder.sent_at = when
    await session.commit()
    await session.refresh(reminder)
    return reminder
