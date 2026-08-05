"""Bridges the database to the pure analytics module."""

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Rule
from app.services import events as event_service
from app.services import rules as rule_service
from app.services.analytics import Evaluation, EventSlice, evaluate


class NoActiveRule(Exception):
    """Raised when an evaluation is requested but no rule has ever been created."""


class RuleNotFound(Exception):
    """Raised when an explicit rule_id names a rule that does not exist.

    Distinct from NoActiveRule on purpose: telling a client with a typo'd rule_id
    to "create a rule first" sends them chasing a problem they do not have.
    """


class InvalidPeriod(Exception):
    """Raised when period_end is not strictly after period_start."""


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
    if period_end <= period_start:
        raise InvalidPeriod()
    if rule_id is None:
        rule = await rule_service.get_active_rule(session)
        if rule is None:
            raise NoActiveRule()
    else:
        rule = await rule_service.get_rule(session, rule_id)
        if rule is None:
            raise RuleNotFound(rule_id)

    rows = await event_service.list_events(session, start=period_start, end=period_end)
    slices = [to_slice(e) for e in rows]
    return evaluate(slices, rule_service.to_spec(rule), period_start, period_end), rule
