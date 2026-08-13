"""Agent tokens: issue/resolve/revoke, Bearer auth on the data API, and — above
all — the fail-closed workspace guard in app.deps.get_current_user."""

import hashlib

from starlette.requests import Request

from app.deps import get_agent_scope, get_current_user
from app.models import AgentToken
from app.services import agent_auth

SIGNUP = {"email": "agent-owner@example.com", "password": "password123", "name": "Owner"}


def _request(*, bearer: str | None = None, cookie: str | None = None) -> Request:
    """Build a bare Request carrying only the headers app.deps cares about, so
    the dependency functions can be exercised directly without going through a
    router that doesn't (yet) use get_agent_scope."""
    headers = []
    if bearer is not None:
        headers.append((b"authorization", f"Bearer {bearer}".encode()))
    if cookie is not None:
        headers.append((b"cookie", f"avery_session={cookie}".encode()))
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "headers": headers,
    }
    return Request(scope)


# --------------------------------------------------------------- service layer


async def test_issued_plaintext_resolves_and_only_the_hash_is_stored(session):
    from app.models import User

    user = User(email="svc@example.com", name="Svc", password_hash=None)
    session.add(user)
    await session.flush()

    row, plaintext = await agent_auth.issue(session, user, name="Claude Code", workspace="personal")

    # The stored row never carries the plaintext, only its SHA-256.
    assert row.token_hash == hashlib.sha256(plaintext.encode()).hexdigest()
    assert plaintext not in row.token_hash

    resolved = await agent_auth.resolve(session, plaintext)
    assert resolved is not None
    assert resolved.id == row.id
    assert resolved.last_used_at is not None  # touched on resolve


async def test_revoked_token_resolves_to_none(session):
    from app.models import User

    user = User(email="svc2@example.com", name="Svc2", password_hash=None)
    session.add(user)
    await session.flush()

    row, plaintext = await agent_auth.issue(session, user, name="x", workspace="personal")
    assert await agent_auth.revoke(session, user, row.id) is True
    assert await agent_auth.resolve(session, plaintext) is None
    # Revoking twice is a no-op, not an error.
    assert await agent_auth.revoke(session, user, row.id) is False


async def test_unknown_and_empty_tokens_resolve_to_none(session):
    assert await agent_auth.resolve(session, "") is None
    assert await agent_auth.resolve(session, "definitely-not-a-real-token") is None


# --------------------------------------------------------------------- HTTP API


