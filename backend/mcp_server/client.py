"""Thin async HTTP client for Avery's REST API.

Holds the base URL and the caller's Bearer token so every tool in server.py
can say what it wants done without repeating how to authenticate or how to
turn one of Avery's error responses into words a model can act on. The model
never sees the underlying httpx exception or a stack trace — only the __str__
of whatever we raise here, so each exception below is written as a sentence
the model can read and follow, not a developer-facing trace.
"""

from __future__ import annotations

import os

import httpx


class AveryConfigError(RuntimeError):
    """Raised when the server can't even attempt to talk to Avery.

    Kept distinct from AveryError (below): this fires before any request is
    made, at client construction, so __main__.py can force it to happen at
    process startup instead of three tool calls into a model's plan.
    """


class AveryError(RuntimeError):
    """Base for every error raised after we've actually talked to Avery."""


class AveryUnavailable(AveryError):
    def __init__(self, base_url: str):
        super().__init__(
            f"Could not reach Avery at {base_url}. The backend is probably not "
            f"running -- start it with `uvicorn app.main:app --reload` from "
            f"Avery/backend, or check AVERY_BASE_URL if it should be running "
            f"somewhere else."
        )


class AveryAuthError(AveryError):
    def __init__(self):
        super().__init__(
            "Avery rejected this request: the agent token is invalid, expired, "
            "or revoked. Issue a fresh token from Avery's settings and update "
            "AVERY_AGENT_TOKEN for this MCP server."
        )


class AveryForbidden(AveryError):
    def __init__(self, detail: str):
        # Avery's own message, verbatim: it already names the specific
        # workspace mismatch better than a generic wrapper could.
        super().__init__(f"Avery refused this request: {detail}")


class AveryNotFound(AveryError):
    def __init__(self, detail: str):
        super().__init__(detail)


class AveryValidationError(AveryError):
    def __init__(self, detail: str):
        super().__init__(f"Avery rejected the request as invalid: {detail}")


class AveryAPIError(AveryError):
    def __init__(self, status_code: int, detail: str):
        super().__init__(f"Avery returned an unexpected HTTP {status_code}: {detail}")


def _detail(response: httpx.Response) -> str:
    """Avery's routers raise HTTPException(status, str) almost everywhere, which
    FastAPI serializes as {"detail": "..."} -- prefer that verbatim string over
    the raw JSON body so the model reads a sentence, not a dict literal."""
    try:
        body = response.json()
    except ValueError:
        return response.text
    if isinstance(body, dict) and "detail" in body:
        return str(body["detail"])
    return str(body)


class AveryClient:
    """One instance per server process. Not reused across event loops beyond
    that -- if this ever needs to survive a loop restart, it will need a fresh
    httpx.AsyncClient rather than reusing self._http.
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        token: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url or os.environ.get("AVERY_BASE_URL", "http://127.0.0.1:8000")
        resolved_token = token if token is not None else os.environ.get("AVERY_AGENT_TOKEN")
        if not resolved_token:
            raise AveryConfigError(
                "AVERY_AGENT_TOKEN is not set. Issue an agent token from Avery's "
                "settings (it authenticates as Bearer <token> and carries its own "
                "workspace scope) and set AVERY_AGENT_TOKEN in this server's "
                "environment before starting it."
            )
        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {resolved_token}"},
            timeout=10.0,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            response = await self._http.request(method, path, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            raise AveryUnavailable(self.base_url) from None

        if response.status_code == 401:
            raise AveryAuthError()
        if response.status_code == 403:
            raise AveryForbidden(_detail(response))
        if response.status_code == 404:
            raise AveryNotFound(_detail(response))
        if response.status_code == 422:
            raise AveryValidationError(_detail(response))
        if response.status_code >= 400:
            raise AveryAPIError(response.status_code, _detail(response))
        return response

    async def get(self, path: str, params: dict | None = None) -> object:
        return (await self._request("GET", path, params=params)).json()

    async def post(self, path: str, json: dict | None = None) -> object:
        return (await self._request("POST", path, json=json)).json()

    async def patch(self, path: str, json: dict | None = None) -> object:
        return (await self._request("PATCH", path, json=json)).json()
