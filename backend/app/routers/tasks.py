from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.task import TaskStatus
from app.schemas.task import TaskCreate, TaskOut, TaskUpdate
from app.services import tasks as service

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    status_filter: TaskStatus | None = None,
    is_floating: bool | None = None,
    include_archived: bool = False,
    session: AsyncSession = Depends(get_session),
):
    return await service.list_tasks(
        session,
        status=status_filter,
        is_floating=is_floating,
        include_archived=include_archived,
    )


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(data: TaskCreate, session: AsyncSession = Depends(get_session)):
    return await service.create_task(session, data)


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await service.get_task(session, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    return task


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(task_id: int, data: TaskUpdate, session: AsyncSession = Depends(get_session)):
    task = await service.update_task(session, task_id, data)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    return task


@router.delete("/{task_id}", response_model=TaskOut, status_code=status.HTTP_200_OK)
async def delete_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await service.archive_task(session, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    return task
