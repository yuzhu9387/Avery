"""Agent tokens: credentials for machine clients (the MCP server), not browsers.

A token is a 32-byte `secrets.token_urlsafe` value, shown to the caller exactly
once at issue time. Only its SHA-256 hash is ever stored — see AgentToken's
docstring for why a stale `avery.db.bak-*` must not double as a working
credential. This is plain `hashlib.sha256`, not a password KDF: the input is
already 256 bits of CSPRNG output, not something a human chose, so there is no
low-entropy secret for scrypt/bcrypt/argon2 to slow an attacker's guessing of —
that cost would buy nothing here and only slow every lookup down. Do not
"upgrade" this to a KDF.

Resolution is a hash-and-lookup against a unique index, not a linear scan
compared with `hmac.compare_digest`. Constant-time comparison defends against
timing attacks that recover a secret byte-by-byte from many *targeted*
comparisons against attacker-chosen guesses; here the attacker cannot choose
which row the DB index compares against, so there is nothing to time. Adding a
compare_digest scan would only make every request O(n) in the token count for
no additional safety.
"""

import hashlib
import secrets
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgentToken, User


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def issue(
    session: AsyncSession, user: User, *, name: str, workspace: str
) -> tuple[AgentToken, str]:
    """Mint a token. Returns (row, plaintext) — the plaintext exists only here;
    the caller must show it to the user now, because it can never be recovered
    again once this returns."""
    plaintext = secrets.token_urlsafe(32)
    row = AgentToken(
        user_id=user.id,
        name=name,
        token_hash=_hash(plaintext),
        workspace=workspace,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row, plaintext


async def resolve(session: AsyncSession, token: str) -> AgentToken | None:
    """Plaintext -> row, or None for empty/unknown/revoked. Bumps last_used_at
    on a hit, same as a cookie session's sliding-expiry touch."""
    if not token:
        return None
    stmt = select(AgentToken).where(AgentToken.token_hash == _hash(token))
    row = (await session.scalars(stmt)).first()
    if row is None or row.revoked_at is not None:
        return None
    row.last_used_at = datetime.now()
    await session.commit()
    return row


async def revoke(session: AsyncSession, user: User, token_id: int) -> bool:
    """True if a live token of this user's was revoked. False for missing,
    already-revoked, or someone else's — same "acts like it doesn't exist"
    shape as the rest of the app's per-user scoping."""
    stmt = select(AgentToken).where(
        AgentToken.id == token_id, AgentToken.user_id == user.id
    )
    row = (await session.scalars(stmt)).first()
    if row is None or row.revoked_at is not None:
        return False
    row.revoked_at = datetime.now()
    await session.commit()
    return True


async def list_for_user(session: AsyncSession, user: User) -> list[AgentToken]:
    stmt = (
        select(AgentToken)
        .where(AgentToken.user_id == user.id)
        .order_by(AgentToken.created_at.desc())
    )
    return list((await session.scalars(stmt)).all())
