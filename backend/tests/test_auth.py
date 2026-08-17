"""Accounts, sessions, OAuth linking, and — above all — per-user isolation."""

import pytest
from datetime import datetime, timedelta
from urllib.parse import parse_qs, unquote, urlparse

from sqlalchemy import select

from app.models import AuthSession
from app.services import oauth as oauth_service

SIGNUP_A = {"email": "a@example.com", "password": "password-a1", "name": "User A"}
SIGNUP_B = {"email": "b@example.com", "password": "password-b1", "name": "User B"}


async def _signup(client, payload):
    response = await client.post("/api/auth/signup", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# ------------------------------------------------------------ account basics


async def test_signup_me_logout_login_cycle(anon_client):
    body = await _signup(anon_client, SIGNUP_A)
    assert body["email"] == "a@example.com"
    assert body["name"] == "User A"
    assert body["has_password"] is True
    assert body["providers"] == []

    me = await anon_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "a@example.com"

    assert (await anon_client.post("/api/auth/logout")).status_code == 204
    assert (await anon_client.get("/api/auth/me")).status_code == 401

    login = await anon_client.post(
        "/api/auth/login", json={"email": "a@example.com", "password": "password-a1"}
    )
    assert login.status_code == 200
    assert (await anon_client.get("/api/auth/me")).status_code == 200


async def test_signup_stores_email_lowercased(anon_client):
    body = await _signup(
        anon_client,
        {"email": "MiXeD@Example.COM", "password": "password123", "name": "Mixed"},
    )
    assert body["email"] == "mixed@example.com"
    # ...and login is case-insensitive too.
    await anon_client.post("/api/auth/logout")
    login = await anon_client.post(
        "/api/auth/login", json={"email": "mixed@EXAMPLE.com", "password": "password123"}
    )
    assert login.status_code == 200


async def test_wrong_password_is_401_with_the_same_message_as_unknown_email(anon_client):
    await _signup(anon_client, SIGNUP_A)
    wrong = await anon_client.post(
        "/api/auth/login", json={"email": "a@example.com", "password": "wrong-password"}
    )
    unknown = await anon_client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "whatever1"}
    )
    assert wrong.status_code == 401
    assert unknown.status_code == 401
    # Identical bodies: responses must not reveal which emails have accounts.
    assert wrong.json() == unknown.json()


async def test_duplicate_email_is_409(anon_client):
    await _signup(anon_client, SIGNUP_A)
    again = await anon_client.post(
        "/api/auth/signup",
        json={"email": "A@EXAMPLE.COM", "password": "password999", "name": "Imposter"},
    )
    assert again.status_code == 409


async def test_short_password_is_422(anon_client):
    response = await anon_client.post(
        "/api/auth/signup",
        json={"email": "short@example.com", "password": "short", "name": "S"},
    )
    assert response.status_code == 422


