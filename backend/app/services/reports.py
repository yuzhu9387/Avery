import calendar as calendar_lib
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Report
from app.services import evaluation as evaluation_service

NARRATIVE_PLACEHOLDER = "Narrative generation arrives with the agent layer."


def month_bounds(year: int, month: int) -> tuple[date, date, datetime, datetime]:
    """Inclusive display bounds plus the half-open datetime window used for querying."""
    first = date(year, month, 1)
    last = date(year, month, calendar_lib.monthrange(year, month)[1])
    start_dt = datetime.combine(first, datetime.min.time())
    end_dt = datetime.combine(last + timedelta(days=1), datetime.min.time())
    return first, last, start_dt, end_dt


async def run_report(session: AsyncSession, year: int, month: int) -> Report:
    """Always inserts. The active rule at this moment is frozen onto the row."""
    first, last, start_dt, end_dt = month_bounds(year, month)
    result, rule = await evaluation_service.evaluate_period(session, start_dt, end_dt)

    report = Report(
        period_start=first,
        period_end=last,
        rule_id=rule.id,
        metrics=result.to_dict(),
        narrative=NARRATIVE_PLACEHOLDER,
    )
    session.add(report)
    await session.commit()
    await session.refresh(report)
    return report


async def list_reports(session: AsyncSession, month_key: str | None = None) -> list[Report]:
    stmt = select(Report).order_by(Report.created_at.desc(), Report.id.desc())
    if month_key is not None:
        year, month = int(month_key[:4]), int(month_key[5:7])
        first, _, _, _ = month_bounds(year, month)
        stmt = stmt.where(Report.period_start == first)
    return list((await session.scalars(stmt)).all())


async def get_report(session: AsyncSession, report_id: int) -> Report | None:
    return await session.get(Report, report_id)


async def delete_report(session: AsyncSession, report_id: int) -> bool:
    report = await session.get(Report, report_id)
    if report is None:
        return False
    await session.delete(report)
    await session.commit()
    return True
