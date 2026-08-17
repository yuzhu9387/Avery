"""calendar connections

Stores one granted calendar consent per (user, provider, external account).

Deliberately its own table rather than columns on `users`: signing in with Google
and letting Avery read your Google Calendar are two separate consents, either can
be granted or revoked without the other, and one account may eventually hold
several calendar accounts. `users.google_sub` means "this Google identity signs in
here"; a row here means "calendar access granted".

Written to catch alembic up with `models/calendar_connection.py`, which already
existed on `Base.metadata` — so `create_all` was auto-creating this table on any
fresh database while alembic knew nothing about it. That divergence is how a
migrated database and a freshly created one drift apart without anyone noticing.

Revision ID: f2c3a71d9e40
Revises: e4b0d9a51c77
"""

import sqlalchemy as sa

from alembic import op

revision = "f2c3a71d9e40"
down_revision = "e4b0d9a51c77"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calendar_connections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("external_account_email", sa.String(length=254), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=False),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("scopes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "user_id",
            "provider",
            "external_account_email",
            name="uq_calendar_connections_user_provider_account",
        ),
    )
    op.create_index(
        "ix_calendar_connections_user_id", "calendar_connections", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_calendar_connections_user_id", table_name="calendar_connections")
    op.drop_table("calendar_connections")
