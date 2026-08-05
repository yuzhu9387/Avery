from datetime import datetime

from app.services import reminders as service


async def _task(client, name="Renew passport"):
    return (
        await client.post("/api/tasks", json={"name": name, "tag_ids": [], "is_floating": True})
    ).json()["id"]


async def test_create_reminder(client):
    task_id = await _task(client)
    created = await client.post(
        "/api/reminders",
        json={"task_id": task_id, "remind_at": "2026-08-10T09:00:00", "channel": "both"},
    )
    assert created.status_code == 201
    assert created.json()["sent_at"] is None
    assert created.json()["channel"] == "both"


async def test_reminder_for_missing_task_returns_404(client):
    bad = await client.post(
        "/api/reminders", json={"task_id": 999, "remind_at": "2026-08-10T09:00:00"}
    )
    assert bad.status_code == 404


async def test_list_due_selects_only_unsent_past_reminders(client, session):
    task_id = await _task(client)
    for when in ("2026-08-01T09:00:00", "2026-08-20T09:00:00"):
        await client.post("/api/reminders", json={"task_id": task_id, "remind_at": when})

    due = await service.list_due(session, datetime(2026, 8, 10, 12, 0))
    assert len(due) == 1
    assert due[0].remind_at == datetime(2026, 8, 1, 9, 0)


async def test_mark_sent_is_not_repeated(client, session):
    task_id = await _task(client)
    reminder_id = (
        await client.post(
            "/api/reminders", json={"task_id": task_id, "remind_at": "2026-08-01T09:00:00"}
        )
    ).json()["id"]

    now = datetime(2026, 8, 10, 12, 0)
    assert len(await service.list_due(session, now)) == 1
    await service.mark_sent(session, reminder_id, now)
    assert await service.list_due(session, now) == []


async def test_dismiss_reminder(client):
    task_id = await _task(client)
    reminder_id = (
        await client.post(
            "/api/reminders", json={"task_id": task_id, "remind_at": "2026-08-10T09:00:00"}
        )
    ).json()["id"]
    patched = await client.patch(
        f"/api/reminders/{reminder_id}", json={"dismissed_at": "2026-08-10T09:05:00"}
    )
    assert patched.json()["dismissed_at"] == "2026-08-10T09:05:00"


async def test_dismissed_reminders_are_not_due(client, session):
    task_id = await _task(client)
    reminder_id = (
        await client.post(
            "/api/reminders", json={"task_id": task_id, "remind_at": "2026-08-01T09:00:00"}
        )
    ).json()["id"]
    await client.patch(
        f"/api/reminders/{reminder_id}", json={"dismissed_at": "2026-08-02T09:00:00"}
    )
    assert await service.list_due(session, datetime(2026, 8, 10, 12, 0)) == []


async def test_explicit_null_on_non_nullable_field_is_422_not_500(client):
    """`remind_at` and `channel` are nullable=False; `dismissed_at` is nullable,
    so nulling it is the legitimate way to un-dismiss."""
    task_id = await _task(client)
    reminder_id = (
        await client.post(
            "/api/reminders", json={"task_id": task_id, "remind_at": "2026-08-10T09:00:00"}
        )
    ).json()["id"]

    for field in ("remind_at", "channel"):
        patched = await client.patch(f"/api/reminders/{reminder_id}", json={field: None})
        assert patched.status_code == 422, field

    await client.patch(
        f"/api/reminders/{reminder_id}", json={"dismissed_at": "2026-08-10T09:05:00"}
    )
    undismissed = await client.patch(
        f"/api/reminders/{reminder_id}", json={"dismissed_at": None}
    )
    assert undismissed.status_code == 200
    assert undismissed.json()["dismissed_at"] is None


async def test_delete_reminder(client):
    task_id = await _task(client)
    reminder_id = (
        await client.post(
            "/api/reminders", json={"task_id": task_id, "remind_at": "2026-08-10T09:00:00"}
        )
    ).json()["id"]
    assert (await client.delete(f"/api/reminders/{reminder_id}")).status_code == 204
