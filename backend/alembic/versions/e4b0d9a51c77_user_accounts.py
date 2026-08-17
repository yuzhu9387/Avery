"""user accounts: users, auth_sessions, and per-table user_id partitioning

Adds the two auth tables and a nullable `user_id` to every table a user's data
lives in directly (tasks, events, tags, rules, routines, reports, reminders —
routine_blocks is scoped transitively through its routine).

`user_id` is nullable ON PURPOSE and this migration backfills NOTHING: it
cannot know who the user is. Existing rows keep user_id NULL, and the very
first account created through POST /api/auth/signup claims them all — that is
where the single-user data attaches to its owner.

Tags also trade their global UNIQUE(name) for UNIQUE(user_id, name): two
accounts must both be able to own a "Work" tag. The old constraint was created
unnamed in the baseline schema, so a naming convention is supplied to the batch
so SQLite's table-rebuild can address it.

Revision ID: e4b0d9a51c77
Revises: 39e8fd1e6386
"""

import sqlalchemy as sa

from alembic import op

revision = "e4b0d9a51c77"
down_revision = "39e8fd1e6386"
branch_labels = None
depends_on = None

# Names the baseline's anonymous UNIQUE(name) on tags so batch mode can drop it.
NAMING = {"uq": "uq_%(table_name)s_%(column_0_name)s"}

PARTITIONED_TABLES = ("tasks", "events", "tags", "rules", "routines", "reports", "reminders")


def _add_user_id(table: str) -> None:
    with op.batch_alter_table(table) as batch:
        batch.add_column(sa.Column("user_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            f"fk_{table}_user_id_users", "users", ["user_id"], ["id"], ondelete="CASCADE"
        )
    op.create_index(f"ix_{table}_user_id", table, ["user_id"])


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=256), nullable=True),
        sa.Column("google_sub", sa.String(length=64), nullable=True),
        sa.Column("lark_open_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("google_sub"),
        sa.UniqueConstraint("lark_open_id"),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_auth_sessions_token", "auth_sessions", ["token"], unique=True)
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])

    for table in PARTITIONED_TABLES:
        _add_user_id(table)

    # tags: global UNIQUE(name) -> UNIQUE(user_id, name)
    with op.batch_alter_table("tags", naming_convention=NAMING) as batch:
        batch.drop_constraint("uq_tags_name", type_="unique")
        batch.create_unique_constraint("uq_tags_user_id_name", ["user_id", "name"])


def downgrade() -> None:
    # tags: restore the global unique first (fails loudly if two users now share
    # a name — better than silently corrupting the constraint).
    with op.batch_alter_table("tags", naming_convention=NAMING) as batch:
        batch.drop_constraint("uq_tags_user_id_name", type_="unique")
        batch.create_unique_constraint("uq_tags_name", ["name"])

    for table in reversed(PARTITIONED_TABLES):
        op.drop_index(f"ix_{table}_user_id", table_name=table)
        with op.batch_alter_table(table, naming_convention=NAMING) as batch:
            batch.drop_constraint(f"fk_{table}_user_id_users", type_="foreignkey")
            batch.drop_column("user_id")

    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_token", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("users")
