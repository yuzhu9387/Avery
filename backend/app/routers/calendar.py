from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.event import EventOut
from app.services import calendar as service
from app.services.reports import InvalidMonthKey, parse_month_key

week_router = APIRouter(prefix="/api/weeks", tags=["weeks"])
month_router = APIRouter(prefix="/api/months", tags=["months"])


@week_router.get("/{any_day}")
async def get_week(any_day: date, session: AsyncSession = Depends(get_session)) -> dict:
    payload = await service.get_week(session, any_day)
    payload["events"] = [
        EventOut.model_validate(e).model_dump(mode="json") for e in payload["events"]
    ]
    return payload


@month_router.get("/{month_key}")
async def get_month(month_key: str, session: AsyncSession = Depends(get_session)) -> dict:
    try:
        year, month = parse_month_key(month_key)
    except InvalidMonthKey:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "expected YYYY-MM")
    return await service.get_month(session, year, month)
