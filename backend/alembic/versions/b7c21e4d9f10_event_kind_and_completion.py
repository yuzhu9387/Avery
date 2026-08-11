"""event kind and completion

Revision ID: b7c21e4d9f10
Revises: 1a43aac6fa94
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c21e4d9f10"
down_revision: Union[str, Sequence[str], None] = "1a43aac6fa94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default is required, not cosmetic: existing rows have no value and the
    # column is NOT NULL. Existing events are events, which is what they always were.
    op.add_column(
        "events",
        sa.Column("kind", sa.String(length=8), nullable=False, server_default="event"),
    )
    op.add_column("events", sa.Column("completed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "completed_at")
    op.drop_column("events", "kind")
