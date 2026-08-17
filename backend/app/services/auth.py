"""Accounts and cookie sessions.

Password hashing is stdlib scrypt, stored as ``scrypt$<salt_hex>$<hash_hex>`` so
the parameters travel with the format tag and a future algorithm can coexist.
Session tokens are opaque random strings held server-side in ``auth_sessions``;
the cookie carries nothing but the token.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuthSession, User

COOKIE_NAME = "avery_session"
SESSION_LIFETIME = timedelta(days=30)
# Sliding window: /me renews the session when less than this much life remains.
SESSION_REFRESH_THRESHOLD = timedelta(days=15)

_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1


class EmailTaken(Exception):
    """Raised when a signup or profile edit collides with an existing email."""


class BadCredentials(Exception):
    """Raised on any authentication failure. One exception for unknown email and
    wrong password alike, so responses cannot be used to probe which emails exist."""


class PasswordRequired(Exception):
    """Raised when a password change omits current_password on an account that has one,
    or supplies a wrong one."""


# ---------------------------------------------------------------- passwords


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P
    )
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, salt_hex, hash_hex = stored.split("$")
        if algorithm != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except ValueError:
        return False
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P
    )
    return hmac.compare_digest(digest, expected)


# ------------------------------------------------------------------ lookups


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    stmt = select(User).where(User.email == normalize_email(email))
    return (await session.scalars(stmt)).first()


async def get_user_by_provider(
    session: AsyncSession, provider_column: str, provider_id: str
) -> User | None:
    """provider_column is 'google_sub' or 'lark_open_id' (from the PROVIDERS table)."""
    stmt = select(User).where(getattr(User, provider_column) == provider_id)
    return (await session.scalars(stmt)).first()


async def attach_provider(
    session: AsyncSession, user: User, provider_column: str, provider_id: str
) -> User:
    setattr(user, provider_column, provider_id)
    await session.commit()
    await session.refresh(user)
    return user


# ----------------------------------------------------------------- sessions


async def create_auth_session(
    session: AsyncSession, user_id: int, *, now: datetime | None = None
) -> AuthSession:
    now = now or datetime.now()
    row = AuthSession(
        token=secrets.token_urlsafe(32),
        user_id=user_id,
        created_at=now,
        expires_at=now + SESSION_LIFETIME,
    )
    session.add(row)
    await session.commit()
    return row


async def resolve_session(
    session: AsyncSession, token: str, *, now: datetime | None = None
) -> tuple[AuthSession, User] | None:
    """Token -> (auth session, user), or None. Expired rows are deleted on sight."""
    if not token:
        return None
    now = now or datetime.now()
    stmt = select(AuthSession).where(AuthSession.token == token)
    row = (await session.scalars(stmt)).first()
    if row is None:
        return None
    if row.expires_at <= now:
        await session.delete(row)
        await session.commit()
        return None
    user = await session.get(User, row.user_id)
    if user is None:
        return None
    return row, user


async def refresh_session(
    session: AsyncSession, row: AuthSession, *, now: datetime | None = None
) -> None:
    """Slide the expiry forward once less than half the lifetime remains."""
    now = now or datetime.now()
    if row.expires_at - now < SESSION_REFRESH_THRESHOLD:
        row.expires_at = now + SESSION_LIFETIME
        await session.commit()


async def delete_session_by_token(session: AsyncSession, token: str) -> None:
    await session.execute(delete(AuthSession).where(AuthSession.token == token))
    await session.commit()


# ----------------------------------------------------------------- accounts


async def signup(session: AsyncSession, email: str, password: str, name: str) -> User:
    email = normalize_email(email)
    if await get_user_by_email(session, email) is not None:
        raise EmailTaken(email)
    user = User(email=email, name=name, password_hash=hash_password(password))
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def create_oauth_user(
    session: AsyncSession, email: str, name: str, provider_column: str, provider_id: str
) -> User:
    """A passwordless account minted by an OAuth link."""
    email = normalize_email(email)
    if await get_user_by_email(session, email) is not None:
        raise EmailTaken(email)
    user = User(email=email, name=name, password_hash=None)
    setattr(user, provider_column, provider_id)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def login(session: AsyncSession, email: str, password: str) -> User:
    user = await get_user_by_email(session, email)
    if user is None or user.password_hash is None:
        # Burn a hash anyway so an unknown email is not measurably faster
        # than a wrong password.
        verify_password(password, hash_password("timing-equalizer"))
        raise BadCredentials()
    if not verify_password(password, user.password_hash):
        raise BadCredentials()
    return user


async def update_profile(
    session: AsyncSession, user: User, *, name: str | None = None, email: str | None = None
) -> User:
    if email is not None:
        email = normalize_email(email)
        if email != user.email:
            existing = await get_user_by_email(session, email)
            if existing is not None and existing.id != user.id:
                raise EmailTaken(email)
            user.email = email
    if name is not None:
        user.name = name
    await session.commit()
    await session.refresh(user)
    return user


async def change_password(
    session: AsyncSession, user: User, *, current_password: str | None, new_password: str
) -> User:
    """current_password is required iff a password already exists. An OAuth-only
    account sets its first password without one — there is nothing to verify."""
    if user.password_hash is not None:
        if current_password is None or not verify_password(
            current_password, user.password_hash
        ):
            raise PasswordRequired()
    user.password_hash = hash_password(new_password)
    await session.commit()
    await session.refresh(user)
    return user
