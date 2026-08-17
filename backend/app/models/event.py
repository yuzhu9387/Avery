from datetime import datetime
from enum import StrEnum

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EventSource(StrEnum):
    ROUTINE = "routine"
    MANUAL = "manual"
    AGENT = "agent"
    # Mirrors of events that live on an external calendar. They are real rows in
    # `events` — that is what lets them take Avery categories, join the overlap
    # layout, and count in the ratios — but the external calendar stays the owner
    # of their times and title: edits here are pushed back (see services.events),
    # and `services.external_sync` refreshes them from the provider.
    GOOGLE = "google"
    LARK = "lark"


EXTERNAL_SOURCES = frozenset({EventSource.GOOGLE, EventSource.LARK})


class EventKind(StrEnum):
    EVENT = "event"
    TASK = "task"


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # NULL for a plain event (kind='event') that was created by name or by a
    # routine block: those no longer mint or reuse a Task. Still set for a
    # kind='task' card (1:1 with its Task) and for an event explicitly
    # scheduling an existing to-do via task_id.
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    tag_ids: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default=EventSource.MANUAL, nullable=False)
    kind: Mapped[str] = mapped_column(String(8), default=EventKind.EVENT, nullable=False)
    # A card's own completion, distinct from Task.status: an appointment happening is
    # not a to-do being finished. Only kind="task" cards sync the two (see services).
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    routine_block_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The provider's own id for a mirrored external event; NULL on native events.
    # The upsert key for sync is (user_id, source, external_id).
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Day markers (holidays, "no school") from external calendars. Excluded from
    # every time-accounting computation and drawn as a banner, not a block.
    all_day: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)

    @property
    def duration_minutes(self) -> int:
        return int((self.end_at - self.start_at).total_seconds() // 60)
