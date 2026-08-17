from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Reminder, Task
from app.models.task import TaskStatus
from app.schemas.reminder import ReminderCreate, ReminderUpdate


class TaskNotFound(Exception):
    """Raised when a reminder references a task that does not exist."""


def _not_archived() -> Any:
    """A reminder belongs to a task; an archived task's reminders are dormant."""
    return Reminder.task_id.in_(
        select(Task.id).where(Task.status != TaskStatus.ARCHIVED)
    )


async def list_reminders(
    session: AsyncSession,
    user_id: int,
    *,
    task_id: int | None = None,
    pending_only: bool = False,
) -> list[Reminder]:
    stmt = (
        select(Reminder)
        .where(_not_archived(), Reminder.user_id == user_id)
        .order_by(Reminder.remind_at)
    )
    if task_id is not None:
        stmt = stmt.where(Reminder.task_id == task_id)
    if pending_only:
        stmt = stmt.where(Reminder.sent_at.is_(None), Reminder.dismissed_at.is_(None))
    return list((await session.scalars(stmt)).all())


async def get_reminder(
    session: AsyncSession, reminder_id: int, user_id: int
) -> Reminder | None:
    stmt = select(Reminder).where(Reminder.id == reminder_id, Reminder.user_id == user_id)
    return (await session.scalars(stmt)).first()


async def create_reminder(
    session: AsyncSession, data: ReminderCreate, user_id: int
) -> Reminder:
    task = (
        await session.scalars(
            select(Task).where(Task.id == data.task_id, Task.user_id == user_id)
        )
    ).first()
    if task is None:
        raise TaskNotFound(data.task_id)
    reminder = Reminder(user_id=user_id, **data.model_dump())
    session.add(reminder)
    await session.commit()
    await session.refresh(reminder)
    return reminder


async def update_reminder(
    session: AsyncSession, reminder_id: int, data: ReminderUpdate, user_id: int
) -> Reminder | None:
    reminder = await get_reminder(session, reminder_id, user_id)
    if reminder is None:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(reminder, key, value)
    await session.commit()
    await session.refresh(reminder)
    return reminder


async def delete_reminder(session: AsyncSession, reminder_id: int, user_id: int) -> bool:
    reminder = await get_reminder(session, reminder_id, user_id)
    if reminder is None:
        return False
    await session.delete(reminder)
    await session.commit()
    return True


async def list_due(session: AsyncSession, now: datetime) -> list[Reminder]:
    stmt = (
        select(Reminder)
        .where(
            _not_archived(),
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
