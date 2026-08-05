async def _tag(client, name="Work", color="#DA96A4"):
    return (await client.post("/api/tags", json={"name": name, "color": color})).json()["id"]


async def test_create_task_defaults(client):
    tag_id = await _tag(client)
    created = await client.post(
        "/api/tasks", json={"name": "Morning routine", "tag_ids": [tag_id]}
    )
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "todo"
    assert body["priority"] == "normal"
    assert body["is_floating"] is False
    assert body["tag_ids"] == [tag_id]
    assert body["completed_at"] is None


async def test_floating_task_filter(client):
    await client.post("/api/tasks", json={"name": "Scheduled", "tag_ids": []})
    await client.post(
        "/api/tasks", json={"name": "Renew passport", "tag_ids": [], "is_floating": True}
    )
    floating = await client.get("/api/tasks", params={"is_floating": True})
    assert [t["name"] for t in floating.json()] == ["Renew passport"]


async def test_completing_task_stamps_completed_at(client):
    task_id = (await client.post("/api/tasks", json={"name": "Gym", "tag_ids": []})).json()["id"]
    patched = await client.patch(f"/api/tasks/{task_id}", json={"status": "done"})
    assert patched.status_code == 200
    assert patched.json()["completed_at"] is not None


async def test_reopening_task_clears_completed_at(client):
    task_id = (await client.post("/api/tasks", json={"name": "Gym", "tag_ids": []})).json()["id"]
    await client.patch(f"/api/tasks/{task_id}", json={"status": "done"})
    reopened = await client.patch(f"/api/tasks/{task_id}", json={"status": "todo"})
    assert reopened.json()["completed_at"] is None


async def test_explicit_null_on_non_nullable_field_is_422_not_500(client):
    """`{"tag_ids": null}` must be rejected at validation, never written to a
    nullable=False column where it would surface as an IntegrityError 500."""
    task_id = (
        await client.post("/api/tasks", json={"name": "Solid", "tag_ids": []})
    ).json()["id"]

    assert (await client.patch(f"/api/tasks/{task_id}", json={"tag_ids": None})).status_code == 422
    assert (await client.patch(f"/api/tasks/{task_id}", json={"status": None})).status_code == 422

    # Task.due_date IS nullable, so explicit null there is a legitimate clear.
    await client.patch(f"/api/tasks/{task_id}", json={"due_date": "2026-09-01"})
    cleared = await client.patch(f"/api/tasks/{task_id}", json={"due_date": None})
    assert cleared.status_code == 200
    assert cleared.json()["due_date"] is None


async def test_partial_patch_leaves_unmentioned_fields_alone(client):
    """A PATCH omitting status must not clear completed_at; one omitting due_date
    must not wipe it. This is the invariant `exclude_unset=True` exists to protect."""
    task_id = (
        await client.post(
            "/api/tasks", json={"name": "Gym", "tag_ids": [], "due_date": "2026-09-01"}
        )
    ).json()["id"]
    await client.patch(f"/api/tasks/{task_id}", json={"status": "done"})

    patched = await client.patch(f"/api/tasks/{task_id}", json={"notes": "went twice"})
    body = patched.json()
    assert body["status"] == "done"
    assert body["completed_at"] is not None
    assert body["due_date"] == "2026-09-01"


async def test_delete_task_archives_it(client):
    """Tasks are never hard-deleted: archiving preserves history (and the events
    that carry the minutes every ratio is computed from) while hiding the task from
    the default list."""
    task_id = (await client.post("/api/tasks", json={"name": "Temp", "tag_ids": []})).json()["id"]

    archived = await client.delete(f"/api/tasks/{task_id}")
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    # Still fetchable by id; just no longer in the default list.
    assert (await client.get(f"/api/tasks/{task_id}")).status_code == 200
    default_list = await client.get("/api/tasks")
    assert task_id not in [t["id"] for t in default_list.json()]

    included = await client.get("/api/tasks", params={"include_archived": True})
    assert task_id in [t["id"] for t in included.json()]

    archived_filter = await client.get("/api/tasks", params={"status_filter": "archived"})
    assert task_id in [t["id"] for t in archived_filter.json()]

    # Idempotent: archiving twice succeeds.
    again = await client.delete(f"/api/tasks/{task_id}")
    assert again.status_code == 200
    assert again.json()["status"] == "archived"


async def test_delete_missing_task_is_404(client):
    assert (await client.delete("/api/tasks/999")).status_code == 404


async def test_archiving_a_task_leaves_analytics_ratios_unchanged(client):
    """Archiving must not rewrite history: the minutes an archived task's events
    already contributed have to keep counting exactly as before."""
    tag_id = await _tag(client)
    task_id = (
        await client.post("/api/tasks", json={"name": "Work block", "tag_ids": [tag_id]})
    ).json()["id"]
    await client.post(
        "/api/events",
        json={
            "task_id": task_id,
            "start_at": "2026-08-03T09:00:00",
            "end_at": "2026-08-03T15:00:00",
            "tag_ids": [tag_id],
        },
    )
    await client.post(
        "/api/rules",
        json={
            "name": "solo",
            "tolerance": 0.2,
            "exclude_tag_ids": [],
            "groups": [{"key": "A", "label": "Work", "ratio": 1, "tag_ids": [tag_id]}],
        },
    )
    period = {"period_start": "2026-08-01T00:00:00", "period_end": "2026-09-01T00:00:00"}
    before = (await client.post("/api/analytics/evaluate", json=period)).json()["metrics"]

    assert (await client.delete(f"/api/tasks/{task_id}")).status_code == 200

    after = (await client.post("/api/analytics/evaluate", json=period)).json()["metrics"]
    assert after["total_minutes"] == before["total_minutes"] == 360
