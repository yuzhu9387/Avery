"""Lark event parsing: unix-second timestamps, all-day dates, error-in-body."""

from datetime import datetime

import pytest

from app.services import calendar_links, lark_calendar


def test_timed_event_converts_unix_seconds_to_local_wall_clock():
    ts = int(datetime(2026, 8, 14, 9, 30).timestamp())
    ev = lark_calendar.parse_event({
        "event_id": "e1", "summary": "1:1",
        "start_time": {"timestamp": str(ts)},
        "end_time": {"timestamp": str(ts + 1800)},
    })
    assert ev.start_at == "2026-08-14T09:30:00"
    assert ev.end_at == "2026-08-14T10:00:00"
    assert ev.all_day is False


def test_all_day_event_keeps_to_its_own_day():
    ev = lark_calendar.parse_event({
        "event_id": "e2", "summary": "Off",
        "start_time": {"date": "2026-08-14"},
        "end_time": {"date": "2026-08-15"},   # exclusive, same as Google
    })
    assert ev.all_day is True
    assert ev.start_at == "2026-08-14T00:00:00"
    assert ev.end_at.startswith("2026-08-14")


def test_cancelled_and_timeless_events_are_skipped():
    assert lark_calendar.parse_event({"event_id": "x", "status": "cancelled"}) is None
    assert lark_calendar.parse_event({"event_id": "y", "summary": "?"}) is None


async def test_error_in_body_is_surfaced_not_swallowed(monkeypatch):
    """Lark can answer HTTP 200 with an error in `code` — treating that as success
    would sync an empty window and PRUNE every mirror in it."""
    import httpx

    def handler(request):
        return httpx.Response(200, json={"code": 99991672, "msg": "scope missing"})

    class Fake(httpx.AsyncClient):
        def __init__(self, *a, **kw):
            super().__init__(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(httpx, "AsyncClient", Fake)
    with pytest.raises(calendar_links.RefreshFailed) as exc:
        await lark_calendar._get("tok", f"{lark_calendar.BASE}/calendars", {})
    assert "99991672" in str(exc.value)
