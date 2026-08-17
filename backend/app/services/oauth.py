"""OAuth scaffolding for Google and Lark sign-in.

The provider specifics (URLs, parameter spellings, how to dig the id out of the
userinfo payload) live in one PROVIDERS table so the flow itself is generic.
Tests monkeypatch :func:`exchange_code`; nothing here calls a real endpoint
under test.

State and link tokens are held in in-memory dicts with expiries. That is
deliberate and documented: this app runs as a single process, so a table (or
redis) would add operational surface for no gain. A restart drops in-flight
OAuth round-trips, which merely means the user clicks "sign in with …" again.
"""

import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx

from app.config import settings

STATE_TTL_SECONDS = 10 * 60
LINK_TOKEN_TTL_SECONDS = 10 * 60


@dataclass(frozen=True)
class Identity:
    """What a completed code exchange tells us about the person."""

    provider: str
    provider_id: str
    email: str | None
    name: str | None
    # True only when the PROVIDER asserts it verified this address. This is the
    # hinge the callback turns on: a verified address may be matched against an
    # existing account and silently linked, an unverified one may not (anyone
    # can put any string in an unverified profile field and would otherwise
    # walk straight into someone else's account).
    email_verified: bool = False


class ProviderNotConfigured(Exception):
    def __init__(self, provider: str, env_vars: list[str]) -> None:
        self.provider = provider
        self.env_vars = env_vars
        super().__init__(provider)


class OAuthExchangeFailed(Exception):
    """The code/token exchange or the userinfo fetch came back unusable."""


class UnknownProvider(Exception):
    pass


PROVIDERS: dict[str, dict] = {
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
        # Read *and* write: the user asked for edit rights, and asking twice later
        # would mean a second consent screen. Write-back is not implemented yet.
        # `email` rides along so the connection can name which Google account it is.
        "calendar_scope": (
            "openid email "
            "https://www.googleapis.com/auth/calendar.readonly "
            "https://www.googleapis.com/auth/calendar.events"
        ),
        "client_id_setting": "google_client_id",
        "client_secret_setting": "google_client_secret",
        "env_vars": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        "id_field": "sub",
        "user_column": "google_sub",
    },
    "lark": {
        "authorize_url": "https://open.larksuite.com/open-apis/authen/v1/authorize",
        "token_url": "https://open.larksuite.com/open-apis/authen/v2/oauth/token",
        "userinfo_url": "https://open.larksuite.com/open-apis/authen/v1/user_info",
        # Without this the user_info response carries no email, every Lark sign-in
        # falls through to the "type your address" step, and the account can never be
        # matched automatically. Lark DOES take a scope parameter, contrary to the
        # note that used to sit here.
        # `offline_access` is what makes Lark issue a refresh token at all. Without
        # it the connection works for exactly one access-token lifetime and then
        # dies with "no refresh token on file" — which is precisely how the first
        # Lark calendar connection failed, silently, hours after it was made.
        "scope": "contact:user.email:readonly offline_access",
        # Read now, write later: the write scope rides along so Lark write-back
        # will not need a second consent screen once it exists.
        "calendar_scope": "calendar:calendar:readonly calendar:calendar offline_access",
        "client_id_setting": "lark_app_id",
        "client_secret_setting": "lark_app_secret",
        "env_vars": ["LARK_APP_ID", "LARK_APP_SECRET"],
        "id_field": "open_id",
        "user_column": "lark_open_id",
    },
}

# A single Google client and a single registered redirect_uri serve two
# unrelated consents: "who are you" (sign-in) and "may Avery read your
# calendar". The callback tells them apart by the purpose carried on the state.
PURPOSE_SIGNIN = "signin"
PURPOSE_CALENDAR = "calendar"

# state -> (purpose, expiry epoch seconds).
#
# The brief called for a *signed* state carrying the purpose. Keeping the
# purpose server-side next to the (already server-side) state is strictly
# stronger: the state is an opaque single-use random token, so there is no
# payload for a caller to tamper with and no key to leak. Signing would only
# be needed if the purpose had to survive a process restart, and an in-flight
# OAuth round-trip does not survive one anyway (see the module docstring).
_states: dict[str, tuple[str, float]] = {}
# link_token -> (Identity, expiry epoch seconds)
_link_tokens: dict[str, tuple[Identity, float]] = {}


