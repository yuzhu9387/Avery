"""event all_day flag

All-day items from an external calendar ("No School", a birthday, a public
holiday) are day markers, not 24 hours of allocated time. Without this flag they
rendered as a pillar swallowing the whole column and — worse — poured 1440
untagged minutes per day into the ratio denominator, distorting the numbers the
app exists to keep honest. The evaluation service now excludes all_day rows; the
week grid draws them as a slim banner at the top of the day.

Revision ID: b3f8c1d47e02
Revises: 0251ebefc744
"""

import sqlalchemy as sa

from alembic import op

revision = "b3f8c1d47e02"
down_revision = "0251ebefc744"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch:
        batch.add_column(
            sa.Column("all_day", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    with op.batch_alter_table("events") as batch:
        batch.drop_column("all_day")
