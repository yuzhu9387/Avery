from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles

import app.models  # noqa: F401

from app.config import FRONTEND_DIST_DIR
from app.database import Base, engine
from app.routers import agent_tokens as agent_tokens_router
from app.routers import analytics as analytics_router
from app.routers import auth as auth_router
from app.routers import calendar as calendar_router
from app.routers import events as events_router
from app.routers import reminders as reminders_router
from app.routers import reports as reports_router
from app.routers import rules as rules_router
from app.routers import seed as seed_router
from app.routers import tags as tags_router
from app.routers import tasks as tasks_router
from app.routers import routines as routines_router
from app.scheduler.jobs import shutdown_scheduler, start_scheduler


@asynccontextmanager
async def lifespan(_app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    start_scheduler()
    yield
    shutdown_scheduler()


app = FastAPI(title="Avery", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(auth_router.integrations_router)
app.include_router(agent_tokens_router.router)
app.include_router(seed_router.router)
app.include_router(tags_router.router)
app.include_router(tasks_router.router)
app.include_router(reminders_router.router)
app.include_router(events_router.router)
app.include_router(rules_router.router)
app.include_router(reports_router.router)
app.include_router(analytics_router.router)
app.include_router(routines_router.router)
app.include_router(routines_router.block_router)
app.include_router(routines_router.week_router)
app.include_router(calendar_router.week_router)
app.include_router(calendar_router.month_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


class _SPAStaticFiles(StaticFiles):
    """Serve the built frontend, falling back to index.html for client-side routes.

    A request for an unknown path (e.g. /events/3, refreshed directly) would
    otherwise 404 instead of letting the React router handle it. /api/* paths
    are excluded from the fallback — they should 404 normally, not resolve to
    the SPA shell — but in practice a mismatched /api/* request never reaches
    here at all: this is mounted at "/" after every /api router above, so
    Starlette matches those routers first and only falls through to this
    mount when nothing under /api/* (or elsewhere) claimed the path.
    """

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and path != "api" and not path.startswith("api/"):
                return await super().get_response("index.html", scope)
            raise


# Mounted last and conditionally: in local dev frontend/dist doesn't exist
# (Vite's dev server serves the UI on :5173 instead), so skip silently rather
# than crashing at import. In a container image the Dockerfile has already
# built the frontend to this path.
if FRONTEND_DIST_DIR.is_dir():
    app.mount("/", _SPAStaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="frontend")
