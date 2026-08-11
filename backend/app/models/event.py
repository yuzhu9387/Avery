from datetime import datetime
from enum import StrEnum

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EventSource(StrEnum):
    ROUTINE = "routine"
    MANUAL = "manual"
    AGENT = "agent"


class EventKind(StrEnum):
    EVENT = "event"
    TASK = "task"


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    tag_ids: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default=EventSource.MANUAL, nullable=False)
    kind: Mapped[str] = mapped_column(String(8), default=EventKind.EVENT, nullable=False)
    # A card's own completion, distinct from Task.status: an appointment happening is
    # not a to-do being finished. Only kind="task" cards sync the two (see services).
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    routine_block_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)

    @property
    def duration_minutes(self) -> int:
        return int((self.end_at - self.start_at).total_seconds() // 60)
