"""Reading a connected Google Calendar: conversion, filtering, and the endpoint.

No test here touches the network — `_fetch` is substituted.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.services import google_calendar as gc


def _tz_offset_hours() -> int:
    """This machine's current UTC offset, so the expectations below are written in
    terms of the conversion rather than a hard-coded zone the CI box may not share."""
    return int(datetime.now().astimezone().utcoffset().total_seconds() // 3600)


def test_timed_event_is_converted_to_local_wall_clock():
    """Google speaks RFC3339 with an offset; the rest of the app is naive local.
    Letting an aware datetime through would make every later comparison either
    raise or silently compare across zones."""
    off = _tz_offset_hours()
    # 17:00 UTC, expressed in a zone three hours ahead of UTC.
    raw = {
        "id": "e1",
        "summary": "Standup",
        "start": {"dateTime": "2026-08-13T20:00:00+03:00"},
        "end": {"dateTime": "2026-08-13T21:00:00+03:00"},
    }
    ev = gc.parse_event(raw, "me@example.com")
    expected_start = (datetime(2026, 8, 13, 17, 0, tzinfo=timezone.utc)
                      .astimezone().replace(tzinfo=None))
    assert ev.start_at == expected_start.isoformat(timespec="seconds")
    assert "+" not in ev.start_at and "Z" not in ev.start_at, "must be naive"
    assert ev.all_day is False
    assert ev.account_email == "me@example.com"
    assert off == off  # offset read succeeded


def test_all_day_event_does_not_bleed_into_the_next_day():
    """Google's all-day `end.date` is EXCLUSIVE. Passing it through unchanged makes a
    one-day event end at 00:00 the following day, which draws a sliver in the next
    column — an event on a day the user has nothing on."""
    raw = {
        "id": "e2",
        "summary": "Holiday",
        "start": {"date": "2026-08-13"},
        "end": {"date": "2026-08-14"},
    }
    ev = gc.parse_event(raw, None)
    assert ev.all_day is True
    assert ev.start_at == "2026-08-13T00:00:00"
    assert ev.end_at.startswith("2026-08-13"), ev.end_at


def test_declined_and_cancelled_events_are_dropped():
    """A declined invitation still comes back from the API. Drawing it puts meetings
    the user turned down on their week, and it looks authoritative."""
    declined = {
        "id": "e3",
        "summary": "Meeting I said no to",
        "start": {"dateTime": "2026-08-13T10:00:00+00:00"},
        "end": {"dateTime": "2026-08-13T11:00:00+00:00"},
        "attendees": [
            {"email": "other@example.com", "responseStatus": "accepted"},
            {"self": True, "responseStatus": "declined"},
        ],
    }
    assert gc.parse_event(declined, None) is None

    cancelled = {"id": "e4", "status": "cancelled", "start": {"date": "2026-08-13"}}
    assert gc.parse_event(cancelled, None) is None

    # Someone *else* declining is not our business.
    others_problem = {
        **declined,
        "attendees": [{"email": "other@example.com", "responseStatus": "declined"}],
    }
    assert gc.parse_event(others_problem, None) is not None


def test_an_event_with_no_usable_time_is_skipped_not_crashed():
    assert gc.parse_event({"id": "e5", "summary": "?"}, None) is None


async def test_list_events_expands_recurrences_and_filters(monkeypatch, session):
    """`singleEvents=true` is what turns a weekly standup into one occurrence per
    week; without it the grid would draw the series master once."""
    from app.models import CalendarConnection
    from app.services import calendar_links

    captured = {}

    async def fake_fetch(access_token, params):
        captured.update(params)
        return {
            "items": [
                {
                    "id": "ok",
                    "summary": "Kept",
                    "start": {"dateTime": "2026-08-13T09:00:00+00:00"},
                    "end": {"dateTime": "2026-08-13T10:00:00+00:00"},
                },
                {"id": "gone", "status": "cancelled", "start": {"date": "2026-08-13"}},
            ]
        }

    monkeypatch.setattr(gc, "_fetch", fake_fetch)

    conn = CalendarConnection(
        user_id=1, provider="google", access_token="at",
        refresh_token="rt", expires_at=datetime.now() + timedelta(hours=1),
        scopes="", external_account_email="me@example.com",
    )
    # ensure_fresh_token must not try to refresh a token that is still good.
    assert calendar_links.needs_refresh(conn) is False

    events = await gc.list_events(
        session, conn, datetime(2026, 8, 10), datetime(2026, 8, 17)
    )
    assert [e.title for e in events] == ["Kept"], "cancelled must not survive"
    assert captured["singleEvents"] == "true"
    assert captured["orderBy"] == "startTime"


async def test_events_endpoint_409s_when_no_calendar_is_connected(anon_client):
    from tests.test_auth import SIGNUP_A, _signup

    await _signup(anon_client, SIGNUP_A)
    r = await anon_client.get(
        "/api/integrations/google/events",
        params={"start": "2026-08-10T00:00:00", "end": "2026-08-17T00:00:00"},
    )
    assert r.status_code == 409
