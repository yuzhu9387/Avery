from datetime import datetime


async def _task(client, name="Work block"):
    return (await client.post("/api/tasks", json={"name": name, "tag_ids": []})).json()["id"]


async def test_create_event_with_explicit_task(client):
    task_id = await _task(client)
    created = await client.post(
        "/api/events",
        json={
            "task_id": task_id,
            "start_at": "2026-08-03T09:30:00",
            "end_at": "2026-08-03T16:30:00",
            "tag_ids": [],
        },
    )
    assert created.status_code == 201
    assert created.json()["source"] == "manual"
    assert created.json()["task_id"] == task_id


async def test_create_event_by_name_autocreates_task(client):
    created = await client.post(
        "/api/events",
        json={
            "task_name": "Dentist",
            "start_at": "2026-08-05T15:00:00",
            "end_at": "2026-08-05T16:00:00",
            "tag_ids": [],
        },
    )
    assert created.status_code == 201
    task_id = created.json()["task_id"]
    assert task_id is not None
    task = await client.get(f"/api/tasks/{task_id}")
    assert task.json()["name"] == "Dentist"


async def test_event_requires_task_id_or_name(client):
    bad = await client.post(
        "/api/events",
        json={"start_at": "2026-08-05T15:00:00", "end_at": "2026-08-05T16:00:00"},
    )
    assert bad.status_code == 422


async def test_end_before_start_rejected(client):
    task_id = await _task(client)
    bad = await client.post(
        "/api/events",
        json={
            "task_id": task_id,
            "start_at": "2026-08-05T16:00:00",
            "end_at": "2026-08-05T15:00:00",
        },
    )
    assert bad.status_code == 422


async def test_list_events_filters_by_range(client):
    task_id = await _task(client)
    for day in ("2026-08-03", "2026-08-10"):
        await client.post(
            "/api/events",
            json={
                "task_id": task_id,
                "start_at": f"{day}T09:00:00",
                "end_at": f"{day}T10:00:00",
            },
        )
    listed = await client.get(
        "/api/events", params={"start": "2026-08-03T00:00:00", "end": "2026-08-04T00:00:00"}
    )
    assert len(listed.json()) == 1


async def test_move_event_preserves_duration(client):
    task_id = await _task(client)
    event_id = (
        await client.post(
            "/api/events",
            json={
                "task_id": task_id,
                "start_at": "2026-08-03T09:00:00",
                "end_at": "2026-08-03T10:30:00",
            },
        )
    ).json()["id"]

    moved = await client.post(
        f"/api/events/{event_id}/move", json={"start_at": "2026-08-04T14:00:00"}
    )
    assert moved.status_code == 200
    body = moved.json()
    delta = datetime.fromisoformat(body["end_at"]) - datetime.fromisoformat(body["start_at"])
    assert delta.total_seconds() == 90 * 60
    assert body["start_at"] == "2026-08-04T14:00:00"


async def test_cross_midnight_event_stored_intact(client):
    task_id = await _task(client, "Rest")
    created = await client.post(
        "/api/events",
        json={
            "task_id": task_id,
            "start_at": "2026-08-03T23:00:00",
            "end_at": "2026-08-04T07:00:00",
        },
    )
    assert created.status_code == 201
    assert created.json()["end_at"] == "2026-08-04T07:00:00"


async def test_explicit_null_on_non_nullable_field_is_422_not_500(client):
    """Every EventUpdate field maps to a nullable=False column, so an explicit
    null must be a 422 rather than an IntegrityError 500."""
    task_id = await _task(client)
    event_id = (
        await client.post(
            "/api/events",
            json={
                "task_id": task_id,
                "start_at": "2026-08-03T09:00:00",
                "end_at": "2026-08-03T10:00:00",
            },
        )
    ).json()["id"]

    for field in ("start_at", "end_at", "tag_ids", "notes"):
        patched = await client.patch(f"/api/events/{event_id}", json={field: None})
        assert patched.status_code == 422, field


async def test_rejected_patch_leaves_no_dirty_state(client):
    """A PATCH moving start_at past end_at must be rejected AND leave nothing
    half-applied. Requests share one session, so an object left dirty here gets
    flushed by the next unrelated commit."""
    task_id = await _task(client)
    event_id = (
        await client.post(
            "/api/events",
            json={
                "task_id": task_id,
                "start_at": "2026-08-03T09:00:00",
                "end_at": "2026-08-03T10:00:00",
            },
        )
    ).json()["id"]

    rejected = await client.patch(
        f"/api/events/{event_id}", json={"start_at": "2026-08-03T11:00:00"}
    )
    assert rejected.status_code == 422

    # A later, unrelated write must not carry the rejected start_at with it.
    await client.post("/api/tags", json={"name": "Unrelated", "color": "#BDBD9B"})

    refetched = await client.get(f"/api/events/{event_id}")
    assert refetched.json()["start_at"] == "2026-08-03T09:00:00"
    assert refetched.json()["end_at"] == "2026-08-03T10:00:00"


async def test_range_filter_excludes_exact_boundaries(client):
    """Half-open window: an event ending exactly at the window start and one
    starting exactly at the window end are both outside it. This is what stops
    adjacent days double-counting the same event."""
    task_id = await _task(client)
    for start, end in (
        ("2026-08-03T08:00:00", "2026-08-03T09:00:00"),  # ends at window start
        ("2026-08-03T17:00:00", "2026-08-03T18:00:00"),  # starts at window end
        ("2026-08-03T09:00:00", "2026-08-03T10:00:00"),  # inside
    ):
        await client.post(
            "/api/events", json={"task_id": task_id, "start_at": start, "end_at": end}
        )

    listed = await client.get(
        "/api/events", params={"start": "2026-08-03T09:00:00", "end": "2026-08-03T17:00:00"}
    )
    assert [e["start_at"] for e in listed.json()] == ["2026-08-03T09:00:00"]


async def test_delete_event(client):
    task_id = await _task(client)
    event_id = (
        await client.post(
            "/api/events",
            json={
                "task_id": task_id,
                "start_at": "2026-08-03T09:00:00",
                "end_at": "2026-08-03T10:00:00",
            },
        )
    ).json()["id"]
    assert (await client.delete(f"/api/events/{event_id}")).status_code == 204
    assert (await client.get(f"/api/events/{event_id}")).status_code == 404
