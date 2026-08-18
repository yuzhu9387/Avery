"""avery_calendar and avery_analytics against a mocked Avery HTTP layer."""

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


from mcp_server.tools.analytics import avery_analytics, avery_calendar


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