async def test_patch_me_updates_name_and_email(anon_client):
    await _signup(anon_client, SIGNUP_A)
    response = await anon_client.patch(
        "/api/auth/me", json={"name": "Renamed", "email": "renamed@example.com"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"
    assert response.json()["email"] == "renamed@example.com"


async def test_patch_me_email_collision_is_409(make_client):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)
    response = await b.patch("/api/auth/me", json={"email": "a@example.com"})
    assert response.status_code == 409


async def test_change_password_requires_the_current_one(anon_client):
    await _signup(anon_client, SIGNUP_A)
    missing = await anon_client.patch(
        "/api/auth/me/password", json={"new_password": "next-password1"}
    )
    assert missing.status_code == 403
    wrong = await anon_client.patch(
        "/api/auth/me/password",
        json={"current_password": "nope-nope-1", "new_password": "next-password1"},
    )
    assert wrong.status_code == 403
    ok = await anon_client.patch(
        "/api/auth/me/password",
        json={"current_password": "password-a1", "new_password": "next-password1"},
    )
    assert ok.status_code == 200
    await anon_client.post("/api/auth/logout")
    login = await anon_client.post(
        "/api/auth/login", json={"email": "a@example.com", "password": "next-password1"}
    )
    assert login.status_code == 200


async def test_anonymous_requests_to_data_endpoints_are_401(anon_client):
    for path in (
        "/api/tasks", "/api/events", "/api/tags", "/api/rules",
        "/api/routines", "/api/reports", "/api/reminders",
        "/api/weeks/2026-08-10", "/api/months/2026-08", "/api/integrations",
    ):
        response = await anon_client.get(path)
        assert response.status_code == 401, path
    assert (await anon_client.post("/api/seed")).status_code == 401
    # Health stays open — it is how the deploy knows the process is up.
    assert (await anon_client.get("/api/health")).status_code == 200


async def test_expired_session_is_401(anon_client, session):
    await _signup(anon_client, SIGNUP_A)
    row = (await session.scalars(select(AuthSession))).one()
    row.expires_at = datetime.now() - timedelta(minutes=1)
    await session.commit()
    assert (await anon_client.get("/api/auth/me")).status_code == 401
    # The dead row was reaped, not just ignored.
    assert (await session.scalars(select(AuthSession))).first() is None


async def test_me_slides_a_session_nearing_expiry(anon_client, session):
    await _signup(anon_client, SIGNUP_A)
    row = (await session.scalars(select(AuthSession))).one()
    row.expires_at = datetime.now() + timedelta(days=10)  # under the 15-day threshold
    await session.commit()

    assert (await anon_client.get("/api/auth/me")).status_code == 200
    await session.refresh(row)
    assert row.expires_at > datetime.now() + timedelta(days=29)


# ------------------------------------------------------------------ isolation


async def test_users_cannot_see_or_touch_each_others_data(make_client):
    """THE point of the feature. A's task/event/tag/routine must be invisible
    to B in lists and indistinguishable from absent on direct access."""
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)

    task_id = (
        await a.post("/api/tasks", json={"name": "A secret task", "tag_ids": []})
    ).json()["id"]
    event_id = (
        await a.post(
            "/api/events",
            json={
                "task_name": "A secret meeting",
                "start_at": "2026-08-12T10:00:00",
                "end_at": "2026-08-12T11:00:00",
            },
        )
    ).json()["id"]
    tag_id = (
        await a.post("/api/tags", json={"name": "A secret tag", "color": "#112233"})
    ).json()["id"]
    routine_id = (await a.post("/api/routines", json={"name": "A routine"})).json()["id"]

    # A sees its own data...
    assert {t["id"] for t in (await a.get("/api/tasks")).json()} >= {task_id}
    assert len((await a.get("/api/events")).json()) >= 1

    # ...and B's lists show NONE of it.
    assert (await b.get("/api/tasks")).json() == []
    assert (await b.get("/api/events")).json() == []
    assert (await b.get("/api/tags")).json() == []
    assert (await b.get("/api/routines")).json() == []

    # Direct access by id reads as "does not exist", never "forbidden".
    assert (await b.get(f"/api/events/{event_id}")).status_code == 404
    assert (await b.patch(f"/api/tasks/{task_id}", json={"name": "hijack"})).status_code == 404
    assert (await b.get(f"/api/tasks/{task_id}")).status_code == 404
    assert (await b.get(f"/api/tags/{tag_id}")).status_code == 404
    assert (await b.get(f"/api/routines/{routine_id}")).status_code == 404
    assert (await b.delete(f"/api/events/{event_id}")).status_code == 404
    assert (await b.post(f"/api/events/{event_id}/complete")).status_code == 404

    # Cross-references are scoped too: B cannot hang an event on A's task...
    stolen = await b.post(
        "/api/events",
        json={
            "task_id": task_id,
            "start_at": "2026-08-12T12:00:00",
            "end_at": "2026-08-12T13:00:00",
        },
    )
    assert stolen.status_code == 404
    # ...nor tag its data with A's tag.
    tagged = await b.post("/api/tasks", json={"name": "sneaky", "tag_ids": [tag_id]})
    assert tagged.status_code == 422

    # And nothing B just did leaked into A.
    assert (await a.get(f"/api/tasks/{task_id}")).json()["name"] == "A secret task"

    # Both users can own the same tag name — uniqueness is per-user.
    assert (
        await b.post("/api/tags", json={"name": "A secret tag", "color": "#445566"})
    ).status_code == 201


