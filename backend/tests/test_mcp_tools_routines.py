"""avery_routines and avery_routine_blocks against a mocked Avery HTTP layer."""

import httpx
import pytest

import mcp_server.shared as shared_mod
from mcp_server.client import AveryClient


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


from mcp_server.tools.routines import avery_routine_blocks, avery_routines


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
