from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.template import (
    MaterializeResult,
    TemplateBlockCreate,
    TemplateBlockOut,
    TemplateCreate,
    TemplateOut,
)
from app.services import tags as tag_service
from app.services import templates as service

router = APIRouter(prefix="/api/templates", tags=["templates"])
block_router = APIRouter(prefix="/api/template-blocks", tags=["templates"])
week_router = APIRouter(prefix="/api/weeks", tags=["weeks"])


@router.get("", response_model=list[TemplateOut])
async def list_templates(session: AsyncSession = Depends(get_session)):
    return await service.list_templates(session)


@router.post("", response_model=TemplateOut, status_code=status.HTTP_201_CREATED)
async def create_template(data: TemplateCreate, session: AsyncSession = Depends(get_session)):
    return await service.create_template(session, data)


@router.get("/active", response_model=TemplateOut)
async def get_active_template(session: AsyncSession = Depends(get_session)):
    template = await service.get_active_template(session)
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no active template")
    return template


@router.get("/{template_id}", response_model=TemplateOut)
async def get_template(template_id: int, session: AsyncSession = Depends(get_session)):
    template = await service.get_template(session, template_id)
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "template not found")
    return template


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: int, session: AsyncSession = Depends(get_session)):
    if not await service.delete_template(session, template_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "template not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{template_id}/blocks", response_model=TemplateBlockOut, status_code=status.HTTP_201_CREATED
)
async def create_block(
    template_id: int, data: TemplateBlockCreate, session: AsyncSession = Depends(get_session)
):
    try:
        block = await service.create_block(session, template_id, data)
        if block is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "template not found")
        return block
    except tag_service.UnknownTagIds as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}"
        )


@block_router.patch("/{block_id}", response_model=TemplateBlockOut)
async def update_block(
    block_id: int, data: TemplateBlockCreate, session: AsyncSession = Depends(get_session)
):
    try:
        block = await service.update_block(session, block_id, data)
        if block is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "block not found")
        return block
    except tag_service.UnknownTagIds as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}"
        )


@block_router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_block(block_id: int, session: AsyncSession = Depends(get_session)):
    if not await service.delete_block(session, block_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "block not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@week_router.post("/{any_day}/materialize", response_model=MaterializeResult)
async def materialize_week(any_day: date, session: AsyncSession = Depends(get_session)):
    try:
        monday, created, skipped = await service.materialize_week(session, any_day)
    except service.NoActiveTemplate:
        raise HTTPException(status.HTTP_409_CONFLICT, "no active template — create one first")
    return MaterializeResult(
        week_start=monday.isoformat(),
        created=len(created),
        skipped_days=[d.isoformat() for d in skipped],
    )
