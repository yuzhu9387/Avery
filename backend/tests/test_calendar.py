from datetime import date, timedelta

WEEKDAY_BLOCK = {
    "days": [1, 2, 3, 4, 5],
    "start_time": "09:30:00",
    "end_time": "16:30:00",
    "task_name": "Work",
    "tag_ids": [],
}


async def _routine(client, blocks=None):
    routine_id = (await client.post("/api/routines", json={"name": "Default"})).json()["id"]
    for block in blocks or [WEEKDAY_BLOCK]:
        await client.post(f"/api/routines/{routine_id}/blocks", json=block)
    return routine_id


def _this_monday() -> date:
    today = date.today()
    return today - timedelta(days=today.isoweekday() - 1)


async def test_week_payload_has_bounds_and_events(client):
    await _routine(client)
    monday = _this_monday()
    result = await client.get(f"/api/weeks/{monday.isoformat()}")
    assert result.status_code == 200
    body = result.json()
    assert body["week_start"] == monday.isoformat()
    assert body["week_end"] == (monday + timedelta(days=7)).isoformat()
    assert len(body["events"]) == 5
    assert body["materialized"] is True


async def test_current_week_lazily_materializes(client):
    await _routine(client)
    monday = _this_monday()
    assert (await client.get(f"/api/weeks/{monday.isoformat()}")).json()["materialized"] is True
    # Second read must not create anything further.
    second = await client.get(f"/api/weeks/{monday.isoformat()}")
    assert second.json()["materialized"] is False
    assert len(second.json()["events"]) == 5


async def test_next_week_lazily_materializes(client):
    await _routine(client)
    next_monday = _this_monday() + timedelta(days=7)
    body = (await client.get(f"/api/weeks/{next_monday.isoformat()}")).json()
    assert body["materialized"] is True
    assert len(body["events"]) == 5


async def test_past_weeks_are_never_materialized(client):
    await _routine(client)
    past_monday = _this_monday() - timedelta(days=7)
    body = (await client.get(f"/api/weeks/{past_monday.isoformat()}")).json()
    assert body["materialized"] is False
    assert body["events"] == []


async def test_week_beyond_next_is_not_materialized(client):
    await _routine(client)
    far = _this_monday() + timedelta(days=21)
    body = (await client.get(f"/api/weeks/{far.isoformat()}")).json()
    assert body["materialized"] is False
    assert body["events"] == []


async def test_week_without_routine_returns_empty_not_error(client):
    monday = _this_monday()
    body = (await client.get(f"/api/weeks/{monday.isoformat()}")).json()
    assert body["events"] == []
    assert body["materialized"] is False


async def test_month_payload_rolls_minutes_per_day_per_tag(client):
    tag_id = (
        await client.post("/api/tags", json={"name": "Rest", "color": "#DEDECF"})
    ).json()["id"]
    await client.post(
        "/api/events",
        json={
            "task_name": "Sleep",
            "start_at": "2026-08-03T23:00:00",
            "end_at": "2026-08-04T07:00:00",
            "tag_ids": [tag_id],
        },
    )
    body = (await client.get("/api/months/2026-08")).json()
    days = {d["date"]: d for d in body["days"]}
    assert days["2026-08-03"]["minutes_by_primary_tag"][str(tag_id)] == 60
    assert days["2026-08-04"]["minutes_by_primary_tag"][str(tag_id)] == 420


async def test_month_payload_covers_every_day(client):
    body = (await client.get("/api/months/2026-08")).json()
    assert len(body["days"]) == 31
    assert body["days"][0]["date"] == "2026-08-01"
    assert body["days"][-1]["date"] == "2026-08-31"


async def test_bad_month_format_returns_422(client):
    assert (await client.get("/api/months/2026-13")).status_code == 422
    # "0000-01" satisfies the regex but date(0, ...) raises — must still be 422.
    assert (await client.get("/api/months/0000-01")).status_code == 422


async def test_untagged_events_still_count_toward_total_minutes(client):
    """total_minutes must not be derived from the per-tag buckets — untagged events
    would contribute nothing and the cell would read "1 event, 0 minutes"."""
    await client.post(
        "/api/events",
        json={
            "task_name": "Untagged block",
            "start_at": "2026-08-03T09:00:00",
            "end_at": "2026-08-03T16:00:00",
            "tag_ids": [],
        },
    )
    days = {d["date"]: d for d in (await client.get("/api/months/2026-08")).json()["days"]}
    cell = days["2026-08-03"]
    assert cell["event_count"] == 1
    assert cell["total_minutes"] == 420
    assert cell["minutes_by_primary_tag"] == {}


async def test_materialized_is_false_when_the_routine_creates_nothing(client):
    """An active routine with no block matching this week legitimately creates
    zero events. Reporting materialized: true there tells the UI a lie."""
    await client.post("/api/routines", json={"name": "Empty"})
    monday = _this_monday()

    body = (await client.get(f"/api/weeks/{monday.isoformat()}")).json()
    assert body["events"] == []
    assert body["materialized"] is False


async def test_an_event_bleeding_in_does_not_suppress_the_week(client):
    """Gating materialization on overlap let one Sunday-night block from the previous
    week blank the entire following week."""
    await _routine(client, [WEEKDAY_BLOCK])
    monday = _this_monday()
    prev_sunday = monday - timedelta(days=1)

    await client.post(
        "/api/events",
        json={
            "task_name": "Late night",
            "start_at": f"{prev_sunday.isoformat()}T22:00:00",
            "end_at": f"{monday.isoformat()}T02:00:00",
        },
    )

    body = (await client.get(f"/api/weeks/{monday.isoformat()}")).json()
    assert body["materialized"] is True
    # Occupancy is judged by where an event starts, not by every day it touches, so
    # the bleeding-in event (which starts Sunday) does not occupy Monday: all five
    # weekdays materialize on top of it, alongside the bled-over event itself.
    assert len(body["events"]) == 6  # 5 materialized + the bled-over one
