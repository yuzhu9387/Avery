from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Tag
from app.schemas.tag import TagCreate, TagUpdate


class DuplicateTagName(Exception):
    """Raised when a tag name collides with an existing one."""


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
    tag = await session.get(Tag, tag_id)
    if tag is None:
        return False
    await session.delete(tag)
    await session.commit()
    return True
