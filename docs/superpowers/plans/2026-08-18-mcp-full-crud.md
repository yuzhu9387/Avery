# MCP Full-CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose every Avery data entity through the MCP server as 11 tools, so the LLM driving the Lark bot can query and modify all of the account's schedule data.

**Architecture:** The MCP server stays a pure HTTP client of Avery's REST API. Ten entity tools each take an `action` enum and dispatch to the matching route; `avery_today` is kept as the only cross-entity aggregation. Three existing intent tools (`avery_schedule`, `avery_capture_task`, `avery_complete`) are deleted, and their semantic guidance moves into the entity tools' descriptions. Tools live in `mcp_server/tools/<entity>.py`, each registering onto the shared FastMCP instance.

**Tech Stack:** Python 3.11+, FastMCP (`mcp.server.fastmcp`), httpx, pytest + pytest-asyncio, httpx.MockTransport for tests.

**Spec:** `docs/superpowers/specs/2026-08-18-mcp-full-crud-design.md`

## Global Constraints

- **Naive local datetimes only.** Every datetime-typed tool parameter passes through `_require_naive_local(value, field_name)` before any HTTP call. Timezone suffixes (`Z`, `+HH:MM`) are rejected with that function's existing message.
- **No tool takes `user_id`, `email`, or any account identifier.** Identity comes only from `AVERY_AGENT_TOKEN`. Task 12 enforces this with a schema-walking test.
- **Routers never exposed:** `auth`, `agent_tokens`, `jobs`, `seed`. Task 12 asserts the registered tool list is exactly the 11 designed tools.
- **The tool list is exactly these 11 names:** `avery_today`, `avery_events`, `avery_tasks`, `avery_tags`, `avery_routines`, `avery_routine_blocks`, `avery_rules`, `avery_reminders`, `avery_reports`, `avery_calendar`, `avery_analytics`.
- **Unknown `action` raises `ValueError` before any HTTP call**, with message `f"unknown action {action!r} for <tool>. Valid actions: a, b, c."`
- **IDs are named per entity** (`event_id`, `task_id`, `tag_id`, `routine_id`, `block_id`, `rule_id`, `reminder_id`, `report_id`) — never a bare `id`.
- **Optional parameters that are `None` are omitted from the request body**, preserving PATCH semantics (Avery rejects explicit nulls server-side).
- Run tests with `cd backend && arch -arm64 .venv/bin/pytest -q` (Apple Silicon; the `arch -arm64` prefix is mandatory — see README).
- Commit after every task. Never leave `main` with failing tests.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/mcp_server/client.py` | MODIFY — add `delete()`; `_request` stays the single choke point for error translation |
| `backend/mcp_server/shared.py` | CREATE — `mcp` FastMCP instance, `_client` global, `ensure_client_ready`, `_get_client`, `_require_naive_local`, `_omit_none`, `_check_action`. Extracted from `server.py` so tool modules import from here without a circular import. |
| `backend/mcp_server/tools/__init__.py` | CREATE — imports every tool module for its registration side effect |
| `backend/mcp_server/tools/today.py` | CREATE — `avery_today`, moved verbatim from `server.py` |
| `backend/mcp_server/tools/events.py` | CREATE — `avery_events` (9 actions) |
| `backend/mcp_server/tools/tasks.py` | CREATE — `avery_tasks` (6 actions) |
| `backend/mcp_server/tools/tags.py` | CREATE — `avery_tags` (6 actions) |
| `backend/mcp_server/tools/routines.py` | CREATE — `avery_routines` (8 actions) + `avery_routine_blocks` (3 actions) |
| `backend/mcp_server/tools/rules.py` | CREATE — `avery_rules` (6 actions) |
| `backend/mcp_server/tools/reminders.py` | CREATE — `avery_reminders` (5 actions) |
| `backend/mcp_server/tools/reports.py` | CREATE — `avery_reports` (4 actions) |
| `backend/mcp_server/tools/analytics.py` | CREATE — `avery_calendar` (2 actions) + `avery_analytics` (1 action) |
| `backend/mcp_server/server.py` | MODIFY — becomes a re-export shim: imports `shared` and `tools`, exposes `mcp`, `ensure_client_ready`, `_client`, `_require_naive_local` so `__main__.py` and existing tests keep working |
| `backend/tests/test_mcp_server.py` | MODIFY — keep `_install` harness and `avery_today` tests; delete tests for the three removed tools |
| `backend/tests/test_mcp_tools_<entity>.py` | CREATE — one file per entity task |
| `backend/tests/test_mcp_security.py` | CREATE — schema walk + exact tool list |
| `backend/README.md`, `README.md` | MODIFY — replace the four-tool table with the eleven-tool table |

**Why `shared.py`:** `server.py` currently owns both the FastMCP instance and the tools. Tool modules must import the instance to register onto it, and `server.py` must import the tool modules to trigger registration — a cycle. Extracting the instance breaks it.

---

### Task 1: Extract shared module and add client.delete

**Files:**
- Create: `backend/mcp_server/shared.py`
- Create: `backend/mcp_server/tools/__init__.py`
- Create: `backend/mcp_server/tools/today.py`
- Modify: `backend/mcp_server/client.py`
- Modify: `backend/mcp_server/server.py`
- Test: `backend/tests/test_mcp_server.py`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `mcp_server.shared.mcp: FastMCP`
  - `mcp_server.shared.ensure_client_ready() -> AveryClient`
  - `mcp_server.shared._get_client() -> AveryClient`
  - `mcp_server.shared._require_naive_local(value: str, field_name: str) -> str`
  - `mcp_server.shared._omit_none(data: dict) -> dict`
  - `mcp_server.shared._check_action(action: str, valid: tuple[str, ...], tool: str) -> None`
  - `mcp_server.client.AveryClient.delete(path: str) -> object`

- [ ] **Step 1: Write the failing test for `client.delete`**

Add to `backend/tests/test_mcp_server.py`:

```python
async def test_client_delete_sends_delete_and_returns_none_for_204():
    """Avery's delete routes return 204 with an empty body; .json() would raise."""
    calls = _install(lambda request: httpx.Response(204))
    client = server_mod._client
    result = await client.delete("/api/events/7")
    assert result is None
    assert calls == [("DELETE", "/api/events/7", None)]


