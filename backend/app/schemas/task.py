from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.task import Priority, TaskStatus


class TaskCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    tag_ids: list[int] = Field(default_factory=list)
    notes: str = ""
    status: TaskStatus = TaskStatus.TODO
    due_date: date | None = None
    est_minutes: int | None = None
    is_floating: bool = False
    priority: Priority = Priority.NORMAL


class TaskUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    tag_ids: list[int] | None = None
    notes: str | None = None
    status: TaskStatus | None = None
    due_date: date | None = None
    est_minutes: int | None = None
    is_floating: bool | None = None
    priority: Priority | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    tag_ids: list[int]
    notes: str
    status: TaskStatus
    due_date: date | None
    est_minutes: int | None
    is_floating: bool
    priority: Priority
    created_at: datetime
    completed_at: datetime | None