async def test_seed_and_calendar_are_per_user(make_client):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)

    assert (await a.post("/api/seed")).json()["tags"] == 8
    # B seeding gets its own fresh set — A's rows don't block or collide.
    assert (await b.post("/api/seed")).json()["tags"] == 8

    # get_week only auto-materializes the current or next week, so use this one.
    from datetime import date, timedelta

    monday = (date.today() - timedelta(days=date.today().isoweekday() - 1)).isoformat()
    await a.post(f"/api/weeks/{monday}/materialize")
    week_b = (await b.get(f"/api/weeks/{monday}")).json()
    # B's week materialized from B's own routine; every event is B's.
    a_event_ids = {e["id"] for e in (await a.get(f"/api/weeks/{monday}")).json()["events"]}
    b_event_ids = {e["id"] for e in week_b["events"]}
    assert a_event_ids and b_event_ids
    assert a_event_ids.isdisjoint(b_event_ids)


# ----------------------------------------------------------------------- oauth


def _configure_google(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "google_client_id", "test-client-id")
    monkeypatch.setattr(settings, "google_client_secret", "test-client-secret")


def _fake_identity(monkeypatch, provider_id="google-sub-1", email="oauth@example.com",
                   name="OAuth Person", email_verified=False):
    """`email_verified` defaults False so the existing tests keep exercising the
    link-token path; the auto-link tests opt in explicitly."""

    async def fake_exchange(provider, code):
        return oauth_service.Identity(
            provider=provider, provider_id=provider_id, email=email, name=name,
            email_verified=email_verified,
        )

    monkeypatch.setattr(oauth_service, "exchange_code", fake_exchange)


async def _callback(client, monkeypatch, **identity_kwargs):
    """Drive start -> callback with a stubbed exchange; returns the redirect."""
    _configure_google(monkeypatch)
    _fake_identity(monkeypatch, **identity_kwargs)
    start = (await client.get("/api/auth/oauth/google/start")).json()
    state = parse_qs(urlparse(start["authorize_url"]).query)["state"][0]
    return await client.get(
        "/api/auth/oauth/google/callback", params={"code": "fake-code", "state": state}
    )


async def test_oauth_start_is_501_until_configured(anon_client, monkeypatch):
    response = await anon_client.get("/api/auth/oauth/google/start")
    assert response.status_code == 501
    assert "GOOGLE_CLIENT_ID" in response.json()["detail"]
    assert "GOOGLE_CLIENT_SECRET" in response.json()["detail"]

    lark = await anon_client.get("/api/auth/oauth/lark/start")
    assert lark.status_code == 501
    assert "LARK_APP_ID" in lark.json()["detail"]

    _configure_google(monkeypatch)
    configured = await anon_client.get("/api/auth/oauth/google/start")
    assert configured.status_code == 200
    url = configured.json()["authorize_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth")
    assert "state=" in url and "test-client-id" in url


async def test_oauth_start_unknown_provider_is_404(anon_client):
    assert (await anon_client.get("/api/auth/oauth/github/start")).status_code == 404


async def test_oauth_callback_rejects_a_bad_state(anon_client, monkeypatch):
    _configure_google(monkeypatch)
    _fake_identity(monkeypatch)
    response = await anon_client.get(
        "/api/auth/oauth/google/callback", params={"code": "x", "state": "forged"}
    )
    assert response.status_code == 400


