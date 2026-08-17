from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.deps import get_current_user
from app.models import User
from app.schemas.rule import RuleCreate, RuleOut, RuleUpdate
from app.services import rules as service
from app.services.tags import UnknownTagIds

router = APIRouter(prefix="/api/rules", tags=["rules"])


@router.get("", response_model=list[RuleOut])
async def list_rules(session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    return await service.list_rules(session, user.id)


@router.post("", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
async def create_rule_version(data: RuleCreate, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        return await service.create_rule_version(session, data, user.id)
    except UnknownTagIds as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}")


@router.get("/active", response_model=RuleOut)
async def get_active_rule(session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    rule = await service.get_active_rule(session, user.id)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no active rule")
    return rule


@router.get("/{rule_id}", response_model=RuleOut)
async def get_rule(rule_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    rule = await service.get_rule(session, rule_id, user.id)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    return rule


@router.patch("/{rule_id}", response_model=RuleOut)
async def update_rule(rule_id: int, data: RuleUpdate, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    # A patch can now carry `groups`, so it can name a tag that does not exist —
    # exactly as POST can, and it needs the same translation. Without this the
    # service's `UnknownTagIds` escapes as a 500.
    try:
        rule = await service.update_rule(session, rule_id, data, user.id)
    except UnknownTagIds as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}")
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: int, session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user)):
    try:
        deleted = await service.delete_rule(session, rule_id, user.id)
    except service.RuleInUse:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "rule is snapshotted by a report and cannot be deleted"
        )
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
