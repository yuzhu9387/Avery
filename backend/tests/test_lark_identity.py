"""Lark sign-in: asking for the email, and reading it back.

Both of these were silently missing. Without the scope Lark returns no email at
all; without the `enterprise_email` fallback the field it *does* fill is ignored.
Either one alone sends every Lark sign-in to the "type your address" step instead
of matching the account automatically — which is what the user saw.
"""

from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.config import settings
from app.services import oauth as oauth_service


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setattr(settings, "lark_app_id", "cli_test")
    monkeypatch.setattr(settings, "lark_app_secret", "secret")


def test_lark_authorize_url_asks_for_the_email_scope():
    url = oauth_service.build_authorize_url("lark")
    q = parse_qs(urlparse(url).query)
    assert q["scope"] == ["contact:user.email:readonly"], (
        "without this Lark returns no email and every sign-in needs the link step"
    )
    assert q["app_id"] == ["cli_test"], "Lark spells the client id app_id"


def _lark_client(user_info: dict):
    """An AsyncClient whose transport answers Lark's two endpoints."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth/token"):
            return httpx.Response(200, json={"access_token": "at"})
        return httpx.Response(200, json={"code": 0, "data": user_info})

    class Fake(httpx.AsyncClient):
        def __init__(self, *a, **kw):
            super().__init__(transport=httpx.MockTransport(handler))

    return Fake


async def test_enterprise_email_is_read_and_trusted(monkeypatch):
    """Lark leaves `email` empty for org-managed accounts and fills
    `enterprise_email`. Reading only the first is why the address went missing."""
    monkeypatch.setattr(
        httpx, "AsyncClient", _lark_client({"open_id": "ou_1", "name": "Leona",
                                            "enterprise_email": "leona@corp.com"})
    )
    identity = await oauth_service.exchange_code("lark", "code")
    assert identity.email == "leona@corp.com"
    # Provisioned by the org's admin, not typed by the user — so it may be matched
    # against an existing account without further proof.
    assert identity.email_verified is True


async def test_plain_email_still_wins_when_present(monkeypatch):
    monkeypatch.setattr(
        httpx, "AsyncClient", _lark_client({"open_id": "ou_2", "email": "a@b.com",
                                            "enterprise_email": "other@corp.com"})
    )
    identity = await oauth_service.exchange_code("lark", "code")
    assert identity.email == "a@b.com"


async def test_no_email_at_all_is_not_treated_as_verified(monkeypatch):
    """The case that legitimately needs the link step — and must never be
    auto-matched to an account."""
    monkeypatch.setattr(
        httpx, "AsyncClient", _lark_client({"open_id": "ou_3", "name": "No Email"})
    )
    identity = await oauth_service.exchange_code("lark", "code")
    assert identity.email is None
    assert identity.email_verified is False


def test_lark_calendar_authorize_url_asks_for_both_scopes():
    from urllib.parse import parse_qs, unquote, urlparse

    url = oauth_service.build_calendar_authorize_url("lark")
    q = parse_qs(urlparse(url).query)
    scope = unquote(q["scope"][0])
    assert "calendar:calendar:readonly" in scope
    assert "calendar:calendar" in scope, "write scope rides along for future write-back"
    assert q["app_id"] == ["cli_test"]
    # Google-only knobs must not leak into Lark's URL.
    assert "access_type" not in q and "prompt" not in q
