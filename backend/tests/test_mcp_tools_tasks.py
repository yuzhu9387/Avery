"""avery_tasks against a mocked Avery HTTP layer."""

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

from mcp_server.tools.tasks import avery_tasks


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
