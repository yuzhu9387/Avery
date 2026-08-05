from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401

from app.database import Base, engine
from app.routers import analytics as analytics_router
from app.routers import calendar as calendar_router
from app.routers import events as events_router
from app.routers import reminders as reminders_router
from app.routers import reports as reports_router
from app.routers import rules as rules_router
from app.routers import seed as seed_router
from app.routers import tags as tags_router
from app.routers import tasks as tasks_router
from app.routers import templates as templates_router
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

app.include_router(seed_router.router)
app.include_router(tags_router.router)
app.include_router(tasks_router.router)
app.include_router(reminders_router.router)
app.include_router(events_router.router)
app.include_router(rules_router.router)
app.include_router(reports_router.router)
app.include_router(analytics_router.router)
app.include_router(templates_router.router)
app.include_router(templates_router.block_router)
app.include_router(templates_router.week_router)
app.include_router(calendar_router.week_router)
app.include_router(calendar_router.month_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
