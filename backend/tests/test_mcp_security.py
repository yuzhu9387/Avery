"""The two properties that keep one account's agent inside that account.

Server-side isolation is the real boundary (no route accepts a caller-supplied
user_id; cross-user reads are 404; tests/test_cross_user_isolation.py covers
it). These tests hold the MCP layer to adding no new surface on top of it.
"""

import mcp_server.server  # noqa: F401  -- registers every tool
from mcp_server.shared import mcp

EXPECTED_TOOLS = {
    "avery_today",
    "avery_events",
    "avery_tasks",
    "avery_tags",
    "avery_routines",
    "avery_routine_blocks",
    "avery_rules",
    "avery_reminders",
    "avery_reports",
    "avery_calendar",
    "avery_analytics",
}

# Anything that would let a caller name an account other than the token's own,
# or reach a router that is deliberately unexposed.
FORBIDDEN_PARAM_NAMES = {
    "user_id", "userid", "user", "email", "account", "account_id",
    "owner_id", "token", "password", "workspace",
}


async def _tools():
    return await mcp.list_tools()


async def test_tool_list_is_exactly_the_designed_eleven():
    """A new tool must be a deliberate act. This catches an accidental export
    of auth, agent_tokens, jobs or seed -- agent_tokens in particular would let
    the agent mint itself fresh credentials."""
    names = {t.name for t in await _tools()}
    assert names == EXPECTED_TOOLS


async def test_no_tool_accepts_an_account_identifier():
    """There must be nothing a model can send to name a victim. Identity comes
    only from AVERY_AGENT_TOKEN."""
    offenders = []
    for tool in await _tools():
        props = (tool.inputSchema or {}).get("properties", {}) or {}
        for param in props:
            if param.lower() in FORBIDDEN_PARAM_NAMES:
                offenders.append(f"{tool.name}.{param}")
    assert offenders == []


async def test_client_does_not_follow_redirects():
    """follow_redirects stays off so the Authorization header can never be
    replayed to a host other than AVERY_BASE_URL."""
    from mcp_server.client import AveryClient

    client = AveryClient(base_url="http://test", token="t")
    assert client._http.follow_redirects is False
    await client.aclose()
