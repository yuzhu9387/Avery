"""Mirroring an external calendar into the `events` table.

The mirror is what makes external events first-class: they take Avery categories
(plain `tag_ids`), join the overlap layout, appear on both calendar views, and
count in the ratios once categorised. The provider stays the owner of times and
title — sync overwrites those on every run — but `tag_ids`, `completed_at` and
`notes` belong to Avery and are preserved across syncs.

Deliberate consequence, worth stating plainly: mirrored time now participates in
`/api/analytics/evaluate`. Untagged mirrors land in the untagged bucket (visible
as a gap); tagged ones count toward their group exactly like native events. This
replaces the earlier "external events are never counted" rule — that rule made
sense while they were an uneditable overlay, and stopped making sense the moment
they could be categorised.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event
from app.models.event import EventKind, EventSource
from app.services import calendar_links, google_calendar, lark_calendar


class UnsupportedProvider(Exception):
    pass


async def _fetch_google(session, connection, start, end):
    return await google_calendar.list_events(session, connection, start, end)


async def _fetch_lark(session, connection, start, end):
    return await lark_calendar.list_events(session, connection, start, end)


# provider -> coroutine returning list[google_calendar.ExternalEvent].
FETCHERS = {"google": _fetch_google, "lark": _fetch_lark}


async def sync_window(
    session: AsyncSession,
    user_id: int,
    provider: str,
    start: datetime,
    end: datetime,
) -> dict:
    """Refresh the mirrors for [start, end). Returns counts for the caller.

    Prune rule: a mirror whose start lies in the window but whose external_id was
    not returned this run is gone from the provider (deleted, or moved away) and is
    deleted here. Events that merely moved re-appear when their new window syncs.
    """
    fetch = FETCHERS.get(provider)
    if fetch is None:
        raise UnsupportedProvider(provider)

    connection = await calendar_links.get_connection(session, user_id, provider)
    if connection is None:
        raise calendar_links.NoConnection(provider)

    fetched = await fetch(session, connection, start, end)

    existing_stmt = select(Event).where(
        Event.user_id == user_id,
        Event.source == provider,
        Event.start_at >= start,
        Event.start_at < end,
    )
    existing = {e.external_id: e for e in (await session.scalars(existing_stmt)).all()}
    # A mirror can drift out of the window on the provider side while its local row
    # still sits inside it; fetching by id set, not just window rows, would miss the
    # overlap cases — so also index every mirror by external_id regardless of window.
    all_stmt = select(Event).where(
        Event.user_id == user_id,
        Event.source == provider,
        Event.external_id.in_([f.external_id for f in fetched] or [""]),
    )
    for row in (await session.scalars(all_stmt)).all():
        existing.setdefault(row.external_id, row)

    created = updated = 0
    seen: set[str] = set()
    for item in fetched:
        seen.add(item.external_id)
        row = existing.get(item.external_id)
        if row is None:
            session.add(
                Event(
                    user_id=user_id,
                    task_id=None,
                    title=item.title,
                    start_at=datetime.fromisoformat(item.start_at),
                    end_at=datetime.fromisoformat(item.end_at),
                    tag_ids=[],
                    source=provider,
                    kind=EventKind.EVENT,
                    external_id=item.external_id,
                    all_day=item.all_day,
                    notes="",
                )
            )
            created += 1
        else:
            # Provider owns time and title; Avery owns tags/completion/notes.
            row.title = item.title
            row.start_at = datetime.fromisoformat(item.start_at)
            row.end_at = datetime.fromisoformat(item.end_at)
            row.all_day = item.all_day
            updated += 1

    pruned = 0
    for external_id, row in existing.items():
        if external_id not in seen and start <= row.start_at < end:
            await session.delete(row)
            pruned += 1

    await session.commit()
    return {"created": created, "updated": updated, "pruned": pruned}


def is_external(event: Event) -> bool:
    return event.source in (EventSource.GOOGLE, EventSource.LARK)
