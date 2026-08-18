"""Reading a connected Lark calendar.

Shape differences from Google worth naming, because each one silently corrupts
data if ignored:

- Times arrive as **Unix-second strings** in `start_time.timestamp`, not RFC3339.
  All-day items use `start_time.date` ("2026-08-14") instead.
- The events list wraps its payload in `{"code": 0, "data": {...}}` and signals
  errors in `code`, sometimes alongside HTTP 200.
- Pagination is `page_token`-based; a busy calendar does not fit one page.
- The primary calendar has to be looked up first — events hang off a calendar id.

Recurring events: the list endpoint may return series masters rather than
expanded instances. This first version mirrors whatever the list returns; if a
weekly series shows up once instead of weekly, the follow-up is Lark's instance
expansion API — verified against real data, not guessed (see the module owner
note in AGENTS/docs).

Write-back for Lark is NOT implemented. Mirrors from Lark refuse edits with a
clear message (see services.events) rather than PATCHing a guessed body shape at
the user's real calendar.
"""

from datetime import date, datetime, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CalendarConnection
from app.services import calendar_links
from app.services.google_calendar import ExternalEvent

BASE = "https://open.larksuite.com/open-apis/calendar/v4"


async def _get(access_token: str, url: str, params: dict) -> dict:
    """One authed GET, with Lark's error-in-body convention handled."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            url, headers={"Authorization": f"Bearer {access_token}"}, params=params
        )
    if resp.status_code == 401:
        # The token itself was rejected — recoverable by a forced refresh, so
        # signal it distinctly instead of the generic dead-end RefreshFailed.
        raise calendar_links.ProviderUnauthorized(
            f"lark calendar answered 401: {resp.text[:200]}"
        )
    if resp.status_code != 200:
        raise calendar_links.RefreshFailed(
            f"lark calendar answered {resp.status_code}: {resp.text[:200]}"
        )
    payload = resp.json()
    if payload.get("code") == 99991677:  # "Authentication token expired"
        raise calendar_links.ProviderUnauthorized(
            f"lark calendar error 99991677: {payload.get('msg', '')[:200]}"
        )
    if payload.get("code") not in (0, None):
        raise calendar_links.RefreshFailed(
            f"lark calendar error {payload.get('code')}: {payload.get('msg', '')[:200]}"
        )
    return payload.get("data") or {}


async def _primary_calendar_id(access_token: str) -> str:
    data = await _get(access_token, f"{BASE}/calendars", {"page_size": 50})
    calendars = data.get("calendar_list") or data.get("items") or []
    for cal in calendars:
        if cal.get("type") == "primary":
            return cal["calendar_id"]
    if calendars:
        # No explicit primary (org-configured accounts sometimes hide the flag):
        # fall back to the first calendar rather than failing the whole sync.
        return calendars[0]["calendar_id"]
    raise calendar_links.RefreshFailed("lark returned no calendars for this account")


def _to_naive_local(ts: str) -> datetime:
    """Unix seconds (Lark sends them as strings) -> local wall-clock, tz dropped."""
    return datetime.fromtimestamp(int(ts)).astimezone().replace(tzinfo=None)


def parse_event(raw: dict) -> ExternalEvent | None:
    """One Lark event -> the shared ExternalEvent shape, or None to skip."""
    if raw.get("status") == "cancelled":
        return None
    start, end = raw.get("start_time") or {}, raw.get("end_time") or {}

    if start.get("date"):
        start_dt = datetime.combine(date.fromisoformat(start["date"]), datetime.min.time())
        end_date = end.get("date")
        # Same exclusive-end convention as Google's all-day events: pull the end
        # back inside the last day so a one-day marker doesn't bleed a sliver
        # into the next column.
        end_dt = (
            datetime.combine(date.fromisoformat(end_date), datetime.min.time())
            - timedelta(seconds=1)
            if end_date
            else start_dt + timedelta(hours=23, minutes=59)
        )
        all_day = True
    elif start.get("timestamp"):
        start_dt = _to_naive_local(start["timestamp"])
        end_dt = _to_naive_local(end["timestamp"]) if end.get("timestamp") else start_dt
        all_day = False
    else:
        return None

    return ExternalEvent(
        external_id=str(raw.get("event_id") or ""),
        title=raw.get("summary") or "(no title)",
        start_at=start_dt.isoformat(timespec="seconds"),
        end_at=end_dt.isoformat(timespec="seconds"),
        all_day=all_day,
        calendar_name="Lark Calendar",
        account_email=None,  # filled from the connection by the caller
    )


async def list_events(
    session: AsyncSession,
    connection: CalendarConnection,
    start: datetime,
    end: datetime,
) -> list[ExternalEvent]:
    """One forced-refresh retry on a 401: `expires_at` can lie (a refresh race
    leaves a voided token looking fresh), and the provider's own rejection is
    the ground truth the clock isn't."""
    try:
        token = await calendar_links.ensure_fresh_token(session, connection)
        return await _list_window(token, connection, start, end)
    except calendar_links.ProviderUnauthorized:
        token = await calendar_links.ensure_fresh_token(session, connection, force=True)
        return await _list_window(token, connection, start, end)


async def _list_window(
    access_token: str,
    connection: CalendarConnection,
    start: datetime,
    end: datetime,
) -> list[ExternalEvent]:
    calendar_id = await _primary_calendar_id(access_token)

    out: list[ExternalEvent] = []
    page_token = None
    for _ in range(10):  # hard page cap: a window fetch must terminate
        params: dict = {
            "start_time": str(int(start.astimezone().timestamp())),
            "end_time": str(int(end.astimezone().timestamp())),
            "page_size": 500,
        }
        if page_token:
            params["page_token"] = page_token
        data = await _get(access_token, f"{BASE}/calendars/{calendar_id}/events", params)
        for raw in data.get("items") or []:
            parsed = parse_event(raw)
            if parsed is not None:
                out.append(
                    ExternalEvent(
                        **{
                            **parsed.__dict__,
                            "account_email": connection.external_account_email,
                        }
                    )
                )
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return out
