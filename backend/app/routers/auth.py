import httpx
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.deps import get_current_user
from app.models import User
from app.schemas.auth import (
    LoginIn,
    MeUpdate,
    OAuthLinkIn,
    PasswordUpdate,
    SignupIn,
    UserOut,
)
from app.services import auth as auth_service
from app.services import calendar_links
from app.services import external_sync
from app.services import google_calendar
from app.services import oauth as oauth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])
integrations_router = APIRouter(prefix="/api/integrations", tags=["integrations"])


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        auth_service.COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=int(auth_service.SESSION_LIFETIME.total_seconds()),
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(auth_service.COOKIE_NAME, path="/")


async def _login_response(
    db: AsyncSession, response: Response, user: User
) -> UserOut:
    row = await auth_service.create_auth_session(db, user.id)
    _set_session_cookie(response, row.token)
    return UserOut.from_user(user)


# ------------------------------------------------------------------ accounts


@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def signup(data: SignupIn, response: Response, db: AsyncSession = Depends(get_session)):
    try:
        user = await auth_service.signup(db, data.email, data.password, data.name)
    except auth_service.EmailTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    return await _login_response(db, response, user)


@router.post("/login", response_model=UserOut)
async def login(data: LoginIn, response: Response, db: AsyncSession = Depends(get_session)):
    try:
        user = await auth_service.login(db, data.email, data.password)
    except auth_service.BadCredentials:
        # One message for unknown email and wrong password alike.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    return await _login_response(db, response, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, db: AsyncSession = Depends(get_session)):
    token = request.cookies.get(auth_service.COOKIE_NAME)
    if token:
        await auth_service.delete_session_by_token(db, token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_session_cookie(response)
    return response


@router.get("/me", response_model=UserOut)
async def me(request: Request, db: AsyncSession = Depends(get_session)):
    token = request.cookies.get(auth_service.COOKIE_NAME, "")
    resolved = await auth_service.resolve_session(db, token)
    if resolved is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    row, user = resolved
    # Sliding expiry: reading /me keeps an active browser signed in.
    await auth_service.refresh_session(db, row)
    return UserOut.from_user(user)


@router.patch("/me", response_model=UserOut)
async def update_me(
    data: MeUpdate,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    try:
        user = await auth_service.update_profile(db, user, name=data.name, email=data.email)
    except auth_service.EmailTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    return UserOut.from_user(user)


@router.patch("/me/password", response_model=UserOut)
async def update_password(
    data: PasswordUpdate,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    try:
        user = await auth_service.change_password(
            db, user, current_password=data.current_password, new_password=data.new_password
        )
    except auth_service.PasswordRequired:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "current password missing or wrong")
    return UserOut.from_user(user)


# --------------------------------------------------------------------- oauth


def _provider_or_404(provider: str) -> dict:
    try:
        return oauth_service.get_provider(provider)
    except oauth_service.UnknownProvider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown provider: {provider}")


def _require_configured_or_501(provider: str) -> dict:
    spec = _provider_or_404(provider)
    if not oauth_service.provider_configured(provider):
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            f"{provider} sign-in is not configured on this server. "
            f"Set {' and '.join(spec['env_vars'])} in backend/.env "
            "(and optionally OAUTH_REDIRECT_BASE, default http://localhost:5173), "
            "then restart.",
        )
    return spec


@router.get("/oauth/{provider}/start")
async def oauth_start(provider: str) -> dict:
    _require_configured_or_501(provider)
    return {"authorize_url": oauth_service.build_authorize_url(provider)}


@router.get("/oauth/{provider}/callback")
async def oauth_callback(
    request: Request,
    provider: str,
    code: str,
    state: str,
    db: AsyncSession = Depends(get_session),
):
    spec = _require_configured_or_501(provider)
    purpose = oauth_service.consume_state(state)
    if purpose is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid or expired state")
    base = settings.oauth_redirect_base.rstrip("/")

    # One registered redirect_uri serves two different consents; the purpose burned
    # into the state is what tells them apart.
    if purpose == oauth_service.PURPOSE_CALENDAR:
        # A calendar consent attaches to an account, so there has to be one. The
        # session cookie rides along on this redirect because the callback is on the
        # frontend's own origin.
        resolved = await auth_service.resolve_session(
            db, request.cookies.get(auth_service.COOKIE_NAME, "")
        )
        if resolved is None:
            # Signed out mid-round-trip. Say so rather than 500 — the tokens are
            # useless without an account to attach them to.
            return RedirectResponse(
                f"{base}/login?calendar_error=signed_out",
                status_code=status.HTTP_302_FOUND,
            )
        try:
            grant = await oauth_service.exchange_code_for_tokens(provider, code)
        except oauth_service.OAuthExchangeFailed as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"oauth exchange failed: {exc}")
        await calendar_links.upsert_connection(db, resolved[1].id, provider, grant)

        # Also attach the provider as a sign-in method, so one consent joins the
        # accounts and this identity can never split off into a second Avery user.
        # Two proofs are in hand: the session says who is here, the round-trip says
        # they control the provider account. Skipped, never stolen, when the
        # identity already belongs to a different user.
        user = resolved[1]
        if grant.provider_id and getattr(user, spec["user_column"]) is None:
            owner = await auth_service.get_user_by_provider(
                db, spec["user_column"], grant.provider_id
            )
            if owner is None:
                await auth_service.attach_provider(
                    db, user, spec["user_column"], grant.provider_id
                )

        return RedirectResponse(
            f"{base}/account?connected={provider}", status_code=status.HTTP_302_FOUND
        )

    try:
        identity = await oauth_service.exchange_code(provider, code)
    except oauth_service.OAuthExchangeFailed as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"oauth exchange failed: {exc}")

    user = await auth_service.get_user_by_provider(db, spec["user_column"], identity.provider_id)
    if user is not None:
        # Known identity: straight in.
        row = await auth_service.create_auth_session(db, user.id)
        response = RedirectResponse(f"{base}/", status_code=status.HTTP_302_FOUND)
        _set_session_cookie(response, row.token)
        return response

    # Unknown identity, but the provider VOUCHED for an email address. That
    # assertion is the proof of ownership, so nothing needs to be typed: match it
    # to an account and attach, or mint one. Asking the user to re-enter an email
    # the provider already verified — or worse, a password — is friction that buys
    # nothing, because the answer is already known and already trustworthy.
    if identity.email and identity.email_verified:
        existing = await auth_service.get_user_by_email(db, identity.email)
        if existing is not None:
            user = await auth_service.attach_provider(
                db, existing, spec["user_column"], identity.provider_id
            )
        else:
            user = await auth_service.create_oauth_user(
                db,
                identity.email,
                identity.name or identity.email.split("@", 1)[0],
                spec["user_column"],
                identity.provider_id,
            )
        row = await auth_service.create_auth_session(db, user.id)
        response = RedirectResponse(f"{base}/", status_code=status.HTTP_302_FOUND)
        _set_session_cookie(response, row.token)
        return response

    # No email, or one the provider would not vouch for. Only here is there
    # anything to ask: park the identity behind a short-lived token and let the
    # login page collect an address for a NEW account.
    link_token = oauth_service.issue_link_token(identity)
    target = str(
        httpx.URL(
            f"{base}/login",
            params={
                "link_token": link_token,
                "provider": provider,
                "email_hint": identity.email or "",
            },
        )
    )
    return RedirectResponse(target, status_code=status.HTTP_302_FOUND)


