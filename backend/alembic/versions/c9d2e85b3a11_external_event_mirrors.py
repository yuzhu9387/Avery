"""external event mirrors

Adds `events.external_id` and a unique index on (user_id, source, external_id),
the upsert key for syncing external calendars (Google/Lark) into the events
table. Rows with external_id NULL — every native event — are unaffected: SQLite
treats NULLs as distinct in unique indexes, so the constraint only bites for
actual mirrors.

No enum migration is needed for the new 'google'/'lark' source values: `source`
is a VARCHAR(16), the enum lives in Python.

Revision ID: c9d2e85b3a11
Revises: d9c729b002e8
"""

import sqlalchemy as sa

from alembic import op

revision = "c9d2e85b3a11"
down_revision = "d9c729b002e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch:
        batch.add_column(sa.Column("external_id", sa.String(length=128), nullable=True))
    op.create_index(
        "ux_events_user_source_external",
        "events",
        ["user_id", "source", "external_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_events_user_source_external", table_name="events")
    with op.batch_alter_table("events") as batch:
        batch.drop_column("external_id")
