"""Mirroring external calendars into `events`, and pushing edits back.

Everything network-shaped is substituted; no test touches Google.
"""

from datetime import datetime, timedelta

import pytest

from app.models import CalendarConnection, Event
from app.services import external_sync, google_calendar
from app.services import oauth as oauth_service
from tests.test_auth import SIGNUP_A, _signup


async def _connected_user(anon_client, session) -> int:
    await _signup(anon_client, SIGNUP_A)
    user_id = (await anon_client.get("/api/auth/me")).json()["id"]
    session.add(CalendarConnection(
        user_id=user_id, provider="google", external_account_email="cal@x.com",
        access_token="at", refresh_token="rt",
        expires_at=datetime.now() + timedelta(hours=1), scopes="",
    ))
    await session.commit()
    return user_id


def _ext(eid, title, start, minutes=60):
    end = start + timedelta(minutes=minutes)
    return google_calendar.ExternalEvent(
        external_id=eid, title=title,
        start_at=start.isoformat(timespec="seconds"),
        end_at=end.isoformat(timespec="seconds"),
        all_day=False, calendar_name="Google Calendar", account_email="cal@x.com",
    )


WEEK = (datetime(2026, 8, 10), datetime(2026, 8, 17))


async def test_sync_creates_updates_and_prunes(anon_client, session, monkeypatch):
    user_id = await _connected_user(anon_client, session)
    batch = [
        _ext("a", "Standup", datetime(2026, 8, 10, 9)),
        _ext("b", "Review", datetime(2026, 8, 11, 14)),
    ]

    async def fake_fetch(session_, conn, start, end):
        return batch

    monkeypatch.setitem(external_sync.FETCHERS, "google", fake_fetch)

    r1 = await external_sync.sync_window(session, user_id, "google", *WEEK)
    assert r1 == {"created": 2, "updated": 0, "pruned": 0}

    # Second run: 'a' moved, 'b' vanished (deleted on Google), 'c' is new.
    batch = [
        _ext("a", "Standup (moved)", datetime(2026, 8, 10, 10)),
        _ext("c", "New thing", datetime(2026, 8, 12, 9)),
    ]
    r2 = await external_sync.sync_window(session, user_id, "google", *WEEK)
    assert r2 == {"created": 1, "updated": 1, "pruned": 1}

    rows = (await anon_client.get("/api/events", params={
        "start": "2026-08-10T00:00:00", "end": "2026-08-17T00:00:00"})).json()
    ext = sorted([e for e in rows if e["source"] == "google"], key=lambda e: e["external_id"])
    assert [e["title"] for e in ext] == ["Standup (moved)", "New thing"]
    assert ext[0]["start_at"] == "2026-08-10T10:00:00"


async def test_sync_preserves_avery_owned_fields(anon_client, session, monkeypatch):
    """The provider owns time and title; the category the user set is Avery's and
    must survive every sync — otherwise categorising external events is Sisyphus."""
    user_id = await _connected_user(anon_client, session)
    batch = [_ext("a", "Standup", datetime(2026, 8, 10, 9))]

    async def fake_fetch(session_, conn, start, end):
        return batch

    monkeypatch.setitem(external_sync.FETCHERS, "google", fake_fetch)
    await external_sync.sync_window(session, user_id, "google", *WEEK)

    # Tag it in Avery.
    tag = (await anon_client.post("/api/tags", json={"name": "Meetings", "color": "#8fadba"})).json()
    rows = (await anon_client.get("/api/events", params={
        "start": "2026-08-10T00:00:00", "end": "2026-08-17T00:00:00"})).json()
    mirror = next(e for e in rows if e["source"] == "google")
    patched = await anon_client.patch(f"/api/events/{mirror['id']}", json={"tag_ids": [tag["id"]]})
    assert patched.status_code == 200

    # Sync again with a new title from the provider.
    batch = [_ext("a", "Standup (renamed upstream)", datetime(2026, 8, 10, 9))]
    await external_sync.sync_window(session, user_id, "google", *WEEK)

    rows = (await anon_client.get("/api/events", params={
        "start": "2026-08-10T00:00:00", "end": "2026-08-17T00:00:00"})).json()
    mirror = next(e for e in rows if e["source"] == "google")
    assert mirror["title"] == "Standup (renamed upstream)", "provider owns the title"
    assert mirror["tag_ids"] == [tag["id"]], "Avery owns the category"


async def test_move_pushes_to_google_before_committing(anon_client, session, monkeypatch):
    user_id = await _connected_user(anon_client, session)

    async def fake_fetch(session_, conn, start, end):
        return [_ext("a", "Standup", datetime(2026, 8, 10, 9))]

    monkeypatch.setitem(external_sync.FETCHERS, "google", fake_fetch)
    await external_sync.sync_window(session, user_id, "google", *WEEK)
    rows = (await anon_client.get("/api/events", params={
        "start": "2026-08-10T00:00:00", "end": "2026-08-17T00:00:00"})).json()
    mirror = next(e for e in rows if e["source"] == "google")

    pushed = {}

    async def fake_push(access_token, external_id, method, body):
        pushed.update({"method": method, "external_id": external_id, "body": body})

    monkeypatch.setattr(google_calendar, "_push", fake_push)

    moved = await anon_client.post(
        f"/api/events/{mirror['id']}/move", json={"start_at": "2026-08-10T11:30:00"}
    )
    assert moved.status_code == 200
    assert pushed["method"] == "PATCH" and pushed["external_id"] == "a"
    assert "2026-08-10T11:30:00" in pushed["body"]["start"]["dateTime"]


