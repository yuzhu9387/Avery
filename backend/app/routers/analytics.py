from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.rule import RuleOut
from app.services import evaluation as service

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class EvaluateRequest(BaseModel):
    period_start: datetime
    period_end: datetime
    rule_id: int | None = None


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
    return {
        "period_start": body.period_start,
        "period_end": body.period_end,
        "rule": RuleOut.model_validate(rule).model_dump(mode="json"),
        "metrics": result.to_dict(),
    }
