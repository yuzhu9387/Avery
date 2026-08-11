from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Rule, Tag, Task, TemplateBlock
from app.schemas.tag import TagCreate, TagUpdate


class DuplicateTagName(Exception):
    """Raised when a tag name collides with an existing one."""


class UnknownTagIds(Exception):
    """Raised when a tag id does not correspond to any tag row."""

    def __init__(self, ids: list[int]) -> None:
        super().__init__(", ".join(str(i) for i in ids))
        self.ids = ids


class TagInUse(Exception):
    """Raised when a delete is refused because something still uses the tag."""

    def __init__(
        self,
        event_count: int = 0,
        task_count: int = 0,
        template_block_count: int = 0,
        rule_count: int = 0,
    ) -> None:
        self.event_count = event_count
        self.task_count = task_count
        self.template_block_count = template_block_count
        self.rule_count = rule_count
        super().__init__("tag is in use")


async def assert_tags_exist(session: AsyncSession, tag_ids: Sequence[int]) -> None:
    """Archived tags count as existing — they are still real rows events point at."""
    wanted = {int(t) for t in tag_ids}
    if not wanted:
        return
    found = set(
        (await session.scalars(select(Tag.id).where(Tag.id.in_(wanted)))).all()
    )
    missing = sorted(wanted - found)
    if missing:
        raise UnknownTagIds(missing)


async def list_tags(session: AsyncSession, include_archived: bool = False) -> list[Tag]:
    stmt = select(Tag).order_by(Tag.sort_order, Tag.id)
    if not include_archived:
        stmt = stmt.where(Tag.archived.is_(False))
    return list((await session.scalars(stmt)).all())


async def get_tag(session: AsyncSession, tag_id: int) -> Tag | None:
    return await session.get(Tag, tag_id)


async def _name_taken(session: AsyncSession, name: str, exclude_id: int | None) -> bool:
    stmt = select(Tag.id).where(Tag.name == name)
    if exclude_id is not None:
        stmt = stmt.where(Tag.id != exclude_id)
    return (await session.scalars(stmt)).first() is not None


async def create_tag(session: AsyncSession, data: TagCreate) -> Tag:
    if await _name_taken(session, data.name, None):
        raise DuplicateTagName(data.name)
    tag = Tag(**data.model_dump())
    session.add(tag)
    await session.commit()
    await session.refresh(tag)
    return tag


async def update_tag(session: AsyncSession, tag_id: int, data: TagUpdate) -> Tag | None:
    tag = await session.get(Tag, tag_id)
    if tag is None:
        return None
    fields = data.model_dump(exclude_unset=True)
    if "name" in fields and await _name_taken(session, fields["name"], tag_id):
        raise DuplicateTagName(fields["name"])
    for key, value in fields.items():
        setattr(tag, key, value)
    await session.commit()
    await session.refresh(tag)
    return tag


async def delete_tag(session: AsyncSession, tag_id: int) -> bool:
    """Really deletes — but only when nothing points at it.

    Tag ids are stored in JSON columns across four models, so a delete cannot cascade.
    Stripping the id from historical data would silently rewrite every ratio and every
    stored Review report, which is why an in-use tag is refused rather than cleaned up.
    """
    tag = await session.get(Tag, tag_id)
    if tag is None:
        return False

    # Count events using this tag
    event_rows = (await session.scalars(select(Event.tag_ids))).all()
    event_count = sum(1 for tag_ids in event_rows if tag_id in (tag_ids or []))

    # Count tasks using this tag
    task_rows = (await session.scalars(select(Task.tag_ids))).all()
    task_count = sum(1 for tag_ids in task_rows if tag_id in (tag_ids or []))

    # Count template blocks using this tag
    template_rows = (await session.scalars(select(TemplateBlock.tag_ids))).all()
    template_block_count = sum(1 for tag_ids in template_rows if tag_id in (tag_ids or []))

    # Count rules using this tag (in exclude_tag_ids or groups[*].tag_ids)
    rule_rows = (await session.scalars(select(Rule))).all()
    rule_count = 0
    for rule in rule_rows:
        if tag_id in (rule.exclude_tag_ids or []):
            rule_count += 1
        elif rule.groups:
            for group in rule.groups:
                if tag_id in group.get("tag_ids", []):
                    rule_count += 1
                    break  # Count once per rule even if multiple groups use it

    # If anything uses this tag, refuse deletion
    if event_count or task_count or template_block_count or rule_count:
        raise TagInUse(
            event_count=event_count,
            task_count=task_count,
            template_block_count=template_block_count,
            rule_count=rule_count,
        )

    await session.delete(tag)
    await session.commit()
    return True


async def archive_tag(session: AsyncSession, tag_id: int) -> Tag | None:
    """Tags are never hard-deleted — events freeze tag ids onto themselves, so
    dropping the row would leave dangling ids in historical analytics. Archiving
    hides the tag from pickers while keeping every past reference resolvable.

    Idempotent: archiving an already-archived tag succeeds and changes nothing.
    """
    tag = await session.get(Tag, tag_id)
    if tag is None:
        return None
    tag.archived = True
    await session.commit()
    await session.refresh(tag)
    return tag
