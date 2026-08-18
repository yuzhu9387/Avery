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
