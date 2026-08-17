from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.deps import get_current_user
from app.models import User
from app.schemas.report import ReportOut, ReportRun
from app.services import evaluation as evaluation_service
from app.services import reports as service

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("", response_model=list[ReportOut])
async def list_reports(month: str | None = None, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        return await service.list_reports(session, user.id, month)
    except service.InvalidMonthKey:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "month must be YYYY-MM")


@router.post("/run", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def run_report(body: ReportRun, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        year, month = service.parse_month_key(body.month)
    except service.InvalidMonthKey:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "month must be YYYY-MM")
    try:
        return await service.run_report(session, year, month, user.id)
    except evaluation_service.NoActiveRule:
        raise HTTPException(status.HTTP_409_CONFLICT, "no active rule — create one first")


@router.get("/{report_id}", response_model=ReportOut)
async def get_report(report_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    report = await service.get_report(session, report_id, user.id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "report not found")
    return report


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(report_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    if not await service.delete_report(session, report_id, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "report not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
