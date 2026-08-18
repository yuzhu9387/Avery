"""Reading a connected Google Calendar.

These events are **never** written into the `events` table. They are not Avery
events: they carry no task, no tags and no completion, and persisting them would
make them count toward every ratio and category total the rule engine computes —
silently inflating the very numbers the app exists to keep honest. They are
fetched per request and handed to the frontend as a separate list to draw over
the grid.

Write-back (Avery -> Google) is not implemented. The `calendar.events` scope is
requested so that adding it later needs no second consent screen.
"""

from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CalendarConnection
from app.services import calendar_links

EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


@dataclass(frozen=True)
class ExternalEvent:
    external_id: str
    title: str
    # Naive local `YYYY-MM-DDTHH:MM:SS`, matching every other datetime the API
    # emits. Google speaks RFC3339 with an offset; see `_to_naive_local`.
    start_at: str
    end_at: str
    all_day: bool
    calendar_name: str
    account_email: str | None

    def as_dict(self) -> dict:
        return asdict(self)


def _to_naive_local(value: str) -> datetime:
    """RFC3339 (with offset) -> local wall-clock, tz dropped.

    The whole app stores and compares naive local times; letting an offset-aware
    datetime through here would make every later comparison either raise or, worse,
    silently compare across timezones. `astimezone()` with no argument converts to
    *this machine's* local zone, which is the zone the grid is drawn in.
    """
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def _self_declined(event: dict) -> bool:
    """True when this account has said no.

    A declined invitation still comes back from the API. Drawing it would put
    meetings the user turned down on their week — worse than not showing the
    calendar at all, because it looks authoritative.
    """
    for attendee in event.get("attendees") or []:
        if attendee.get("self") and attendee.get("responseStatus") == "declined":
            return True
    return False


def parse_event(raw: dict, account_email: str | None) -> ExternalEvent | None:
    """One Google event -> our shape, or None when it should not be drawn."""
    if raw.get("status") == "cancelled" or _self_declined(raw):
        return None

    start, end = raw.get("start") or {}, raw.get("end") or {}

    if "date" in start:
        # All-day. Google's end date is exclusive; the grid wants an inclusive span,
        # so a one-day event ends at 23:59:59 rather than midnight on the next day —
        # otherwise it would bleed a pixel into the following column.
        start_dt = datetime.combine(date.fromisoformat(start["date"]), datetime.min.time())
        end_date = date.fromisoformat(end["date"]) if "date" in end else None
        end_dt = (
            datetime.combine(end_date, datetime.min.time()) - timedelta(seconds=1)
            if end_date
            else start_dt + timedelta(hours=23, minutes=59)
        )
        all_day = True
    elif "dateTime" in start:
        start_dt = _to_naive_local(start["dateTime"])
        end_dt = _to_naive_local(end["dateTime"]) if "dateTime" in end else start_dt
        all_day = False
    else:
        return None

    return ExternalEvent(
        external_id=str(raw.get("id") or ""),
        title=raw.get("summary") or "(no title)",
        start_at=start_dt.isoformat(timespec="seconds"),
        end_at=end_dt.isoformat(timespec="seconds"),
        all_day=all_day,
        calendar_name=raw.get("organizer", {}).get("displayName") or "Google Calendar",
        account_email=account_email,
    )


async def _fetch(access_token: str, params: dict) -> dict:
    """Isolated so tests substitute it instead of reaching the network."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            EVENTS_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
    if resp.status_code != 200:
        # Google's body says *which* problem this is — "Google Calendar API has not
        # been used in project ... before or it is disabled" reads very differently
        # from "insufficient authentication scopes", and both arrive as a bare 403.
        # Dropping it turns a two-minute console fix into a guessing game.
        detail = ""
        try:
            body = resp.json()
            detail = body.get("error", {}).get("message") or str(body)[:300]
        except Exception:
            detail = resp.text[:300]
        if resp.status_code == 401:
            # Token rejected — recoverable via a forced refresh, unlike the
            # scope/console problems the other statuses describe.
            raise calendar_links.ProviderUnauthorized(
                f"calendar endpoint answered 401: {detail}"
            )
        raise calendar_links.RefreshFailed(
            f"calendar endpoint answered {resp.status_code}: {detail}"
        )
    return resp.json()


async def list_events(
    session: AsyncSession,
    connection: CalendarConnection,
    start: datetime,
    end: datetime,
) -> list[ExternalEvent]:
    """Events overlapping [start, end), already filtered and converted.

    `singleEvents=true` expands recurring series into individual occurrences —
    without it a weekly standup comes back as one master event with a recurrence
    rule, and the grid would draw it once instead of every week.

    One forced-refresh retry on a 401: the provider's rejection outranks
    whatever `expires_at` believes (see lark_calendar.list_events).
    """
    try:
        token = await calendar_links.ensure_fresh_token(session, connection)
        return await _fetch_window(token, connection, start, end)
    except calendar_links.ProviderUnauthorized:
        token = await calendar_links.ensure_fresh_token(session, connection, force=True)
        return await _fetch_window(token, connection, start, end)


async def _fetch_window(
    access_token: str,
    connection: CalendarConnection,
    start: datetime,
    end: datetime,
) -> list[ExternalEvent]:
    payload = await _fetch(
        access_token,
        {
            # Google wants RFC3339. These are naive local, so `astimezone()` stamps
            # them with this machine's offset — the same wall-clock the user sees.
            "timeMin": start.astimezone().isoformat(),
            "timeMax": end.astimezone().isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": "250",
        },
    )
    out = []
    for raw in payload.get("items") or []:
        parsed = parse_event(raw, connection.external_account_email)
        if parsed is not None:
            out.append(parsed)
    return out


class PushFailed(Exception):
    """Google rejected the write-back; the local edit must not commit."""


async def _push(access_token: str, external_id: str, method: str, body: dict | None) -> None:
    """Isolated for the same reason as `_fetch`: tests substitute it."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.request(
            method,
            f"{EVENTS_URL}/{external_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            json=body,
        )
    # DELETE answers 204/410 (already gone is fine — the goal state is reached).
    if resp.status_code not in (200, 204, 410):
        raise PushFailed(f"google answered {resp.status_code}: {resp.text[:200]}")


def _rfc3339(value: datetime) -> str:
    """Naive local -> RFC3339 with this machine's offset — the reverse of
    `_to_naive_local`, so a round-trip lands on the same wall-clock time."""
    return value.astimezone().isoformat()


async def push_update(
    session: AsyncSession,
    connection: CalendarConnection,
    external_id: str,
    *,
    title: str,
    start_at: datetime,
    end_at: datetime,
) -> None:
    """Write time/title back to Google. Called BEFORE the local commit: if Google
    refuses, the local row stays untouched and the user sees the failure, instead
    of Avery quietly disagreeing with the calendar that owns the event."""
    access_token = await calendar_links.ensure_fresh_token(session, connection)
    await _push(
        access_token,
        external_id,
        "PATCH",
        {
            "summary": title,
            "start": {"dateTime": _rfc3339(start_at)},
            "end": {"dateTime": _rfc3339(end_at)},
        },
    )


async def push_delete(
    session: AsyncSession, connection: CalendarConnection, external_id: str
) -> None:
    access_token = await calendar_links.ensure_fresh_token(session, connection)
    await _push(access_token, external_id, "DELETE", None)
