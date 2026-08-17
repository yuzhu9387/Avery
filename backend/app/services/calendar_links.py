"""Granted calendar consents: storing them, and keeping their tokens usable.

Separate from `services.oauth` (which is about *who you are*) because granting
calendar access and signing in are different consents with different lifetimes:
either can be revoked without touching the other.
"""

from datetime import datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import CalendarConnection
from app.services import oauth as oauth_service

# Refresh a little before the token actually dies. Without the margin a request
# that passes the check and then spends a second in flight can still arrive
# expired, which reads as a random intermittent 401 from Google.
EXPIRY_MARGIN = timedelta(seconds=60)


class NoConnection(Exception):
    """No calendar consent on file for this user and provider."""


class RefreshFailed(Exception):
    """The refresh token no longer works — the user has to reconnect."""


async def get_connection(
    session: AsyncSession, user_id: int, provider: str
) -> CalendarConnection | None:
    stmt = select(CalendarConnection).where(
        CalendarConnection.user_id == user_id, CalendarConnection.provider == provider
    )
    return (await session.scalars(stmt)).first()


async def upsert_connection(
    session: AsyncSession,
    user_id: int,
    provider: str,
    grant: oauth_service.TokenGrant,
) -> CalendarConnection:
    """Store a fresh consent, replacing any previous one for this provider.

    Reconnecting must not orphan the old row (the unique constraint is on
    `(user_id, provider, external_account_email)`, so connecting a *different*
    Google account would otherwise leave two rows and make "which one is mine"
    ambiguous). One connection per provider per user is the model.
    """
    existing = await get_connection(session, user_id, provider)
    if existing is None:
        existing = CalendarConnection(user_id=user_id, provider=provider)
        session.add(existing)

    existing.access_token = grant.access_token
    # Google returns a refresh token only on the first consent (or when
    # prompt=consent forces one). Never overwrite a good one with None, or the
    # connection silently becomes un-refreshable an hour later.
    if grant.refresh_token:
        existing.refresh_token = grant.refresh_token
    existing.expires_at = grant.expires_at
    existing.scopes = grant.scopes
    if grant.email:
        existing.external_account_email = grant.email
    existing.updated_at = datetime.now()

    await session.commit()
    await session.refresh(existing)
    return existing


async def delete_connection(session: AsyncSession, user_id: int, provider: str) -> bool:
    row = await get_connection(session, user_id, provider)
    if row is None:
        return False
    await session.delete(row)
    await session.commit()
    return True


def needs_refresh(connection: CalendarConnection, now: datetime | None = None) -> bool:
    """A connection with no expiry is treated as still valid: the provider did not
    say when it dies, so guessing would refresh on every single request."""
    if connection.expires_at is None:
        return False
    return connection.expires_at <= (now or datetime.now()) + EXPIRY_MARGIN


async def _post_refresh(provider: str, refresh_token: str) -> dict:
    """Isolated so tests can substitute it without touching the network."""
    spec = oauth_service.require_configured(provider)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            spec["token_url"],
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": getattr(settings, spec["client_id_setting"]),
                "client_secret": getattr(settings, spec["client_secret_setting"]),
            },
        )
    if resp.status_code != 200:
        raise RefreshFailed(f"refresh endpoint answered {resp.status_code}")
    return resp.json()


async def ensure_fresh_token(
    session: AsyncSession, connection: CalendarConnection
) -> str:
    """The access token to use right now, refreshing first when it is about to die.

    Raises `RefreshFailed` when there is nothing to refresh with — a connection
    whose refresh token was never issued or has been revoked cannot recover on its
    own, and the honest answer is to make the user reconnect rather than retry
    forever against a token that will never work.
    """
    if not needs_refresh(connection):
        return connection.access_token
    if not connection.refresh_token:
        raise RefreshFailed("no refresh token on file — reconnect the calendar")

    payload = await _post_refresh(connection.provider, connection.refresh_token)
    access_token = payload.get("access_token")
    if not access_token:
        raise RefreshFailed("refresh response carried no access_token")

    connection.access_token = access_token
    expires_in = payload.get("expires_in")
    connection.expires_at = (
        datetime.now() + timedelta(seconds=int(expires_in)) if expires_in else None
    )
    # A refresh response usually omits the refresh token; keep the existing one.
    if payload.get("refresh_token"):
        connection.refresh_token = payload["refresh_token"]
    connection.updated_at = datetime.now()
    await session.commit()
    return access_token
