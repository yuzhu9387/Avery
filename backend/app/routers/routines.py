from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.deps import get_current_user
from app.models import User
from app.schemas.routine import (
    MaterializeResult,
    PreviewResult,
    RoutineBlockCreate,
    RoutineBlockOut,
    RoutineBlockUpdate,
    RoutineCreate,
    RoutineOut,
    RoutineUpdate,
)
from app.services import tags as tag_service
from app.services import routines as service

router = APIRouter(prefix="/api/routines", tags=["routines"])
block_router = APIRouter(prefix="/api/routine-blocks", tags=["routines"])
week_router = APIRouter(prefix="/api/weeks", tags=["weeks"])


@router.get("", response_model=list[RoutineOut])
async def list_routines(session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    return await service.list_routines(session, user.id)


@router.post("", response_model=RoutineOut, status_code=status.HTTP_201_CREATED)
async def create_routine(data: RoutineCreate, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    return await service.create_routine(session, data, user.id)


@router.get("/active", response_model=RoutineOut)
async def get_active_routine(session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    routine = await service.get_active_routine(session, user.id)
    if routine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no active routine")
    return routine


@router.get("/{routine_ref}/preview/{any_day}", response_model=PreviewResult)
async def preview_week(
    routine_ref: str, any_day: date, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)
):
    if routine_ref == "active":
        routine = await service.get_active_routine(session, user.id)
    elif routine_ref.isdigit():
        routine = await service.get_routine(session, int(routine_ref), user.id)
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "expected an id or 'active'")
    if routine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "routine not found")

    result = await service.preview_week(session, any_day, user.id, routine)
    monday, rows = result
    return PreviewResult(week_start=monday.isoformat(), events=rows)


@router.get("/{routine_id}", response_model=RoutineOut)
async def get_routine(routine_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    routine = await service.get_routine(session, routine_id, user.id)
    if routine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "routine not found")
    return routine


@router.patch("/{routine_id}", response_model=RoutineOut)
async def update_routine(
    routine_id: int, data: RoutineUpdate, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)
):
    routine = await service.update_routine(session, routine_id, data, user.id)
    if routine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "routine not found")
    return routine


@router.delete("/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_routine(routine_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        deleted = await service.delete_routine(session, routine_id, user.id)
    except service.ActiveRoutineError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "this is the active version — activate another one first",
        )
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "routine not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{routine_id}/blocks", response_model=RoutineBlockOut, status_code=status.HTTP_201_CREATED
)
async def create_block(
    routine_id: int, data: RoutineBlockCreate, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)
):
    try:
        block = await service.create_block(session, routine_id, data, user.id)
        if block is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "routine not found")
        return block
    except tag_service.UnknownTagIds as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}"
        )


@block_router.patch("/{block_id}", response_model=RoutineBlockOut)
async def update_block(
    block_id: int, data: RoutineBlockUpdate, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)
):
    try:
        block = await service.update_block(session, block_id, data, user.id)
        if block is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "block not found")
        return block
    except tag_service.UnknownTagIds as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}"
        )


@block_router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_block(block_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    if not await service.delete_block(session, block_id, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "block not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@week_router.post("/{any_day}/materialize", response_model=MaterializeResult)
async def materialize_week(any_day: date, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        monday, created, skipped = await service.materialize_week(session, any_day, user.id)
    except service.NoActiveRoutine:
        raise HTTPException(status.HTTP_409_CONFLICT, "no active routine — create one first")
    return MaterializeResult(
        week_start=monday.isoformat(),
        created=len(created),
        skipped_days=[d.isoformat() for d in skipped],
    )
