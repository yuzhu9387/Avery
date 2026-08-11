from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.event import EventKind, EventSource


class EventCreate(BaseModel):
    task_id: int | None = None
    task_name: str | None = None
    start_at: datetime
    end_at: datetime
    tag_ids: list[int] = Field(default_factory=list)
    kind: EventKind = EventKind.EVENT
    source: EventSource = EventSource.MANUAL
    template_block_id: int | None = None
    notes: str = ""

    @model_validator(mode="after")
    def check(self) -> "EventCreate":
        if self.task_id is None and not self.task_name:
            raise ValueError("either task_id or task_name is required")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class EventUpdate(BaseModel):
    start_at: datetime | None = None
    end_at: datetime | None = None
    tag_ids: list[int] | None = None
    notes: str | None = None

    # Every Event column here is nullable=False, so none of them may be nulled.
    @field_validator("start_at", "end_at", "tag_ids", "notes")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value

    @model_validator(mode="after")
    def check(self) -> "EventUpdate":
        if self.start_at and self.end_at and self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class EventMove(BaseModel):
    start_at: datetime


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    start_at: datetime
    end_at: datetime
    tag_ids: list[int]
    kind: EventKind
    completed_at: datetime | None
    source: EventSource
    template_block_id: int | None
    notes: str
