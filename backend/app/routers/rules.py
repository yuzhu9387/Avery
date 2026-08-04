from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.schemas.rule import RuleCreate, RuleOut
from app.services import rules as service

router = APIRouter(prefix="/api/rules", tags=["rules"])


@router.get("", response_model=list[RuleOut])
async def list_rules(session: AsyncSession = Depends(get_session)):
    return await service.list_rules(session)


@router.post("", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
async def create_rule_version(data: RuleCreate, session: AsyncSession = Depends(get_session)):
    return await service.create_rule_version(session, data)


@router.get("/active", response_model=RuleOut)
async def get_active_rule(session: AsyncSession = Depends(get_session)):
    rule = await service.get_active_rule(session)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no active rule")
    return rule


@router.get("/{rule_id}", response_model=RuleOut)
async def get_rule(rule_id: int, session: AsyncSession = Depends(get_session)):
    rule = await service.get_rule(session, rule_id)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: int, session: AsyncSession = Depends(get_session)):
    if not await service.delete_rule(session, rule_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
