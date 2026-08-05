from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.reminder import Channel


class ReminderCreate(BaseModel):
    task_id: int
    remind_at: datetime
    channel: Channel = Channel.INAPP


class ReminderUpdate(BaseModel):
    remind_at: datetime | None = None
    channel: Channel | None = None
    dismissed_at: datetime | None = None

    # `dismissed_at` is omitted deliberately: that column is nullable, and setting
    # it back to null is how a client un-dismisses a reminder.
    @field_validator("remind_at", "channel")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    remind_at: datetime
    channel: Channel
    sent_at: datetime | None
    dismissed_at: datetime | None
