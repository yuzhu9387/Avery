from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services import seed as service

router = APIRouter(prefix="/api/seed", tags=["seed"])


@router.post("")
async def seed(session: AsyncSession = Depends(get_session)) -> dict[str, int]:
    try:
        return await service.seed_all(session)
    except service.SeedTagsMissing as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"cannot seed: these tags are missing or renamed — {exc}. "
            "Recreate them with their original names, or seed into an empty database.",
        )
