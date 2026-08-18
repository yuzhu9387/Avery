"""avery_events: everything that occupies a slot on the calendar."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from mcp_server.shared import (
    _KIND_EVENT,
    _SOURCE_AGENT,
    _check_action,
    _get_client,
    _omit_none,
    _require_naive_local,
    mcp,
)

_ACTIONS = (
    "list", "get", "create", "update", "delete",
    "move", "complete", "uncomplete", "roll_over",
)


def _require(value: Any, name: str, action: str) -> Any:
    if value is None:
        raise ValueError(f"action {action!r} requires {name}.")
    return value


@mcp.tool()
async def avery_events(
    action: Annotated[str, Field(description=f"One of: {', '.join(_ACTIONS)}.")],
    event_id: Annotated[int | None, Field(description="Which event. Required for get, update, delete, move, complete, uncomplete.")] = None,
    title: Annotated[str | None, Field(description='What to call this slot, e.g. "Dentist appointment".')] = None,
    start_at: Annotated[str | None, Field(description='Naive local start, "YYYY-MM-DDTHH:MM:SS". No "Z", no "+HH:MM".')] = None,
    end_at: Annotated[str | None, Field(description='Naive local end, "YYYY-MM-DDTHH:MM:SS".')] = None,
    kind: Annotated[str | None, Field(description='"event" (time you spent) or "task" (a to-do with a slot and a checkbox). Defaults to "event".')] = None,
    tag_ids: Annotated[list[int] | None, Field(description="Category ids from avery_tags.")] = None,
    notes: Annotated[str | None, Field(description="Free text.")] = None,
    task_id: Annotated[int | None, Field(description="Schedule an EXISTING to-do into this slot. Omit unless the user explicitly ties them together.")] = None,
    start: Annotated[str | None, Field(description='action="list": window start, naive local.')] = None,
    end: Annotated[str | None, Field(description='action="list": window end, naive local.')] = None,
    event_ids: Annotated[list[int] | None, Field(description='action="roll_over": which events to move.')] = None,
    to_date: Annotated[str | None, Field(description='action="roll_over": target day, "YYYY-MM-DD".')] = None,
) -> object:
    """Create, read, change, move, complete and delete calendar slots.

    An Event is a slot on the calendar; a Task is a to-do. They are separate
    lists and one does not create the other. Booking a meeting must NOT also
    put an entry on the to-do list -- pass task_id only when the user
    explicitly says this slot is for an existing to-do. To record a to-do with
    no time attached, use avery_tasks, not this tool.

    kind="task" is the exception: it creates a task CARD, a to-do that also
    occupies a slot, and Avery mints the backing Task itself. Do not also call
    avery_tasks for it.

    delete is permanent and there is no undo. Confirm with the user before
    calling it; to clear a completed slot, prefer leaving it as history.

    Args:
        action: Which operation. One of list, get, create, update, delete,
            move, complete, uncomplete, roll_over.
        event_id: Which event, for the single-event actions.
        title: The slot's name.
        start_at: Naive local start time.
        end_at: Naive local end time.
        kind: "event" or "task".
        tag_ids: Category ids.
        notes: Free text.
        task_id: An existing to-do to attach.
        start: Window start for list.
        end: Window end for list.
        event_ids: Which events roll_over moves.
        to_date: The day roll_over moves them to.
    """
    _check_action(action, _ACTIONS, "avery_events")
    client = _get_client()

    if start_at is not None:
        _require_naive_local(start_at, "start_at")
    if end_at is not None:
        _require_naive_local(end_at, "end_at")
    if start is not None:
        _require_naive_local(start, "start")
    if end is not None:
        _require_naive_local(end, "end")

    if action == "list":
        params = _omit_none({"start": start, "end": end})
        return await client.get("/api/events", params=params or None)

    if action == "get":
        _require(event_id, "event_id", action)
        return await client.get(f"/api/events/{event_id}")

    if action == "create":
        _require(start_at, "start_at", action)
        _require(end_at, "end_at", action)
        _require(title, "title", action)
        body = _omit_none({
            "title": title,
            "start_at": start_at,
            "end_at": end_at,
            "kind": kind or _KIND_EVENT,
            "source": _SOURCE_AGENT,
            "tag_ids": tag_ids,
            "notes": notes,
            "task_id": task_id,
        })
        # A task card's backing Task takes its name from task_name on Avery
        # versions predating 2026-08-17; sending both is correct on every
        # version and never creates a second Task.
        if body["kind"] == "task" and task_id is None:
            body["task_name"] = title
        return await client.post("/api/events", json=body)

    if action == "update":
        _require(event_id, "event_id", action)
        body = _omit_none({
            "title": title, "start_at": start_at, "end_at": end_at,
            "tag_ids": tag_ids, "notes": notes,
        })
        return await client.patch(f"/api/events/{event_id}", json=body)

    if action == "delete":
        _require(event_id, "event_id", action)
        await client.delete(f"/api/events/{event_id}")
        return {"deleted": event_id}

    if action == "move":
        _require(event_id, "event_id", action)
        _require(start_at, "start_at", action)
        return await client.post(
            f"/api/events/{event_id}/move", json={"start_at": start_at}
        )

    if action in ("complete", "uncomplete"):
        _require(event_id, "event_id", action)
        return await client.post(f"/api/events/{event_id}/{action}")

    _require(event_ids, "event_ids", action)
    _require(to_date, "to_date", action)
    return await client.post(
        "/api/events/roll-over", json={"event_ids": event_ids, "to_date": to_date}
    )
