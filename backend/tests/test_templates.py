WEEKDAY_BLOCK = {
    "days": [1, 2, 3, 4, 5],
    "start_time": "09:30:00",
    "end_time": "16:30:00",
    "task_name": "Work",
    "tag_ids": [],
}
OVERNIGHT_BLOCK = {
    "days": [1, 2, 3, 4, 5, 6, 7],
    "start_time": "23:00:00",
    "end_time": "07:00:00",
    "task_name": "Rest",
    "tag_ids": [],
}


async def _template(client, blocks):
    template_id = (await client.post("/api/templates", json={"name": "Default"})).json()["id"]
    for block in blocks:
        await client.post(f"/api/templates/{template_id}/blocks", json=block)
    return template_id


async def test_materialize_creates_one_event_per_matching_day(client):
    await _template(client, [WEEKDAY_BLOCK])
    result = await client.post("/api/weeks/2026-08-03/materialize")
    assert result.status_code == 200
    assert result.json()["created"] == 5

    events = await client.get(
        "/api/events", params={"start": "2026-08-03T00:00:00", "end": "2026-08-10T00:00:00"}
    )
    starts = sorted(e["start_at"] for e in events.json())
    assert starts[0] == "2026-08-03T09:30:00"
    assert len(starts) == 5


async def test_overnight_block_ends_next_morning(client):
    await _template(client, [OVERNIGHT_BLOCK])
    await client.post("/api/weeks/2026-08-03/materialize")
    events = (
        await client.get(
            "/api/events", params={"start": "2026-08-03T00:00:00", "end": "2026-08-04T00:00:00"}
        )
    ).json()
    monday = next(e for e in events if e["start_at"] == "2026-08-03T23:00:00")
    assert monday["end_at"] == "2026-08-04T07:00:00"


async def test_materialize_skips_days_that_already_have_events(client):
    await _template(client, [WEEKDAY_BLOCK])
    await client.post(
        "/api/events",
        json={
            "task_name": "Dentist",
            "start_at": "2026-08-05T15:00:00",
            "end_at": "2026-08-05T16:00:00",
        },
    )
    result = await client.post("/api/weeks/2026-08-03/materialize")
    assert result.json()["created"] == 4
    assert result.json()["skipped_days"] == ["2026-08-05"]


async def test_materialize_is_idempotent(client):
    await _template(client, [WEEKDAY_BLOCK])
    assert (await client.post("/api/weeks/2026-08-03/materialize")).json()["created"] == 5
    assert (await client.post("/api/weeks/2026-08-03/materialize")).json()["created"] == 0


async def test_materialize_reuses_one_task_across_the_week(client):
    await _template(client, [WEEKDAY_BLOCK])
    await client.post("/api/weeks/2026-08-03/materialize")
    events = (
        await client.get(
            "/api/events", params={"start": "2026-08-03T00:00:00", "end": "2026-08-10T00:00:00"}
        )
    ).json()
    assert len({e["task_id"] for e in events}) == 1


async def test_materialized_events_are_tagged_as_template_source(client):
    await _template(client, [WEEKDAY_BLOCK])
    await client.post("/api/weeks/2026-08-03/materialize")
    events = (
        await client.get(
            "/api/events", params={"start": "2026-08-03T00:00:00", "end": "2026-08-10T00:00:00"}
        )
    ).json()
    assert all(e["source"] == "template" for e in events)
    assert all(e["template_block_id"] is not None for e in events)


async def test_materialize_without_template_returns_409(client):
    assert (await client.post("/api/weeks/2026-08-03/materialize")).status_code == 409


async def test_any_date_in_the_week_resolves_to_its_monday(client):
    await _template(client, [WEEKDAY_BLOCK])
    # Wednesday 2026-08-05 belongs to the week starting Monday 2026-08-03.
    result = await client.post("/api/weeks/2026-08-05/materialize")
    assert result.json()["week_start"] == "2026-08-03"


async def test_delete_block(client):
    template_id = await _template(client, [WEEKDAY_BLOCK])
    blocks = (await client.get(f"/api/templates/{template_id}")).json()["blocks"]
    block_id = blocks[0]["id"]
    assert (await client.delete(f"/api/template-blocks/{block_id}")).status_code == 204
    assert (await client.get(f"/api/templates/{template_id}")).json()["blocks"] == []
