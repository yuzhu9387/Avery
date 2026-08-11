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
