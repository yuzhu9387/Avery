from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class RuleGroup(BaseModel):
    key: str = Field(min_length=1, max_length=16)
    label: str = Field(min_length=1, max_length=120)
    ratio: float = Field(gt=0)
    tag_ids: list[int] = Field(default_factory=list)


class RuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    groups: list[RuleGroup] = Field(min_length=1)
    tolerance: float = Field(default=0.2, ge=0, le=1)
    exclude_tag_ids: list[int] = Field(default_factory=list)
    note: str = ""


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    groups: list[RuleGroup]
    tolerance: float
    exclude_tag_ids: list[int]
    effective_from: date
    effective_to: date | None
    note: str
    created_at: datetime
