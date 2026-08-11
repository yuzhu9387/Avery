"""Covers the orphan-Task cleanup migration's CLEANUP_SQL against an in-memory
scenario, loading the migration file directly so the query under test is the
exact query that runs against the real database -- not a copy that could drift.
"""

import importlib.util
from pathlib import Path

from sqlalchemy import text

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "alembic"
    / "versions"
    / "39e8fd1e6386_cleanup_routine_orphaned_tasks.py"
)


def _load_cleanup_sql() -> str:
    spec = importlib.util.spec_from_file_location("cleanup_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.CLEANUP_SQL


async def test_cleanup_removes_only_zero_event_block_named_orphans(client, session):
    """Three tasks, three fates:

    - "Work": zero events, name matches a routine block -- a materialization
      leftover, must be deleted.
    - "check": zero events, name matches no block -- a real floating to-do,
      must survive.
    - "Rest": name matches a block, but still has an event -- history, must
      survive untouched.
    """
    await client.post("/api/routines", json={"name": "Default"})
    routine_id = (await client.get("/api/routines/active")).json()["id"]
    await client.post(
        f"/api/routines/{routine_id}/blocks",
        json={
            "days": [1],
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "task_name": "Work",
            "tag_ids": [],
        },
    )
    await client.post(
        f"/api/routines/{routine_id}/blocks",
        json={
            "days": [1],
            "start_time": "22:00:00",
            "end_time": "23:00:00",
            "task_name": "Rest",
            "tag_ids": [],
        },
    )

    orphan_id = (
        await client.post("/api/tasks", json={"name": "Work", "tag_ids": []})
    ).json()["id"]
    floating_id = (
        await client.post("/api/tasks", json={"name": "check", "tag_ids": []})
    ).json()["id"]
    linked_id = (
        await client.post("/api/tasks", json={"name": "Rest", "tag_ids": []})
    ).json()["id"]
    await client.post(
        "/api/events",
        json={
            "task_id": linked_id,
            "start_at": "2026-08-03T22:00:00",
            "end_at": "2026-08-03T23:00:00",
        },
    )

    await session.execute(text(_load_cleanup_sql()))
    await session.commit()

    remaining_ids = {
        t["id"] for t in (await client.get("/api/tasks", params={"include_archived": True})).json()
    }
    assert orphan_id not in remaining_ids, "zero-event, block-named orphan must be deleted"
    assert floating_id in remaining_ids, "a real floating to-do must survive"
    assert linked_id in remaining_ids, "a task still linked to an event must survive"