def get_provider(provider: str) -> dict:
    spec = PROVIDERS.get(provider)
    if spec is None:
        raise UnknownProvider(provider)
    return spec


def provider_configured(provider: str) -> bool:
    spec = get_provider(provider)
    return bool(
        getattr(settings, spec["client_id_setting"])
        and getattr(settings, spec["client_secret_setting"])
    )


def require_configured(provider: str) -> dict:
    spec = get_provider(provider)
    if not provider_configured(provider):
        raise ProviderNotConfigured(provider, spec["env_vars"])
    return spec


def redirect_uri(provider: str) -> str:
    return f"{settings.oauth_redirect_base.rstrip('/')}/api/auth/oauth/{provider}/callback"


# ------------------------------------------------------------------- state


def _sweep(store: dict, now: float) -> None:
    expired = [k for k, v in store.items() if (v[1] if isinstance(v, tuple) else v) <= now]
    for key in expired:
        del store[key]


def issue_state(purpose: str = PURPOSE_SIGNIN) -> str:
    now = time.time()
    _sweep(_states, now)
    state = secrets.token_urlsafe(24)
    _states[state] = (purpose, now + STATE_TTL_SECONDS)
    return state


def consume_state(state: str) -> str | None:
    """Burn the state and return the purpose it was issued for, or None."""
    now = time.time()
    _sweep(_states, now)
    entry = _states.pop(state, None)
    return entry[0] if entry else None


def issue_link_token(identity: Identity) -> str:
    now = time.time()
    _sweep(_link_tokens, now)
    token = secrets.token_urlsafe(24)
    _link_tokens[token] = (identity, now + LINK_TOKEN_TTL_SECONDS)
    return token


def consume_link_token(token: str) -> Identity | None:
    now = time.time()
    _sweep(_link_tokens, now)
    entry = _link_tokens.pop(token, None)
    return entry[0] if entry else None


# ---------------------------------------------------------------- the flow


def build_calendar_authorize_url(provider: str) -> str:
    """Consent for calendar access — a different consent from signing in.

    Same client and same registered redirect_uri as sign-in, so the user does not
    have to register a second URI; the callback tells the two apart by the purpose
    burned into the state.

    `access_type=offline` + `prompt=consent` are both required to actually receive
    a refresh token: Google issues one only on the first consent unless the prompt
    is forced, and without it the connection would silently stop working the hour
    the access token expired.
    """
    spec = require_configured(provider)
    scope = spec.get("calendar_scope")
    if not scope:
        raise UnknownProvider(f"{provider} has no calendar scope")
    if provider == "lark":
        # Lark: app_id spelling, no offline/consent knobs — its v2 token endpoint
        # always issues a refresh token.
        params = {
            "app_id": getattr(settings, spec["client_id_setting"]),
            "redirect_uri": redirect_uri(provider),
            "state": issue_state(PURPOSE_CALENDAR),
            "scope": scope,
        }
    else:
        params = {
            "client_id": getattr(settings, spec["client_id_setting"]),
            "redirect_uri": redirect_uri(provider),
            "response_type": "code",
            "scope": scope,
            "state": issue_state(PURPOSE_CALENDAR),
            # Both required to actually receive a Google refresh token; without one
            # the connection dies the hour the access token expires.
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
        }
    return str(httpx.URL(spec["authorize_url"], params=params))


@dataclass(frozen=True)
class TokenGrant:
    """The tokens themselves, for the calendar flow. Sign-in throws these away —
    it only ever wanted the identity behind them."""

    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    scopes: str
    email: str | None
    # The provider's stable id for this person (google `sub`). Carried so a calendar
    # consent can also attach the provider as a sign-in method: the session proves
    # who is sitting here, the OAuth round-trip proves they control the provider
    # account — together that is strictly more proof than the link flow ever has.
    provider_id: str | None = None


