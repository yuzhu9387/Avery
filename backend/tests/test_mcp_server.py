"""mcp_server/ against a mocked Avery HTTP layer -- no live server, no network.

Every test builds an AveryClient over httpx.MockTransport and swaps it into
mcp_server.server._client, then calls the tool functions directly (the
@mcp.tool() decorator returns the original function unchanged, so these are
just plain async calls, not a trip through the MCP wire protocol).
"""

import httpx
import pytest

import mcp_server.server as server_mod
from mcp_server.client import (
    AveryAuthError,
    AveryClient,
    AveryConfigError,
    AveryForbidden,
    AveryUnavailable,
)


@pytest.fixture(autouse=True)
def _reset_client():
    """Each test wires its own AveryClient in; never leak one into the next."""
    server_mod._client = None
    yield
    server_mod._client = None


def _install(handler) -> list:
    """Point mcp_server.server at a mock transport and return the list of
    (method, path, json) tuples it records, in call order."""
    calls: list[tuple[str, str, object]] = []

    def _recording_handler(request: httpx.Request):
        body = None
        if request.content:
            import json as _json

            body = _json.loads(request.content)
        calls.append((request.method, request.url.path, body))
        return handler(request)

    transport = httpx.MockTransport(_recording_handler)
    server_mod._client = AveryClient(base_url="http://test", token="test-token", transport=transport)
    return calls


def _json_response(status_code: int, payload: object) -> httpx.Response:
    return httpx.Response(status_code, json=payload)


# --------------------------------------------------------------------- setup


def test_missing_agent_token_fails_loudly_at_startup(monkeypatch):
    monkeypatch.delenv("AVERY_AGENT_TOKEN", raising=False)
    with pytest.raises(AveryConfigError, match="AVERY_AGENT_TOKEN"):
        AveryClient(base_url="http://test")


def test_missing_agent_token_via_ensure_client_ready(monkeypatch):
    monkeypatch.delenv("AVERY_AGENT_TOKEN", raising=False)
    monkeypatch.delenv("AVERY_BASE_URL", raising=False)
    with pytest.raises(AveryConfigError):
        server_mod.ensure_client_ready()


# ---------------------------------------------------------------- scheduling


async def test_avery_schedule_creates_plain_event_with_agent_source_and_no_task():
    calls = _install(
        lambda req: _json_response(
            201,
            {
                "id": 1,
                "task_id": None,
                "title": "Dentist",
                "start_at": "2026-08-13T15:00:00",
                "end_at": "2026-08-13T16:00:00",
                "tag_ids": [],
                "kind": "event",
                "completed_at": None,
                "source": "agent",
                "routine_block_id": None,
                "notes": "",
            },
        )
    )

    result = await server_mod.avery_schedule(
        title="Dentist",
        start_at="2026-08-13T15:00:00",
        end_at="2026-08-13T16:00:00",
    )

    assert len(calls) == 1
    method, path, body = calls[0]
    assert (method, path) == ("POST", "/api/events")
    assert body["source"] == "agent"
    assert body["kind"] == "event"
    # No task_id was sent -- this call must not schedule an *existing* to-do,
    # and it must give create_event nothing that would make it mint one either.
    assert "task_id" not in body

    assert result["event_id"] == 1
    assert result["task_id"] is None
    assert result["source"] == "agent"


async def test_avery_schedule_with_task_id_links_the_existing_task():
    calls = _install(
        lambda req: _json_response(
            201,
            {
                "id": 2,
                "task_id": 42,
                "title": "Renew passport",
                "start_at": "2026-08-13T09:00:00",
                "end_at": "2026-08-13T09:30:00",
                "tag_ids": [],
                "kind": "event",
                "completed_at": None,
                "source": "agent",
                "routine_block_id": None,
                "notes": "",
            },
        )
    )

    result = await server_mod.avery_schedule(
        title="Renew passport",
        start_at="2026-08-13T09:00:00",
        end_at="2026-08-13T09:30:00",
        task_id=42,
    )

    _, _, body = calls[0]
    assert body["task_id"] == 42
    assert body["kind"] == "event"
    assert result["task_id"] == 42


@pytest.mark.parametrize(
    "bad_value",
    ["2026-08-13T15:00:00Z", "2026-08-13T15:00:00+00:00", "2026-08-13T15:00:00-07:00", "not-a-datetime"],
)
async def test_avery_schedule_rejects_timezone_suffixed_or_invalid_datetimes(bad_value):
    calls = _install(lambda req: (_ for _ in ()).throw(AssertionError("must not call Avery")))
    with pytest.raises(ValueError):
        await server_mod.avery_schedule(title="X", start_at=bad_value, end_at="2026-08-13T16:00:00")
    assert calls == []


