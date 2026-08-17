from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.deps import get_current_user
from app.models import User
from app.services import seed as service

router = APIRouter(prefix="/api/seed", tags=["seed"])


@router.post("")
async def seed(session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)) -> dict[str, int]:
    try:
        return await service.seed_all(session, user.id)
    except service.SeedTagsMissing as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"cannot seed: these tags are missing or renamed — {exc}. "
            "Recreate them with their original names, or seed into an empty database.",
        )
