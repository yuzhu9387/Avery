from datetime import datetime, time

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Routine(Base):
    __tablename__ = "routines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

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