# --------------------------------------------------------------- task capture


async def test_avery_capture_task_creates_task_and_no_event():
    calls = _install(
        lambda req: _json_response(
            201,
            {
                "id": 7,
                "name": "Renew passport",
                "tag_ids": [],
                "notes": "",
                "status": "todo",
                "due_date": "2026-09-01",
                "est_minutes": None,
                "is_floating": False,
                "priority": "normal",
                "created_at": "2026-08-13T10:00:00",
                "completed_at": None,
            },
        )
    )

    result = await server_mod.avery_capture_task(name="Renew passport", due_date="2026-09-01")

    assert len(calls) == 1
    method, path, body = calls[0]
    assert (method, path) == ("POST", "/api/tasks")
    assert body["name"] == "Renew passport"
    assert body["due_date"] == "2026-09-01"

    assert result["task_id"] == 7
    assert result["status"] == "todo"


# ------------------------------------------------------------------ complete


async def test_avery_complete_event_hits_the_event_completion_path():
    calls = _install(
        lambda req: _json_response(
            200,
            {
                "id": 5,
                "task_id": 9,
                "title": "Team sync",
                "start_at": "2026-08-13T10:00:00",
                "end_at": "2026-08-13T10:30:00",
                "tag_ids": [],
                "kind": "task",
                "completed_at": "2026-08-13T10:31:00",
                "source": "manual",
                "routine_block_id": None,
                "notes": "",
            },
        )
    )

    result = await server_mod.avery_complete(event_id=5)

    method, path, _ = calls[0]
    assert (method, path) == ("POST", "/api/events/5/complete")
    assert result["completed"] == "event"
    assert result["event_id"] == 5
    assert result["task_id"] == 9


async def test_avery_complete_task_hits_the_task_status_path():
    calls = _install(
        lambda req: _json_response(
            200,
            {
                "id": 9,
                "name": "Finish report",
                "tag_ids": [],
                "notes": "",
                "status": "done",
                "due_date": None,
                "est_minutes": None,
                "is_floating": False,
                "priority": "normal",
                "created_at": "2026-08-01T00:00:00",
                "completed_at": "2026-08-13T10:31:00",
            },
        )
    )

    result = await server_mod.avery_complete(task_id=9)

    method, path, body = calls[0]
    assert (method, path) == ("PATCH", "/api/tasks/9")
    assert body == {"status": "done"}
    assert result["completed"] == "task"
    assert result["task_id"] == 9


async def test_avery_complete_event_and_task_are_distinguishable_paths():
    """Same tool, two different ids, two different HTTP calls -- proves the
    two completion meanings never collapse into one code path."""
    event_calls = _install(
        lambda req: _json_response(
            200,
            {
                "id": 1, "task_id": None, "title": "X", "start_at": "2026-08-13T09:00:00",
                "end_at": "2026-08-13T10:00:00", "tag_ids": [], "kind": "event",
                "completed_at": "2026-08-13T10:00:00", "source": "manual",
                "routine_block_id": None, "notes": "",
            },
        )
    )
    event_result = await server_mod.avery_complete(event_id=1)
    assert ("POST", "/api/events/1/complete") == (event_calls[0][0], event_calls[0][1])

    task_calls = _install(
        lambda req: _json_response(
            200,
            {
                "id": 1, "name": "Y", "tag_ids": [], "notes": "", "status": "done",
                "due_date": None, "est_minutes": None, "is_floating": False,
                "priority": "normal", "created_at": "2026-08-01T00:00:00",
                "completed_at": "2026-08-13T10:00:00",
            },
        )
    )
    task_result = await server_mod.avery_complete(task_id=1)
    assert ("PATCH", "/api/tasks/1") == (task_calls[0][0], task_calls[0][1])

    assert event_result["completed"] == "event"
    assert task_result["completed"] == "task"


async def test_avery_complete_requires_exactly_one_of_event_id_or_task_id():
    calls = _install(lambda req: (_ for _ in ()).throw(AssertionError("must not call Avery")))
    with pytest.raises(ValueError):
        await server_mod.avery_complete()
    with pytest.raises(ValueError):
        await server_mod.avery_complete(event_id=1, task_id=2)
    assert calls == []


# --------------------------------------------------------------------- today


