from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services import seed as service

router = APIRouter(prefix="/api/seed", tags=["seed"])


@router.post("")
async def seed(session: AsyncSession = Depends(get_session)) -> dict[str, int]:
    return await service.seed_all(session)
