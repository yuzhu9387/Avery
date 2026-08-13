"""Request-scoped dependencies shared by every router."""

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import AgentToken, User
from app.services import agent_auth
from app.services import auth as auth_service

# The only workspace that exists today. An agent token is issued with a
# `workspace` value and that value must be honored, not assumed — a "work"
# workspace is planned but has no data of its own yet, so a token scoped to it
# must never be treated as equivalent to `personal`. See the guard below.
SUPPORTED_WORKSPACE = "personal"


_BEARER_PREFIX = "bearer "


def _bearer_token(request: Request) -> str | None:
    """The raw token from an `Authorization: Bearer <token>` header, or None if
    the header is absent. None here means "no Bearer credential was offered at
    all" — distinct from a Bearer credential that turns out not to resolve, so
    callers can tell "fall back to cookie" apart from "this Bearer token is bad,
    say so and stop" (see get_current_user).
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith(_BEARER_PREFIX):
        return None
    return auth_header[len(_BEARER_PREFIX):]


async def _resolve_agent_token(
    request: Request, session: AsyncSession
) -> AgentToken | None:
    """Bearer header -> live AgentToken, or None if the header is absent or
    unresolvable. Kept separate from get_current_user so get_agent_scope can
    call it too without duplicating the header parsing."""
    token = _bearer_token(request)
    if token is None:
        return None
    return await agent_auth.resolve(session, token)


async def get_current_user(
    request: Request, session: AsyncSession = Depends(get_session)
) -> User:
    """Bearer agent token -> cookie session, in that order, or 401.

    Every data router hangs off this, so this is also where a machine caller
    enters the system — through the exact same function a human's browser does,
    with the exact same per-user scoping downstream.

    A Bearer header, once present, is authoritative: an invalid, revoked, or
    misscoped Bearer token must fail on its own rather than silently falling
    back to whatever cookie happens to be sitting on the same request. Falling
    back would let a caller believe it authenticated as the agent it claimed to
    be while actually riding on someone else's browser session — the opposite
    of what a scoped, revocable credential is for.
    """
    bearer = _bearer_token(request)
    if bearer is not None:
        agent_token = await agent_auth.resolve(session, bearer)
        if agent_token is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
        # FAIL CLOSED: only `personal` exists today. A token scoped to anything
        # else (e.g. a future "work" workspace) must be rejected outright rather
        # than silently treated as personal — handing a "work" caller today's
        # personal data is exactly the bug this design exists to prevent.
        if agent_token.workspace != SUPPORTED_WORKSPACE:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"workspace {agent_token.workspace!r} is not yet supported",
            )
        user = await session.get(User, agent_token.user_id)
        if user is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
        return user

    token = request.cookies.get(auth_service.COOKIE_NAME, "")
    resolved = await auth_service.resolve_session(session, token)
    if resolved is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    return resolved[1]


async def get_agent_scope(
    request: Request, session: AsyncSession = Depends(get_session)
) -> str | None:
    """The workspace an agent token authenticated this request with, or None for
    a cookie session (the human's own UI, which is not workspace-restricted).

    Deliberately re-resolves the Bearer header rather than reading anything off
    get_current_user's return value — User carries no notion of "which
    workspace authenticated this request", and it must not grow one just to
    thread this through, since that would make the scope look like a property
    of the user instead of the credential.
    """
    agent_token = await _resolve_agent_token(request, session)
    if agent_token is None:
        return None
    return agent_token.workspace
