"""The FastMCP instance and the helpers every tool module shares.

Split out of server.py because tool modules must import the instance to
register onto it while server.py must import the tool modules to trigger that
registration -- importing both from here breaks the cycle.
"""

from __future__ import annotations

from datetime import datetime

from mcp.server.fastmcp import FastMCP

from mcp_server.client import AveryClient, AveryConfigError

mcp = FastMCP(
    name="avery",
    instructions=(
        "Avery is the user's personal calendar and to-do list. Each tool covers "
        "one entity and takes an `action` naming what to do with it. Start with "
        "avery_today for \"what's going on\"; use avery_events for anything with "
        "a time slot, avery_tasks for to-dos, and the remaining tools for "
        "categories, routines, rules, reminders and reports. The calendar and "
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



def _omit_none(data: dict) -> dict:
    """Drop keys whose value is None.

    Avery's PATCH schemas treat "absent" as "leave alone" but reject an
    explicit null (every column behind them is NOT NULL), so a tool that
    forwarded its unset optional parameters verbatim would 422 on every
    partial update.
    """
    return {k: v for k, v in data.items() if v is not None}


def _check_action(action: str, valid: tuple[str, ...], tool: str) -> None:
    """Fail before the HTTP call, naming what this tool actually accepts.

    A model that guesses an action gets the list back and can retry in the
    same turn; letting it through would 404 or 405 against Avery and read as
    "Avery is broken" instead of "that action does not exist".
    """
    if action not in valid:
        raise ValueError(
            f"unknown action {action!r} for {tool}. "
            f"Valid actions: {', '.join(valid)}."
        )
