from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RoutineBlockCreate(BaseModel):
    days: list[int] = Field(min_length=1)
    start_time: time
    end_time: time
    task_name: str = Field(min_length=1, max_length=200)
    tag_ids: list[int] = Field(default_factory=list)
    sort_order: int = 0

    @field_validator("days")
    @classmethod
    def days_are_iso_weekdays(cls, value: list[int]) -> list[int]:
        if any(d < 1 or d > 7 for d in value):
            raise ValueError("days must be ISO weekdays 1-7")
        return value


class RoutineBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    routine_id: int
    days: list[int]
    start_time: time
    end_time: time
    task_name: str
    tag_ids: list[int]
    sort_order: int


class RoutineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    note: str = ""
    is_active: bool = True
    # Copy the currently active routine's blocks into the new version instead of
    # starting empty. A new version almost always means "like the current one,
    # but with a change", and starting empty is how an active routine ends up
    # with no blocks -- which silently generates empty weeks.
    copy_blocks_from_active: bool = False


class RoutineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    note: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    blocks: list[RoutineBlockOut]


class MaterializeResult(BaseModel):
    week_start: str
    created: int
    skipped_days: list[str]


class RoutineUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    # A note may legitimately be cleared, so "" is allowed where a name is not.
    note: str | None = None
    is_active: bool | None = None

    @field_validator("name", "note", "is_active")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value


class RoutineBlockUpdate(BaseModel):
    """Partial patch. Every field optional; unset fields are left untouched."""

    days: list[int] | None = Field(default=None, min_length=1)
    start_time: time | None = None
    end_time: time | None = None
    task_name: str | None = Field(default=None, min_length=1, max_length=200)
    tag_ids: list[int] | None = None
    sort_order: int | None = None

    @field_validator("days", "start_time", "end_time", "task_name", "tag_ids", "sort_order")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value

    @field_validator("days")
    @classmethod
    def days_are_iso_weekdays(cls, value: list[int]) -> list[int]:
        if any(d < 1 or d > 7 for d in value):
            raise ValueError("days must be ISO weekdays 1-7")
        return value


class PreviewResult(BaseModel):
    week_start: str
    events: list[dict]
