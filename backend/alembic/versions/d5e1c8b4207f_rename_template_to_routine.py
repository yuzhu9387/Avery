"""rename template to routine

Renames the product concept everywhere it is persisted:

  templates            -> routines
  template_blocks      -> routine_blocks
  .template_id         -> .routine_id
  events.template_block_id -> events.routine_block_id
  events.source 'template' -> 'routine'   (a stored enum value, so a data backfill)

Renames rather than create-copy-drop, so ids and every row survive untouched.
SQLite 3.25+ supports both `RENAME TO` and `RENAME COLUMN`, and rewrites the
child table's foreign-key clause to follow a renamed parent — which is why
`routine_blocks.routine_id` still points at `routines.id` afterwards without
being redefined here.

The index is dropped and recreated rather than left alone: renaming a table
does not rename its indexes, so without this a migrated database would carry
`ix_template_blocks_template_id` while a freshly created one gets
`ix_routine_blocks_routine_id`. That drift is invisible until something
reflects on index names.

Revision ID: d5e1c8b4207f
Revises: 3f7a9cee3801
"""

from alembic import op

revision = "d5e1c8b4207f"
down_revision = "3f7a9cee3801"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_template_blocks_template_id", table_name="template_blocks")

    op.rename_table("templates", "routines")
    op.rename_table("template_blocks", "routine_blocks")
    op.execute("ALTER TABLE routine_blocks RENAME COLUMN template_id TO routine_id")
    op.execute("ALTER TABLE events RENAME COLUMN template_block_id TO routine_block_id")

    # `source` is a StrEnum persisted as text, so the rename is not complete until
    # the existing rows carry the new value. Anything still reading 'template'
    # would silently fall outside every branch that matches on EventSource.
    op.execute("UPDATE events SET source = 'routine' WHERE source = 'template'")

    op.create_index("ix_routine_blocks_routine_id", "routine_blocks", ["routine_id"])


def downgrade() -> None:
    op.drop_index("ix_routine_blocks_routine_id", table_name="routine_blocks")

    op.execute("UPDATE events SET source = 'template' WHERE source = 'routine'")
    op.execute("ALTER TABLE events RENAME COLUMN routine_block_id TO template_block_id")
    op.execute("ALTER TABLE routine_blocks RENAME COLUMN routine_id TO template_id")
    op.rename_table("routine_blocks", "template_blocks")
    op.rename_table("routines", "templates")

    op.create_index("ix_template_blocks_template_id", "template_blocks", ["template_id"])