async def test_oauth_unknown_identity_redirects_with_a_link_token(anon_client, monkeypatch):
    response = await _callback(anon_client, monkeypatch)
    assert response.status_code == 302
    target = urlparse(response.headers["location"])
    assert target.path == "/login"
    query = parse_qs(target.query)
    assert query["provider"] == ["google"]
    assert query["email_hint"] == ["oauth@example.com"]
    assert query["link_token"][0]


async def test_verified_email_links_silently_with_no_prompt(anon_client, monkeypatch):
    """The common case: you sign in with the Google account whose address is already
    your Avery address. The provider has vouched for that address, so there is
    nothing left to prove — no link page, no email to retype, no password.
    """
    await _signup(anon_client, SIGNUP_A)  # a@example.com, with a password
    await anon_client.post("/api/auth/logout")

    response = await _callback(
        anon_client, monkeypatch, email="a@example.com", email_verified=True
    )

    # Straight to the app, not to /login?link_token=...
    location = response.headers["location"]
    assert "link_token" not in location, location
    assert location.rstrip("/").endswith(":5173"), location  # the app, not /login

    me = (await anon_client.get("/api/auth/me")).json()
    assert me["email"] == "a@example.com"
    assert me["providers"] == ["google"]
    # The existing account was joined, not duplicated.
    assert me["has_password"] is True


async def test_verified_email_with_no_account_creates_one(anon_client, monkeypatch):
    response = await _callback(
        anon_client, monkeypatch, email="fresh@example.com", email_verified=True
    )
    assert "link_token" not in response.headers["location"]

    me = (await anon_client.get("/api/auth/me")).json()
    assert me["email"] == "fresh@example.com"
    assert me["has_password"] is False


async def test_unverified_email_cannot_attach_to_a_stranger_account(
    anon_client, monkeypatch
):
    """Account takeover, refused: a typed address is not proof of owning it.

    This is the attack the `oauth_link` gate exists to stop. The caller holds a
    perfectly valid link token — their own — and simply types someone else's
    address. Before the gate, that attached their provider identity to the
    victim's account and returned the victim's session. Worse than a stolen
    session: `attach_provider` is a persistent write, so the attacker could sign
    back in through the provider indefinitely, and the victim changing their
    password would not revoke it, because the provider path never consults one.

    If this test is ever "fixed" by asserting 200 again, the takeover is back.
    """
    await _signup(anon_client, SIGNUP_A)  # the victim, a@example.com
    await anon_client.post("/api/auth/logout")

    response = await _callback(anon_client, monkeypatch)  # email_verified=False
    link_token = parse_qs(urlparse(response.headers["location"]).query)["link_token"][0]

    linked = await anon_client.post(
        "/api/auth/oauth/link", json={"link_token": link_token, "email": "a@example.com"}
    )
    assert linked.status_code == 401
    # Refused *and* not signed in as the victim — a rejection that still handed
    # back a session would defeat the point.
    assert (await anon_client.get("/api/auth/me")).status_code == 401


async def test_a_session_for_a_different_account_does_not_authorise_the_link(
    anon_client, monkeypatch
):
    """Holding *a* session is not enough — it must be a session for that account.

    Gating on "is anyone signed in" instead of "is this that user" would leave the
    takeover fully intact for any attacker willing to register their own account
    first, which costs them nothing.
    """
    await _signup(anon_client, SIGNUP_A)  # the victim, a@example.com
    await anon_client.post("/api/auth/logout")
    await _signup(anon_client, SIGNUP_B)  # the attacker, now signed in as b@

    response = await _callback(anon_client, monkeypatch)
    link_token = parse_qs(urlparse(response.headers["location"]).query)["link_token"][0]

    linked = await anon_client.post(
        "/api/auth/oauth/link", json={"link_token": link_token, "email": "a@example.com"}
    )
    assert linked.status_code == 401
    # Still B: B did not acquire A's account.
    assert (await anon_client.get("/api/auth/me")).json()["email"] == "b@example.com"