async def test_client_delete_returns_body_when_present():
    """Tasks' DELETE returns 200 with the archived TaskOut."""
    _install(lambda request: httpx.Response(200, json={"id": 3, "status": "archived"}))
    result = await server_mod._client.delete("/api/tasks/3")
    assert result == {"id": 3, "status": "archived"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_server.py -k client_delete -q`
Expected: FAIL with `AttributeError: 'AveryClient' object has no attribute 'delete'`

- [ ] **Step 3: Add `delete` to the client**

In `backend/mcp_server/client.py`, after `patch` (line 152-153):

```python
    async def delete(self, path: str) -> object:
        # 204 is the common case (events, routines, tags, rules, reminders,
        # reports); tasks' DELETE is a 200 carrying the archived row. Guard on
        # the status rather than on .json() raising, so a genuinely malformed
        # 200 body still surfaces as an error instead of silently reading None.
        response = await self._request("DELETE", path)
        if response.status_code == 204 or not response.content:
            return None
        return response.json()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_server.py -k client_delete -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Create `shared.py` by moving code out of `server.py`**

Create `backend/mcp_server/shared.py`. Move the FastMCP instance, `_client`, `ensure_client_ready`, `_get_client`, `_require_naive_local` and the `_KIND_*`/`_SOURCE_*`/`_STATUS_*`/`_OPEN_TASK_STATUSES` constants out of `server.py` verbatim, then add the two new helpers:

```python
"""The FastMCP instance and the helpers every tool module shares.

Split out of server.py because tool modules must import the instance to
register onto it while server.py must import the tool modules to trigger that
registration -- importing both from here breaks the cycle.
"""

from __future__ import annotations

from datetime import datetime

from mcp.server.fastmcp import FastMCP

from mcp_server.client import AveryClient, AveryConfigError

mcp = FastMCP(
    name="avery",
    instructions=(
        "Avery is the user's personal calendar and to-do list. Each tool covers "
        "one entity and takes an `action` naming what to do with it. Start with "
        "avery_today for \"what's going on\"; use avery_events for anything with "
        "a time slot, avery_tasks for to-dos, and the remaining tools for "
        "categories, routines, rules, reminders and reports. The calendar and "
        "the to-do list are separate: booking time for something does not, by "
        "itself, put it on the to-do list, and finishing a to-do does not, by "
        "itself, mark any calendar slot as having happened."
    ),
)

_KIND_EVENT = "event"
_KIND_TASK = "task"
_SOURCE_AGENT = "agent"
_STATUS_DONE = "done"
_OPEN_TASK_STATUSES = {"todo", "doing"}

_client: AveryClient | None = None


def ensure_client_ready() -> AveryClient:
    """Construct (or return) the one AveryClient for this process.

    Called explicitly by __main__.py before mcp.run(), so a missing or blank
    AVERY_AGENT_TOKEN raises AveryConfigError -- and the process exits with a
    clear message -- at startup, rather than surfacing as a confusing failure
    on whatever tool call happens to run first.
    """
    global _client
    if _client is None:
        _client = AveryClient()
    return _client


def _get_client() -> AveryClient:
    try:
        return ensure_client_ready()
    except AveryConfigError:
        raise


def _require_naive_local(value: str, field_name: str) -> str:
    """Reject a date-time string that carries a timezone offset or 'Z'.

    Avery stores naive local datetimes and treats whatever string it's given
    as the user's own wall-clock time. A tz-suffixed string would still parse
    -- Python happily builds an aware datetime from it -- and Avery would then
    store that offset's clock time verbatim, silently shifting the event by
    whatever the offset was. Catching it here, before the request leaves this
    process, turns that into a clear error instead of a wrong-hour meeting.
    """
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError(
            f"{field_name}={value!r} is not a valid date-time. Use naive local "
            f"time as \"YYYY-MM-DDTHH:MM:SS\", e.g. \"2026-08-13T14:30:00\"."
        ) from None
    if parsed.tzinfo is not None:
        raise ValueError(
            f"{field_name}={value!r} carries a timezone offset. Avery stores "
            f"naive local date-times only -- send \"YYYY-MM-DDTHH:MM:SS\" with "
            f"no \"Z\" and no \"+HH:MM\" suffix, or the event will silently "
            f"land on the wrong hour."
        )
    return value


def _omit_none(data: dict) -> dict:
    """Drop keys whose value is None.

    Avery's PATCH schemas treat "absent" as "leave alone" but reject an
    explicit null (every column behind them is NOT NULL), so a tool that
    forwarded its unset optional parameters verbatim would 422 on every
    partial update.
    """
    return {k: v for k, v in data.items() if v is not None}


def _check_action(action: str, valid: tuple[str, ...], tool: str) -> None:
    """Fail before the HTTP call, naming what this tool actually accepts.

    A model that guesses an action gets the list back and can retry in the
    same turn; letting it through would 404 or 405 against Avery and read as
    "Avery is broken" instead of "that action does not exist".
    """
    if action not in valid:
        raise ValueError(
            f"unknown action {action!r} for {tool}. "
            f"Valid actions: {', '.join(valid)}."
        )
```

- [ ] **Step 6: Move `avery_today` into its own module**

Create `backend/mcp_server/tools/today.py` containing the `avery_today` function moved verbatim from `server.py` (lines 104-177), with imports changed to:

```python
from __future__ import annotations

from datetime import datetime, timedelta
from datetime import date as _date
from typing import Annotated

from pydantic import Field

from mcp_server.shared import _get_client, _OPEN_TASK_STATUSES, mcp
```

The function body and docstring are unchanged.

Create `backend/mcp_server/tools/__init__.py`:

```python
"""Importing this package registers every tool onto the shared FastMCP instance.

Each module calls @mcp.tool() at import time, so the imports below are the
registration -- they are not unused, and removing one silently drops that
tool from the server's advertised list.
"""

from mcp_server.tools import today  # noqa: F401
```

- [ ] **Step 7: Reduce `server.py` to a shim**

Replace the entire contents of `backend/mcp_server/server.py` with:

```python
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
    _get_client,
    _omit_none,
    _check_action,
    _require_naive_local,
    ensure_client_ready,
    mcp,
)
```

Note for the implementer: `tests/test_mcp_server.py` sets `server_mod._client = ...`. That now has to target the module that actually holds the global. Update the `_install` helper's final line and the `_reset_client` fixture to use `mcp_server.shared` instead:

```python
import mcp_server.shared as shared_mod
```
and replace every `server_mod._client` with `shared_mod._client`.

- [ ] **Step 8: Run the full suite**

Run: `cd backend && arch -arm64 .venv/bin/pytest -q`
Expected: PASS. `avery_today` tests still pass; the three intent tools still exist and their tests still pass (they are removed in Task 2).

- [ ] **Step 9: Commit**

```bash
git add backend/mcp_server/ backend/tests/test_mcp_server.py
git commit -m "refactor(mcp): split shared instance out of server.py, add client.delete"
```

---

### Task 2: avery_events

**Files:**
- Create: `backend/mcp_server/tools/events.py`
- Modify: `backend/mcp_server/tools/__init__.py`
- Modify: `backend/mcp_server/server.py` (remove the three intent tools — they were left in place by Task 1)
- Modify: `backend/tests/test_mcp_server.py` (delete tests for the three removed tools)
- Test: `backend/tests/test_mcp_tools_events.py`

**Interfaces:**
- Consumes: `mcp_server.shared.{mcp, _get_client, _require_naive_local, _omit_none, _check_action, _KIND_EVENT, _KIND_TASK, _SOURCE_AGENT}`; `AveryClient.{get, post, patch, delete}`
- Produces: `mcp_server.tools.events.avery_events(action: str, ...) -> object`

**Route map (verified against `app/routers/events.py`):**

| action | method | path | body |
|---|---|---|---|
| list | GET | `/api/events` | params `start`, `end` |
| get | GET | `/api/events/{event_id}` | — |
| create | POST | `/api/events` | EventCreate |
| update | PATCH | `/api/events/{event_id}` | EventUpdate |
| delete | DELETE | `/api/events/{event_id}` | — |
| move | POST | `/api/events/{event_id}/move` | `{start_at}` |
| complete | POST | `/api/events/{event_id}/complete` | — |
| uncomplete | POST | `/api/events/{event_id}/uncomplete` | — |
| roll_over | POST | `/api/events/roll-over` | `{event_ids, to_date}` |

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mcp_tools_events.py`:

```python
"""avery_events against a mocked Avery HTTP layer."""

import httpx
import pytest

import mcp_server.shared as shared_mod
from mcp_server.client import AveryClient
from mcp_server.tools.events import avery_events


@pytest.fixture(autouse=True)
def _reset_client():
    shared_mod._client = None
    yield
    shared_mod._client = None


def _install(handler) -> list:
    calls: list[tuple[str, str, object]] = []

    def _recording(request: httpx.Request):
        body = None
        if request.content:
            import json as _json
            body = _json.loads(request.content)
        calls.append((request.method, request.url.path, body))
        return handler(request)

    shared_mod._client = AveryClient(
        base_url="http://test", token="t", transport=httpx.MockTransport(_recording)
    )
    return calls


def _event(**over) -> dict:
    base = {
        "id": 1, "task_id": None, "title": "Dentist",
        "start_at": "2026-08-12T09:00:00", "end_at": "2026-08-12T10:00:00",
        "tag_ids": [], "kind": "event", "completed_at": None, "source": "agent",
        "routine_block_id": None, "external_id": None, "all_day": False, "notes": "",
    }
    base.update(over)
    return base


async def test_list_passes_the_window_as_params():
    calls = _install(lambda r: httpx.Response(200, json=[_event()]))
    result = await avery_events(
        action="list", start="2026-08-12T00:00:00", end="2026-08-13T00:00:00"
    )
    assert calls[0][0] == "GET"
    assert calls[0][1] == "/api/events"
    assert result == [_event()]


async def test_create_sends_agent_source_and_naive_times():
    calls = _install(lambda r: httpx.Response(201, json=_event()))
    await avery_events(
        action="create", title="Dentist",
        start_at="2026-08-12T09:00:00", end_at="2026-08-12T10:00:00",
    )
    method, path, body = calls[0]
    assert (method, path) == ("POST", "/api/events")
    assert body["title"] == "Dentist"
    assert body["source"] == "agent"
    assert body["kind"] == "event"


async def test_create_task_card_sends_name_as_both_title_and_task_name():
    """kind='task' mints a backing Task. Avery <=2026-08-17 read the name only
    from task_name and 500'd on a title-only body; sending both is correct on
    every version."""
    calls = _install(lambda r: httpx.Response(201, json=_event(kind="task")))
    await avery_events(
        action="create", title="Renew passport", kind="task",
        start_at="2026-08-12T09:00:00", end_at="2026-08-12T10:00:00",
    )
    body = calls[0][2]
    assert body["title"] == "Renew passport"
    assert body["task_name"] == "Renew passport"


async def test_create_rejects_a_timezone_suffix():
    _install(lambda r: httpx.Response(201, json=_event()))
    with pytest.raises(ValueError, match="timezone offset"):
        await avery_events(
            action="create", title="Dentist",
            start_at="2026-08-12T09:00:00Z", end_at="2026-08-12T10:00:00",
        )


async def test_update_omits_unset_fields():
    calls = _install(lambda r: httpx.Response(200, json=_event(title="New")))
    await avery_events(action="update", event_id=1, title="New")
    assert calls[0][2] == {"title": "New"}


async def test_delete_returns_a_confirmation():
    calls = _install(lambda r: httpx.Response(204))
    result = await avery_events(action="delete", event_id=7)
    assert calls[0][:2] == ("DELETE", "/api/events/7")
    assert result == {"deleted": 7}


async def test_move_posts_to_the_move_route():
    calls = _install(lambda r: httpx.Response(200, json=_event()))
    await avery_events(action="move", event_id=1, start_at="2026-08-13T09:00:00")
    assert calls[0][:2] == ("POST", "/api/events/1/move")
    assert calls[0][2] == {"start_at": "2026-08-13T09:00:00"}


async def test_complete_and_uncomplete_hit_their_routes():
    calls = _install(lambda r: httpx.Response(200, json=_event()))
    await avery_events(action="complete", event_id=1)
    await avery_events(action="uncomplete", event_id=1)
    assert calls[0][:2] == ("POST", "/api/events/1/complete")
    assert calls[1][:2] == ("POST", "/api/events/1/uncomplete")


async def test_roll_over_posts_ids_and_target_date():
    calls = _install(lambda r: httpx.Response(200, json=[_event()]))
    await avery_events(action="roll_over", event_ids=[1, 2], to_date="2026-08-13")
    assert calls[0][:2] == ("POST", "/api/events/roll-over")
    assert calls[0][2] == {"event_ids": [1, 2], "to_date": "2026-08-13"}


async def test_unknown_action_lists_the_valid_ones_without_calling_avery():
    calls = _install(lambda r: httpx.Response(200, json=[]))
    with pytest.raises(ValueError, match="unknown action 'destroy'"):
        await avery_events(action="destroy")
    assert calls == []


async def test_get_requires_event_id():
    _install(lambda r: httpx.Response(200, json=_event()))
    with pytest.raises(ValueError, match="event_id"):
        await avery_events(action="get")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_events.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'mcp_server.tools.events'`

- [ ] **Step 3: Implement `avery_events`**

Create `backend/mcp_server/tools/events.py`:

```python
"""avery_events: everything that occupies a slot on the calendar."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from mcp_server.shared import (
    _KIND_EVENT,
    _SOURCE_AGENT,
    _check_action,
    _get_client,
    _omit_none,
    _require_naive_local,
    mcp,
)

_ACTIONS = (
    "list", "get", "create", "update", "delete",
    "move", "complete", "uncomplete", "roll_over",
)


def _require(value: Any, name: str, action: str) -> Any:
    if value is None:
        raise ValueError(f"action {action!r} requires {name}.")
    return value


@mcp.tool()
async def avery_events(
    action: Annotated[str, Field(description=f"One of: {', '.join(_ACTIONS)}.")],
    event_id: Annotated[int | None, Field(description="Which event. Required for get, update, delete, move, complete, uncomplete.")] = None,
    title: Annotated[str | None, Field(description='What to call this slot, e.g. "Dentist appointment".')] = None,
    start_at: Annotated[str | None, Field(description='Naive local start, "YYYY-MM-DDTHH:MM:SS". No "Z", no "+HH:MM".')] = None,
    end_at: Annotated[str | None, Field(description='Naive local end, "YYYY-MM-DDTHH:MM:SS".')] = None,
    kind: Annotated[str | None, Field(description='"event" (time you spent) or "task" (a to-do with a slot and a checkbox). Defaults to "event".')] = None,
    tag_ids: Annotated[list[int] | None, Field(description="Category ids from avery_tags.")] = None,
    notes: Annotated[str | None, Field(description="Free text.")] = None,
    task_id: Annotated[int | None, Field(description="Schedule an EXISTING to-do into this slot. Omit unless the user explicitly ties them together.")] = None,
    start: Annotated[str | None, Field(description='action="list": window start, naive local.')] = None,
    end: Annotated[str | None, Field(description='action="list": window end, naive local.')] = None,
    event_ids: Annotated[list[int] | None, Field(description='action="roll_over": which events to move.')] = None,
    to_date: Annotated[str | None, Field(description='action="roll_over": target day, "YYYY-MM-DD".')] = None,
) -> object:
    """Create, read, change, move, complete and delete calendar slots.

    An Event is a slot on the calendar; a Task is a to-do. They are separate
    lists and one does not create the other. Booking a meeting must NOT also
    put an entry on the to-do list -- pass task_id only when the user
    explicitly says this slot is for an existing to-do. To record a to-do with
    no time attached, use avery_tasks, not this tool.

    kind="task" is the exception: it creates a task CARD, a to-do that also
    occupies a slot, and Avery mints the backing Task itself. Do not also call
    avery_tasks for it.

    delete is permanent and there is no undo. Confirm with the user before
    calling it; to clear a completed slot, prefer leaving it as history.

    Args:
        action: Which operation. One of list, get, create, update, delete,
            move, complete, uncomplete, roll_over.
        event_id: Which event, for the single-event actions.
        title: The slot's name.
        start_at: Naive local start time.
        end_at: Naive local end time.
        kind: "event" or "task".
        tag_ids: Category ids.
        notes: Free text.
        task_id: An existing to-do to attach.
        start: Window start for list.
        end: Window end for list.
        event_ids: Which events roll_over moves.
        to_date: The day roll_over moves them to.
    """
    _check_action(action, _ACTIONS, "avery_events")
    client = _get_client()

    if start_at is not None:
        _require_naive_local(start_at, "start_at")
    if end_at is not None:
        _require_naive_local(end_at, "end_at")
    if start is not None:
        _require_naive_local(start, "start")
    if end is not None:
        _require_naive_local(end, "end")

    if action == "list":
        params = _omit_none({"start": start, "end": end})
        return await client.get("/api/events", params=params or None)

    if action == "get":
        _require(event_id, "event_id", action)
        return await client.get(f"/api/events/{event_id}")

    if action == "create":
        _require(start_at, "start_at", action)
        _require(end_at, "end_at", action)
        _require(title, "title", action)
        body = _omit_none({
            "title": title,
            "start_at": start_at,
            "end_at": end_at,
            "kind": kind or _KIND_EVENT,
            "source": _SOURCE_AGENT,
            "tag_ids": tag_ids,
            "notes": notes,
            "task_id": task_id,
        })
        # A task card's backing Task takes its name from task_name on Avery
        # versions predating 2026-08-17; sending both is correct on every
        # version and never creates a second Task.
        if body["kind"] == "task" and task_id is None:
            body["task_name"] = title
        return await client.post("/api/events", json=body)

    if action == "update":
        _require(event_id, "event_id", action)
        body = _omit_none({
            "title": title, "start_at": start_at, "end_at": end_at,
            "tag_ids": tag_ids, "notes": notes,
        })
        return await client.patch(f"/api/events/{event_id}", json=body)

    if action == "delete":
        _require(event_id, "event_id", action)
        await client.delete(f"/api/events/{event_id}")
        return {"deleted": event_id}

    if action == "move":
        _require(event_id, "event_id", action)
        _require(start_at, "start_at", action)
        return await client.post(
            f"/api/events/{event_id}/move", json={"start_at": start_at}
        )

    if action in ("complete", "uncomplete"):
        _require(event_id, "event_id", action)
        return await client.post(f"/api/events/{event_id}/{action}")

    _require(event_ids, "event_ids", action)
    _require(to_date, "to_date", action)
    return await client.post(
        "/api/events/roll-over", json={"event_ids": event_ids, "to_date": to_date}
    )
```

Add to `backend/mcp_server/tools/__init__.py`:

```python
from mcp_server.tools import events  # noqa: F401
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_events.py -q`
Expected: PASS (11 passed)

- [ ] **Step 5: Delete the three superseded intent tools**

Remove `avery_schedule`, `avery_capture_task` and `avery_complete` from `backend/mcp_server/server.py`'s history — they were already moved out by Task 1's rewrite, so verify none of them remain anywhere:

Run: `cd backend && grep -rn "avery_schedule\|avery_capture_task\|avery_complete" mcp_server/ tests/`

Delete every test in `backend/tests/test_mcp_server.py` that calls them. Keep the `_install` harness, `_reset_client`, and the `avery_today` and `client_delete` tests.

- [ ] **Step 6: Run the full suite**

Run: `cd backend && arch -arm64 .venv/bin/pytest -q`
Expected: PASS, with a lower total than before (the three tools' tests are gone, events' 11 are new).

- [ ] **Step 7: Commit**

```bash
git add backend/mcp_server/ backend/tests/
git commit -m "feat(mcp): avery_events with full CRUD, replacing the three intent tools"
```

---

### Task 3: avery_tasks

**Files:**
- Create: `backend/mcp_server/tools/tasks.py`
- Modify: `backend/mcp_server/tools/__init__.py`
- Test: `backend/tests/test_mcp_tools_tasks.py`

**Interfaces:**
- Consumes: `mcp_server.shared.{mcp, _get_client, _omit_none, _check_action}`
- Produces: `mcp_server.tools.tasks.avery_tasks(action: str, ...) -> object`

**Route map (verified against `app/routers/tasks.py`):**

| action | method | path | note |
|---|---|---|---|
| list | GET | `/api/tasks` | params `include_archived` |
| get | GET | `/api/tasks/{task_id}` | |
| create | POST | `/api/tasks` | TaskCreate |
| update | PATCH | `/api/tasks/{task_id}` | TaskUpdate |
| archive | DELETE | `/api/tasks/{task_id}` | **returns 200 + the archived TaskOut — this is not a hard delete** |
| stats | GET | `/api/tasks/{task_id}/stats` | |

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mcp_tools_tasks.py`. Use the same `_reset_client` fixture and `_install` helper as Task 2's test file (copy them verbatim — each test module is self-contained), then:

```python
def _task(**over) -> dict:
    base = {
        "id": 1, "name": "Renew passport", "tag_ids": [], "notes": "",
        "status": "todo", "due_date": None, "est_minutes": None,
        "is_floating": False, "priority": "normal",
    }
    base.update(over)
    return base


async def test_list_defaults_to_excluding_archived():
    calls = _install(lambda r: httpx.Response(200, json=[_task()]))
    await avery_tasks(action="list")
    assert calls[0][:2] == ("GET", "/api/tasks")


async def test_create_sends_the_name():
    calls = _install(lambda r: httpx.Response(201, json=_task()))
    await avery_tasks(action="create", name="Renew passport", due_date="2026-08-20")
    assert calls[0][:2] == ("POST", "/api/tasks")
    assert calls[0][2] == {"name": "Renew passport", "due_date": "2026-08-20"}


async def test_update_omits_unset_fields():
    calls = _install(lambda r: httpx.Response(200, json=_task(status="done")))
    await avery_tasks(action="update", task_id=1, status="done")
    assert calls[0][2] == {"status": "done"}


async def test_archive_uses_delete_and_reports_archived_not_deleted():
    """Avery has no hard delete for tasks: DELETE /api/tasks/{id} archives and
    returns the row. Reporting it as "deleted" would be a lie the model relays
    to the user."""
    calls = _install(lambda r: httpx.Response(200, json=_task(status="archived")))
    result = await avery_tasks(action="archive", task_id=1)
    assert calls[0][:2] == ("DELETE", "/api/tasks/1")
    assert result == {"archived": 1}


async def test_delete_is_not_a_valid_action():
    """The API cannot hard-delete a task, so the tool must not offer an action
    that implies it can."""
    calls = _install(lambda r: httpx.Response(200, json=_task()))
    with pytest.raises(ValueError, match="unknown action 'delete'"):
        await avery_tasks(action="delete", task_id=1)
    assert calls == []


async def test_stats_hits_the_stats_route():
    calls = _install(lambda r: httpx.Response(200, json={"week_minutes": 0}))
    await avery_tasks(action="stats", task_id=1)
    assert calls[0][:2] == ("GET", "/api/tasks/1/stats")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_tasks.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'mcp_server.tools.tasks'`

- [ ] **Step 3: Implement `avery_tasks`**

Create `backend/mcp_server/tools/tasks.py`:

```python
"""avery_tasks: to-dos, with or without a slot on the calendar."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from mcp_server.shared import _check_action, _get_client, _omit_none, mcp

_ACTIONS = ("list", "get", "create", "update", "archive", "stats")


def _require(value: Any, name: str, action: str) -> Any:
    if value is None:
        raise ValueError(f"action {action!r} requires {name}.")
    return value


@mcp.tool()
async def avery_tasks(
    action: Annotated[str, Field(description=f"One of: {', '.join(_ACTIONS)}.")],
    task_id: Annotated[int | None, Field(description="Which to-do. Required for get, update, archive, stats.")] = None,
    name: Annotated[str | None, Field(description='What the to-do is, e.g. "Renew passport".')] = None,
    due_date: Annotated[str | None, Field(description='When it is due, "YYYY-MM-DD".')] = None,
    status: Annotated[str | None, Field(description='"todo", "doing", "done" or "archived".')] = None,
    priority: Annotated[str | None, Field(description='"low", "normal" or "high".')] = None,
    tag_ids: Annotated[list[int] | None, Field(description="Category ids from avery_tags.")] = None,
    notes: Annotated[str | None, Field(description="Free text.")] = None,
    est_minutes: Annotated[int | None, Field(description="Rough size in minutes.")] = None,
    include_archived: Annotated[bool | None, Field(description='action="list": include archived to-dos. Defaults to false.')] = None,
) -> object:
    """Create, read, change and archive to-dos.

    A Task is a to-do; an Event is a slot on the calendar. They are separate
    lists. Recording a to-do here does NOT put time on the calendar, and
    marking one done here does NOT mark any calendar slot as having happened.
    To give a to-do a slot, use avery_events with kind="task".

    There is no hard delete: action="archive" is the strongest removal Avery
    offers, and it keeps the row so historical hour totals stay honest. Set
    status="done" to complete a to-do; archive is for ones that turned out not
    to matter.

    Args:
        action: One of list, get, create, update, archive, stats.
        task_id: Which to-do, for the single-task actions.
        name: What the to-do is.
        due_date: Due day as "YYYY-MM-DD".
        status: todo, doing, done or archived.
        priority: low, normal or high.
        tag_ids: Category ids.
        notes: Free text.
        est_minutes: Rough size in minutes.
        include_archived: Whether list includes archived to-dos.
    """
    _check_action(action, _ACTIONS, "avery_tasks")
    client = _get_client()

    if action == "list":
        params = _omit_none({"include_archived": include_archived})
        return await client.get("/api/tasks", params=params or None)

    if action == "get":
        _require(task_id, "task_id", action)
        return await client.get(f"/api/tasks/{task_id}")

    if action == "stats":
        _require(task_id, "task_id", action)
        return await client.get(f"/api/tasks/{task_id}/stats")

    if action == "create":
        _require(name, "name", action)
        body = _omit_none({
            "name": name, "due_date": due_date, "status": status,
            "priority": priority, "tag_ids": tag_ids, "notes": notes,
            "est_minutes": est_minutes,
        })
        return await client.post("/api/tasks", json=body)

    if action == "update":
        _require(task_id, "task_id", action)
        body = _omit_none({
            "name": name, "due_date": due_date, "status": status,
            "priority": priority, "tag_ids": tag_ids, "notes": notes,
            "est_minutes": est_minutes,
        })
        return await client.patch(f"/api/tasks/{task_id}", json=body)

    _require(task_id, "task_id", action)
    await client.delete(f"/api/tasks/{task_id}")
    return {"archived": task_id}
```

Add `from mcp_server.tools import tasks  # noqa: F401` to `tools/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_tasks.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_server/ backend/tests/test_mcp_tools_tasks.py
git commit -m "feat(mcp): avery_tasks"
```

---

### Task 4: avery_tags

**Files:**
- Create: `backend/mcp_server/tools/tags.py`
- Modify: `backend/mcp_server/tools/__init__.py`
- Test: `backend/tests/test_mcp_tools_tags.py`

**Interfaces:**
- Consumes: `mcp_server.shared.{mcp, _get_client, _omit_none, _check_action}`
- Produces: `mcp_server.tools.tags.avery_tags(action: str, ...) -> object`

**Route map (verified against `app/routers/tags.py`):** list `GET /api/tags`; get `GET /api/tags/{tag_id}`; create `POST /api/tags`; update `PATCH /api/tags/{tag_id}`; delete `DELETE /api/tags/{tag_id}`; archive `POST /api/tags/{tag_id}/archive`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mcp_tools_tags.py` with the same fixture/helper preamble as Task 2, then:

```python
def _tag(**over) -> dict:
    base = {"id": 1, "name": "Work", "color": "#AA5566", "description": "",
            "icon": None, "sort_order": 0, "archived": False}
    base.update(over)
    return base


async def test_create_requires_name_and_color():
    calls = _install(lambda r: httpx.Response(201, json=_tag()))
    await avery_tags(action="create", name="Work", color="#AA5566")
    assert calls[0][:2] == ("POST", "/api/tags")
    assert calls[0][2] == {"name": "Work", "color": "#AA5566"}


async def test_delete_in_use_surfaces_avery_s_count_verbatim():
    """Avery 409s with a count when the category is still referenced. That
    sentence is what lets the model offer archiving instead, so it must reach
    the model unedited."""
    _install(lambda r: httpx.Response(409, json={"detail": "12 event(s) still use this category"}))
    with pytest.raises(Exception, match="12 event"):
        await avery_tags(action="delete", tag_id=1)


async def test_archive_posts_to_the_archive_route():
    calls = _install(lambda r: httpx.Response(200, json=_tag(archived=True)))
    await avery_tags(action="archive", tag_id=1)
    assert calls[0][:2] == ("POST", "/api/tags/1/archive")


async def test_delete_returns_a_confirmation():
    calls = _install(lambda r: httpx.Response(204))
    result = await avery_tags(action="delete", tag_id=2)
    assert calls[0][:2] == ("DELETE", "/api/tags/2")
    assert result == {"deleted": 2}


async def test_update_omits_unset_fields():
    calls = _install(lambda r: httpx.Response(200, json=_tag(name="Deep work")))
    await avery_tags(action="update", tag_id=1, name="Deep work")
    assert calls[0][2] == {"name": "Deep work"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_tags.py -q`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `avery_tags`**

Create `backend/mcp_server/tools/tags.py`:

```python
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
    color: Annotated[str | None, Field(description='Hex colour, exactly "#RRGGBB" — e.g. "#AA5566". Required on create.')] = None,
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
```

Add `from mcp_server.tools import tags  # noqa: F401` to `tools/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_tags.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_server/ backend/tests/test_mcp_tools_tags.py
git commit -m "feat(mcp): avery_tags"
```

---

### Task 5: avery_routines and avery_routine_blocks

**Files:**
- Create: `backend/mcp_server/tools/routines.py`
- Modify: `backend/mcp_server/tools/__init__.py`
- Test: `backend/tests/test_mcp_tools_routines.py`

**Interfaces:**
- Consumes: `mcp_server.shared.{mcp, _get_client, _omit_none, _check_action}`
- Produces: `avery_routines(action: str, ...)`, `avery_routine_blocks(action: str, ...)`

**Route map (verified against `app/routers/routines.py`):**

`avery_routines`: list `GET /api/routines`; active `GET /api/routines/active`; get `GET /api/routines/{routine_id}`; create `POST /api/routines`; update `PATCH /api/routines/{routine_id}`; delete `DELETE /api/routines/{routine_id}`; preview `GET /api/routines/{routine_ref}/preview/{any_day}`; materialize `POST /api/weeks/{any_day}/materialize`.

`avery_routine_blocks` (verified against `app/routers/routines.py:22-24, 102, 120, 136` — three separate routers are mounted, and **create sits on a different prefix from update/delete**):

| action | method | path |
|---|---|---|
| create | POST | `/api/routines/{routine_id}/blocks` |
| update | PATCH | `/api/routine-blocks/{block_id}` |
| delete | DELETE | `/api/routine-blocks/{block_id}` |

Note the hyphen and the prefix change: `block_router = APIRouter(prefix="/api/routine-blocks")` is mounted separately from `router = APIRouter(prefix="/api/routines")`. Creating is scoped under its routine because a new block needs to know which routine owns it; updating and deleting address the block by its own id.

`materialize` likewise lives on a third router: `week_router = APIRouter(prefix="/api/weeks")` inside `routines.py`, giving `POST /api/weeks/{any_day}/materialize`.

There is no `activate` route: activation is `update` with `is_active=true`. There is no `fork` route: forking is `create` with `copy_blocks_from_active=true`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mcp_tools_routines.py` with the standard preamble, then:

```python
def _routine(**over) -> dict:
    base = {"id": 1, "name": "Default week", "note": "", "is_active": True, "blocks": []}
    base.update(over)
    return base


async def test_activate_is_an_update_not_its_own_route():
    """Avery has no /activate route; activation is is_active on PATCH."""
    calls = _install(lambda r: httpx.Response(200, json=_routine()))
    await avery_routines(action="update", routine_id=2, is_active=True)
    assert calls[0][:2] == ("PATCH", "/api/routines/2")
    assert calls[0][2] == {"is_active": True}


async def test_create_can_copy_the_active_routines_blocks():
    """Forking is create + copy_blocks_from_active; starting empty is how an
    active routine ends up generating blank weeks."""
    calls = _install(lambda r: httpx.Response(201, json=_routine(id=3)))
    await avery_routines(action="create", name="v2", copy_blocks_from_active=True)
    assert calls[0][2] == {"name": "v2", "copy_blocks_from_active": True}


async def test_preview_uses_the_ref_and_day_path():
    calls = _install(lambda r: httpx.Response(200, json={"events": []}))
    await avery_routines(action="preview", routine_ref="active", any_day="2026-08-17")
    assert calls[0][:2] == ("GET", "/api/routines/active/preview/2026-08-17")


async def test_materialize_posts_to_the_weeks_route():
    calls = _install(lambda r: httpx.Response(200, json={"created": 12}))
    await avery_routines(action="materialize", any_day="2026-08-17")
    assert calls[0][:2] == ("POST", "/api/weeks/2026-08-17/materialize")


async def test_block_create_sends_days_times_and_name():
    calls = _install(lambda r: httpx.Response(201, json={"id": 9}))
    await avery_routine_blocks(
        action="create", routine_id=1, days=[1, 2, 3, 4, 5],
        start_time="09:30", end_time="16:30", task_name="Work",
    )
    assert calls[0][:2] == ("POST", "/api/routines/1/blocks")
    assert calls[0][2] == {
        "days": [1, 2, 3, 4, 5], "start_time": "09:30",
        "end_time": "16:30", "task_name": "Work",
    }


async def test_block_update_and_delete_use_the_separate_routine_blocks_prefix():
    """create is scoped under its routine; update/delete address the block by
    its own id on a DIFFERENT router (note the hyphen). Getting this wrong 404s
    against a path that looks plausible."""
    calls = _install(lambda r: httpx.Response(200, json={"id": 9}))
    await avery_routine_blocks(action="update", block_id=9, task_name="Deep work")
    assert calls[0][:2] == ("PATCH", "/api/routine-blocks/9")

    calls2 = _install(lambda r: httpx.Response(204))
    result = await avery_routine_blocks(action="delete", block_id=9)
    assert calls2[0][:2] == ("DELETE", "/api/routine-blocks/9")
    assert result == {"deleted": 9}


async def test_unknown_routine_action_lists_valid_ones():
    calls = _install(lambda r: httpx.Response(200, json=[]))
    with pytest.raises(ValueError, match="unknown action 'activate'"):
        await avery_routines(action="activate", routine_id=1)
    assert calls == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_routines.py -q`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement both tools**

Create `backend/mcp_server/tools/routines.py` following the shape of Tasks 2-4: `_ACTIONS` tuples `("list", "get", "active", "create", "update", "delete", "preview", "materialize")` and `("create", "update", "delete")`, the same `_require` helper, `_check_action` first, `_omit_none` on every body.

Docstring for `avery_routines` must state:

```
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
```

Docstring for `avery_routine_blocks` must state:

```
    Blocks are the recurring slots inside a routine ("Work, Mon-Fri
    09:30-16:30"). days uses 1=Monday through 7=Sunday. Times are "HH:MM",
    wall-clock, with no date and no timezone.

    There is no list action: a routine's blocks come back embedded in
    avery_routines get.

    Editing a block changes future materialised weeks only. Events already
    stamped out keep the values they were created with.
```

Add `from mcp_server.tools import routines  # noqa: F401` to `tools/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_routines.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_server/ backend/tests/test_mcp_tools_routines.py
git commit -m "feat(mcp): avery_routines and avery_routine_blocks"
```

---

### Task 6: avery_rules

**Files:**
- Create: `backend/mcp_server/tools/rules.py`
- Modify: `backend/mcp_server/tools/__init__.py`
- Test: `backend/tests/test_mcp_tools_rules.py`

**Interfaces:**
- Consumes: `mcp_server.shared.{mcp, _get_client, _omit_none, _check_action}`
- Produces: `mcp_server.tools.rules.avery_rules(action: str, ...) -> object`

**Route map (verified against `app/routers/rules.py`):** list `GET /api/rules`; active `GET /api/rules/active`; get `GET /api/rules/{rule_id}`; create `POST /api/rules`; update `PATCH /api/rules/{rule_id}`; delete `DELETE /api/rules/{rule_id}`.

A group is `{"key": str, "label": str, "ratio": float, "tag_ids": list[int]}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mcp_tools_rules.py` with the standard preamble, then:

```python
_GROUPS = [
    {"key": "work", "label": "Work & Study", "ratio": 6, "tag_ids": [2, 3]},
    {"key": "family", "label": "Family care", "ratio": 3, "tag_ids": [5]},
    {"key": "fit", "label": "Fitness", "ratio": 1, "tag_ids": [7]},
]


async def test_create_sends_groups_and_tolerance():
    calls = _install(lambda r: httpx.Response(201, json={"id": 1}))
    await avery_rules(action="create", name="6:3:1", groups=_GROUPS, tolerance=0.2)
    assert calls[0][:2] == ("POST", "/api/rules")
    assert calls[0][2] == {"name": "6:3:1", "groups": _GROUPS, "tolerance": 0.2}


async def test_update_omits_unset_fields():
    calls = _install(lambda r: httpx.Response(200, json={"id": 2}))
    await avery_rules(action="update", rule_id=1, tolerance=0.1)
    assert calls[0][2] == {"tolerance": 0.1}


async def test_active_hits_the_active_route_not_an_id():
    calls = _install(lambda r: httpx.Response(200, json={"id": 1}))
    await avery_rules(action="active")
    assert calls[0][:2] == ("GET", "/api/rules/active")


async def test_delete_referenced_by_a_report_surfaces_the_409():
    _install(lambda r: httpx.Response(409, json={"detail": "a report references this rule"}))
    with pytest.raises(Exception, match="report references"):
        await avery_rules(action="delete", rule_id=1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_rules.py -q`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `avery_rules`**

Create `backend/mcp_server/tools/rules.py` in the same shape as Task 4. Parameters: `action`, `rule_id`, `name`, `groups: list[dict] | None`, `tolerance: float | None`, `exclude_tag_ids: list[int] | None`, `note`.

The docstring must state:

```
    A rule is a versioned ratio target -- e.g. 6 : 3 : 1 across Work & Study /
    Family care / Fitness, with a tolerance band.

    update does not edit in place: it closes the current version and opens a
    new one, so reports already run keep meaning exactly what they meant. Tell
    the user that when they ask to "change" a rule.

    Each group is {"key", "label", "ratio", "tag_ids"}; ratios are relative
    weights, not percentages. exclude_tag_ids drops time from the maths
    entirely -- typically sleep or commuting.

    delete refuses with a 409 when a report references the rule.
```

Add `from mcp_server.tools import rules  # noqa: F401` to `tools/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_rules.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_server/ backend/tests/test_mcp_tools_rules.py
git commit -m "feat(mcp): avery_rules"
```

---

### Task 7: avery_reminders and avery_reports

**Files:**
- Create: `backend/mcp_server/tools/reminders.py`
- Create: `backend/mcp_server/tools/reports.py`
- Modify: `backend/mcp_server/tools/__init__.py`
- Test: `backend/tests/test_mcp_tools_reminders_reports.py`

**Interfaces:**
- Consumes: `mcp_server.shared.{mcp, _get_client, _omit_none, _check_action, _require_naive_local}`
- Produces: `avery_reminders(action: str, ...)`, `avery_reports(action: str, ...)`

**Route maps (verified):** reminders — list `GET /api/reminders`; get `GET /api/reminders/{reminder_id}`; create `POST /api/reminders`; update `PATCH /api/reminders/{reminder_id}`; delete `DELETE /api/reminders/{reminder_id}`. reports — list `GET /api/reports`; run `POST /api/reports/run`; get `GET /api/reports/{report_id}`; delete `DELETE /api/reports/{report_id}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mcp_tools_reminders_reports.py` with the standard preamble, then:

```python
async def test_reminder_create_requires_a_task_and_naive_time():
    calls = _install(lambda r: httpx.Response(201, json={"id": 1}))
    await avery_reminders(action="create", task_id=4, remind_at="2026-08-19T09:00:00")
    assert calls[0][:2] == ("POST", "/api/reminders")
    assert calls[0][2] == {"task_id": 4, "remind_at": "2026-08-19T09:00:00"}


async def test_reminder_create_rejects_a_timezone_suffix():
    _install(lambda r: httpx.Response(201, json={"id": 1}))
    with pytest.raises(ValueError, match="timezone offset"):
        await avery_reminders(action="create", task_id=4, remind_at="2026-08-19T09:00:00+08:00")


async def test_reminders_attach_to_tasks_not_events():
    """Avery has no reminder-on-event: ReminderCreate.task_id is required."""
    calls = _install(lambda r: httpx.Response(201, json={"id": 1}))
    with pytest.raises(ValueError, match="task_id"):
        await avery_reminders(action="create", remind_at="2026-08-19T09:00:00")
    assert calls == []


async def test_report_run_takes_a_month_string():
    calls = _install(lambda r: httpx.Response(201, json={"id": 1}))
    await avery_reports(action="run", month="2026-08")
    assert calls[0][:2] == ("POST", "/api/reports/run")
    assert calls[0][2] == {"month": "2026-08"}


async def test_report_delete_returns_a_confirmation():
    calls = _install(lambda r: httpx.Response(204))
    result = await avery_reports(action="delete", report_id=3)
    assert calls[0][:2] == ("DELETE", "/api/reports/3")
    assert result == {"deleted": 3}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_reminders_reports.py -q`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement both tools**

Create both modules in the same shape as Task 4. `avery_reminders` parameters: `action`, `reminder_id`, `task_id`, `remind_at`, `channel`, `dismissed_at`. Both `remind_at` and `dismissed_at` go through `_require_naive_local`. `avery_reports` parameters: `action`, `report_id`, `month`.

`avery_reminders` docstring must state:

```
    Reminders attach to to-dos, never to calendar slots: task_id is required.
    A background job sweeps every 15 minutes and marks due reminders.

    channel offers "inapp", "lark" or "both", but nothing sends Lark
    notifications today -- every channel behaves as in-app only. Do not tell
    the user a Lark reminder will reach them.
```

`avery_reports` docstring must state:

```
    A report is a monthly evaluation frozen against the rule version that was
    active when it ran, which is why editing a rule opens a new version rather
    than rewriting the old one.

    month is "YYYY-MM". Report narratives are a hardcoded placeholder today --
    the metrics are real, the prose is not, so do not read the narrative back
    to the user as analysis.
```

Add both imports to `tools/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_reminders_reports.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_server/ backend/tests/test_mcp_tools_reminders_reports.py
git commit -m "feat(mcp): avery_reminders and avery_reports"
```

---

### Task 8: avery_calendar and avery_analytics

**Files:**
- Create: `backend/mcp_server/tools/analytics.py`
- Modify: `backend/mcp_server/tools/__init__.py`
- Test: `backend/tests/test_mcp_tools_analytics.py`

**Interfaces:**
- Consumes: `mcp_server.shared.{mcp, _get_client, _omit_none, _check_action, _require_naive_local}`
- Produces: `avery_calendar(action: str, ...)`, `avery_analytics(action: str, ...)`

**Route maps (verified):** calendar — week `GET /api/weeks/{any_day}`; month `GET /api/months/{month_key}`. analytics — evaluate `POST /api/analytics/evaluate` with `{period_start, period_end, rule_id?}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mcp_tools_analytics.py` with the standard preamble, then:

```python
async def test_week_takes_any_day_in_that_week():
    calls = _install(lambda r: httpx.Response(200, json={"days": []}))
    await avery_calendar(action="week", any_day="2026-08-19")
    assert calls[0][:2] == ("GET", "/api/weeks/2026-08-19")


async def test_month_takes_a_month_key():
    calls = _install(lambda r: httpx.Response(200, json={"days": []}))
    await avery_calendar(action="month", month="2026-08")
    assert calls[0][:2] == ("GET", "/api/months/2026-08")


async def test_evaluate_posts_the_period():
    calls = _install(lambda r: httpx.Response(200, json={"groups": []}))
    await avery_analytics(
        action="evaluate",
        period_start="2026-08-01T00:00:00",
        period_end="2026-09-01T00:00:00",
    )
    assert calls[0][:2] == ("POST", "/api/analytics/evaluate")
    assert calls[0][2] == {
        "period_start": "2026-08-01T00:00:00",
        "period_end": "2026-09-01T00:00:00",
    }


async def test_evaluate_rejects_a_timezone_suffix():
    _install(lambda r: httpx.Response(200, json={}))
    with pytest.raises(ValueError, match="timezone offset"):
        await avery_analytics(
            action="evaluate",
            period_start="2026-08-01T00:00:00Z",
            period_end="2026-09-01T00:00:00",
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_analytics.py -q`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement both tools**

Create `backend/mcp_server/tools/analytics.py` with both tools. `avery_calendar` parameters: `action`, `any_day`, `month`. `avery_analytics` parameters: `action`, `period_start`, `period_end`, `rule_id`; both datetimes go through `_require_naive_local`.

`avery_calendar` docstring must state:

```
    Read-only calendar payloads. week takes ANY day inside the week you want,
    not necessarily its Monday. month takes "YYYY-MM".

    Reading a week materialises it from the active routine if it has not been
    materialised yet -- that is expected, not a side effect to avoid.
```

`avery_analytics` docstring must state:

```
    Evaluates logged time against a rule and returns a verdict per group --
    on target, over, or under. Omit rule_id to use the active rule.

    A reversed period is rejected rather than returning every group "under",
    which would be indistinguishable from a month with nothing logged.

    Hidden categories still count: hiding changes only what the UI draws.
```

Add `from mcp_server.tools import analytics  # noqa: F401` to `tools/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_tools_analytics.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/mcp_server/ backend/tests/test_mcp_tools_analytics.py
git commit -m "feat(mcp): avery_calendar and avery_analytics"
```

---

### Task 9: Security assertions

**Files:**
- Create: `backend/tests/test_mcp_security.py`

**Interfaces:**
- Consumes: `mcp_server.shared.mcp` (fully registered via `import mcp_server.server`)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mcp_security.py`:

```python
"""The two properties that keep one account's agent inside that account.

Server-side isolation is the real boundary (no route accepts a caller-supplied
user_id; cross-user reads are 404; tests/test_cross_user_isolation.py covers
it). These tests hold the MCP layer to adding no new surface on top of it.
"""

import pytest

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
```

- [ ] **Step 2: Run tests to verify they fail or pass for the right reason**

Run: `cd backend && arch -arm64 .venv/bin/pytest tests/test_mcp_security.py -q`
Expected: all three PASS. If `test_tool_list_is_exactly_the_designed_eleven` fails, the diff names exactly which tool is missing or extra — fix the registration, not the test. If `test_client_does_not_follow_redirects` fails, httpx's default changed; set `follow_redirects=False` explicitly in `AveryClient.__init__`.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_mcp_security.py
git commit -m "test(mcp): assert the tool list and that no tool names an account"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md` (the "Install — the MCP server" → "Tools it exposes" table)
- Modify: `backend/README.md` if it repeats the tool list (check first)

**Interfaces:**
- Consumes: the final tool list from Tasks 2-8
- Produces: nothing

- [ ] **Step 1: Replace the four-tool table**

In `README.md`, replace the table under "3. Tools it exposes" with:

```markdown
Eleven tools. Ten cover one entity each and take an `action`; `avery_today` is
the cross-entity "what's my day" aggregation.

| Tool | Actions |
|---|---|
| `avery_today(date?)` | — one call for the day's schedule, open to-dos and anything overdue |
| `avery_events` | list, get, create, update, delete, move, complete, uncomplete, roll_over |
| `avery_tasks` | list, get, create, update, archive, stats |
| `avery_tags` | list, get, create, update, delete, archive |
| `avery_routines` | list, get, active, create, update, delete, preview, materialize |
| `avery_routine_blocks` | create, update, delete |
| `avery_rules` | list, get, active, create, update, delete |
| `avery_reminders` | list, get, create, update, delete |
| `avery_reports` | list, run, get, delete |
| `avery_calendar` | week, month |
| `avery_analytics` | evaluate |

All datetimes are naive local (`2026-08-12T15:00:00`); timezone suffixes are
rejected rather than guessed at.

**Not exposed, deliberately:** `auth`, `agent-tokens`, `jobs`, `seed`. An agent
that could reach `agent-tokens` could mint itself fresh credentials; one that
could reach `auth` could change the account password. Tokens are issued and
revoked from the web app only.
```

- [ ] **Step 2: Verify the tool names in the docs match the code**

Run: `cd backend && arch -arm64 .venv/bin/python -c "
import asyncio, mcp_server.server
from mcp_server.shared import mcp
print(sorted(t.name for t in asyncio.run(mcp.list_tools())))
"`

Expected: the eleven names, matching the table exactly.

- [ ] **Step 3: Run the full suite one last time**

Run: `cd backend && arch -arm64 .venv/bin/pytest -q`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md backend/README.md
git commit -m "docs: document the eleven MCP tools"
```

---

## Self-Review Notes

**Spec coverage:** every spec section maps to a task — tool inventory → Tasks 2-8; parameter conventions → Task 1 (`_omit_none`, `_check_action`, `_require_naive_local`) applied throughout; semantic guardrails 1-5 → docstrings in Tasks 2-7 with a regression test each; security model → Task 9; error handling → existing `client._request` (unchanged, already maps 401/403/404/422/5xx); implementation shape → the File Structure table; rollout → no task needed (no deploy step).

**Known gap accepted:** the spec's "`avery_routine_blocks` list action" was removed after checking the router — there is no list route. The plan documents blocks arriving embedded in `avery_routines` get.

**Verification debt: none.** Every route path in this plan was read from its decorator, not inferred. The block paths in particular were wrong in the first draft (`/api/routines/blocks/{id}`) and corrected to `/api/routine-blocks/{id}` after reading `app/routers/routines.py:22-24`; Task 5 carries a test that pins the prefix difference. `follow_redirects` was confirmed to default to `False` in the installed httpx, so Task 9's assertion documents current behaviour rather than requiring a code change.

**Sequencing note:** Tasks 3, 4, 6, 7 and 8 touch disjoint files and depend only on Task 1's helpers plus Task 2's established pattern. They can be dispatched in parallel once Task 2 lands. Tasks 9 and 10 must come last — both assert against the complete tool list.
