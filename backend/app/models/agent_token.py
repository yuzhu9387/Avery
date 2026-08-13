from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AgentToken(Base):
    """A long-lived credential for a machine client (the MCP server, not a browser).

    Unlike AuthSession, which stores its session token in plaintext because it is
    short-lived and server-generated end to end, an agent token is handed to a
    process outside our control and lives for a long time — so only its hash is
    stored. `data/` already has several `avery.db.bak-*` files lying around; if the
    plaintext were in the row, a stale backup would hand out working credentials
    forever. `workspace` rides on the token itself (never on the request body) so a
    caller cannot assert its own scope — see app/deps.py::get_current_user for the
    fail-closed check that depends on that.
    """

    __tablename__ = "agent_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Human label, e.g. "Claude Code — personal". Purely descriptive.
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    workspace: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
