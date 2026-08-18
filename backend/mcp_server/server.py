"""Backwards-compatible surface for the MCP server.

The FastMCP instance and shared helpers live in shared.py; the tools live in
tools/. This module imports both so that `import mcp_server.server` still
yields a fully-registered server, and re-exports the names __main__.py and the
test-suite bind to.

Historical note: this file used to hold four intent-shaped tools, chosen over
1:1 endpoint exposure to protect tool selection. That constraint still holds --
Avery has ~70 routes -- but it is now met by grouping per entity with an
`action` enum (11 tools) rather than by covering only four intents. See
docs/superpowers/specs/2026-08-18-mcp-full-crud-design.md.
"""

from __future__ import annotations

from mcp_server import tools  # noqa: F401  -- import registers every tool
from mcp_server.shared import (  # noqa: F401
    _check_action,
    _get_client,
    _omit_none,
    _require_naive_local,
    ensure_client_ready,
    mcp,
)