async def exchange_code_for_tokens(provider: str, code: str) -> TokenGrant:
    """Code -> tokens, keeping the tokens. Monkeypatched in tests."""
    spec = require_configured(provider)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            spec["token_url"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": getattr(settings, spec["client_id_setting"]),
                "client_secret": getattr(settings, spec["client_secret_setting"]),
                "redirect_uri": redirect_uri(provider),
            },
        )
        if resp.status_code != 200:
            raise OAuthExchangeFailed(f"token endpoint answered {resp.status_code}")
        payload = resp.json()
        access_token = payload.get("access_token")
        if not access_token:
            raise OAuthExchangeFailed("token response carried no access_token")

        email = None
        provider_id = None
        info = await client.get(
            spec["userinfo_url"], headers={"Authorization": f"Bearer {access_token}"}
        )
        if info.status_code == 200:
            info_payload = info.json()
            if provider == "lark" and isinstance(info_payload.get("data"), dict):
                info_payload = info_payload["data"]
            email = info_payload.get("email") or None
            raw_id = info_payload.get(spec["id_field"])
            provider_id = str(raw_id) if raw_id else None

    expires_in = payload.get("expires_in")
    expires_at = (
        datetime.now() + timedelta(seconds=int(expires_in)) if expires_in else None
    )
    return TokenGrant(
        access_token=access_token,
        refresh_token=payload.get("refresh_token") or None,
        expires_at=expires_at,
        scopes=payload.get("scope") or "",
        email=email,
        provider_id=provider_id,
    )


def build_authorize_url(provider: str) -> str:
    spec = require_configured(provider)
    state = issue_state()
    if provider == "lark":
        # Lark spells the client id "app_id".
        params = {
            "app_id": getattr(settings, spec["client_id_setting"]),
            "redirect_uri": redirect_uri(provider),
            "state": state,
            "scope": spec["scope"],
        }
    else:
        params = {
            "client_id": getattr(settings, spec["client_id_setting"]),
            "redirect_uri": redirect_uri(provider),
            "response_type": "code",
            "scope": spec["scope"],
            "state": state,
        }
    return str(httpx.URL(spec["authorize_url"], params=params))


async def exchange_code(provider: str, code: str) -> Identity:
    """Code -> tokens -> userinfo -> Identity. Monkeypatched in tests."""
    spec = require_configured(provider)
    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            spec["token_url"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": getattr(settings, spec["client_id_setting"]),
                "client_secret": getattr(settings, spec["client_secret_setting"]),
                "redirect_uri": redirect_uri(provider),
            },
        )
        if token_resp.status_code != 200:
            raise OAuthExchangeFailed(f"token endpoint answered {token_resp.status_code}")
        access_token = token_resp.json().get("access_token")
        if not access_token:
            raise OAuthExchangeFailed("token response carried no access_token")

        info_resp = await client.get(
            spec["userinfo_url"], headers={"Authorization": f"Bearer {access_token}"}
        )
        if info_resp.status_code != 200:
            raise OAuthExchangeFailed(f"userinfo endpoint answered {info_resp.status_code}")
        payload = info_resp.json()
        # Lark wraps the payload in {"code": 0, "data": {...}}.
        if provider == "lark" and isinstance(payload.get("data"), dict):
            payload = payload["data"]

    provider_id = payload.get(spec["id_field"])
    if not provider_id:
        raise OAuthExchangeFailed(f"userinfo payload carried no {spec['id_field']}")
    # Lark fills `enterprise_email` for org-managed accounts and leaves `email`
    # empty; taking only the first one is why every Lark sign-in used to land on the
    # "type your address" step even with the scope granted.
    email = payload.get("email") or payload.get("enterprise_email") or None
    if provider == "lark":
        # Lark hands back the ENTERPRISE email: it is provisioned by the org's
        # Lark admin, not typed in by the person, and cannot be self-edited to
        # an arbitrary address. We therefore treat its presence as the org
        # having verified it. (Lark sends no email_verified flag, so this
        # assumption is the whole basis for auto-linking a Lark identity; if
        # Avery ever accepts personal-tenant Lark accounts, revisit it.)
        email_verified = email is not None
    else:
        # Google says so explicitly, and only `true` counts — a missing or
        # false flag means an address we must not trust for matching.
        email_verified = payload.get("email_verified") is True
    return Identity(
        provider=provider,
        provider_id=str(provider_id),
        email=email,
        name=payload.get("name") or None,
        email_verified=email_verified and email is not None,
    )
