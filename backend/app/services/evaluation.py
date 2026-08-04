"""Bridges the database to the pure analytics module."""

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Rule
from app.services import events as event_service
from app.services import rules as rule_service
from app.services.analytics import Evaluation, EventSlice, evaluate


class NoActiveRule(Exception):
    """Raised when an evaluation is requested but no rule has ever been created."""


def to_slice(event: Event) -> EventSlice:
    return EventSlice(
        id=event.id,
        start_at=event.start_at,
        end_at=event.end_at,
        tag_ids=tuple(event.tag_ids),
    )


async def evaluate_period(
    session: AsyncSession,
    period_start: datetime,
    period_end: datetime,
    rule_id: int | None = None,
) -> tuple[Evaluation, Rule]:
    if rule_id is None:
        rule = await rule_service.get_active_rule(session)
    else:
        rule = await rule_service.get_rule(session, rule_id)
    if rule is None:
        raise NoActiveRule()

    rows = await event_service.list_events(session, start=period_start, end=period_end)
    slices = [to_slice(e) for e in rows]
    return evaluate(slices, rule_service.to_spec(rule), period_start, period_end), rule
