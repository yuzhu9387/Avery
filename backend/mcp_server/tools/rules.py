"""avery_rules: the versioned ratio targets every report is judged against."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from mcp_server.shared import _check_action, _get_client, _omit_none, mcp

_ACTIONS = ("list", "get", "active", "create", "update", "delete")


def _require(value: Any, name: str, action: str) -> Any:
    if value is None:
        raise ValueError(f"action {action!r} requires {name}.")
    return value


@mcp.tool()
async def avery_rules(
    action: Annotated[str, Field(description=f"One of: {', '.join(_ACTIONS)}.")],
    rule_id: Annotated[int | None, Field(description="Which rule. Required for get, update, delete.")] = None,
    name: Annotated[str | None, Field(description='What to call this target, e.g. "6:3:1 baseline".')] = None,
    groups: Annotated[list[dict] | None, Field(description='The ratio groups. Each is {"key", "label", "ratio", "tag_ids"} -- ratios are relative weights, not percentages.')] = None,
    tolerance: Annotated[float | None, Field(description="How far off target still counts as on track, as a fraction. 0.2 means +/-20%.")] = None,
    exclude_tag_ids: Annotated[list[int] | None, Field(description="Categories dropped from the maths entirely -- typically sleep or commuting.")] = None,
    note: Annotated[str | None, Field(description="Why this version exists.")] = None,
) -> object:
    """Read and change the ratio targets time is measured against.

    A rule is a versioned ratio target -- e.g. 6 : 3 : 1 across Work & Study /
    Family care / Fitness, with a tolerance band.

    update does not edit in place: it closes the current version and opens a
    new one, so reports already run keep meaning exactly what they meant. Tell
    the user that when they ask to "change" a rule.

    Each group is {"key", "label", "ratio", "tag_ids"}; ratios are relative
    weights, not percentages. exclude_tag_ids drops time from the maths
    entirely -- typically sleep or commuting.

    delete refuses with a 409 when a report references the rule.

    Args:
        action: One of list, get, active, create, update, delete.
        rule_id: Which rule, for the single-rule actions.
        name: The rule's name.
        groups: The ratio groups.
        tolerance: Tolerance band as a fraction.
        exclude_tag_ids: Categories excluded from the maths.
        note: Why this version exists.
    """
    _check_action(action, _ACTIONS, "avery_rules")
    client = _get_client()

    if action == "list":
        return await client.get("/api/rules")

    if action == "active":
        return await client.get("/api/rules/active")

    if action == "get":
        _require(rule_id, "rule_id", action)
        return await client.get(f"/api/rules/{rule_id}")

    body = _omit_none({
        "name": name, "groups": groups, "tolerance": tolerance,
        "exclude_tag_ids": exclude_tag_ids, "note": note,
    })

    if action == "create":
        _require(name, "name", action)
        _require(groups, "groups", action)
        return await client.post("/api/rules", json=body)

    if action == "update":
        _require(rule_id, "rule_id", action)
        return await client.patch(f"/api/rules/{rule_id}", json=body)

    _require(rule_id, "rule_id", action)
    await client.delete(f"/api/rules/{rule_id}")
    return {"deleted": rule_id}
