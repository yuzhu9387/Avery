"""tag_description

Revision ID: c4f8a2d61b90
Revises: b7c21e4d9f10
Create Date: 2026-08-11 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4f8a2d61b90"
down_revision: Union[str, None] = "b7c21e4d9f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tags",
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("tags", "description")