async def test_failed_push_leaves_the_local_event_untouched(anon_client, session, monkeypatch):
    """The ordering IS the feature: Google refused, so Avery must still show what
    Google last said — not a local time the real calendar does not have."""
    user_id = await _connected_user(anon_client, session)

    async def fake_fetch(session_, conn, start, end):
        return [_ext("a", "Standup", datetime(2026, 8, 10, 9))]

    monkeypatch.setitem(external_sync.FETCHERS, "google", fake_fetch)
    await external_sync.sync_window(session, user_id, "google", *WEEK)
    rows = (await anon_client.get("/api/events", params={
        "start": "2026-08-10T00:00:00", "end": "2026-08-17T00:00:00"})).json()
    mirror = next(e for e in rows if e["source"] == "google")

    async def refusing_push(access_token, external_id, method, body):
        raise google_calendar.PushFailed("google answered 403: nope")

    monkeypatch.setattr(google_calendar, "_push", refusing_push)

    moved = await anon_client.post(
        f"/api/events/{mirror['id']}/move", json={"start_at": "2026-08-10T11:30:00"}
    )
    assert moved.status_code == 502

    rows = (await anon_client.get("/api/events", params={
        "start": "2026-08-10T00:00:00", "end": "2026-08-17T00:00:00"})).json()
    mirror = next(e for e in rows if e["source"] == "google")
    assert mirror["start_at"] == "2026-08-10T09:00:00", "local row must be unchanged"


async def test_delete_pushes_to_google_first(anon_client, session, monkeypatch):
    user_id = await _connected_user(anon_client, session)

    async def fake_fetch(session_, conn, start, end):
        return [_ext("a", "Standup", datetime(2026, 8, 10, 9))]

    monkeypatch.setitem(external_sync.FETCHERS, "google", fake_fetch)
    await external_sync.sync_window(session, user_id, "google", *WEEK)
    rows = (await anon_client.get("/api/events", params={
        "start": "2026-08-10T00:00:00", "end": "2026-08-17T00:00:00"})).json()
    mirror = next(e for e in rows if e["source"] == "google")

    calls = []

    async def fake_push(access_token, external_id, method, body):
        calls.append(method)

    monkeypatch.setattr(google_calendar, "_push", fake_push)
    assert (await anon_client.delete(f"/api/events/{mirror['id']}")).status_code == 204
    assert calls == ["DELETE"]


async def test_native_events_never_touch_the_push_path(anon_client, session, monkeypatch):
    await _signup(anon_client, SIGNUP_A)

    async def exploding_push(*a, **kw):
        raise AssertionError("push must not run for a native event")

    monkeypatch.setattr(google_calendar, "_push", exploding_push)
    created = (await anon_client.post("/api/events", json={
        "title": "Native", "start_at": "2026-08-10T09:00:00", "end_at": "2026-08-10T10:00:00",
    })).json()
    moved = await anon_client.post(
        f"/api/events/{created['id']}/move", json={"start_at": "2026-08-10T12:00:00"}
    )
    assert moved.status_code == 200


async def test_all_day_markers_render_but_never_count(anon_client, session, monkeypatch):
    """A holiday from Google is a day marker, not 24 hours of activity. It must
    reach the calendar (all_day=True on the mirror) and stay out of the ratios —
    one uncounted marker or the whole week's shares bend around 1440 phantom
    untagged minutes."""
    user_id = await _connected_user(anon_client, session)
    marker = google_calendar.ExternalEvent(
        external_id="holiday", title="No School", start_at="2026-08-14T00:00:00",
        end_at="2026-08-14T23:59:59", all_day=True,
        calendar_name="Google Calendar", account_email="cal@x.com",
    )

    async def fake_fetch(session_, conn, start, end):
        return [marker, _ext("t", "Timed", datetime(2026, 8, 14, 9))]

    monkeypatch.setitem(external_sync.FETCHERS, "google", fake_fetch)
    await external_sync.sync_window(session, user_id, "google", *WEEK)

    rows = (await anon_client.get("/api/events", params={
        "start": "2026-08-10T00:00:00", "end": "2026-08-17T00:00:00"})).json()
    flags = {e["external_id"]: e["all_day"] for e in rows if e["source"] == "google"}
    assert flags == {"holiday": True, "t": False}

    # A rule to evaluate against, then: only the timed hour may count.
    tag = (await anon_client.post("/api/tags", json={"name": "Work", "color": "#8fadba"})).json()
    await anon_client.post("/api/rules", json={
        "name": "r", "groups": [{"key": "A", "label": "Work", "ratio": 1.0, "tag_ids": [tag["id"]]}],
    })
    ev = await anon_client.post("/api/analytics/evaluate", json={
        "period_start": "2026-08-10T00:00:00", "period_end": "2026-08-17T00:00:00"})
    m = ev.json()["metrics"]
    # total_minutes counts grouped time only; untagged time is reported separately.
    # The timed mirror (60 min, untagged) must appear there — and ONLY it: were the
    # all-day marker counted too this would read 1499.
    assert m["untagged_minutes"] == 60, m
