import calendar as calendar_lib
from datetime import date, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event
from app.services import events as event_service
from app.services import templates as template_service
from app.services.analytics import EventSlice, split_minutes_by_day


def _is_materializable(monday: date) -> bool:
    """Only the current and next week may be created on read. History is a record."""
    today = date.today()
    this_monday = today - timedelta(days=today.isoweekday() - 1)
    return monday in (this_monday, this_monday + timedelta(days=7))


async def get_week(
    session: AsyncSession, any_day: date, allow_materialize: bool = True
) -> dict:
    monday, next_monday = template_service.week_bounds(any_day)
    start = datetime.combine(monday, datetime.min.time())
    end = datetime.combine(next_monday, datetime.min.time())

    rows = await event_service.list_events(session, start=start, end=end)
    materialized = False

    if not rows and allow_materialize and _is_materializable(monday):
        try:
            _, created, _ = await template_service.materialize_week(session, monday)
        except template_service.NoActiveTemplate:
            pass
        else:
            # `materialized` must mean "events were created", not merely "no exception
            # was raised". A template with no blocks matching this week legitimately
            # creates nothing, and reporting true there tells the UI a lie.
            materialized = bool(created)
            if created:
                rows = await event_service.list_events(session, start=start, end=end)

    return {
        "week_start": monday.isoformat(),
        "week_end": next_monday.isoformat(),
        "materialized": materialized,
        "events": rows,
    }


async def get_month(session: AsyncSession, year: int, month: int) -> dict:
    first = date(year, month, 1)
    days_in_month = calendar_lib.monthrange(year, month)[1]
    last_exclusive = first + timedelta(days=days_in_month)

    rows: list[Event] = await event_service.list_events(
        session,
        start=datetime.combine(first, datetime.min.time()),
        end=datetime.combine(last_exclusive, datetime.min.time()),
    )

    per_day: dict[date, dict[int, int]] = {}
    counts: dict[date, int] = {}
    totals: dict[date, int] = {}
    for row in rows:
        slice_ = EventSlice(
            id=row.id, start_at=row.start_at, end_at=row.end_at, tag_ids=tuple(row.tag_ids)
        )
        tag_id = slice_.primary_tag_id
        for day, minutes in split_minutes_by_day(slice_).items():
            if not (first <= day < last_exclusive):
                continue
            counts[day] = counts.get(day, 0) + 1
            # Accumulate the day's total independently of the per-tag buckets.
            # Deriving it from those buckets drops every untagged event's minutes,
            # producing day cells that read "1 event, 0 minutes".
            totals[day] = totals.get(day, 0) + minutes
            if tag_id is None:
                continue
            bucket = per_day.setdefault(day, {})
            bucket[tag_id] = bucket.get(tag_id, 0) + minutes

    days = []
    for offset in range(days_in_month):
        day = first + timedelta(days=offset)
        minutes_by_tag = per_day.get(day, {})
        days.append(
            {
                "date": day.isoformat(),
                "event_count": counts.get(day, 0),
                "total_minutes": totals.get(day, 0),
                "minutes_by_tag": {str(k): v for k, v in sorted(minutes_by_tag.items())},
            }
        )

    return {"year": year, "month": month, "days": days}
