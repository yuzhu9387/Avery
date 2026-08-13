from datetime import datetime, time

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Routine(Base):
    """One version of the weekly routine.

    Versions are kept rather than overwritten, the same way rules are: at most
    one is active (enforced in `services.routines`, not by the schema), and the
    rest are history you can read and switch back to. `note` is the room to say
    why a version exists, which is the part that is impossible to reconstruct
    from its blocks later.
    """

    __tablename__ = "routines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Blocks are scoped transitively through their routine — no user_id there.
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    # When this version's *content* last changed: its name, its note, or its blocks.
    #
    # Deliberately no `onupdate=datetime.now`. Every switch of the active version
    # writes `is_active` on two rows, and `onupdate` would stamp both with "changed
    # just now" -- so the retired version would claim it had been edited when only
    # its flag flipped, and the whole list would collapse to one timestamp and
    # reshuffle on every switch. `services.routines` bumps this explicitly for the
    # changes that really are changes.
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

    blocks: Mapped[list["RoutineBlock"]] = relationship(
        back_populates="routine",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="RoutineBlock.sort_order",
    )


class RoutineBlock(Base):
    __tablename__ = "routine_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    routine_id: Mapped[int] = mapped_column(
        ForeignKey("routines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    days: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    task_name: Mapped[str] = mapped_column(String(200), nullable=False)
    tag_ids: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    routine: Mapped[Routine] = relationship(back_populates="blocks")
