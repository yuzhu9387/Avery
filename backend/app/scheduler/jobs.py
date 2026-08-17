"""Background jobs. Each takes an explicit session and clock value so it is
directly testable without patching time or starting APScheduler.
"""

import logging
from datetime import date, datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session_factory
from app.models import Routine
from app.services import reminders as reminder_service
from app.services import routines as routine_service

logger = logging.getLogger(__name__)
_scheduler: AsyncIOScheduler | None = None


async def roll_next_week(session: AsyncSession, today: date) -> dict:
    """Materialize the week following `today` for EVERY user with an active routine.

    Idempotent — safe to run repeatedly. Returns a per-user summary. Every routine
    has a real owner (Routine.user_id is NOT NULL) — there is no pre-account data
    left to roll on anyone's behalf.
    """
    next_monday = today + timedelta(days=8 - today.isoweekday())

    owner_ids = (
        await session.scalars(
            select(Routine.user_id).where(Routine.is_active.is_(True)).distinct()
        )
    ).all()
    if not owner_ids:
        logger.warning("week roll skipped: no active routine for any user")
        return {"created": 0, "users": [], "skipped_reason": "no active routine"}

    users: list[dict] = []
    total_created = 0
    for owner_id in owner_ids:
        try:
            monday, created, skipped = await routine_service.materialize_week(
                session, next_monday, owner_id
            )
        except routine_service.NoActiveRoutine:  # pragma: no cover — raced away
            continue
        total_created += len(created)
        users.append(
            {
                "user_id": owner_id,
                "week_start": monday.isoformat(),
                "created": len(created),
                "skipped_days": [d.isoformat() for d in skipped],
            }
        )
    return {"created": total_created, "users": users}


async def sweep_reminders(session: AsyncSession, now: datetime) -> list[int]:
    """Mark every due reminder as sent. Returns the ids handled.

    Lark delivery is wired in during Plan 3; marking sent here already makes the
    sweep exactly-once.
    """
    due = await reminder_service.list_due(session, now)
    handled: list[int] = []
    for reminder in due:
        await reminder_service.mark_sent(session, reminder.id, now)
        handled.append(reminder.id)
    if handled:
        logger.info("dispatched %d reminder(s)", len(handled))
    return handled


async def _run_week_roll() -> None:
    # APScheduler catches job exceptions into its own logger and moves on. This job
    # runs unattended on a Sunday night, so a silent failure means a blank Monday with
    # nothing to explain it — record it under the app's logger with context too.
    try:
        async with async_session_factory() as session:
            result = await roll_next_week(session, date.today())
        logger.info("week roll: %s", result)
    except Exception:
        logger.exception("week roll failed")


async def _run_reminder_sweep() -> None:
    try:
        async with async_session_factory() as session:
            handled = await sweep_reminders(session, datetime.now())
        if handled:
            logger.info("reminder sweep dispatched %d reminder(s)", len(handled))
    except Exception:
        logger.exception("reminder sweep failed")


def start_scheduler() -> AsyncIOScheduler | None:
    global _scheduler
    if not settings.enable_scheduler:
        logger.info("scheduler disabled by config")
        return None
    if _scheduler is not None:
        # Starting twice would orphan the first scheduler: its thread keeps running and
        # shutdown_scheduler() can only ever reach whichever one the global points at.
        logger.warning("scheduler already running; ignoring duplicate start")
        return _scheduler
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        _run_week_roll,
        CronTrigger(day_of_week="sun", hour=settings.week_roll_hour, minute=0),
        id="week_roll",
        replace_existing=True,
    )
    _scheduler.add_job(
        _run_reminder_sweep,
        CronTrigger(minute="*/15"),
        id="reminder_sweep",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("scheduler started")
    return _scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
