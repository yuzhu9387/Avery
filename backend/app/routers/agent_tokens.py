from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.deps import get_current_user
from app.models import User
from app.schemas.agent_token import AgentTokenCreate, AgentTokenIssued, AgentTokenOut
from app.services import agent_auth

# Cookie-authenticated only: these are managed from the Avery UI by the human
# who owns the account, not by the agent tokens themselves — an agent token
# minting more agent tokens would make revocation meaningless, since a caller
# that got compromised could just re-arm itself.
router = APIRouter(prefix="/api/agent-tokens", tags=["agent-tokens"])


@router.post("", response_model=AgentTokenIssued, status_code=status.HTTP_201_CREATED)
async def issue_agent_token(
    data: AgentTokenCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    row, plaintext = await agent_auth.issue(
        session, user, name=data.name, workspace=data.workspace
    )
    # `token` only ever appears in this one response body. AgentTokenOut (what
    # every other endpoint returns) has no field for it at all.
    return AgentTokenIssued(
        id=row.id,
        name=row.name,
        workspace=row.workspace,
        created_at=row.created_at,
        last_used_at=row.last_used_at,
        revoked_at=row.revoked_at,
        token=plaintext,
    )


@router.get("", response_model=list[AgentTokenOut])
async def list_agent_tokens(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return await agent_auth.list_for_user(session, user)


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_agent_token(
    token_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    revoked = await agent_auth.revoke(session, user, token_id)
    if not revoked:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "agent token not found")
