from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import analytics as analytics_router
from app.routers import calendar as calendar_router
from app.routers import events as events_router
from app.routers import reminders as reminders_router
from app.routers import reports as reports_router
from app.routers import rules as rules_router
from app.routers import tags as tags_router
from app.routers import tasks as tasks_router
from app.routers import templates as templates_router

app = FastAPI(title="Avery", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
