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
e4b0d9a51c77) rather than hardcoded.

Whether a user is *required* depends on whether there is anything to attach
to one. The guard checks "does any partitioned table have a NULL user_id
row" rather than "does any user exist":

- No NULL rows anywhere (a brand-new, empty database, or an already-clean
  one) -- there is nothing to backfill, so the NOT NULL constraints apply
  immediately and no user is required. This matters because
  `docker-entrypoint.sh` runs `alembic upgrade head` before the server
  starts: on a fresh Cloud SQL database there is no user yet (the first
  signup is what *creates* one), and requiring a user here would make the
  very first deploy unable to ever reach a healthy state -- the migration
  raises, the container never starts, and there is no running instance left
  to accept the signup that would create the user the migration is waiting
  on. An empty database has no orphaned data to protect, so skipping the
  requirement is safe.
- NULL rows exist and a user exists -- backfill them onto the lowest-id
  account, exactly as before.
- NULL rows exist and no user exists -- still refuses to guess. This is the
  case the original guard was written for, and it stays strict: orphaned
  real data must never be silently dropped or attached to a made-up id, only
  ever to a real account.

batch_alter_table(recreate="always") is required on SQLite, not cosmetic:
SQLite cannot ALTER a column's nullability in place, so Alembic rebuilds each
table, and `recreate="always"` is what carries the `fk_<table>_user_id_users`
ON DELETE CASCADE constraint across the rebuild (see bfa9f753810b for the
same pattern on events.task_id). Postgres, by contrast, supports
`ALTER COLUMN ... SET NOT NULL` in place and must NOT be forced through
recreate="always": that forces a full table rebuild (drop + recreate the
primary key) even though the PK isn't changing, which Postgres refuses on
`tasks` because `reminders.task_id` and `events.task_id` still reference it
(dropping tasks_pkey to rebuild would require CASCADE). So recreate mode is
chosen per-dialect below: "always" only on SQLite, the native in-place ALTER
everywhere else.

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


def _recreate_kwargs(bind) -> dict:
    # Only SQLite needs (or tolerates) a forced full-table rebuild here; see
    # the module docstring for why forcing it on Postgres breaks.
    return {"recreate": "always"} if bind.dialect.name == "sqlite" else {}


def upgrade() -> None:
    bind = op.get_bind()

    needs_backfill = any(
        bind.execute(
            sa.text(f"SELECT 1 FROM {table} WHERE user_id IS NULL LIMIT 1")
        ).scalar()
        is not None
        for table in PARTITIONED_TABLES
    )

    target_user_id = None
    if needs_backfill:
        target_user_id = bind.execute(sa.text("SELECT MIN(id) FROM users")).scalar()
        if target_user_id is None:
            raise RuntimeError(
                "cannot enforce user_id NOT NULL: rows with a NULL user_id exist "
                "but this database has no users at all. Create an account first "
                "-- attaching orphaned rows to a made-up id would silently hand "
                "someone's data to nobody."
            )

    recreate_kwargs = _recreate_kwargs(bind)
    for table in PARTITIONED_TABLES:
        if target_user_id is not None:
            bind.execute(
                sa.text(f"UPDATE {table} SET user_id = :uid WHERE user_id IS NULL"),
                {"uid": target_user_id},
            )
        with op.batch_alter_table(table, **recreate_kwargs) as batch:
            batch.alter_column("user_id", existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    recreate_kwargs = _recreate_kwargs(bind)
    for table in reversed(PARTITIONED_TABLES):
        with op.batch_alter_table(table, **recreate_kwargs) as batch:
            batch.alter_column("user_id", existing_type=sa.Integer(), nullable=True)