async def test_the_owner_can_link_a_provider_to_their_own_account(
    anon_client, monkeypatch
):
    """The legitimate path the gate is careful not to break: sign in by a means you
    already have, then link. It costs one extra sign-in, exactly once."""
    await _signup(anon_client, SIGNUP_A)  # signed in as a@example.com

    response = await _callback(anon_client, monkeypatch)  # email_verified=False
    link_token = parse_qs(urlparse(response.headers["location"]).query)["link_token"][0]

    linked = await anon_client.post(
        "/api/auth/oauth/link", json={"link_token": link_token, "email": "a@example.com"}
    )
    assert linked.status_code == 200
    assert linked.json()["email"] == "a@example.com"
    assert linked.json()["providers"] == ["google"]
    # Joined, not replaced: the password still works.
    assert linked.json()["has_password"] is True
    assert (await anon_client.get("/api/auth/me")).json()["email"] == "a@example.com"


async def test_the_link_step_still_rejects_a_password_field(anon_client, monkeypatch):
    """No password is asked for anywhere in this flow; a client still sending one is
    told rather than having it silently ignored."""
    await _signup(anon_client, SIGNUP_A)
    await anon_client.post("/api/auth/logout")
    response = await _callback(anon_client, monkeypatch)
    link_token = parse_qs(urlparse(response.headers["location"]).query)["link_token"][0]

    with_password = await anon_client.post(
        "/api/auth/oauth/link",
        json={"link_token": link_token, "email": "a@example.com", "password": "x"},
    )
    assert with_password.status_code == 422


async def test_a_link_token_is_single_use(anon_client, monkeypatch):
    """It is burned on use. A second submit — a double-click, or a stale tab — gets
    the same "invalid or expired" answer as a token that timed out, which is what
    that message means when a user sees it."""
    response = await _callback(anon_client, monkeypatch)
    link_token = parse_qs(urlparse(response.headers["location"]).query)["link_token"][0]

    first = await anon_client.post(
        "/api/auth/oauth/link", json={"link_token": link_token, "email": "new@example.com"}
    )
    assert first.status_code == 200

    again = await anon_client.post(
        "/api/auth/oauth/link", json={"link_token": link_token, "email": "new@example.com"}
    )
    assert again.status_code == 400
    assert "invalid or expired" in again.json()["detail"]

async def test_oauth_link_new_email_creates_a_passwordless_account(anon_client, monkeypatch):
    response = await _callback(anon_client, monkeypatch)
    link_token = parse_qs(urlparse(response.headers["location"]).query)["link_token"][0]

    created = await anon_client.post(
        "/api/auth/oauth/link",
        json={"link_token": link_token, "email": "oauth@example.com"},
    )
    assert created.status_code == 200
    body = created.json()
    assert body["email"] == "oauth@example.com"
    assert body["has_password"] is False
    assert body["providers"] == ["google"]

    # Next OAuth round-trip with the same identity goes straight in — no link step.
    await anon_client.post("/api/auth/logout")
    again = await _callback(anon_client, monkeypatch)
    assert again.status_code == 302
    assert urlparse(again.headers["location"]).path == "/"
    assert (await anon_client.get("/api/auth/me")).json()["email"] == "oauth@example.com"


async def test_oauth_link_with_a_stale_token_is_400(anon_client):
    response = await anon_client.post(
        "/api/auth/oauth/link",
        json={"link_token": "expired-or-forged", "email": "x@example.com"},
    )
    assert response.status_code == 400
async def test_integrations_report_signin_and_calendar_separately(anon_client, monkeypatch):
    """Signing in with Google and letting Avery read the calendar are two consents.

    Collapsing them into one "connected" flag is what the Account page cannot work
    with: a user who signed in with Google but never granted calendar access and a
    user who did both would look identical.
    """
    await _signup(anon_client, SIGNUP_A)
    body = (await anon_client.get("/api/integrations")).json()
    assert body["google"] == {
        "configured": False,
        "signin_connected": False,
        "calendar": {"connected": False, "account_email": None, "scopes": ""},
    }
    # Lark's calendar integration exists too, disconnected until consented.
    assert body["lark"]["calendar"] == {"connected": False, "account_email": None, "scopes": ""}

    _configure_google(monkeypatch)
    body = (await anon_client.get("/api/integrations")).json()
    assert body["google"]["configured"] is True
    assert body["google"]["signin_connected"] is False


