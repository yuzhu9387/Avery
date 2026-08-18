"""avery_today -- the one cross-entity aggregation.

Moved verbatim out of server.py when the tools were split per entity; it is
deliberately not an `action` on avery_events, because "what does my day look
like" spans both the calendar and the to-do list.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from datetime import date as _date
from typing import Annotated

from pydantic import Field

from mcp_server.shared import _OPEN_TASK_STATUSES, _get_client, mcp


@mcp.tool()
async def avery_today(
    date: Annotated[
        str | None,
        Field(
            description=(
                "The day to look at, as \"YYYY-MM-DD\". Omit to use today."
            ),
        ),
    ] = None,
) -> dict:
    """One call to answer "what does my day look like": the day's calendar
    slots, the open to-dos, and anything overdue.

    Returns three separate lists -- do not merge them or treat one as a
    summary of another:

    - "schedule": calendar slots for the day (meetings, appointments,
      scheduled task cards), each with its time range, kind, and whether it's
      already marked done. This is everything on the calendar, not the to-do
      list.
    - "open_tasks": to-dos with status todo or doing, regardless of whether
      they have a due date or a calendar slot at all. Most to-dos have no
      slot -- that is normal, not something to fix by scheduling them.
    - "overdue": the subset of open_tasks whose due date is before the
      requested day.

    Args:
        date: The day to look at, as "YYYY-MM-DD". Defaults to today.
    """
    client = _get_client()
    day = _date.fromisoformat(date) if date else _date.today()
    day_start = datetime.combine(day, datetime.min.time())
    day_end = day_start + timedelta(days=1)

    events = await client.get(
        "/api/events",
        params={"start": day_start.isoformat(), "end": day_end.isoformat()},
    )
    tasks = await client.get("/api/tasks")

    schedule = [
        {
            "event_id": e["id"],
            "title": e["title"],
            "start_at": e["start_at"],
            "end_at": e["end_at"],
            "kind": e["kind"],
            "task_id": e["task_id"],
            "done": e["completed_at"] is not None,
        }
        for e in events
    ]

    open_tasks = [t for t in tasks if t["status"] in _OPEN_TASK_STATUSES]
    overdue = [
        t for t in open_tasks if t["due_date"] is not None and t["due_date"] < day.isoformat()
    ]

    def _task_summary(t: dict) -> dict:
        return {
            "task_id": t["id"],
            "name": t["name"],
            "due_date": t["due_date"],
            "priority": t["priority"],
            "status": t["status"],
        }

    return {
        "date": day.isoformat(),
        "schedule": schedule,
        "open_tasks": [_task_summary(t) for t in open_tasks],
        "overdue": [_task_summary(t) for t in overdue],
    }
