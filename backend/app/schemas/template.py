from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TemplateBlockCreate(BaseModel):
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


class TemplateBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    template_id: int
    days: list[int]
    start_time: time
    end_time: time
    task_name: str
    tag_ids: list[int]
    sort_order: int


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = True


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_active: bool
    created_at: datetime
    blocks: list[TemplateBlockOut]


class MaterializeResult(BaseModel):
    week_start: str
    created: int
    skipped_days: list[str]


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None

    @field_validator("name", "is_active")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value


class TemplateBlockUpdate(BaseModel):
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