async def test_calendar_authorize_is_501_until_configured(anon_client, monkeypatch):
    await _signup(anon_client, SIGNUP_A)
    unconfigured = await anon_client.get("/api/integrations/google/authorize")
    assert unconfigured.status_code == 501
    assert "GOOGLE_CLIENT_ID" in unconfigured.json()["detail"]

    _configure_google(monkeypatch)
    ok = await anon_client.get("/api/integrations/google/authorize")
    assert ok.status_code == 200
    url = unquote(ok.json()["authorize_url"])
    # Calendar scopes, and — crucially — offline access: without it Google issues no
    # refresh token and the connection stops working an hour later.
    assert "calendar.events" in url
    assert "calendar.readonly" in url
    assert "access_type=offline" in url
    assert "prompt=consent" in url

    # Lark now has a calendar consent of its own; unconfigured server answers 501.
    assert (await anon_client.get("/api/integrations/lark/authorize")).status_code == 501


async def test_disconnecting_a_calendar_leaves_signin_intact(anon_client, monkeypatch, session):
    """They live in different places precisely so one can go without the other."""
    from datetime import datetime, timedelta

    from app.models import User
    from app.services import calendar_links
    from app.services import oauth as oauth_svc

    await _signup(anon_client, SIGNUP_A)
    _configure_google(monkeypatch)
    user_id = (await anon_client.get("/api/auth/me")).json()["id"]

    user = await session.get(User, user_id)
    user.google_sub = "google-sub-xyz"
    await session.commit()

    await calendar_links.upsert_connection(
        session,
        user_id,
        "google",
        oauth_svc.TokenGrant(
            access_token="at-1",
            refresh_token="rt-1",
            expires_at=datetime.now() + timedelta(hours=1),
            scopes="calendar.events",
            email="cal@example.com",
        ),
    )

    body = (await anon_client.get("/api/integrations")).json()
    assert body["google"]["signin_connected"] is True
    assert body["google"]["calendar"]["connected"] is True
    assert body["google"]["calendar"]["account_email"] == "cal@example.com"

    assert (await anon_client.delete("/api/integrations/google/calendar")).status_code == 204

    body = (await anon_client.get("/api/integrations")).json()
    assert body["google"]["calendar"]["connected"] is False
    assert body["google"]["signin_connected"] is True, "disconnect must not remove sign-in"


async def test_calendar_callback_stores_tokens_and_lands_on_account(
    anon_client, monkeypatch, session
):
    from datetime import datetime, timedelta

    from app.services import calendar_links
    from app.services import oauth as oauth_svc

    await _signup(anon_client, SIGNUP_A)
    _configure_google(monkeypatch)
    user_id = (await anon_client.get("/api/auth/me")).json()["id"]

    async def fake_tokens(provider, code):
        return oauth_svc.TokenGrant(
            access_token="at-new",
            refresh_token="rt-new",
            expires_at=datetime.now() + timedelta(hours=1),
            scopes="https://www.googleapis.com/auth/calendar.events",
            email="cal@example.com",
        )

    monkeypatch.setattr(oauth_svc, "exchange_code_for_tokens", fake_tokens)

    start = (await anon_client.get("/api/integrations/google/authorize")).json()
    state = parse_qs(urlparse(start["authorize_url"]).query)["state"][0]
    done = await anon_client.get(
        "/api/auth/oauth/google/callback", params={"code": "c", "state": state}
    )
    assert done.status_code == 302
    assert "/account?connected=google" in done.headers["location"]

    row = await calendar_links.get_connection(session, user_id, "google")
    assert row is not None and row.access_token == "at-new" and row.refresh_token == "rt-new"

    # A calendar consent is not a sign-in method: it must not have attached one.
    assert (await anon_client.get("/api/auth/me")).json()["providers"] == []


