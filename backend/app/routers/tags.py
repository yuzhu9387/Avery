from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.tag import TagCreate, TagOut, TagUpdate
from app.services import tags as service

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagOut])
async def list_tags(include_archived: bool = False, session: AsyncSession = Depends(get_session)):
    return await service.list_tags(session, include_archived)


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
async def create_tag(data: TagCreate, session: AsyncSession = Depends(get_session)):
    try:
        return await service.create_tag(session, data)
    except service.DuplicateTagName as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, f"tag name already exists: {exc}")


@router.get("/{tag_id}", response_model=TagOut)
async def get_tag(tag_id: int, session: AsyncSession = Depends(get_session)):
    tag = await service.get_tag(session, tag_id)
    if tag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tag not found")
    return tag


@router.patch("/{tag_id}", response_model=TagOut)
async def update_tag(tag_id: int, data: TagUpdate, session: AsyncSession = Depends(get_session)):
    try:
        tag = await service.update_tag(session, tag_id, data)
    except service.DuplicateTagName as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, f"tag name already exists: {exc}")
    if tag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tag not found")
    return tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(tag_id: int, session: AsyncSession = Depends(get_session)):
    try:
        deleted = await service.delete_tag(session, tag_id)
    except service.TagInUse as exc:
        # Format a message indicating what is still using the tag
        if exc.event_count:
            message = f"{exc.event_count} event(s) still use this category"
        elif exc.task_count:
            message = "a task still uses this category"
        elif exc.template_block_count:
            message = "a template block still uses this category"
        else:  # rule_count must be > 0
            message = "a rule still uses this category"
        raise HTTPException(status.HTTP_409_CONFLICT, message)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tag not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{tag_id}/archive", response_model=TagOut)
async def archive_tag(tag_id: int, session: AsyncSession = Depends(get_session)):
    tag = await service.archive_tag(session, tag_id)
    if tag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tag not found")
    return tag
