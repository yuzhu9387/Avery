"""The HTTP job endpoints (app/routers/jobs.py): shared-secret auth, the date
override, and that they delegate to the exact same functions the in-process
scheduler calls — see tests/test_scheduler.py for those functions' own
behavioural tests (idempotency of materialize_week, list_due filtering)."""

from datetime import date, datetime, timedelta

WEEKDAY_BLOCK = {
    "days": [1, 2, 3, 4, 5],
    "start_time": "09:30:00",
    "end_time": "16:30:00",
    "task_name": "Work",
    "tag_ids": [],
}

TOKEN = "test-jobs-secret"


async def _routine(client):
    routine_id = (await client.post("/api/routines", json={"name": "Default"})).json()["id"]
    await client.post(f"/api/routines/{routine_id}/blocks", json=WEEKDAY_BLOCK)


def _headers(token: str | None) -> dict:
    return {"X-Jobs-Token": token} if token is not None else {}


# --------------------------------------------------------------- roll-week


async def test_roll_week_happy_path_returns_the_job_summary(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "jobs_token", TOKEN)
    await _routine(client)

    response = await client.post(
        "/api/jobs/roll-week",
        json={"today": "2026-08-02"},
        headers=_headers(TOKEN),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] == 5
    assert body["users"][0]["week_start"] == "2026-08-03"


async def test_roll_week_defaults_to_the_real_clock_when_no_override_given(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "jobs_token", TOKEN)
    response = await client.post("/api/jobs/roll-week", json={}, headers=_headers(TOKEN))
    assert response.status_code == 200, response.text
    # No routine at all -> the zero-work branch, but still a 200 with a summary,
    # proving the endpoint ran rather than short-circuiting before the call.
    assert response.json()["created"] == 0


async def test_roll_week_is_idempotent(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "jobs_token", TOKEN)
    await _routine(client)

    first = await client.post(
        "/api/jobs/roll-week", json={"today": "2026-08-02"}, headers=_headers(TOKEN)
    )
    second = await client.post(
        "/api/jobs/roll-week", json={"today": "2026-08-02"}, headers=_headers(TOKEN)
    )
    assert first.json()["created"] == 5
    assert second.json()["created"] == 0


# --------------------------------------------------------------- sweep-reminders


async def test_sweep_reminders_happy_path_returns_the_handled_ids(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "jobs_token", TOKEN)
    task_id = (
        await client.post("/api/tasks", json={"name": "Renew passport", "tag_ids": []})
    ).json()["id"]
    reminder_id = (
        await client.post(
            "/api/reminders", json={"task_id": task_id, "remind_at": "2026-08-01T09:00:00"}
        )
    ).json()["id"]

    response = await client.post(
        "/api/jobs/sweep-reminders",
        json={"now": "2026-08-10T12:00:00"},
        headers=_headers(TOKEN),
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"handled": [reminder_id]}


async def test_sweep_reminders_defaults_to_the_real_clock_when_no_override_given(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "jobs_token", TOKEN)
    response = await client.post("/api/jobs/sweep-reminders", json={}, headers=_headers(TOKEN))
    assert response.status_code == 200, response.text
    assert response.json() == {"handled": []}


async def test_sweep_reminders_is_idempotent(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "jobs_token", TOKEN)
    task_id = (await client.post("/api/tasks", json={"name": "Renew passport", "tag_ids": []})).json()["id"]
    reminder_id = (
        await client.post(
            "/api/reminders", json={"task_id": task_id, "remind_at": "2026-08-01T09:00:00"}
        )
    ).json()["id"]

    now = "2026-08-10T12:00:00"
    first = await client.post("/api/jobs/sweep-reminders", json={"now": now}, headers=_headers(TOKEN))
    second = await client.post("/api/jobs/sweep-reminders", json={"now": now}, headers=_headers(TOKEN))
    assert first.json()["handled"] == [reminder_id]
    assert second.json()["handled"] == []


# --------------------------------------------------------------- auth


async def test_wrong_token_is_rejected(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "jobs_token", TOKEN)
    response = await client.post(
        "/api/jobs/roll-week", json={}, headers=_headers("not-the-secret")
    )
    assert response.status_code == 401


async def test_missing_token_header_is_rejected(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "jobs_token", TOKEN)
    response = await client.post("/api/jobs/roll-week", json={}, headers=_headers(None))
    assert response.status_code == 401


async def test_unconfigured_jobs_token_returns_503_and_does_not_run_the_job(client, monkeypatch):
    from app.config import settings
    from app.scheduler import jobs as job_service

    monkeypatch.setattr(settings, "jobs_token", "")

    calls: list = []

    async def _spy(*args, **kwargs):
        calls.append((args, kwargs))
        return {"created": 999, "users": []}

    monkeypatch.setattr(job_service, "roll_next_week", _spy)

    response = await client.post(
        "/api/jobs/roll-week", json={}, headers=_headers("anything-at-all")
    )
    assert response.status_code == 503
    assert calls == []  # the job function itself must never have been called


async def test_unconfigured_jobs_token_rejects_even_with_no_header(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "jobs_token", "")
    response = await client.post("/api/jobs/roll-week", json={}, headers=_headers(None))
    assert response.status_code == 503
