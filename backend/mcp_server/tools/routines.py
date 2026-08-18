"""avery_routines and avery_routine_blocks: the weekly template and its slots.

Two tools rather than one because a block is addressed differently from the
routine that owns it -- and, in Avery's routing, on a different prefix.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from mcp_server.shared import _check_action, _get_client, _omit_none, mcp

_ROUTINE_ACTIONS = (
    "list", "get", "active", "create", "update", "delete", "preview", "materialize",
)
_BLOCK_ACTIONS = ("create", "update", "delete")


def _require(value: Any, name: str, action: str) -> Any:
    if value is None:
        raise ValueError(f"action {action!r} requires {name}.")
    return value


@mcp.tool()
async def avery_routines(
    action: Annotated[str, Field(description=f"One of: {', '.join(_ROUTINE_ACTIONS)}.")],
    routine_id: Annotated[int | None, Field(description="Which routine. Required for get, update, delete.")] = None,
    name: Annotated[str | None, Field(description='What to call this version, e.g. "Autumn term".')] = None,
    note: Annotated[str | None, Field(description="Why this version exists -- the part that cannot be reconstructed from its blocks later.")] = None,
    is_active: Annotated[bool | None, Field(description="Make this the routine that materialising uses. Setting it true retires whichever was active.")] = None,
    copy_blocks_from_active: Annotated[bool | None, Field(description='action="create": start from the active routine\'s blocks instead of empty.')] = None,
    routine_ref: Annotated[str | None, Field(description='action="preview": a routine id, or "active".')] = None,
    any_day: Annotated[str | None, Field(description='Any day inside the target week, "YYYY-MM-DD". Used by preview and materialize.')] = None,
) -> object:
    """Read and change the weekly routine, and stamp it onto a real week.

    A routine is a named, versioned weekly template. One routine is active;
    materialising a week stamps its blocks out as real events.

    There is no separate activate action: set is_active=true via update.
    There is no separate fork action: create with copy_blocks_from_active=true,
    which is almost always what "a new version" means -- starting empty is how
    an active routine ends up generating blank weeks.

    materialize skips any day that already has events, so it never overwrites
    work already recorded. A "partial" result is correct, not a failure to
    retry.

    preview writes nothing: it shows what a week WOULD materialise.

    Args:
        action: One of list, get, active, create, update, delete, preview,
            materialize.
        routine_id: Which routine, for the single-routine actions.
        name: The version's name.
        note: Why this version exists.
        is_active: Whether this is the routine materialising uses.
        copy_blocks_from_active: Fork the active routine's blocks on create.
        routine_ref: Which routine preview reads -- an id or "active".
        any_day: Any day inside the target week.
    """
    _check_action(action, _ROUTINE_ACTIONS, "avery_routines")
    client = _get_client()

    if action == "list":
        return await client.get("/api/routines")

    if action == "active":
        return await client.get("/api/routines/active")

    if action == "get":
        _require(routine_id, "routine_id", action)
        return await client.get(f"/api/routines/{routine_id}")

    if action == "create":
        _require(name, "name", action)
        body = _omit_none({
            "name": name, "note": note, "is_active": is_active,
            "copy_blocks_from_active": copy_blocks_from_active,
        })
        return await client.post("/api/routines", json=body)

    if action == "update":
        _require(routine_id, "routine_id", action)
        body = _omit_none({"name": name, "note": note, "is_active": is_active})
        return await client.patch(f"/api/routines/{routine_id}", json=body)

    if action == "delete":
        _require(routine_id, "routine_id", action)
        await client.delete(f"/api/routines/{routine_id}")
        return {"deleted": routine_id}

    if action == "preview":
        _require(routine_ref, "routine_ref", action)
        _require(any_day, "any_day", action)
        return await client.get(f"/api/routines/{routine_ref}/preview/{any_day}")

    _require(any_day, "any_day", action)
    return await client.post(f"/api/weeks/{any_day}/materialize")


@mcp.tool()
async def avery_routine_blocks(
    action: Annotated[str, Field(description=f"One of: {', '.join(_BLOCK_ACTIONS)}.")],
    routine_id: Annotated[int | None, Field(description='action="create": which routine gets the new block.')] = None,
    block_id: Annotated[int | None, Field(description="Which block. Required for update and delete.")] = None,
    days: Annotated[list[int] | None, Field(description="Which weekdays this block repeats on. 1=Monday through 7=Sunday.")] = None,
    start_time: Annotated[str | None, Field(description='Wall-clock start, "HH:MM". No date, no timezone.')] = None,
    end_time: Annotated[str | None, Field(description='Wall-clock end, "HH:MM".')] = None,
    task_name: Annotated[str | None, Field(description='What this slot is, e.g. "Work".')] = None,
    tag_ids: Annotated[list[int] | None, Field(description="Category ids from avery_tags.")] = None,
    sort_order: Annotated[int | None, Field(description="Position among the routine's blocks.")] = None,
) -> object:
    """Add, change and remove the recurring slots inside a routine.

    Blocks are the recurring slots inside a routine ("Work, Mon-Fri
    09:30-16:30"). days uses 1=Monday through 7=Sunday. Times are "HH:MM",
    wall-clock, with no date and no timezone.

    There is no list action: a routine's blocks come back embedded in
    avery_routines get.

    Editing a block changes future materialised weeks only. Events already
    stamped out keep the values they were created with.

    Args:
        action: One of create, update, delete.
        routine_id: Which routine a new block belongs to.
        block_id: Which block, for update and delete.
        days: Weekdays, 1=Monday through 7=Sunday.
        start_time: Wall-clock start as "HH:MM".
        end_time: Wall-clock end as "HH:MM".
        task_name: What the slot is.
        tag_ids: Category ids.
        sort_order: Position among the routine's blocks.
    """
    _check_action(action, _BLOCK_ACTIONS, "avery_routine_blocks")
    client = _get_client()

    body = _omit_none({
        "days": days, "start_time": start_time, "end_time": end_time,
        "task_name": task_name, "tag_ids": tag_ids, "sort_order": sort_order,
    })

    if action == "create":
        _require(routine_id, "routine_id", action)
        return await client.post(f"/api/routines/{routine_id}/blocks", json=body)

    if action == "update":
        _require(block_id, "block_id", action)
        return await client.patch(f"/api/routine-blocks/{block_id}", json=body)

    _require(block_id, "block_id", action)
    await client.delete(f"/api/routine-blocks/{block_id}")
    return {"deleted": block_id}