@router.post("/oauth/link", response_model=UserOut)
async def oauth_link(
    data: OAuthLinkIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_session),
):
    identity = oauth_service.consume_link_token(data.link_token)
    if identity is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid or expired link token")
    spec = _provider_or_404(identity.provider)
    column = spec["user_column"]

    # The identity may have been attached in the meantime (double submit) —
    # then this is just a login.
    existing_by_provider = await auth_service.get_user_by_provider(
        db, column, identity.provider_id
    )
    if existing_by_provider is not None:
        return await _login_response(db, response, existing_by_provider)

    user = await auth_service.get_user_by_email(db, data.email)
    if user is not None:
        # Attaching a provider to an account that already exists requires proving
        # you are already that account — a session for that exact user.
        #
        # The typed address is not that proof. The provider did NOT vouch for it
        # (when it does, the callback auto-links and never reaches here), so this
        # endpoint receives an address the caller merely asserts. Without the gate
        # below, anyone holding their own valid link token could type a stranger's
        # address and have their provider identity attached to that account — and
        # attach_provider is a *persistent* write, so the takeover would outlive
        # the session and survive the victim changing their password, since the
        # provider login path never checks one.
        #
        # Linking is therefore an account-settings action, not a login action:
        # sign in by whatever means you already have, then link. This is the same
        # model GitHub and Google use, and it costs a legitimate user one extra
        # sign-in exactly once.
        session_token = request.cookies.get(auth_service.COOKIE_NAME, "")
        resolved = await auth_service.resolve_session(db, session_token)
        if resolved is None or resolved[1].id != user.id:
            # One message for "not signed in" and for "signed in as someone else":
            # distinguishing them would tell an attacker whose account they just
            # probed. The address-exists oracle is not fully closed here — the
            # fresh-email branch below still 409s on a taken address — but there
            # is no reason to widen it.
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "that email already has an account — sign in to it first, then "
                "link this provider from your account settings",
            )
        user = await auth_service.attach_provider(db, user, column, identity.provider_id)
        return await _login_response(db, response, user)

    # Fresh email: mint a passwordless account owned by this identity.
    name = identity.name or data.email.split("@", 1)[0]
    try:
        user = await auth_service.create_oauth_user(
            db, data.email, name, column, identity.provider_id
        )
    except auth_service.EmailTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    return await _login_response(db, response, user)


