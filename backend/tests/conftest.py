from collections.abc import AsyncIterator, Callable

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.models  # noqa: F401  — registers every model on Base.metadata
from app.config import settings as app_settings
from app.database import Base, enable_sqlite_foreign_keys, get_session
from app.main import app as fastapi_app


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite:///:memory:")
    enable_sqlite_foreign_keys(eng)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        yield s


@pytest_asyncio.fixture
async def make_client(session) -> AsyncIterator[Callable[[], AsyncClient]]:
    """Factory for independent clients over the same app + database.

    Each client keeps its own cookie jar, which is exactly what a multi-user
    isolation test needs: one browser per user.
    """
    async def _override():
        yield session

    fastapi_app.dependency_overrides[get_session] = _override
    transport = ASGITransport(app=fastapi_app)
    created: list[AsyncClient] = []

    def _make() -> AsyncClient:
        c = AsyncClient(transport=transport, base_url="http://test")
        created.append(c)
        return c

    yield _make
    for c in created:
        await c.aclose()
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def anon_client(make_client) -> AsyncClient:
    """A client with no account and no cookie — for the auth tests themselves."""
    return make_client()


@pytest_asyncio.fixture
async def client(make_client) -> AsyncClient:
    """The default client every data test uses, signed in as a fresh user.

    The session cookie set by signup persists on the httpx client automatically,
    so the ~200 pre-account tests keep working unchanged against the now
    auth-required API.
    """
    c = make_client()
    response = await c.post(
        "/api/auth/signup",
        json={"email": "test@example.com", "password": "password123", "name": "Test User"},
    )
    assert response.status_code == 201, response.text
    return c


@pytest_asyncio.fixture(autouse=True)
async def _no_ambient_oauth_credentials():
    """Blank the OAuth credentials for every test.

    `Settings` reads `backend/.env`, so the suite otherwise inherits whatever the
    developer has configured on this machine — and the moment real credentials were
    filled in, two tests that assert the *unconfigured* behaviour started failing
    with no code change. Tests must not depend on a file that is deliberately
    gitignored and different on every machine; the ones that need credentials
    monkeypatch them in explicitly.
    """
    saved = {
        name: getattr(app_settings, name)
        for name in (
            "google_client_id",
            "google_client_secret",
            "lark_app_id",
            "lark_app_secret",
        )
    }
    for name in saved:
        setattr(app_settings, name, "")
    yield
    for name, value in saved.items():
        setattr(app_settings, name, value)


@pytest_asyncio.fixture(autouse=True)
async def _no_ambient_jobs_token():
    """Blank JOBS_TOKEN for every test, same reasoning as the OAuth fixture
    above: `Settings` reads `backend/.env`, which is gitignored and differs
    per machine. A developer who has set JOBS_TOKEN locally must not make the
    "missing token -> 503" test start failing. Tests that need a token set it
    explicitly via monkeypatch.
    """
    saved = app_settings.jobs_token
    app_settings.jobs_token = ""
    yield
    app_settings.jobs_token = saved
