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
