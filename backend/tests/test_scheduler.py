from datetime import date, datetime, timedelta

from app.scheduler.jobs import roll_next_week, sweep_reminders

WEEKDAY_BLOCK = {
    "days": [1, 2, 3, 4, 5],
    "start_time": "09:30:00",
    "end_time": "16:30:00",
    "task_name": "Work",
    "tag_ids": [],
}


async def _template(client):
    template_id = (await client.post("/api/templates", json={"name": "Default"})).json()["id"]
    await client.post(f"/api/templates/{template_id}/blocks", json=WEEKDAY_BLOCK)


async def test_roll_next_week_targets_the_following_monday(client, session):
    await _template(client)
    sunday = date(2026, 8, 2)
    result = await roll_next_week(session, sunday)
    assert result["week_start"] == "2026-08-03"
    assert result["created"] == 5


async def test_roll_next_week_is_idempotent(client, session):
    await _template(client)
    sunday = date(2026, 8, 2)
    assert (await roll_next_week(session, sunday))["created"] == 5
    assert (await roll_next_week(session, sunday))["created"] == 0


async def test_roll_next_week_without_template_reports_zero(client, session):
    result = await roll_next_week(session, date(2026, 8, 2))
    assert result["created"] == 0
    assert result["skipped_reason"] == "no active template"


async def test_double_start_returns_the_same_scheduler():
    """Starting twice used to orphan the first scheduler — its thread kept running and
    shutdown could only reach the newest one."""
    from app.scheduler import jobs

    first = jobs.start_scheduler()
    try:
        assert first is not None
        assert jobs.start_scheduler() is first
        assert len(first.get_jobs()) == 2
    finally:
        jobs.shutdown_scheduler()


async def test_scheduler_disabled_by_config_is_a_no_op(monkeypatch):
    from app.config import settings
    from app.scheduler import jobs

    monkeypatch.setattr(settings, "enable_scheduler", False)
    assert jobs.start_scheduler() is None
    jobs.shutdown_scheduler()  # must be safe when nothing was ever started


async def test_sweep_marks_due_reminders_sent(client, session):
    task_id = (
        await client.post("/api/tasks", json={"name": "Renew passport", "tag_ids": []})
    ).json()["id"]
    reminder_id = (
        await client.post(
            "/api/reminders", json={"task_id": task_id, "remind_at": "2026-08-01T09:00:00"}
        )
    ).json()["id"]

    now = datetime(2026, 8, 10, 12, 0)
    assert await sweep_reminders(session, now) == [reminder_id]
    assert await sweep_reminders(session, now) == []


async def test_sweep_ignores_future_reminders(client, session):
    task_id = (await client.post("/api/tasks", json={"name": "Later", "tag_ids": []})).json()["id"]
    future = (datetime.now() + timedelta(days=30)).isoformat(timespec="seconds")
    await client.post("/api/reminders", json={"task_id": task_id, "remind_at": future})
    assert await sweep_reminders(session, datetime.now()) == []
