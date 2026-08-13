"""Cross-user data isolation.

Every user-scoped resource (tasks, events, routines, rules, tags, reminders,
reports) must be completely invisible and untouchable to a user who does not
own it. The by-id and list checks are parametrized over every resource type
on purpose: the whole point is that this file must fail if *any* handler is
missing its `.where(Model.user_id == user.id)`, not just the ones someone
thought to hand-check.

A 403 anywhere in here is a failure, not a lesser pass. A 403 confirms the
row exists and merely isn't the caller's -- which leaks its existence, and
with sequential integer ids lets a caller enumerate how much data another
account has just by walking ids and watching 403 turn to 404. The only
response that reveals nothing is 404, exactly the response a made-up id
would also get.
"""

from dataclasses import dataclass
from typing import Awaitable, Callable

import pytest
from httpx import AsyncClient

SIGNUP_A = {"email": "iso-a@example.com", "password": "password-a1", "name": "User A"}
SIGNUP_B = {"email": "iso-b@example.com", "password": "password-b1", "name": "User B"}


async def _signup(client: AsyncClient, payload: dict) -> None:
    response = await client.post("/api/auth/signup", json=payload)
    assert response.status_code == 201, response.text


# ----------------------------------------------------------- resource creators
#
# Each creator makes exactly one row, as whichever client it is given, and
# returns that row's id. Kept self-contained (a reminder creator makes its own
# task, a report creator makes its own rule) so every resource case can be
# driven from a single `case.create(client)` call.


