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


async def _routine(client, blocks):
    routine_id = (await client.post("/api/routines", json={"name": "Default"})).json()["id"]
    for block in blocks:
        await client.post(f"/api/routines/{routine_id}/blocks", json=block)
    return routine_id


async def test_materialize_creates_one_event_per_matching_day(client):
    await _routine(client, [WEEKDAY_BLOCK])
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
    await _routine(client, [OVERNIGHT_BLOCK])
    await client.post("/api/weeks/2026-08-03/materialize")
    events = (
        await client.get(
            "/api/events", params={"start": "2026-08-03T00:00:00", "end": "2026-08-04T00:00:00"}
        )
    ).json()
    monday = next(e for e in events if e["start_at"] == "2026-08-03T23:00:00")
    assert monday["end_at"] == "2026-08-04T07:00:00"


async def test_materialize_skips_days_that_already_have_events(client):
    await _routine(client, [WEEKDAY_BLOCK])
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
    await _routine(client, [WEEKDAY_BLOCK])
    assert (await client.post("/api/weeks/2026-08-03/materialize")).json()["created"] == 5
    assert (await client.post("/api/weeks/2026-08-03/materialize")).json()["created"] == 0


async def test_materialize_reuses_one_task_across_the_week(client):
    await _routine(client, [WEEKDAY_BLOCK])
    await client.post("/api/weeks/2026-08-03/materialize")
    events = (
        await client.get(
            "/api/events", params={"start": "2026-08-03T00:00:00", "end": "2026-08-10T00:00:00"}
        )
    ).json()
    assert len({e["task_id"] for e in events}) == 1


async def test_materialized_events_are_tagged_as_routine_source(client):
    await _routine(client, [WEEKDAY_BLOCK])
    await client.post("/api/weeks/2026-08-03/materialize")
    events = (
        await client.get(
            "/api/events", params={"start": "2026-08-03T00:00:00", "end": "2026-08-10T00:00:00"}
        )
    ).json()
    assert all(e["source"] == "routine" for e in events)
    assert all(e["routine_block_id"] is not None for e in events)


async def test_materialize_without_routine_returns_409(client):
    assert (await client.post("/api/weeks/2026-08-03/materialize")).status_code == 409


async def test_any_date_in_the_week_resolves_to_its_monday(client):
    await _routine(client, [WEEKDAY_BLOCK])
    # Wednesday 2026-08-05 belongs to the week starting Monday 2026-08-03.
    result = await client.post("/api/weeks/2026-08-05/materialize")
    assert result.json()["week_start"] == "2026-08-03"


async def test_untagged_block_inherits_the_task_tags(client):
    """Tags drive the whole 6:3:1 analytic. A block carrying no tags of its own must
    inherit the task's, or its events land in "unassigned" and disappear from every
    ratio — wrong in the one direction nobody notices."""
    tag_id = (
        await client.post("/api/tags", json={"name": "Deep work", "color": "#DA96A4"})
    ).json()["id"]
    await client.post("/api/tasks", json={"name": "Work", "tag_ids": [tag_id]})

    await _routine(client, [WEEKDAY_BLOCK])  # WEEKDAY_BLOCK declares tag_ids: []
    await client.post("/api/weeks/2026-08-03/materialize")

    events = (
        await client.get(
            "/api/events", params={"start": "2026-08-03T00:00:00", "end": "2026-08-10T00:00:00"}
        )
    ).json()
    assert len(events) == 5
    assert all(e["tag_ids"] == [tag_id] for e in events)


async def test_week_is_materialized_in_a_single_commit(client, session):
    """All of a week's events land in one commit. Per-event commits would let an
    interrupted run half-fill a day, and the skip-if-any-event guard would then
    skip that day forever, leaving its remaining blocks permanently missing."""
    from sqlalchemy import func, select

    from app.models import Event

    await _routine(client, [WEEKDAY_BLOCK, OVERNIGHT_BLOCK])

    committed: list[int] = []
    original_commit = session.commit

    async def counting_commit():
        await original_commit()
        committed.append(
            (await session.scalars(select(func.count()).select_from(Event))).one()
        )

    session.commit = counting_commit
    try:
        result = await client.post("/api/weeks/2026-08-03/materialize")
    finally:
        session.commit = original_commit

    assert result.json()["created"] == 12  # 5 weekday + 7 overnight

    # Task rows commit first (one per distinct name); every Event appears in one step.
    jumps = [b - a for a, b in zip([0, *committed], committed)]
    assert max(jumps) == 12, f"events arrived in multiple commits: {committed}"


