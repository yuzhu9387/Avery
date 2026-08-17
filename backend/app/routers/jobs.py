"""HTTP triggers for the background jobs in app/scheduler/jobs.py, meant to be
called by Cloud Scheduler instead of an in-process APScheduler cron.

On Cloud Run the service scales to zero and may run several instances of the
same revision concurrently, so an in-process cron tick fires zero times
(nothing running when the tick happens) or N times (every instance fires at
once) — never the once-only semantics a weekly roll or a reminder sweep
needs. Cloud Scheduler calling a stable HTTP endpoint fixes that: exactly one
caller, on a real schedule, independent of how many (if any) app instances
happen to be up.

These endpoints call the exact same functions app/scheduler/jobs.py's
in-process scheduler calls (roll_next_week, sweep_reminders) — see that
module for start_scheduler/shutdown_scheduler, still used for local dev via
ENABLE_SCHEDULER. Routing both paths through the same functions means the
job logic itself cannot drift between "cron on my laptop" and "Cloud
Scheduler in prod".

Both endpoints are idempotent, by inheriting idempotency from the functions
they call rather than adding any of their own: materialize_week (used by
roll_next_week) skips any day that already holds an event, so replaying a
roll never double-books a day; sweep_reminders only ever selects reminders
with sent_at IS NULL and sets sent_at on the way out, so a reminder already
marked sent is excluded from the next sweep. A retried or overlapping Cloud
Scheduler invocation is therefore safe to just run again.

Auth is a shared secret (see verify_jobs_token in app/deps.py), not
get_current_user — there is no user in a cron request, and these mutate
every user's data, so they must not be reachable through ordinary session or
agent-token auth either.
"""

from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.deps import verify_jobs_token
from app.scheduler import jobs as job_service

router = APIRouter(
    prefix="/api/jobs",
    tags=["jobs"],
    dependencies=[Depends(verify_jobs_token)],
)


class RollWeekRequest(BaseModel):
    # Override for replaying a specific date; defaults to the real clock.
    today: date | None = None


class SweepRemindersRequest(BaseModel):
    now: datetime | None = None


@router.post("/roll-week")
async def roll_week(
    body: RollWeekRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    today = (body.today if body else None) or date.today()
    return await job_service.roll_next_week(session, today)


@router.post("/sweep-reminders")
async def sweep_reminders(
    body: SweepRemindersRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    now = (body.now if body else None) or datetime.now()
    handled = await job_service.sweep_reminders(session, now)
    return {"handled": handled}
