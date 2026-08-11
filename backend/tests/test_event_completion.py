from datetime import datetime


async def _event(client, *, kind="event", name="Work block", start="2026-08-03T09:00:00",
                 end="2026-08-03T10:00:00"):
    res = await client.post(
        "/api/events",
        json={"task_name": name, "kind": kind, "start_at": start, "end_at": end, "tag_ids": []},
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_event_defaults_to_kind_event(client):
    created = await _event(client)
    assert created["kind"] == "event"
    assert created["completed_at"] is None


async def test_event_can_be_created_as_a_task_card(client):
    created = await _event(client, kind="task", name="Renew passport")
    assert created["kind"] == "task"


async def test_unknown_kind_is_rejected(client):
    bad = await client.post(
        "/api/events",
        json={
            "task_name": "Nonsense",
            "kind": "reminder",
            "start_at": "2026-08-03T09:00:00",
            "end_at": "2026-08-03T10:00:00",
        },
    )
    assert bad.status_code == 422


async def test_two_event_cards_with_one_name_share_a_task(client):
    a = await _event(client, name="Standup", start="2026-08-03T09:00:00",
                     end="2026-08-03T09:15:00")
    b = await _event(client, name="Standup", start="2026-08-04T09:00:00",
                     end="2026-08-04T09:15:00")
    assert a["task_id"] == b["task_id"]


async def test_two_task_cards_with_one_name_get_their_own_tasks(client):
    # A task card is a to-do with a slot. Sharing one Task would mean completing
    # Monday's card silently completes Tuesday's, and the Tasks page and the
    # calendar would then disagree about what is done.
    a = await _event(client, kind="task", name="Water plants",
                     start="2026-08-03T09:00:00", end="2026-08-03T09:15:00")
    b = await _event(client, kind="task", name="Water plants",
                     start="2026-08-04T09:00:00", end="2026-08-04T09:15:00")
    assert a["task_id"] != b["task_id"]


async def test_complete_sets_the_timestamp_and_is_idempotent(client):
    event = await _event(client)
    first = await client.post(f"/api/events/{event['id']}/complete")
    assert first.status_code == 200
    assert first.json()["completed_at"] is not None

    second = await client.post(f"/api/events/{event['id']}/complete")
    assert second.status_code == 200
    # Completing twice must not slide the timestamp forward — a double-click that
    # lands twice would otherwise rewrite when the work happened.
    assert second.json()["completed_at"] == first.json()["completed_at"]


async def test_uncomplete_clears_the_timestamp_and_is_idempotent(client):
    event = await _event(client)
    await client.post(f"/api/events/{event['id']}/complete")
    cleared = await client.post(f"/api/events/{event['id']}/uncomplete")
    assert cleared.json()["completed_at"] is None
    again = await client.post(f"/api/events/{event['id']}/uncomplete")
    assert again.status_code == 200
    assert again.json()["completed_at"] is None


async def test_completing_a_task_card_marks_its_task_done(client):
    event = await _event(client, kind="task", name="Renew passport")
    await client.post(f"/api/events/{event['id']}/complete")
    task = (await client.get(f"/api/tasks/{event['task_id']}")).json()
    assert task["status"] == "done"
    assert task["completed_at"] is not None

    await client.post(f"/api/events/{event['id']}/uncomplete")
    task = (await client.get(f"/api/tasks/{event['task_id']}")).json()
    assert task["status"] == "todo"
    assert task["completed_at"] is None


async def test_completing_an_event_card_leaves_its_task_alone(client):
    event = await _event(client, name="Dentist")
    await client.post(f"/api/events/{event['id']}/complete")
    task = (await client.get(f"/api/tasks/{event['task_id']}")).json()
    assert task["status"] == "todo"


async def test_uncompleting_does_not_resurrect_an_archived_task(client):
    event = await _event(client, kind="task", name="Old chore")
    await client.post(f"/api/events/{event['id']}/complete")
    await client.delete(f"/api/tasks/{event['task_id']}")  # archives it
    await client.post(f"/api/events/{event['id']}/uncomplete")
    task = (await client.get(f"/api/tasks/{event['task_id']}")).json()
    assert task["status"] == "archived"


async def test_complete_on_a_missing_event_is_404(client):
    assert (await client.post("/api/events/9999/complete")).status_code == 404
