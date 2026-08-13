from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Only value accepted today. Kept here (not just in deps.py) so the create
# schema can validate at the door instead of letting a typo become a token
# that get_current_user rejects on every single use. deps.py enforces this
# again independently at resolve time — a belt-and-suspenders guard, since a
# row could in principle exist with some other workspace (a manual DB edit, a
# future migration) and must still be rejected there regardless of what this
# schema ever allowed in.
SUPPORTED_WORKSPACES = ("personal",)


class AgentTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    workspace: str = Field(default="personal", max_length=32)

    @field_validator("workspace")
    @classmethod
    def check_workspace(cls, value: str) -> str:
        if value not in SUPPORTED_WORKSPACES:
            raise ValueError(f"unsupported workspace: {value!r}")
        return value


class AgentTokenOut(BaseModel):
    """Never carries the hash or the plaintext — this is the shape used for both
    the list endpoint and the non-secret half of the issue response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    workspace: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class AgentTokenIssued(AgentTokenOut):
    """Returned only from POST, only once. `token` is the one and only time the
    plaintext exists outside the caller's hands — Avery does not keep it."""

    token: str
