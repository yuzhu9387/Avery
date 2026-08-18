"""avery_tags: the categories that every ratio and hour total groups on."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from mcp_server.shared import _check_action, _get_client, _omit_none, mcp

_ACTIONS = ("list", "get", "create", "update", "delete", "archive")


def _require(value: Any, name: str, action: str) -> Any:
    if value is None:
        raise ValueError(f"action {action!r} requires {name}.")
    return value


@mcp.tool()
async def avery_tags(
    action: Annotated[str, Field(description=f"One of: {', '.join(_ACTIONS)}.")],
    tag_id: Annotated[int | None, Field(description="Which category. Required for get, update, delete, archive.")] = None,
    name: Annotated[str | None, Field(description='What the category is called, e.g. "Work".')] = None,
    color: Annotated[str | None, Field(description='Hex colour, exactly "#RRGGBB" -- e.g. "#AA5566". Required on create.')] = None,
    description: Annotated[str | None, Field(description="What belongs in this category.")] = None,
    icon: Annotated[str | None, Field(description="Optional icon name.")] = None,
    sort_order: Annotated[int | None, Field(description="Where it sits in the sidebar; lower is higher.")] = None,
) -> object:
    """Create, read, change, archive and delete categories.

    Categories are what the ratio maths groups on, so changing them changes
    what every report means.

    delete refuses with a 409 when the category is still used, and the error
    names how many rows still reference it. When that happens, offer archive
    instead: archiving keeps historical hour totals intact, deleting would
    rewrite them.

    Args:
        action: One of list, get, create, update, delete, archive.
        tag_id: Which category, for the single-category actions.
        name: The category's name.
        color: Hex colour as "#RRGGBB".
        description: What belongs in it.
        icon: Optional icon name.
        sort_order: Sidebar position.
    """
    _check_action(action, _ACTIONS, "avery_tags")
    client = _get_client()

    if action == "list":
        return await client.get("/api/tags")

    if action == "get":
        _require(tag_id, "tag_id", action)
        return await client.get(f"/api/tags/{tag_id}")

    if action == "create":
        _require(name, "name", action)
        _require(color, "color", action)
        body = _omit_none({
            "name": name, "color": color, "description": description,
            "icon": icon, "sort_order": sort_order,
        })
        return await client.post("/api/tags", json=body)

    if action == "update":
        _require(tag_id, "tag_id", action)
        body = _omit_none({
            "name": name, "color": color, "description": description,
            "icon": icon, "sort_order": sort_order,
        })
        return await client.patch(f"/api/tags/{tag_id}", json=body)

    if action == "archive":
        _require(tag_id, "tag_id", action)
        return await client.post(f"/api/tags/{tag_id}/archive")

    _require(tag_id, "tag_id", action)
    await client.delete(f"/api/tags/{tag_id}")
    return {"deleted": tag_id}
