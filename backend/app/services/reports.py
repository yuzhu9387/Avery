import calendar as calendar_lib
import re
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Report
from app.services import evaluation as evaluation_service

NARRATIVE_PLACEHOLDER = "Narrative generation arrives with the agent layer."

MONTH_KEY = re.compile(r"^(\d{4})-(\d{2})$")


class InvalidMonthKey(Exception):
    """Raised when a month key is not a well-formed, in-range YYYY-MM."""


def parse_month_key(value: str) -> tuple[int, int]:
    """The single place that turns "YYYY-MM" into (year, month).

    The run route and the list filter each used to slice this string themselves with
    different validation, which is how `?month=garbage` reached `int()` and returned
    a 500 from an endpoint that should answer 422.
    """
    match = MONTH_KEY.match(value)
    if match is None:
        raise InvalidMonthKey(value)
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12 or not 1 <= year <= 9999:
        raise InvalidMonthKey(value)
    return year, month


def month_bounds(year: int, month: int) -> tuple[date, date, datetime, datetime]:
    """Inclusive display bounds plus the half-open datetime window used for querying."""
    first = date(year, month, 1)
    last = date(year, month, calendar_lib.monthrange(year, month)[1])
    start_dt = datetime.combine(first, datetime.min.time())
    end_dt = datetime.combine(last + timedelta(days=1), datetime.min.time())
    return first, last, start_dt, end_dt


async def run_report(session: AsyncSession, year: int, month: int, user_id: int) -> Report:
    """Always inserts. The active rule at this moment is frozen onto the row."""
    first, last, start_dt, end_dt = month_bounds(year, month)
    result, rule = await evaluation_service.evaluate_period(session, start_dt, end_dt, user_id)

    report = Report(
        user_id=user_id,
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


async def list_reports(
    session: AsyncSession, user_id: int, month_key: str | None = None
) -> list[Report]:
    stmt = (
        select(Report)
        .where(Report.user_id == user_id)
        .order_by(Report.created_at.desc(), Report.id.desc())
    )
    if month_key is not None:
        year, month = parse_month_key(month_key)
        first, _, _, _ = month_bounds(year, month)
        stmt = stmt.where(Report.period_start == first)
    return list((await session.scalars(stmt)).all())


async def get_report(session: AsyncSession, report_id: int, user_id: int) -> Report | None:
    stmt = select(Report).where(Report.id == report_id, Report.user_id == user_id)
    return (await session.scalars(stmt)).first()


async def delete_report(session: AsyncSession, report_id: int, user_id: int) -> bool:
    report = await get_report(session, report_id, user_id)
    if report is None:
        return False
    await session.delete(report)
    await session.commit()
    return True
