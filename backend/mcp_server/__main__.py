"""Entry point: `python -m mcp_server`.

Builds the AveryClient before starting the stdio loop, on purpose: that is
what turns a missing or bad AVERY_AGENT_TOKEN into a message on stderr and a
non-zero exit right now, instead of a silent no-op the first time some tool
gets called minutes into a Claude session.
"""

import sys

from mcp_server.client import AveryConfigError
from mcp_server.server import ensure_client_ready, mcp


def main() -> None:
    try:
        ensure_client_ready()
    except AveryConfigError as exc:
        print(f"avery-mcp: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