async def test_spillover_event_does_not_block_materialization_but_overlap_is_reported(
    client,
):
    """Occupancy is judged by where an event *starts*, not by every day it touches.

    A Sunday-night event spilling into Monday used to mark Monday occupied and skip
    it entirely — silently dropping the day's blocks forever (every week after the
    first, since the seeded rest block runs nightly). That is worse than the
    alternative: materialize Monday anyway, even though it now overlaps the tail of
    the spilling event, and let the overlap be reported. `Evaluation.overlaps` exists
    exactly to surface this, and it does — silent loss does not."""
    all_days_block = {
        "days": [1, 2, 3, 4, 5, 6, 7],
        "start_time": "09:30:00",
        "end_time": "16:30:00",
        "task_name": "Work",
        "tag_ids": [],
    }
    await _routine(client, [all_days_block])

    # Sunday 2026-08-02 22:00 -> Monday 2026-08-03 10:00: starts before the week that
    # begins Monday 2026-08-03, but spills into it and overlaps the Monday block below.
    await client.post(
        "/api/events",
        json={
            "task_name": "Rest",
            "start_at": "2026-08-02T22:00:00",
            "end_at": "2026-08-03T10:00:00",
        },
    )

    result = await client.post("/api/weeks/2026-08-03/materialize")
    assert result.status_code == 200
    body = result.json()
    assert body["created"] == 7  # every day, including Monday
    assert body["skipped_days"] == []

    # An active rule is required for /evaluate; overlap detection doesn't care what's
    # in it, so an empty-tag group is enough to unlock the endpoint.
    await client.post(
        "/api/rules",
        json={
            "name": "Baseline",
            "groups": [{"key": "A", "label": "Everything", "ratio": 1, "tag_ids": []}],
        },
    )
    evaluation = await client.post(
        "/api/analytics/evaluate",
        json={
            "period_start": "2026-08-03T00:00:00",
            "period_end": "2026-08-10T00:00:00",
        },
    )
    assert evaluation.status_code == 200
    assert evaluation.json()["metrics"]["overlaps"], (
        "the Monday block materialized on top of the spilling Rest event, so the "
        "week's evaluation must report the overlap instead of hiding it"
    )


async def test_delete_block(client):
    routine_id = await _routine(client, [WEEKDAY_BLOCK])
    blocks = (await client.get(f"/api/routines/{routine_id}")).json()["blocks"]
    block_id = blocks[0]["id"]
    assert (await client.delete(f"/api/routine-blocks/{block_id}")).status_code == 204
    assert (await client.get(f"/api/routines/{routine_id}")).json()["blocks"] == []


async def test_block_rejects_an_unknown_tag_id(client):
    """A bad tag id on a block becomes a bad tag id on every event it materializes."""
    routine_id = (await client.post("/api/routines", json={"name": "T"})).json()["id"]
    bad = await client.post(
        f"/api/routines/{routine_id}/blocks",
        json={
            "days": [1],
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "task_name": "X",
            "tag_ids": [7777],
        },
    )
    assert bad.status_code == 422


async def test_rename_and_deactivate_a_routine(client):
    routine_id = (await client.post("/api/routines", json={"name": "Old"})).json()["id"]

    renamed = await client.patch(f"/api/routines/{routine_id}", json={"name": "New"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "New"

    off = await client.patch(f"/api/routines/{routine_id}", json={"is_active": False})
    assert off.json()["is_active"] is False
    assert (await client.get("/api/routines/active")).status_code == 404


async def test_partial_block_patch_leaves_other_fields_alone(client):
    routine_id = await _routine(client, [WEEKDAY_BLOCK])
    block = (await client.get(f"/api/routines/{routine_id}")).json()["blocks"][0]

    patched = await client.patch(
        f"/api/routine-blocks/{block['id']}", json={"task_name": "Deep work"}
    )
    assert patched.status_code == 200
    assert patched.json()["task_name"] == "Deep work"
    assert patched.json()["days"] == block["days"]
    assert patched.json()["start_time"] == block["start_time"]


async def test_preview_does_not_write_anything(client):
    """The Routine editor's "Preview next week" must be a pure read."""
    await _routine(client, [WEEKDAY_BLOCK])

    preview = await client.get("/api/routines/active/preview/2026-08-03")
    assert preview.status_code == 200
    body = preview.json()
    assert body["week_start"] == "2026-08-03"
    assert len(body["events"]) == 5
    assert body["events"][0]["start_at"] == "2026-08-03T09:30:00"

    assert (await client.get("/api/events")).json() == []


async def test_every_week_materializes_a_full_monday(client):
    """The nightly rest block bleeds Sunday into Monday. Judging occupancy by touch
    dropped Monday's blocks from every week after the first — 8 events a week, silently."""
    await client.post("/api/seed")

    first = (await client.post("/api/weeks/2026-08-03/materialize")).json()
    second = (await client.post("/api/weeks/2026-08-10/materialize")).json()
    third = (await client.post("/api/weeks/2026-08-17/materialize")).json()

    assert first["created"] == second["created"] == third["created"] == 53
    assert second["skipped_days"] == [] and third["skipped_days"] == []

    for monday, next_day in (("2026-08-10", "2026-08-11"), ("2026-08-17", "2026-08-18")):
        events = (
            await client.get(
                "/api/events",
                params={"start": f"{monday}T00:00:00", "end": f"{next_day}T00:00:00"},
            )
        ).json()
        starting = [e for e in events if e["start_at"].startswith(monday)]
        assert len(starting) == 8, f"{monday} lost blocks"


async def test_preview_predicts_the_tags_that_will_be_created(client):
    """A block declaring no tags inherits the task's at materialization, so the preview
    must show those too. A preview that disagrees with what actually gets created is
    worse than no preview at all."""
    tag_id = (
        await client.post("/api/tags", json={"name": "Deep", "color": "#DA96A4"})
    ).json()["id"]
    await client.post("/api/tasks", json={"name": "Work", "tag_ids": [tag_id]})
    await _routine(client, [WEEKDAY_BLOCK])  # WEEKDAY_BLOCK declares tag_ids: []

    preview = (await client.get("/api/routines/active/preview/2026-08-03")).json()
    assert preview["events"][0]["tag_ids"] == [tag_id]

    await client.post("/api/weeks/2026-08-03/materialize")
    created = (await client.get("/api/events")).json()
    assert created[0]["tag_ids"] == preview["events"][0]["tag_ids"]
