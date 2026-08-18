"""Importing this package registers every tool onto the shared FastMCP instance.

Each module calls @mcp.tool() at import time, so the imports below are the
registration -- they are not unused, and removing one silently drops that
tool from the server's advertised list.
"""

from mcp_server.tools import events  # noqa: F401
from mcp_server.tools import tasks  # noqa: F401
from mcp_server.tools import tags  # noqa: F401
from mcp_server.tools import routines  # noqa: F401
from mcp_server.tools import rules  # noqa: F401
from mcp_server.tools import today  # noqa: F401