async def _create_task(client: AsyncClient) -> int:
    r = await client.post("/api/tasks", json={"name": "A's task", "tag_ids": []})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_event(client: AsyncClient) -> int:
    r = await client.post(
        "/api/events",
        json={
            "task_name": "A's event",
            "start_at": "2026-01-05T09:00:00",
            "end_at": "2026-01-05T10:00:00",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_routine(client: AsyncClient) -> int:
    r = await client.post("/api/routines", json={"name": "A's routine"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_rule(client: AsyncClient) -> int:
    r = await client.post(
        "/api/rules",
        json={"name": "A's rule", "groups": [{"key": "a", "label": "A", "ratio": 1.0}]},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_tag(client: AsyncClient) -> int:
    r = await client.post("/api/tags", json={"name": "A's tag", "color": "#112233"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_reminder(client: AsyncClient) -> int:
    task_id = await _create_task(client)
    r = await client.post(
        "/api/reminders", json={"task_id": task_id, "remind_at": "2026-01-05T08:00:00"}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_report(client: AsyncClient) -> int:
    await client.post(
        "/api/rules",
        json={"name": "A's rule", "groups": [{"key": "a", "label": "A", "ratio": 1.0}]},
    )
    r = await client.post("/api/reports/run", json={"month": "2026-01"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


@dataclass(frozen=True)
class ResourceCase:
    key: str
    create: Callable[[AsyncClient], Awaitable[int]]
    list_path: str
    item_path: str
    # None means there is no by-id update endpoint to attempt at all (reports
    # are append-only by design -- see app/models/report.py) rather than "we
    # didn't get around to testing it".
    patch_payload: dict | None


RESOURCES = [
    ResourceCase("tasks", _create_task, "/api/tasks", "/api/tasks/{id}", {"name": "hijacked"}),
    ResourceCase(
        "events", _create_event, "/api/events", "/api/events/{id}", {"title": "hijacked"}
    ),
    ResourceCase(
        "routines", _create_routine, "/api/routines", "/api/routines/{id}", {"name": "hijacked"}
    ),
    ResourceCase("rules", _create_rule, "/api/rules", "/api/rules/{id}", {"name": "hijacked"}),
    ResourceCase("tags", _create_tag, "/api/tags", "/api/tags/{id}", {"name": "hijacked"}),
    ResourceCase(
        "reminders",
        _create_reminder,
        "/api/reminders",
        "/api/reminders/{id}",
        {"channel": "lark"},
    ),
    ResourceCase("reports", _create_report, "/api/reports", "/api/reports/{id}", None),
]


def _ids(case: ResourceCase) -> str:
    return case.key


# ------------------------------------------------------------- by-id access


@pytest.mark.parametrize("case", RESOURCES, ids=_ids)
async def test_by_id_access_is_404_not_403(make_client, case: ResourceCase):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)

    resource_id = await case.create(a)
    item_url = case.item_path.format(id=resource_id)

    get_resp = await b.get(item_url)
    assert get_resp.status_code == 404, (
        f"{case.key}: GET by another user's id returned {get_resp.status_code}, "
        "not 404 -- see this file's module docstring for why 403 is a failure here"
    )

    if case.patch_payload is not None:
        patch_resp = await b.patch(item_url, json=case.patch_payload)
        assert patch_resp.status_code == 404, (
            f"{case.key}: PATCH by another user's id returned {patch_resp.status_code}, not 404"
        )

    delete_resp = await b.delete(item_url)
    assert delete_resp.status_code == 404, (
        f"{case.key}: DELETE by another user's id returned {delete_resp.status_code}, not 404"
    )

    # None of B's attempts actually touched A's row -- confirmed by A still
    # being able to read it back, unharmed, through A's own session.
    still_there = await a.get(item_url)
    assert still_there.status_code == 200, (
        f"{case.key}: A's row is gone or broken after B's rejected attempts"
    )


# ---------------------------------------------------------------- list scope


@pytest.mark.parametrize("case", RESOURCES, ids=_ids)
async def test_list_endpoint_excludes_other_users_rows(make_client, case: ResourceCase):
    """The by-id checks above catch a missing filter on the single-row path;
    this catches the same bug on the collection path, which they cannot."""
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)

    await case.create(a)

    listed = (await b.get(case.list_path)).json()
    assert listed == [], f"{case.key}: B's list is not empty -- it can see A's row(s): {listed}"


# ------------------------------------------------------------- agent tokens


async def test_agent_token_does_not_cross_users(make_client):
    """An agent token is long-lived and machine-held, unlike a cookie -- if a
    token ever reached another account's data the blast radius would be a
    standing credential, not a single stolen browser session. Exercised over
    the Authorization: Bearer route specifically, not the cookie, since that
    is the only way a caller actually presents an agent token."""
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)

    a_task_id = await _create_task(a)
    b_task_id = await _create_task(b)

    a_token = (
        await a.post("/api/agent-tokens", json={"name": "A's agent", "workspace": "personal"})
    ).json()["token"]
    b_token = (
        await b.post("/api/agent-tokens", json={"name": "B's agent", "workspace": "personal"})
    ).json()["token"]

    # Sent through b's own client -- which still carries b's cookie -- so this
    # also confirms Bearer wins outright rather than merging with the cookie's
    # scope (see app.deps.get_current_user: "a Bearer header, once present, is
    # authoritative").
    via_a_token = await b.get("/api/tasks", headers={"Authorization": f"Bearer {a_token}"})
    assert via_a_token.status_code == 200
    a_token_ids = {t["id"] for t in via_a_token.json()}
    assert a_token_ids == {a_task_id}

    via_b_token = await a.get("/api/tasks", headers={"Authorization": f"Bearer {b_token}"})
    assert via_b_token.status_code == 200
    b_token_ids = {t["id"] for t in via_b_token.json()}
    assert b_token_ids == {b_task_id}

    # And the by-id path specifically: A's token reaching for B's task id (and
    # the reverse) must read as not-found, the same as every other cross-user
    # by-id attempt in this file.
    cross_a = await b.get(f"/api/tasks/{b_task_id}", headers={"Authorization": f"Bearer {a_token}"})
    assert cross_a.status_code == 404
    cross_b = await a.get(f"/api/tasks/{a_task_id}", headers={"Authorization": f"Bearer {b_token}"})
    assert cross_b.status_code == 404


# ------------------------------------------------------ reference smuggling
#
# The subtlest leak: a handler can scope the *parent* row correctly (the
# create/update is happening in B's own account) while still trusting a
# foreign-key-shaped id in the request body without checking who owns it.
# Every field of this shape that the schemas actually accept is covered below.


async def test_event_create_cannot_attach_to_another_users_task(make_client):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)
    a_task_id = await _create_task(a)

    resp = await b.post(
        "/api/events",
        json={
            "task_id": a_task_id,
            "start_at": "2026-01-05T09:00:00",
            "end_at": "2026-01-05T10:00:00",
        },
    )
    # Naming another user's task_id must read exactly like naming one that
    # does not exist at all -- see services/events.py's TaskNotFound comment.
    assert resp.status_code == 404


async def test_reminder_create_cannot_attach_to_another_users_task(make_client):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)
    a_task_id = await _create_task(a)

    resp = await b.post(
        "/api/reminders", json={"task_id": a_task_id, "remind_at": "2026-01-05T08:00:00"}
    )
    assert resp.status_code == 404


async def test_task_create_cannot_attach_another_users_tag(make_client):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)
    a_tag_id = await _create_tag(a)

    resp = await b.post("/api/tasks", json={"name": "sneaky", "tag_ids": [a_tag_id]})
    # Same "does not exist" treatment as an unknown tag id -- see
    # services/tags.py::assert_tags_exist.
    assert resp.status_code == 422


async def test_task_update_cannot_attach_another_users_tag(make_client):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)
    a_tag_id = await _create_tag(a)
    b_task_id = await _create_task(b)

    resp = await b.patch(f"/api/tasks/{b_task_id}", json={"tag_ids": [a_tag_id]})
    assert resp.status_code == 422


async def test_event_create_cannot_attach_another_users_tag(make_client):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)
    a_tag_id = await _create_tag(a)

    resp = await b.post(
        "/api/events",
        json={
            "task_name": "sneaky",
            "start_at": "2026-01-05T09:00:00",
            "end_at": "2026-01-05T10:00:00",
            "tag_ids": [a_tag_id],
        },
    )
    assert resp.status_code == 422


async def test_routine_block_create_cannot_attach_another_users_tag(make_client):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)
    a_tag_id = await _create_tag(a)
    b_routine_id = await _create_routine(b)

    resp = await b.post(
        f"/api/routines/{b_routine_id}/blocks",
        json={
            "days": [1],
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "task_name": "sneaky",
            "tag_ids": [a_tag_id],
        },
    )
    assert resp.status_code == 422


async def test_rule_create_cannot_reference_another_users_tag_in_a_group(make_client):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)
    a_tag_id = await _create_tag(a)

    resp = await b.post(
        "/api/rules",
        json={
            "name": "sneaky",
            "groups": [{"key": "a", "label": "A", "ratio": 1.0, "tag_ids": [a_tag_id]}],
        },
    )
    assert resp.status_code == 422


async def test_rule_create_cannot_exclude_another_users_tag(make_client):
    a, b = make_client(), make_client()
    await _signup(a, SIGNUP_A)
    await _signup(b, SIGNUP_B)
    a_tag_id = await _create_tag(a)

    resp = await b.post(
        "/api/rules",
        json={
            "name": "sneaky",
            "groups": [{"key": "a", "label": "A", "ratio": 1.0}],
            "exclude_tag_ids": [a_tag_id],
        },
    )
    assert resp.status_code == 422
