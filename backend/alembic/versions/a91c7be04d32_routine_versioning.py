"""routine versioning: note and updated_at

Gives a routine the two things a version needs beyond its blocks: a `note`
saying why this version exists, and an `updated_at` to order versions by.

`updated_at` is backfilled from `created_at` rather than from now(), so that
existing routines keep a truthful relative order instead of all collapsing to
the moment this migration ran.

Deliberately does NOT touch `is_active`. The accompanying service change makes
"at most one active routine" an enforced invariant from here on, but a database
that already has several actives is a fact about the user's data, not a
migration's business to silently pick a winner for -- the version list now
shows the situation and makes it one click to resolve.

Revision ID: a91c7be04d32
Revises: d5e1c8b4207f
"""

import sqlalchemy as sa

from alembic import op

revision = "a91c7be04d32"
down_revision = "d5e1c8b4207f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("routines", sa.Column("note", sa.Text(), nullable=False, server_default=""))
    # Added nullable, backfilled, then made NOT NULL: SQLite cannot add a NOT NULL
    # column without a constant default, and `created_at` is per-row.
    op.add_column("routines", sa.Column("updated_at", sa.DateTime(), nullable=True))
    op.execute("UPDATE routines SET updated_at = created_at WHERE updated_at IS NULL")
    with op.batch_alter_table("routines") as batch:
        batch.alter_column("updated_at", existing_type=sa.DateTime(), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("routines") as batch:
        batch.drop_column("updated_at")
        batch.drop_column("note")
