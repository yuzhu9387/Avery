"""The token-refresh lifecycle that keeps calendar connections alive.

Lark rotates refresh tokens: each refresh invalidates the one just used, and
reusing a consumed token can void the whole grant. That makes two failure modes
real, both observed in production on 2026-08-18:

- two concurrent requests racing the same refresh token (the frontend fires
  parallel syncs), one losing the race and killing the grant;
- a stored token the provider rejects even though `expires_at` still looks
  fresh, with no recovery path short of a manual reconnect.
"""

import asyncio
from datetime import datetime, timedelta

import httpx
import pytest

from app.config import settings
from app.models import CalendarConnection
from app.services import calendar_links, google_calendar, lark_calendar
from app.services.google_calendar import ExternalEvent

JOBS_TOKEN = "test-jobs-secret"


def _connection(user_id, provider="lark", *, expires_at, access="T0", refresh="RT0"):
    now = datetime.now()
    return CalendarConnection(
        user_id=user_id, provider=provider,
        access_token=access, refresh_token=refresh, expires_at=expires_at,
        scopes="calendar", external_account_email="me@example.com",
        created_at=now, updated_at=now,
    )


async def _user_id(client) -> int:
    return (await client.get("/api/auth/me")).json()["id"]


FRESH_PAYLOAD = {"access_token": "T1", "refresh_token": "RT1", "expires_in": 7200}


# ------------------------------------------------- refresh serialization


async def test_concurrent_refreshes_hit_the_provider_once(session, client, monkeypatch):
    """Two requests noticing a stale token at the same time must share one
    refresh: a second POST would replay the just-rotated token at Lark."""
    conn = _connection(await _user_id(client),
                       expires_at=datetime.now() - timedelta(minutes=5))
    session.add(conn)
    await session.commit()

    calls = 0

    async def fake_refresh(provider, refresh_token):
        nonlocal calls
        calls += 1
        assert refresh_token == "RT0", "refreshed with an already-consumed token"
        await asyncio.sleep(0.01)  # hold the race window open
        return dict(FRESH_PAYLOAD)

    monkeypatch.setattr(calendar_links, "_post_refresh", fake_refresh)

    got = await asyncio.gather(
        calendar_links.ensure_fresh_token(session, conn),
        calendar_links.ensure_fresh_token(session, conn),
    )

    assert list(got) == ["T1", "T1"]
    assert calls == 1
    assert conn.refresh_token == "RT1"  # the rotated token must be kept


async def test_force_refresh_ignores_a_future_expiry(session, client, monkeypatch):
    """A provider 401 proves the token is dead no matter what expires_at says;
    force=True must refresh anyway."""
    conn = _connection(await _user_id(client),
                       expires_at=datetime.now() + timedelta(hours=2))
    session.add(conn)
    await session.commit()

    async def fake_refresh(provider, refresh_token):
        return dict(FRESH_PAYLOAD)

    monkeypatch.setattr(calendar_links, "_post_refresh", fake_refresh)

    token = await calendar_links.ensure_fresh_token(session, conn, force=True)
    assert token == "T1"


