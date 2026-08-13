"""MCP server exposing Avery to Claude Code, Claude Desktop, and the Lark bridge.

Talks to Avery over its REST API (`app/routers/`) as a Bearer-authenticated
agent client — it does not import Avery's app package or touch its database
directly, so it can run as a separate process against any Avery instance
reachable at AVERY_BASE_URL.
"""
