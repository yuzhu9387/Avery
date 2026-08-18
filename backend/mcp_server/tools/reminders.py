"""avery_reminders: nudges attached to to-dos."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from mcp_server.shared import (
    _check_action,
    _get_client,
    _omit_none,
    _require_naive_local,
    mcp,
)

_ACTIONS = ("list", "get", "create", "update", "delete")


def _require(value: Any, name: str, action: str) -> Any:
    if value is None:
        raise ValueError(f"action {action!r} requires {name}.")
    return value


@mcp.tool()
async def avery_reminders(
    action: Annotated[str, Field(description=f"One of: {', '.join(_ACTIONS)}.")],
    reminder_id: Annotated[int | None, Field(description="Which reminder. Required for get, update, delete.")] = None,
    task_id: Annotated[int | None, Field(description="Which to-do this reminds about. Required on create.")] = None,
    remind_at: Annotated[str | None, Field(description='When to fire, naive local "YYYY-MM-DDTHH:MM:SS". No "Z", no "+HH:MM".')] = None,
    channel: Annotated[str | None, Field(description='"inapp", "lark" or "both". All behave as in-app today.')] = None,
    dismissed_at: Annotated[str | None, Field(description="Mark the reminder dismissed at this naive local time.")] = None,
) -> object:
    """Create, read, change and delete reminders on to-dos.

    Reminders attach to to-dos, never to calendar slots: task_id is required.
    A background job sweeps every 15 minutes and marks due reminders.

    channel offers "inapp", "lark" or "both", but nothing sends Lark
    notifications today -- every channel behaves as in-app only. Do not tell
    the user a Lark reminder will reach them.

    Un-dismissing is not expressible here: Avery clears dismissed_at by
    accepting an explicit null, and this tool omits unset parameters rather
    than sending nulls. Delete and recreate the reminder instead.

    Args:
        action: One of list, get, create, update, delete.
        reminder_id: Which reminder, for the single-reminder actions.
        task_id: Which to-do the reminder is about.
        remind_at: When it fires, naive local.
        channel: inapp, lark or both.
        dismissed_at: When it was dismissed, naive local.
    """
    _check_action(action, _ACTIONS, "avery_reminders")
    client = _get_client()

    if remind_at is not None:
        _require_naive_local(remind_at, "remind_at")
    if dismissed_at is not None:
        _require_naive_local(dismissed_at, "dismissed_at")

    if action == "list":
        return await client.get("/api/reminders")

    if action == "get":
        _require(reminder_id, "reminder_id", action)
        return await client.get(f"/api/reminders/{reminder_id}")

    if action == "create":
        _require(task_id, "task_id", action)
        _require(remind_at, "remind_at", action)
        body = _omit_none({
            "task_id": task_id, "remind_at": remind_at, "channel": channel,
        })
        return await client.post("/api/reminders", json=body)

    if action == "update":
        _require(reminder_id, "reminder_id", action)
        body = _omit_none({
            "remind_at": remind_at, "channel": channel,
            "dismissed_at": dismissed_at,
        })
        return await client.patch(f"/api/reminders/{reminder_id}", json=body)

    _require(reminder_id, "reminder_id", action)
    await client.delete(f"/api/reminders/{reminder_id}")
    return {"deleted": reminder_id}
