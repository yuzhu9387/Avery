"""agent tokens

Adds `agent_tokens`: long-lived, hashed credentials for machine clients (the
MCP server), separate from `auth_sessions` because those are short-lived,
server-generated, browser-only, and stored in plaintext by design — none of
which agent tokens can afford, since they leave the process in a caller's
hands and outlive a browser session by months.

Only `token_hash` is stored, never the plaintext — see AgentToken's docstring
in app/models/agent_token.py for why. `workspace` rides on the row itself so
it cannot be asserted by a request body.

Revision ID: d9c729b002e8
Revises: f2c3a71d9e40
"""

import sqlalchemy as sa

from alembic import op

revision = "d9c729b002e8"
down_revision = "f2c3a71d9e40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("workspace", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_agent_tokens_user_id", "agent_tokens", ["user_id"])
    op.create_index(
        "ix_agent_tokens_token_hash", "agent_tokens", ["token_hash"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_agent_tokens_token_hash", table_name="agent_tokens")
    op.drop_index("ix_agent_tokens_user_id", table_name="agent_tokens")
    op.drop_table("agent_tokens")
