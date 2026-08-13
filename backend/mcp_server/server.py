"""The FastMCP instance and Avery's four intent-shaped tools.

Avery has ~40 REST endpoints; exposing them 1:1 would flood the model's tool
list and wreck tool selection. These four map onto the things a user actually
asks for ("what's my day look like", "book this", "remind me to", "mark that
done") rather than onto Avery's routers.

The one rule every tool here defers to: an Event is a slot on the calendar,
a Task is a to-do, and the two are separate lists that do not create each
other except where the user explicitly says so (avery_schedule's task_id).
Getting that backwards means Claude litters the user's to-do list with a
phantom entry every time it books a meeting -- see avery_schedule's
docstring for the mechanics.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from datetime import date as _date
from typing import Annotated

from pydantic import Field

from mcp.server.fastmcp import FastMCP

from mcp_server.client import AveryClient, AveryConfigError

mcp = FastMCP(
    name="avery",
    instructions=(
        "Avery is the user's personal calendar and to-do list. Use avery_today "
        "to see what's going on, avery_schedule to book calendar time, "
        "avery_capture_task to record a to-do with no time attached, and "
        "avery_complete to mark either kind of thing done. The calendar and "
        "the to-do list are separate: booking time for something does not, by "
        "itself, put it on the to-do list, and finishing a to-do does not, by "
        "itself, mark any calendar slot as having happened."
    ),
)

# Constants for values this server writes into Avery, kept as plain strings
# (matching app/models/event.py's EventKind/EventSource) rather than importing
# Avery's app package -- this server only ever talks to Avery over HTTP, even
# though the two happen to share a repo and a venv today.
_KIND_EVENT = "event"
_SOURCE_AGENT = "agent"
_STATUS_DONE = "done"
_OPEN_TASK_STATUSES = {"todo", "doing"}

_client: AveryClient | None = None


def ensure_client_ready() -> AveryClient:
    """Construct (or return) the one AveryClient for this process.

    Called explicitly by __main__.py before mcp.run(), so a missing or blank
    AVERY_AGENT_TOKEN raises AveryConfigError -- and the process exits with a
    clear message -- at startup, rather than surfacing as a confusing failure
    on whatever tool call happens to run first.
    """
    global _client
    if _client is None:
        _client = AveryClient()
    return _client


def _get_client() -> AveryClient:
    try:
        return ensure_client_ready()
    except AveryConfigError:
        # Re-raised as-is: tests and __main__ both want the same message, and
        # FastMCP's call_tool handler will stringify it for the model exactly
        # like any other tool error.
        raise


def _require_naive_local(value: str, field_name: str) -> str:
    """Reject a date-time string that carries a timezone offset or 'Z'.

    Avery stores naive local datetimes and treats whatever string it's given
    as the user's own wall-clock time. A tz-suffixed string would still parse
    -- Python happily builds an aware datetime from it -- and Avery would then
    store that offset's clock time verbatim, silently shifting the event by
    whatever the offset was. Catching it here, before the request leaves this
    process, turns that into a clear error instead of a wrong-hour meeting.
    """
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError(
            f"{field_name}={value!r} is not a valid date-time. Use naive local "
            f"time as \"YYYY-MM-DDTHH:MM:SS\", e.g. \"2026-08-13T14:30:00\"."
        ) from None
    if parsed.tzinfo is not None:
        raise ValueError(
            f"{field_name}={value!r} carries a timezone offset. Avery stores "
            f"naive local date-times only -- send \"YYYY-MM-DDTHH:MM:SS\" with "
            f"no \"Z\" and no \"+HH:MM\" suffix, or the event will silently "
            f"land on the wrong hour."
        )
    return value


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


@mcp.tool()
async def avery_schedule(
    title: Annotated[str, Field(description='What to call this slot on the calendar, e.g. "Dentist appointment".')],
    start_at: Annotated[
        str,
        Field(description='Local start date-time, "YYYY-MM-DDTHH:MM:SS" -- no timezone suffix.'),
    ],
    end_at: Annotated[
        str,
        Field(description='Local end date-time, "YYYY-MM-DDTHH:MM:SS" -- no timezone suffix. Must be after start_at.'),
    ],
    task_id: Annotated[
        int | None,
        Field(
            description=(
                "Only set this when the user is explicitly scheduling time for "
                "a to-do that already exists in Avery (they named it, or you "
                "already have its id from avery_today or avery_capture_task). "
                "Omit it for every ordinary booking -- do not invent an id, and "
                "do not call avery_capture_task first \"just in case\"."
            ),
        ),
    ] = None,
    notes: Annotated[str, Field(description="Optional free-text notes for the slot.")] = "",
    tag_ids: Annotated[
        list[int] | None, Field(description="Optional list of existing tag ids to attach.")
    ] = None,
) -> dict:
    """Put something on the calendar as a plain event -- a slot with a start and end time.

    Use this for booking meetings, appointments, calls, or blocking time --
    anything that has a specific place on the calendar. This tool NEVER
    creates a to-do: a plain event carries its own title and stands on its
    own, because Avery's calendar and its to-do list are deliberately
    separate. Booking a dentist appointment must not put "dentist" on the
    user's to-do list.

    If the user is explicitly scheduling time for a to-do that already
    exists in Avery, pass its id as task_id -- this links the new slot to
    that to-do without creating a second one. Do not pass task_id for an
    ordinary booking, and never invent an id.

    start_at and end_at are naive local date-times, "YYYY-MM-DDTHH:MM:SS"
    (e.g. "2026-08-13T14:30:00"). No "Z", no "+00:00", no offset of any
    kind -- Avery stores these as the user's own wall-clock time exactly as
    given, and a timezone-suffixed string will silently land on the wrong
    hour instead of being converted.
    """
    client = _get_client()
    start_at = _require_naive_local(start_at, "start_at")
    end_at = _require_naive_local(end_at, "end_at")

    payload: dict = {
        "title": title,
        "start_at": start_at,
        "end_at": end_at,
        "kind": _KIND_EVENT,
        "source": _SOURCE_AGENT,
        "notes": notes,
        "tag_ids": tag_ids or [],
    }
    if task_id is not None:
        payload["task_id"] = task_id
    else:
        # EventCreate requires task_id or task_name even for a plain event --
        # task_name is not used to mint anything here (kind stays "event"),
        # it just satisfies that either/or and gives the server a name to
        # fall back on if title is ever blank.
        payload["task_name"] = title

    event = await client.post("/api/events", json=payload)
    return {
        "event_id": event["id"],
        "title": event["title"],
        "start_at": event["start_at"],
        "end_at": event["end_at"],
        "kind": event["kind"],
        "task_id": event["task_id"],
        "source": event["source"],
    }


@mcp.tool()
async def avery_capture_task(
    name: Annotated[str, Field(description='The to-do itself, e.g. "Renew passport".')],
    due_date: Annotated[
        str | None, Field(description='Optional date it\'s due by, "YYYY-MM-DD". Omit if the user gave no date.')
    ] = None,
    notes: Annotated[str, Field(description="Optional free-text notes.")] = "",
    priority: Annotated[
        str,
        Field(description='"low", "normal", or "high". Only set this away from "normal" when the user signals urgency.'),
    ] = "normal",
) -> dict:
    """Record a to-do on Avery's list, without putting it on the calendar.

    Use this when the user wants to remember to do something but hasn't
    said when -- "remind me to renew my passport", "add 'call the plumber'
    to my list". This never creates a calendar slot. There is deliberately
    no time argument here: if the user also wants a specific time for this
    to-do, capture it here first, then call avery_schedule with the task_id
    this returns to put it on the calendar as a second step.
    """
    client = _get_client()
    payload = {
        "name": name,
        "notes": notes,
        "due_date": due_date,
        "priority": priority,
    }
    task = await client.post("/api/tasks", json=payload)
    return {
        "task_id": task["id"],
        "name": task["name"],
        "due_date": task["due_date"],
        "priority": task["priority"],
        "status": task["status"],
    }


@mcp.tool()
async def avery_complete(
    event_id: Annotated[
        int | None, Field(description="The id of a calendar event to mark as happened.")
    ] = None,
    task_id: Annotated[
        int | None, Field(description="The id of a to-do to mark as finished.")
    ] = None,
) -> dict:
    """Mark something done -- pass exactly one of event_id or task_id. They mean different things.

    - event_id: marks that calendar slot as having happened
      (Event.completed_at). Use this for "I'm done with my 2pm" or "mark the
      dentist appointment complete". If that slot is a task card
      (kind="task"), Avery syncs the underlying to-do's status for you --
      you do not also need to pass task_id.
    - task_id: marks that to-do itself as finished (Task.status="done"),
      independent of any calendar slot. Use this for "I finished renewing my
      passport" when there was never a specific appointment for it.

    Passing the wrong id marks the wrong thing: completing an event never
    finishes an unrelated to-do, and completing a to-do never touches a
    calendar slot that didn't schedule it.
    """
    if (event_id is None) == (task_id is None):
        raise ValueError(
            "avery_complete takes exactly one of event_id or task_id, not both "
            "and not neither -- they mark different things done."
        )
    client = _get_client()

    if event_id is not None:
        event = await client.post(f"/api/events/{event_id}/complete")
        return {
            "completed": "event",
            "event_id": event["id"],
            "title": event["title"],
            "completed_at": event["completed_at"],
            "task_id": event["task_id"],
        }

    task = await client.patch(f"/api/tasks/{task_id}", json={"status": _STATUS_DONE})
    return {
        "completed": "task",
        "task_id": task["id"],
        "name": task["name"],
        "status": task["status"],
        "completed_at": task["completed_at"],
    }
