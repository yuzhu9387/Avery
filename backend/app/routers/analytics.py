from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.rule import RuleOut
from app.services import evaluation as service

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class EvaluateRequest(BaseModel):
    period_start: datetime
    period_end: datetime
    rule_id: int | None = None

    @model_validator(mode="after")
    def check_period(self) -> "EvaluateRequest":
        # Without this, a reversed range returns 200 with every group "under" —
        # a payload indistinguishable from a month in which nothing was logged.
        if self.period_end <= self.period_start:
            raise ValueError("period_end must be after period_start")
        return self


@router.post("/evaluate")
async def evaluate_period(
    body: EvaluateRequest, session: AsyncSession = Depends(get_session)
) -> dict:
    try:
        result, rule = await service.evaluate_period(
            session, body.period_start, body.period_end, body.rule_id
        )
    except service.NoActiveRule:
        raise HTTPException(status.HTTP_409_CONFLICT, "no active rule — create one first")
    except service.RuleNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"rule {body.rule_id} not found")
    return {
        "period_start": body.period_start,
        "period_end": body.period_end,
        "rule": RuleOut.model_validate(rule).model_dump(mode="json"),
        "metrics": result.to_dict(),
    }
