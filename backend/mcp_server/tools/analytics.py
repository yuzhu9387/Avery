"""avery_calendar and avery_analytics: reading the grid, and judging it."""

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

_CALENDAR_ACTIONS = ("week", "month")
_ANALYTICS_ACTIONS = ("evaluate",)


def _require(value: Any, name: str, action: str) -> Any:
    if value is None:
        raise ValueError(f"action {action!r} requires {name}.")
    return value


@mcp.tool()
async def avery_calendar(
    action: Annotated[str, Field(description=f"One of: {', '.join(_CALENDAR_ACTIONS)}.")],
    any_day: Annotated[str | None, Field(description='action="week": any day inside the week you want, "YYYY-MM-DD".')] = None,
    month: Annotated[str | None, Field(description='action="month": which month, "YYYY-MM".')] = None,
) -> object:
    """Read a whole week or month of the calendar at once.

    Read-only calendar payloads. week takes ANY day inside the week you want,
    not necessarily its Monday. month takes "YYYY-MM".

    Reading a week materialises it from the active routine if it has not been
    materialised yet -- that is expected, not a side effect to avoid.

    Args:
        action: One of week, month.
        any_day: Any day inside the week, for action="week".
        month: Which month, for action="month".
    """
    _check_action(action, _CALENDAR_ACTIONS, "avery_calendar")
    client = _get_client()

    if action == "week":
        _require(any_day, "any_day", action)
        return await client.get(f"/api/weeks/{any_day}")

    _require(month, "month", action)
    return await client.get(f"/api/months/{month}")


@mcp.tool()
async def avery_analytics(
    action: Annotated[str, Field(description=f"One of: {', '.join(_ANALYTICS_ACTIONS)}.")],
    period_start: Annotated[str | None, Field(description='Window start, naive local "YYYY-MM-DDTHH:MM:SS".')] = None,
    period_end: Annotated[str | None, Field(description='Window end, naive local. Exclusive.')] = None,
    rule_id: Annotated[int | None, Field(description="Judge against a specific rule version. Omit to use the active rule.")] = None,
) -> object:
    """Judge logged time against a ratio rule for an arbitrary window.

    Evaluates logged time against a rule and returns a verdict per group --
    on target, over, or under. Omit rule_id to use the active rule.

    A reversed period is rejected rather than returning every group "under",
    which would be indistinguishable from a month with nothing logged.

    Hidden categories still count: hiding changes only what the UI draws.

    Args:
        action: Only "evaluate".
        period_start: Window start, naive local.
        period_end: Window end, naive local and exclusive.
        rule_id: Which rule version to judge against.
    """
    _check_action(action, _ANALYTICS_ACTIONS, "avery_analytics")
    client = _get_client()

    _require(period_start, "period_start", action)
    _require(period_end, "period_end", action)
    _require_naive_local(period_start, "period_start")
    _require_naive_local(period_end, "period_end")

    body = _omit_none({
        "period_start": period_start, "period_end": period_end,
        "rule_id": rule_id,
    })
    return await client.post("/api/analytics/evaluate", json=body)
