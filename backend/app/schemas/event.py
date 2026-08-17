from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.event import EventKind, EventSource


class EventCreate(BaseModel):
    task_id: int | None = None
    task_name: str | None = None
    title: str | None = None
    start_at: datetime
    end_at: datetime
    tag_ids: list[int] = Field(default_factory=list)
    kind: EventKind = EventKind.EVENT
    source: EventSource = EventSource.MANUAL
    routine_block_id: int | None = None
    notes: str = ""

    @model_validator(mode="after")
    def check(self) -> "EventCreate":
        # An event needs SOME name. A bare title is the normal case now that events
        # carry their own; task_id/task_name still work for scheduling a to-do.
        if self.task_id is None and not self.task_name and not (self.title or "").strip():
            raise ValueError("one of title, task_id or task_name is required")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class EventUpdate(BaseModel):
    title: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    tag_ids: list[int] | None = None
    notes: str | None = None

    # Every Event column here is nullable=False, so none of them may be nulled.
    @field_validator("title", "start_at", "end_at", "tag_ids", "notes")
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
    task_id: int | None
    title: str
    start_at: datetime
    end_at: datetime
    tag_ids: list[int]
    kind: EventKind
    completed_at: datetime | None
    source: EventSource
    routine_block_id: int | None
    # The provider's id for a mirrored external event; the frontend uses source +
    # external_id to know a card is a mirror (colored, edits push back).
    external_id: str | None
    all_day: bool
    notes: str


class EventRollOver(BaseModel):
    event_ids: list[int] = Field(min_length=1)
    to_date: date
