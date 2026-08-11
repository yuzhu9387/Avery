"""rename_seeded_group_labels

Revision ID: 3f7a9cee3801
Revises: c4f8a2d61b90
Create Date: 2026-08-11 11:37:51.380970

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3f7a9cee3801'
down_revision: Union[str, Sequence[str], None] = 'c4f8a2d61b90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Label mapping for forward migration
LABEL_MAP_UPGRADE = {
    "Work · Study · Commute": "Work & Study",
    "Kids · Chores": "Family care",
}

# Label mapping for downgrade
LABEL_MAP_DOWNGRADE = {v: k for k, v in LABEL_MAP_UPGRADE.items()}


def upgrade() -> None:
    """Rename seeded group labels in existing rule rows."""
    connection = op.get_bind()

    # Fetch all rules
    result = connection.execute(sa.text("SELECT id, groups FROM rules"))
    rules = result.fetchall()

    for rule_id, groups_json in rules:
        if groups_json is None:
            continue

        groups = json.loads(groups_json)
        updated = False

        # Update labels that match the old seeded values
        for group in groups:
            if group.get("label") in LABEL_MAP_UPGRADE:
                group["label"] = LABEL_MAP_UPGRADE[group["label"]]
                updated = True

        # Write back if any labels were changed
        if updated:
            connection.execute(
                sa.text("UPDATE rules SET groups = :groups WHERE id = :id"),
                {"groups": json.dumps(groups), "id": rule_id}
            )


def downgrade() -> None:
    """Restore original seeded group labels."""
    connection = op.get_bind()

    # Fetch all rules
    result = connection.execute(sa.text("SELECT id, groups FROM rules"))
    rules = result.fetchall()

    for rule_id, groups_json in rules:
        if groups_json is None:
            continue

        groups = json.loads(groups_json)
        updated = False

        # Restore labels that match the new seeded values
        for group in groups:
            if group.get("label") in LABEL_MAP_DOWNGRADE:
                group["label"] = LABEL_MAP_DOWNGRADE[group["label"]]
                updated = True

        # Write back if any labels were changed
        if updated:
            connection.execute(
                sa.text("UPDATE rules SET groups = :groups WHERE id = :id"),
                {"groups": json.dumps(groups), "id": rule_id}
            )
