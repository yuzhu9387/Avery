"""event title

Gives every event its own display name instead of borrowing one from
`task_id -> task.name` at read time. Backfilled from each event's current
task so existing rows keep showing what they already show.

Revision ID: 7b64e8ab1a8b
Revises: a91c7be04d32
"""

import sqlalchemy as sa

from alembic import op

revision = "7b64e8ab1a8b"
down_revision = "a91c7be04d32"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events", sa.Column("title", sa.String(length=200), nullable=False, server_default="")
    )
    # Correlated subquery rather than an UPDATE...FROM join: SQLite's UPDATE...FROM
    # support is version-dependent, a correlated subquery works everywhere. Only
    # rows whose task still exists are touched -- a dangling task_id (shouldn't
    # happen with the CASCADE FK, but nothing here assumes it) is left at "".
    op.execute(
        """
        UPDATE events
        SET title = (SELECT name FROM tasks WHERE tasks.id = events.task_id)
        WHERE EXISTS (SELECT 1 FROM tasks WHERE tasks.id = events.task_id)
        """
    )


def downgrade() -> None:
    op.drop_column("events", "title")
