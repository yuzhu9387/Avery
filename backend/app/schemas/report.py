from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class ReportRun(BaseModel):
    month: str = Field(pattern=r"^\d{4}-\d{2}$")


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    period_start: date
    period_end: date
    rule_id: int
    metrics: dict
    narrative: str
    created_at: datetime
