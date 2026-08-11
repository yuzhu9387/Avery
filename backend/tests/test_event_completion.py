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
