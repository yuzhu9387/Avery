import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.event import EventOut
from app.services import calendar as service

week_router = APIRouter(prefix="/api/weeks", tags=["weeks"])
month_router = APIRouter(prefix="/api/months", tags=["months"])

MONTH_PATTERN = re.compile(r"^(\d{4})-(\d{2})$")


@week_router.get("/{any_day}")
async def get_week(any_day: date, session: AsyncSession = Depends(get_session)) -> dict:
    payload = await service.get_week(session, any_day)
    payload["events"] = [
        EventOut.model_validate(e).model_dump(mode="json") for e in payload["events"]
    ]
    return payload


@month_router.get("/{month_key}")
async def get_month(month_key: str, session: AsyncSession = Depends(get_session)) -> dict:
    match = MONTH_PATTERN.match(month_key)
    if match is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "expected YYYY-MM")
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "month must be 01-12")
    # "0000-01" satisfies the regex but date(0, ...) raises, turning a malformed
    # key into a 500 on an endpoint whose whole contract is to 422 on bad input.
    if not 1 <= year <= 9999:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "year must be 0001-9999")
    return await service.get_month(session, year, month)
