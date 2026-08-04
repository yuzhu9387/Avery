from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import tags as tags_router

app = FastAPI(title="Avery", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tags_router.router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
