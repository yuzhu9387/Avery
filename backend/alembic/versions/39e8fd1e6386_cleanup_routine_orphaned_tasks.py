"""clean up tasks orphaned by routine materialization

Before this redesign, `materialize_week` minted (or reused) a Task per routine
block name on every materialization. Now it mints none (see the previous
migration): routine-born events carry their own title and identify themselves
by `routine_block_id`, not by a task link. That leaves any Task which exists
*only* because some past materialization needed a name to attach an event to,
and which has since lost every one of those events (e.g. the events were
deleted, or the block was renamed so nothing points at that name anymore).

The two-part filter matters: a Task is removed only if it BOTH (a) has zero
events left, AND (b) its name matches a task_name declared by some routine
block, past or present. (a) alone would also catch a real, never-scheduled
floating to-do like "check" -- those are exactly what must survive. (b) alone
would catch a real Task that just happens to still be attached to events. The
combination targets only the routine-minting leftovers.

Tasks whose only remaining linkage is a legacy `kind='event'` row from before
the previous migration are left untouched -- they have events, so (a) already
excludes them. That is deliberate: those rows are history, and the whole point
of this cleanup is to remove mint-only debris without rewriting history.

`CLEANUP_SQL` is a module constant (rather than inlined in `upgrade()`) so
`tests/test_task_cleanup.py` can load this file directly and run the exact
same query against an in-memory scenario -- one query, one place, tested and
shipped as literally the same string.

Revision ID: 39e8fd1e6386
Revises: bfa9f753810b
"""

from alembic import op

revision = "39e8fd1e6386"
down_revision = "bfa9f753810b"
branch_labels = None
depends_on = None

CLEANUP_SQL = """
DELETE FROM tasks
WHERE id IN (
    SELECT t.id FROM tasks t
    WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.task_id = t.id)
      AND EXISTS (SELECT 1 FROM routine_blocks rb WHERE rb.task_name = t.name)
)
"""


def upgrade() -> None:
    op.execute(CLEANUP_SQL)


def downgrade() -> None:
    """No-op, deliberately.

    This is a data cleanup, not a schema change: the rows it removes are gone,
    and nothing recorded what their ids or full field values were, so there is
    nothing to reconstruct them from. A downgrade that recreated blank Task
    rows with the same names would not restore the original rows (different
    ids, none of the original tag_ids/notes/status/due_date/created_at) and
    would misleadingly look like a real rollback. Refusing to fake it is more
    honest than a downgrade that silently produces wrong data.
    """
