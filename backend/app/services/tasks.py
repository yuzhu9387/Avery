from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task
from app.models.task import TaskStatus
from app.schemas.task import TaskCreate, TaskUpdate


async def list_tasks(
    session: AsyncSession,
    *,
    status: TaskStatus | None = None,
    is_floating: bool | None = None,
    include_archived: bool = False,
) -> list[Task]:
    stmt = select(Task).order_by(Task.created_at.desc(), Task.id.desc())
    if status is not None:
        stmt = stmt.where(Task.status == status)
    if is_floating is not None:
        stmt = stmt.where(Task.is_floating.is_(is_floating))
    if not include_archived and status != TaskStatus.ARCHIVED:
        stmt = stmt.where(Task.status != TaskStatus.ARCHIVED)
    return list((await session.scalars(stmt)).all())


async def get_task(session: AsyncSession, task_id: int) -> Task | None:
    return await session.get(Task, task_id)


async def create_task(session: AsyncSession, data: TaskCreate) -> Task:
    payload = data.model_dump()
    task = Task(**payload)
    if task.status == TaskStatus.DONE:
        task.completed_at = datetime.now()
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def update_task(session: AsyncSession, task_id: int, data: TaskUpdate) -> Task | None:
    task = await session.get(Task, task_id)
    if task is None:
        return None
    fields = data.model_dump(exclude_unset=True)
    for key, value in fields.items():
        setattr(task, key, value)
    if "status" in fields:
        task.completed_at = datetime.now() if fields["status"] == TaskStatus.DONE else None
    await session.commit()
    await session.refresh(task)
    return task


async def archive_task(session: AsyncSession, task_id: int) -> Task | None:
    """Tasks are never hard-deleted. Events freeze onto a task and carry the minutes
    every ratio is computed from, so removing the row would silently rewrite history —
    the same reason tags archive rather than delete. Idempotent.
    """
    task = await session.get(Task, task_id)
    if task is None:
        return None
    task.status = TaskStatus.ARCHIVED
    await session.commit()
    await session.refresh(task)
    return task


async def find_or_create_by_name(
    session: AsyncSession, name: str, tag_ids: list[int]
) -> Task:
    """Used by event creation and template materialization to keep one Task per name."""
    stmt = select(Task).where(Task.name == name).order_by(Task.id)
    existing = (await session.scalars(stmt)).first()
    if existing is not None:
        return existing
    task = Task(name=name, tag_ids=list(tag_ids))
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task
