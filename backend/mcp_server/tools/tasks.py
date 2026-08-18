"""avery_tasks: to-dos, with or without a slot on the calendar."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from mcp_server.shared import _check_action, _get_client, _omit_none, mcp

_ACTIONS = ("list", "get", "create", "update", "archive", "stats")


def _require(value: Any, name: str, action: str) -> Any:
    if value is None:
        raise ValueError(f"action {action!r} requires {name}.")
    return value


@mcp.tool()
async def avery_tasks(
    action: Annotated[str, Field(description=f"One of: {', '.join(_ACTIONS)}.")],
    task_id: Annotated[int | None, Field(description="Which to-do. Required for get, update, archive, stats.")] = None,
    name: Annotated[str | None, Field(description='What the to-do is, e.g. "Renew passport".')] = None,
    due_date: Annotated[str | None, Field(description='When it is due, "YYYY-MM-DD".')] = None,
    status: Annotated[str | None, Field(description='"todo", "doing", "done" or "archived".')] = None,
    priority: Annotated[str | None, Field(description='"low", "normal" or "high".')] = None,
    tag_ids: Annotated[list[int] | None, Field(description="Category ids from avery_tags.")] = None,
    notes: Annotated[str | None, Field(description="Free text.")] = None,
    est_minutes: Annotated[int | None, Field(description="Rough size in minutes.")] = None,
    include_archived: Annotated[bool | None, Field(description='action="list": include archived to-dos. Defaults to false.')] = None,
) -> object:
    """Create, read, change and archive to-dos.

    A Task is a to-do; an Event is a slot on the calendar. They are separate
    lists. Recording a to-do here does NOT put time on the calendar, and
    marking one done here does NOT mark any calendar slot as having happened.
    To give a to-do a slot, use avery_events with kind="task".

    There is no hard delete: action="archive" is the strongest removal Avery
    offers, and it keeps the row so historical hour totals stay honest. Set
    status="done" to complete a to-do; archive is for ones that turned out not
    to matter.

    Args:
        action: One of list, get, create, update, archive, stats.
        task_id: Which to-do, for the single-task actions.
        name: What the to-do is.
        due_date: Due day as "YYYY-MM-DD".
        status: todo, doing, done or archived.
        priority: low, normal or high.
        tag_ids: Category ids.
        notes: Free text.
        est_minutes: Rough size in minutes.
        include_archived: Whether list includes archived to-dos.
    """
    _check_action(action, _ACTIONS, "avery_tasks")
    client = _get_client()

    if action == "list":
        params = _omit_none({"include_archived": include_archived})
        return await client.get("/api/tasks", params=params or None)

    if action == "get":
        _require(task_id, "task_id", action)
        return await client.get(f"/api/tasks/{task_id}")

    if action == "stats":
        _require(task_id, "task_id", action)
        return await client.get(f"/api/tasks/{task_id}/stats")

    if action == "create":
        _require(name, "name", action)
        body = _omit_none({
            "name": name, "due_date": due_date, "status": status,
            "priority": priority, "tag_ids": tag_ids, "notes": notes,
            "est_minutes": est_minutes,
        })
        return await client.post("/api/tasks", json=body)

    if action == "update":
        _require(task_id, "task_id", action)
        body = _omit_none({
            "name": name, "due_date": due_date, "status": status,
            "priority": priority, "tag_ids": tag_ids, "notes": notes,
            "est_minutes": est_minutes,
        })
        return await client.patch(f"/api/tasks/{task_id}", json=body)

    _require(task_id, "task_id", action)
    await client.delete(f"/api/tasks/{task_id}")
    return {"archived": task_id}