async def _issue_via_api(client, name="Claude Code", workspace="personal"):
    response = await client.post(
        "/api/agent-tokens", json={"name": name, "workspace": workspace}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_issue_list_and_revoke_over_the_api(client):
    issued = await _issue_via_api(client)
    assert issued["token"]  # the plaintext, shown exactly once
    assert "token_hash" not in issued

    listed = (await client.get("/api/agent-tokens")).json()
    assert len(listed) == 1
    assert listed[0]["id"] == issued["id"]
    assert "token" not in listed[0]
    assert "token_hash" not in listed[0]

    deleted = await client.delete(f"/api/agent-tokens/{issued['id']}")
    assert deleted.status_code == 204
    # Revoking again (or an id that never existed) reads as not-found.
    assert (await client.delete(f"/api/agent-tokens/{issued['id']}")).status_code == 404
    assert (await client.delete("/api/agent-tokens/999999")).status_code == 404


async def test_agent_tokens_endpoint_requires_a_cookie(anon_client):
    """Issuing/listing/revoking tokens is itself cookie-only — an agent token
    minting more agent tokens would make revocation meaningless."""
    assert (await anon_client.post(
        "/api/agent-tokens", json={"name": "x", "workspace": "personal"}
    )).status_code == 401
    assert (await anon_client.get("/api/agent-tokens")).status_code == 401


async def test_bearer_token_reaches_a_real_data_endpoint(make_client):
    owner, caller = make_client(), make_client()
    signup = await owner.post("/api/auth/signup", json=SIGNUP)
    assert signup.status_code == 201

    issued = await _issue_via_api(owner)
    token = issued["token"]

    created = await owner.post("/api/tasks", json={"name": "Bearer-visible task", "tag_ids": []})
    assert created.status_code == 201

    # `caller` never signed in and carries no cookie — only the Bearer header.
    via_bearer = await caller.get("/api/tasks", headers={"Authorization": f"Bearer {token}"})
    assert via_bearer.status_code == 200
    assert [t["name"] for t in via_bearer.json()] == ["Bearer-visible task"]


async def test_cookie_auth_still_works_on_the_same_endpoint(client):
    """Regression: adding the Bearer path must not disturb the existing cookie one."""
    await client.post("/api/tasks", json={"name": "Cookie task", "tag_ids": []})
    response = await client.get("/api/tasks")
    assert response.status_code == 200
    assert [t["name"] for t in response.json()] == ["Cookie task"]


async def test_unknown_bearer_token_is_401(anon_client):
    response = await anon_client.get(
        "/api/tasks", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401


async def test_revoked_bearer_token_is_401(client):
    issued = await _issue_via_api(client)
    await client.delete(f"/api/agent-tokens/{issued['id']}")
    response = await client.get(
        "/api/tasks", headers={"Authorization": f"Bearer {issued['token']}"}
    )
    assert response.status_code == 401


# ------------------------------------------------------- the fail-closed guard


async def test_agent_token_scoped_to_an_unsupported_workspace_is_403(anon_client, session):
    """THE point of the design: only `personal` exists today, so a token minted
    for anything else must be rejected outright rather than quietly treated as
    personal. The API itself refuses to *issue* a non-personal token (see
    test_workspace_other_than_personal_is_rejected_at_issue below), so this
    constructs the row directly through the service, the way a future
    `work`-scoped token would actually come to exist.
    """
    from app.models import User

    user = User(email="work-tenant@example.com", name="Work", password_hash=None)
    session.add(user)
    await session.flush()
    await session.commit()

    _, plaintext = await agent_auth.issue(session, user, name="rogue", workspace="work")

    response = await anon_client.get(
        "/api/tasks", headers={"Authorization": f"Bearer {plaintext}"}
    )
    assert response.status_code == 403
    assert "work" in response.json()["detail"]


async def test_workspace_other_than_personal_is_rejected_at_issue(client):
    response = await client.post(
        "/api/agent-tokens", json={"name": "x", "workspace": "work"}
    )
    assert response.status_code == 422


# ------------------------------------------------------------- get_agent_scope


async def test_get_agent_scope_reports_personal_for_bearer_and_none_for_cookie(
    make_client, session
):
    owner = make_client()
    await owner.post("/api/auth/signup", json=SIGNUP)
    issued = await _issue_via_api(owner)

    bearer_request = _request(bearer=issued["token"])
    assert await get_agent_scope(bearer_request, session) == "personal"

    # A cookie-only request (no Authorization header at all) is the human's own
    # UI session — not workspace-restricted.
    cookie_request = _request(cookie="whatever-a-browser-cookie-looks-like")
    assert await get_agent_scope(cookie_request, session) is None


async def test_get_current_user_prefers_bearer_over_cookie(make_client, session):
    """Explicit priority check: when both credentials are present, Bearer wins."""
    a, b = make_client(), make_client()
    await a.post("/api/auth/signup", json={"email": "a2@example.com", "password": "password123", "name": "A"})
    await b.post("/api/auth/signup", json={"email": "b2@example.com", "password": "password123", "name": "B"})

    issued = await _issue_via_api(b, workspace="personal")
    cookie_token = a.cookies.get("avery_session")
    assert cookie_token

    request = _request(bearer=issued["token"], cookie=cookie_token)
    user = await get_current_user(request, session)
    assert user.email == "b2@example.com"
