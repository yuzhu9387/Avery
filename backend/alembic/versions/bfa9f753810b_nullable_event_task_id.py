"""nullable event task_id

A plain event card (kind='event') no longer mints or reuses a Task -- it
carries its own title (see the previous migration) and stands on its own.
Only a kind='task' card, or an event explicitly scheduling an existing
(likely floating) to-do, still points at a Task. That makes the column
optional.

batch_alter_table is required here, not cosmetic: SQLite cannot ALTER a
column's nullability in place, so Alembic recreates the table under the
hood, and batch mode is what expresses that. The ON DELETE CASCADE FK on
tasks.id is preserved across the rebuild by re-declaring it in `recreate`.

Revision ID: bfa9f753810b
Revises: 7b64e8ab1a8b
"""

import sqlalchemy as sa

from alembic import op

revision = "bfa9f753810b"
down_revision = "7b64e8ab1a8b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("events", recreate="always") as batch:
        batch.alter_column(
            "task_id",
            existing_type=sa.Integer(),
            nullable=True,
        )


def downgrade() -> None:
    # A NULL task_id has no task to backfill from -- downgrading to NOT NULL would
    # need a real task to point every such row at, which this migration cannot
    # invent. Any event materialized or created after this migration's upgrade
    # would need to be repaired by hand before a downgrade could succeed.
    with op.batch_alter_table("events", recreate="always") as batch:
        batch.alter_column(
            "task_id",
            existing_type=sa.Integer(),
            nullable=False,
        )
