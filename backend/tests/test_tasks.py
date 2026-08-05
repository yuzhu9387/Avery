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


async def test_find_or_create_skips_an_archived_task(client, session):
    """Matching on name alone let the Sunday cron re-attach events to a task the
    user had archived, silently undoing the archive every week."""
    from app.services import tasks as service

    first = await service.find_or_create_by_name(session, "Work", [])
    await client.delete(f"/api/tasks/{first.id}")

    second = await service.find_or_create_by_name(session, "Work", [])
    assert second.id != first.id
    assert second.status == "todo"


async def test_task_stats_rolls_hours_and_occurrences(client):
    tag_id = (
        await client.post("/api/tags", json={"name": "W", "color": "#DA96A4"})
    ).json()["id"]
    task_id = (
        await client.post("/api/tasks", json={"name": "Work", "tag_ids": [tag_id]})
    ).json()["id"]
    for day, hours in (("2026-08-03", 2), ("2026-08-04", 3), ("2026-09-01", 4)):
        await client.post(
            "/api/events",
            json={
                "task_id": task_id,
                "start_at": f"{day}T09:00:00",
                "end_at": f"{day}T{9 + hours:02d}:00:00",
            },
        )

    stats = await client.get(f"/api/tasks/{task_id}/stats", params={"today": "2026-08-05"})
    assert stats.status_code == 200
    body = stats.json()
    assert body["minutes_all_time"] == 9 * 60
    assert body["minutes_this_week"] == 5 * 60   # Mon 3rd + Tue 4th, week of Aug 3
    assert body["minutes_this_month"] == 5 * 60  # September's 4h is a different month
    assert body["event_count"] == 3
    assert len(body["upcoming"]) == 1            # Sep 1 is after Aug 5
    assert body["upcoming"][0]["start_at"] == "2026-09-01T09:00:00"
    assert len(body["recent"]) == 2


async def test_task_stats_404s_for_a_missing_task(client):
    assert (await client.get("/api/tasks/999/stats")).status_code == 404


async def test_floating_only_excludes_tasks_that_have_events(client):
    """`is_floating` alone is not the Floating list: a floating task that has since
    been scheduled belongs under Scheduled."""
    bare = (
        await client.post(
            "/api/tasks", json={"name": "Renew passport", "tag_ids": [], "is_floating": True}
        )
    ).json()["id"]
    scheduled = (
        await client.post(
            "/api/tasks", json={"name": "Dentist", "tag_ids": [], "is_floating": True}
        )
    ).json()["id"]
    await client.post(
        "/api/events",
        json={
            "task_id": scheduled,
            "start_at": "2026-08-05T15:00:00",
            "end_at": "2026-08-05T16:00:00",
        },
    )

    ids = [t["id"] for t in (await client.get("/api/tasks", params={"floating_only": True})).json()]
    assert ids == [bare]


async def test_task_rejects_an_unknown_tag_id(client):
    """Events and rules already validate tag ids. Tasks did not, and an event with
    no tags inherits the task's — so the bad id arrived by the back door."""
    bad = await client.post("/api/tasks", json={"name": "X", "tag_ids": [9999]})
    assert bad.status_code == 422

    ok = (await client.post("/api/tasks", json={"name": "Y", "tag_ids": []})).json()
    assert (
        await client.patch(f"/api/tasks/{ok['id']}", json={"tag_ids": [8888]})
    ).status_code == 422
