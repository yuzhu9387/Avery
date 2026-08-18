"""avery_reports: monthly evaluations frozen against the rule that was active."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from mcp_server.shared import _check_action, _get_client, mcp

_ACTIONS = ("list", "get", "run", "delete")


def _require(value: Any, name: str, action: str) -> Any:
    if value is None:
        raise ValueError(f"action {action!r} requires {name}.")
    return value


@mcp.tool()
async def avery_reports(
    action: Annotated[str, Field(description=f"One of: {', '.join(_ACTIONS)}.")],
    report_id: Annotated[int | None, Field(description="Which report. Required for get and delete.")] = None,
    month: Annotated[str | None, Field(description='action="run": which month to evaluate, "YYYY-MM".')] = None,
) -> object:
    """List, read, run and delete monthly evaluations.

    A report is a monthly evaluation frozen against the rule version that was
    active when it ran, which is why editing a rule opens a new version rather
    than rewriting the old one.

    month is "YYYY-MM". Report narratives are a hardcoded placeholder today --
    the metrics are real, the prose is not, so do not read the narrative back
    to the user as analysis.

    Args:
        action: One of list, get, run, delete.
        report_id: Which report, for get and delete.
        month: Which month to evaluate, as "YYYY-MM".
    """
    _check_action(action, _ACTIONS, "avery_reports")
    client = _get_client()

    if action == "list":
        return await client.get("/api/reports")

    if action == "get":
        _require(report_id, "report_id", action)
        return await client.get(f"/api/reports/{report_id}")

    if action == "run":
        _require(month, "month", action)
        return await client.post("/api/reports/run", json={"month": month})

    _require(report_id, "report_id", action)
    await client.delete(f"/api/reports/{report_id}")
    return {"deleted": report_id}
