"""require user_id

Avery started single-user, so `user_id` was made nullable on every user-scoped
table (see e4b0d9a51c77) and the first signup ever claimed whatever pre-account
rows existed. That claim already happened: the live database has exactly one
account and zero NULL user_id rows anywhere. Going public to other users makes
the nullability itself a liability -- a NULL row is invisible to every
per-user query, and a future re-introduction of the "first signup claims
orphans" path (see app/services/auth.py) would silently hand it to whoever
signs up. This migration closes that door by making the column NOT NULL.

The UPDATE below is defensive, not a real backfill: today's database has
nothing for it to do. It exists because this migration may run against an
older snapshot -- `data/` already holds eight `avery.db.bak-*` files, and a
cloud deployment will be restored from *some* backup -- where pre-account
rows could still be sitting on NULL. The target user is resolved as the
lowest-id account (mirroring "the first signup ever claims them" from
e4b0d9a51c77) rather than hardcoded, and the migration refuses to guess if no
user exists at all: silently defaulting would attach someone's data to nobody,
which is worse than failing the migration.

batch_alter_table(recreate="always") is required, not cosmetic: SQLite cannot
ALTER a column's nullability in place, so Alembic rebuilds each table, and
`recreate="always"` is what carries the `fk_<table>_user_id_users` ON DELETE
CASCADE constraint across the rebuild (see bfa9f753810b for the same pattern
on events.task_id).

Revision ID: 0251ebefc744
Revises: c9d2e85b3a11
"""

import sqlalchemy as sa

from alembic import op

revision = "0251ebefc744"
down_revision = "c9d2e85b3a11"
branch_labels = None
depends_on = None

# Same seven tables e4b0d9a51c77 partitioned by user_id. routine_blocks is
# scoped transitively through routines and never had its own user_id column.
PARTITIONED_TABLES = ("tasks", "events", "tags", "rules", "routines", "reports", "reminders")


def upgrade() -> None:
    bind = op.get_bind()

    target_user_id = bind.execute(sa.text("SELECT MIN(id) FROM users")).scalar()
    if target_user_id is None:
        raise RuntimeError(
            "cannot enforce user_id NOT NULL: this database has no users at all. "
            "Create an account first -- attaching orphaned rows to a made-up id "
            "would silently hand someone's data to nobody."
        )

    for table in PARTITIONED_TABLES:
        bind.execute(
            sa.text(f"UPDATE {table} SET user_id = :uid WHERE user_id IS NULL"),
            {"uid": target_user_id},
        )
        with op.batch_alter_table(table, recreate="always") as batch:
            batch.alter_column("user_id", existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    for table in reversed(PARTITIONED_TABLES):
        with op.batch_alter_table(table, recreate="always") as batch:
            batch.alter_column("user_id", existing_type=sa.Integer(), nullable=True)