async def test_refresh_failure_carries_the_provider_answer(monkeypatch):
    """'refresh endpoint answered 400' hides *why*; the body names it."""
    monkeypatch.setattr(settings, "lark_app_id", "cli_x")
    monkeypatch.setattr(settings, "lark_app_secret", "s")

    def handler(request):
        return httpx.Response(400, json={"error": "invalid_grant"})

    class Fake(httpx.AsyncClient):
        def __init__(self, *a, **kw):
            super().__init__(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(httpx, "AsyncClient", Fake)

    with pytest.raises(calendar_links.RefreshFailed) as exc:
        await calendar_links._post_refresh("lark", "dead-token")
    assert "invalid_grant" in str(exc.value)


# ------------------------------------------------- 401-driven recovery


async def test_lark_list_events_recovers_from_a_rejected_token(session, client, monkeypatch):
    """The production signature: expires_at in the future, Lark answering
    99991677 anyway. One forced refresh and a retry must heal it."""
    conn = _connection(await _user_id(client),
                       expires_at=datetime.now() + timedelta(hours=2))
    session.add(conn)
    await session.commit()

    refreshes = 0

    async def fake_refresh(provider, refresh_token):
        nonlocal refreshes
        refreshes += 1
        return dict(FRESH_PAYLOAD)

    monkeypatch.setattr(calendar_links, "_post_refresh", fake_refresh)

    ts = int(datetime(2026, 8, 18, 9, 30).timestamp())

    def handler(request):
        if request.headers["Authorization"] == "Bearer T0":
            return httpx.Response(401, json={
                "code": 99991677, "msg": "Authentication token expired."})
        if request.url.path.endswith("/events"):
            return httpx.Response(200, json={"code": 0, "data": {
                "items": [{"event_id": "e1", "summary": "1:1",
                           "start_time": {"timestamp": str(ts)},
                           "end_time": {"timestamp": str(ts + 1800)}}],
                "has_more": False}})
        return httpx.Response(200, json={"code": 0, "data": {
            "calendar_list": [{"calendar_id": "c1", "type": "primary"}]}})

    class Fake(httpx.AsyncClient):
        def __init__(self, *a, **kw):
            super().__init__(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(httpx, "AsyncClient", Fake)

    events = await lark_calendar.list_events(
        session, conn, datetime(2026, 8, 18), datetime(2026, 8, 19))

    assert [e.title for e in events] == ["1:1"]
    assert refreshes == 1


async def test_google_list_events_recovers_from_a_rejected_token(session, client, monkeypatch):
    conn = _connection(await _user_id(client), provider="google",
                       expires_at=datetime.now() + timedelta(hours=2))
    session.add(conn)
    await session.commit()

    refreshes = 0

    async def fake_refresh(provider, refresh_token):
        nonlocal refreshes
        refreshes += 1
        return dict(FRESH_PAYLOAD)

    monkeypatch.setattr(calendar_links, "_post_refresh", fake_refresh)

    def handler(request):
        if request.headers["Authorization"] == "Bearer T0":
            return httpx.Response(401, json={
                "error": {"message": "Invalid Credentials"}})
        return httpx.Response(200, json={"items": []})

    class Fake(httpx.AsyncClient):
        def __init__(self, *a, **kw):
            super().__init__(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(httpx, "AsyncClient", Fake)

    events = await google_calendar.list_events(
        session, conn, datetime(2026, 8, 18), datetime(2026, 8, 19))

    assert events == []
    assert refreshes == 1


# ------------------------------------------------- /events provider dispatch


async def test_external_events_endpoint_asks_the_named_provider(session, client, monkeypatch):
    """GET /api/integrations/lark/events must fetch from Lark — today it sends
    the Lark token to Google's API and returns Google's error."""
    conn = _connection(await _user_id(client),
                       expires_at=datetime.now() + timedelta(hours=2))
    session.add(conn)
    await session.commit()

    marker = ExternalEvent(
        external_id="L1", title="from-lark",
        start_at="2026-08-18T09:00:00", end_at="2026-08-18T10:00:00",
        all_day=False, calendar_name="Lark Calendar", account_email=None)

    async def fake_lark(session_, connection, start, end):
        return [marker]

    async def fake_google(session_, connection, start, end):
        raise AssertionError("google fetcher called for a lark request")

    monkeypatch.setattr(lark_calendar, "list_events", fake_lark)
    monkeypatch.setattr(google_calendar, "list_events", fake_google)

    resp = await client.get(
        "/api/integrations/lark/events",
        params={"start": "2026-08-18T00:00:00", "end": "2026-08-19T00:00:00"})

    assert resp.status_code == 200, resp.text
    assert [e["title"] for e in resp.json()] == ["from-lark"]


# ------------------------------------------------- keepalive job


def _headers(token):
    return {"X-Jobs-Token": token}


async def test_refresh_job_rejects_a_bad_token(client, monkeypatch):
    monkeypatch.setattr(settings, "jobs_token", JOBS_TOKEN)
    resp = await client.post("/api/jobs/refresh-calendar-tokens",
                             headers=_headers("wrong"))
    assert resp.status_code == 401


async def test_refresh_job_force_refreshes_every_connection(session, client, monkeypatch):
    """The keepalive: rotate every stored grant on schedule so a Lark refresh
    token (7-day lifetime) never dies of old age between uses."""
    monkeypatch.setattr(settings, "jobs_token", JOBS_TOKEN)
    uid = await _user_id(client)
    session.add(_connection(uid, "lark",
                            expires_at=datetime.now() + timedelta(hours=2)))
    session.add(_connection(uid, "google",
                            expires_at=datetime.now() + timedelta(hours=2)))
    await session.commit()

    refreshed = []

    async def fake_refresh(provider, refresh_token):
        refreshed.append(provider)
        return dict(FRESH_PAYLOAD)

    monkeypatch.setattr(calendar_links, "_post_refresh", fake_refresh)

    resp = await client.post("/api/jobs/refresh-calendar-tokens",
                             headers=_headers(JOBS_TOKEN))

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"refreshed": 2, "failed": []}
    assert sorted(refreshed) == ["google", "lark"]


async def test_refresh_job_reports_failures_without_aborting(session, client, monkeypatch):
    monkeypatch.setattr(settings, "jobs_token", JOBS_TOKEN)
    uid = await _user_id(client)
    session.add(_connection(uid, "lark",
                            expires_at=datetime.now() + timedelta(hours=2)))
    session.add(_connection(uid, "google",
                            expires_at=datetime.now() + timedelta(hours=2)))
    await session.commit()

    async def fake_refresh(provider, refresh_token):
        if provider == "lark":
            raise calendar_links.RefreshFailed("refresh endpoint answered 400")
        return dict(FRESH_PAYLOAD)

    monkeypatch.setattr(calendar_links, "_post_refresh", fake_refresh)

    resp = await client.post("/api/jobs/refresh-calendar-tokens",
                             headers=_headers(JOBS_TOKEN))

    body = resp.json()
    assert body["refreshed"] == 1
    assert len(body["failed"]) == 1
    assert body["failed"][0]["provider"] == "lark"
    assert "400" in body["failed"][0]["error"]