async def test_calendar_callback_while_signed_out_does_not_500(anon_client, monkeypatch):
    """The tokens are useless with no account to attach them to; say so."""
    from app.services import oauth as oauth_svc

    await _signup(anon_client, SIGNUP_A)
    _configure_google(monkeypatch)
    start = (await anon_client.get("/api/integrations/google/authorize")).json()
    state = parse_qs(urlparse(start["authorize_url"]).query)["state"][0]
    await anon_client.post("/api/auth/logout")

    done = await anon_client.get(
        "/api/auth/oauth/google/callback", params={"code": "c", "state": state}
    )
    assert done.status_code == 302
    assert "calendar_error=signed_out" in done.headers["location"]


async def test_token_is_refreshed_only_when_it_is_about_to_expire(monkeypatch, session):
    """The margin matters: a token that passes the check and then spends a second in
    flight would otherwise arrive expired, which reads as a random 401 from Google."""
    from datetime import datetime, timedelta

    from app.models import CalendarConnection
    from app.services import calendar_links

    fresh = CalendarConnection(
        user_id=1, provider="google", access_token="at",
        refresh_token="rt", expires_at=datetime.now() + timedelta(hours=1), scopes="",
    )
    assert calendar_links.needs_refresh(fresh) is False

    dying = CalendarConnection(
        user_id=1, provider="google", access_token="at",
        refresh_token="rt", expires_at=datetime.now() + timedelta(seconds=5), scopes="",
    )
    assert calendar_links.needs_refresh(dying) is True, "inside the margin must refresh"

    # No expiry at all: the provider never said when it dies, so refreshing every
    # request would be guessing.
    unknown = CalendarConnection(
        user_id=1, provider="google", access_token="at",
        refresh_token="rt", expires_at=None, scopes="",
    )
    assert calendar_links.needs_refresh(unknown) is False


async def test_refresh_without_a_refresh_token_fails_loudly(monkeypatch, session):
    """Google issues a refresh token only on first consent. A connection without one
    can never recover on its own — making the user reconnect is the honest answer,
    not retrying forever against a token that will never work."""
    from datetime import datetime, timedelta

    from app.models import CalendarConnection
    from app.services import calendar_links

    stuck = CalendarConnection(
        user_id=1, provider="google", access_token="at",
        refresh_token=None, expires_at=datetime.now() - timedelta(minutes=1), scopes="",
    )
    with pytest.raises(calendar_links.RefreshFailed):
        await calendar_links.ensure_fresh_token(session, stuck)


async def test_refresh_keeps_the_existing_refresh_token(anon_client, monkeypatch, session):
    """A refresh response usually omits the refresh token; overwriting with None
    would make the connection un-refreshable from then on."""
    from datetime import datetime, timedelta

    from app.models import CalendarConnection
    from app.services import calendar_links

    # A real user: foreign keys are enforced here (see enable_sqlite_foreign_keys),
    # so a connection needs an account that actually exists.
    await _signup(anon_client, SIGNUP_A)
    user_id = (await anon_client.get("/api/auth/me")).json()["id"]

    async def fake_post(provider, refresh_token):
        return {"access_token": "at-2", "expires_in": 3600}

    monkeypatch.setattr(calendar_links, "_post_refresh", fake_post)

    conn = CalendarConnection(
        user_id=user_id, provider="google", access_token="at-1",
        refresh_token="rt-keep", expires_at=datetime.now() - timedelta(minutes=1), scopes="",
    )
    session.add(conn)
    await session.commit()

    token = await calendar_links.ensure_fresh_token(session, conn)
    assert token == "at-2"
    assert conn.refresh_token == "rt-keep", "must not lose the refresh token"
    assert conn.expires_at > datetime.now()