async def test_avery_today_shapes_a_summary_from_a_mixed_payload():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/events":
            return _json_response(
                200,
                [
                    {
                        "id": 1, "task_id": None, "title": "Standup",
                        "start_at": "2026-08-13T09:00:00", "end_at": "2026-08-13T09:15:00",
                        "tag_ids": [], "kind": "event", "completed_at": "2026-08-13T09:16:00",
                        "source": "manual", "routine_block_id": None, "notes": "",
                    },
                    {
                        "id": 2, "task_id": 9, "title": "Finish report",
                        "start_at": "2026-08-13T14:00:00", "end_at": "2026-08-13T15:00:00",
                        "tag_ids": [], "kind": "task", "completed_at": None,
                        "source": "agent", "routine_block_id": None, "notes": "",
                    },
                ],
            )
        assert request.url.path == "/api/tasks"
        return _json_response(
            200,
            [
                {
                    "id": 9, "name": "Finish report", "tag_ids": [], "notes": "",
                    "status": "todo", "due_date": "2026-08-13", "est_minutes": None,
                    "is_floating": False, "priority": "normal",
                    "created_at": "2026-08-01T00:00:00", "completed_at": None,
                },
                {
                    "id": 10, "name": "Overdue thing", "tag_ids": [], "notes": "",
                    "status": "doing", "due_date": "2026-08-01", "est_minutes": None,
                    "is_floating": False, "priority": "high",
                    "created_at": "2026-07-01T00:00:00", "completed_at": None,
                },
                {
                    "id": 11, "name": "Already done", "tag_ids": [], "notes": "",
                    "status": "done", "due_date": "2026-08-01", "est_minutes": None,
                    "is_floating": False, "priority": "normal",
                    "created_at": "2026-07-01T00:00:00", "completed_at": "2026-08-10T00:00:00",
                },
                {
                    "id": 12, "name": "Floating, no due date", "tag_ids": [], "notes": "",
                    "status": "todo", "due_date": None, "est_minutes": None,
                    "is_floating": True, "priority": "low",
                    "created_at": "2026-07-01T00:00:00", "completed_at": None,
                },
            ],
        )

    _install(handler)

    summary = await server_mod.avery_today(date="2026-08-13")

    assert summary["date"] == "2026-08-13"

    assert {e["event_id"] for e in summary["schedule"]} == {1, 2}
    standup = next(e for e in summary["schedule"] if e["event_id"] == 1)
    assert standup["done"] is True
    report_block = next(e for e in summary["schedule"] if e["event_id"] == 2)
    assert report_block["done"] is False
    assert report_block["task_id"] == 9

    # Done and archived-style tasks never show up as "open".
    open_ids = {t["task_id"] for t in summary["open_tasks"]}
    assert open_ids == {9, 10, 12}
    assert 11 not in open_ids

    # Only the open task whose due date is before the requested day is overdue.
    overdue_ids = {t["task_id"] for t in summary["overdue"]}
    assert overdue_ids == {10}


async def test_avery_today_defaults_to_today(monkeypatch):
    seen_params = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/events":
            seen_params["start"] = request.url.params.get("start")
            return _json_response(200, [])
        return _json_response(200, [])

    _install(handler)

    import datetime as dt

    result = await server_mod.avery_today()
    assert result["date"] == dt.date.today().isoformat()
    assert seen_params["start"].startswith(dt.date.today().isoformat())


# --------------------------------------------------------- failure handling


async def test_401_raises_a_message_about_the_agent_token():
    _install(lambda req: httpx.Response(401, json={"detail": "not authenticated"}))
    with pytest.raises(AveryAuthError, match="invalid|revoked"):
        await server_mod.avery_capture_task(name="X")


async def test_403_surfaces_the_workspace_message_verbatim():
    _install(
        lambda req: httpx.Response(403, json={"detail": "workspace 'work' is not yet supported"})
    )
    with pytest.raises(AveryForbidden, match="workspace 'work' is not yet supported"):
        await server_mod.avery_capture_task(name="X")


async def test_connection_refused_names_avery_as_the_problem():
    def _raise_connect_error(request: httpx.Request):
        raise httpx.ConnectError("connection refused", request=request)

    transport = httpx.MockTransport(_raise_connect_error)
    server_mod._client = AveryClient(base_url="http://test", token="tok", transport=transport)

    with pytest.raises(AveryUnavailable, match="not running|Could not reach"):
        await server_mod.avery_capture_task(name="X")


async def test_401_403_and_connection_refused_are_distinct_exception_types():
    """The three failure modes must not collapse into one generic message --
    each needs a different fix from the human on the other end."""
    assert AveryAuthError is not AveryForbidden
    assert AveryForbidden is not AveryUnavailable
    assert issubclass(AveryAuthError, Exception)
    assert issubclass(AveryForbidden, Exception)
    assert issubclass(AveryUnavailable, Exception)
