from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.task import Priority, TaskStatus
from app.schemas.event import EventOut


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

    # `due_date` and `est_minutes` are omitted deliberately: both columns are
    # nullable, so explicit null is how a client clears them.
    @field_validator("name", "tag_ids", "notes", "status", "is_floating", "priority")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value


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


class TaskStats(BaseModel):
    task_id: int
    minutes_this_week: int
    minutes_this_month: int
    minutes_all_time: int
    event_count: int
    upcoming: list[EventOut]
    recent: list[EventOut]
