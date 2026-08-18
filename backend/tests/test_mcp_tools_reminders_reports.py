"""avery_reminders and avery_reports against a mocked Avery HTTP layer."""

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


from mcp_server.tools.reminders import avery_reminders
from mcp_server.tools.reports import avery_reports


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
