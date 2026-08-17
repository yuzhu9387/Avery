from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CalendarConnection(Base):
    """One granted calendar consent: a user, a provider, and the tokens for it.

    Deliberately NOT columns on `users`. Signing in with Google and letting
    Avery read your Google Calendar are two separate consents: either can be
    granted or revoked without the other, and one account may eventually hold
    several calendar accounts. A row here means "calendar access granted";
    `users.google_sub` means "this Google identity signs in here". Deleting the
    row disconnects the calendar and leaves sign-in untouched.
    """

    __tablename__ = "calendar_connections"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "provider",
            "external_account_email",
            name="uq_calendar_connections_user_provider_account",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    # Which account on the provider's side the tokens belong to. NULL when the
    # provider would not tell us (the calendar scopes alone carry no identity).
    external_account_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    # NULL when the provider withheld one — see services.google_calendar for
    # what that costs us.
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Space-separated, exactly as the provider returned them.
    scopes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.now, onupdate=datetime.now, nullable=False
    )
