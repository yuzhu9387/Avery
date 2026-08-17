from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.deps import get_current_user
from app.models import User
from app.models.task import TaskStatus
from app.schemas.task import TaskCreate, TaskOut, TaskStats, TaskUpdate
from app.services import tags as tag_service
from app.services import tasks as service

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    status_filter: TaskStatus | None = None,
    is_floating: bool | None = None,
    floating_only: bool = False,
    include_archived: bool = False,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return await service.list_tasks(
        session,
        user.id,
        status=status_filter,
        is_floating=is_floating,
        floating_only=floating_only,
        include_archived=include_archived,
    )


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(data: TaskCreate, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        return await service.create_task(session, data, user.id)
    except tag_service.UnknownTagIds as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}"
        )


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    task = await service.get_task(session, task_id, user.id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    return task


@router.get("/{task_id}/stats", response_model=TaskStats)
async def task_stats(
    task_id: int, today: date | None = None, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)
):
    stats = await service.task_stats(session, task_id, user.id, today)
    if stats is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    return stats


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(task_id: int, data: TaskUpdate, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        task = await service.update_task(session, task_id, data, user.id)
        if task is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
        return task
    except tag_service.UnknownTagIds as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}"
        )


@router.delete("/{task_id}", response_model=TaskOut, status_code=status.HTTP_200_OK)
async def delete_task(task_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    task = await service.archive_task(session, task_id, user.id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    return task