# -------------------------------------------------------------- integrations


@integrations_router.get("")
async def list_integrations(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_session)
) -> dict:
    """Two independent facts per provider, deliberately not collapsed into one.

    `signin_connected` means "this identity can sign you in"; `calendar` means
    "you granted access to the calendar". They are separate consents — connecting
    a calendar does not make the provider a sign-in method, and signing in with it
    grants no calendar access — so reporting a single "connected" flag would make
    the Account page unable to tell the user which of the two they actually have.
    """
    out: dict[str, dict] = {}
    for provider, spec in oauth_service.PROVIDERS.items():
        calendar = None
        if spec.get("calendar_scope"):
            row = await calendar_links.get_connection(db, user.id, provider)
            calendar = {
                "connected": row is not None,
                "account_email": row.external_account_email if row else None,
                "scopes": row.scopes if row else "",
            }
        out[provider] = {
            "configured": oauth_service.provider_configured(provider),
            "signin_connected": getattr(user, spec["user_column"]) is not None,
            "calendar": calendar,
        }
    return out


@integrations_router.get("/{provider}/authorize")
async def authorize_calendar(provider: str, user: User = Depends(get_current_user)):
    """Start the calendar consent. Auth required — the consent attaches to *this*
    account, so there has to be one before the round-trip begins."""
    spec = _provider_or_404(provider)
    if not spec.get("calendar_scope"):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"{provider} has no calendar integration"
        )
    _require_configured_or_501(provider)
    return {"authorize_url": oauth_service.build_calendar_authorize_url(provider)}


@integrations_router.delete("/{provider}/calendar", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_calendar(
    provider: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Drops the tokens. Sign-in is untouched: `users.google_sub` stays, so the
    account can still be signed into with Google afterwards."""
    _provider_or_404(provider)
    await calendar_links.delete_connection(db, user.id, provider)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@integrations_router.get("/{provider}/events")
async def list_external_events(
    provider: str,
    start: datetime,
    end: datetime,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Read-through: fetched per request, never stored.

    Storing them would enrol them in every ratio and category total — the numbers
    the whole app exists to keep honest. They are an overlay, so they stay outside
    the `events` table and are returned as their own list.
    """
    _provider_or_404(provider)
    connection = await calendar_links.get_connection(db, user.id, provider)
    if connection is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"no {provider} calendar connected"
        )
    try:
        events = await google_calendar.list_events(db, connection, start, end)
    except calendar_links.RefreshFailed as exc:
        # The consent is gone or unusable. 409 rather than 500: nothing is broken,
        # the user simply has to reconnect, and the frontend treats it as "not
        # connected" instead of an error banner.
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    return [e.as_dict() for e in events]


@integrations_router.post("/{provider}/sync")
async def sync_external_calendar(
    provider: str,
    start: datetime,
    end: datetime,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Mirror the provider's events for [start, end) into the events table.

    The frontend fires this when a calendar view opens on a window; afterwards the
    normal /api/events read already contains the mirrors, so every view (week,
    month, lists, ratios) sees them with no second code path.
    """
    _provider_or_404(provider)
    try:
        return await external_sync.sync_window(db, user.id, provider, start, end)
    except external_sync.UnsupportedProvider:
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED, f"{provider} calendar sync is not built yet"
        )
    except calendar_links.NoConnection:
        raise HTTPException(status.HTTP_409_CONFLICT, f"no {provider} calendar connected")
    except calendar_links.RefreshFailed as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
