from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


def enable_sqlite_foreign_keys(target: AsyncEngine) -> None:
    """Enable SQLite foreign key constraints by setting the pragma on each connection.

    SQLite has foreign_keys OFF by default. This listener registers a pragma
    statement that fires on every connection to enforce ON DELETE CASCADE.
    """
    @event.listens_for(target.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        if target.url.drivername.startswith("sqlite"):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()


engine = create_async_engine(settings.resolved_database_url(), echo=False)
enable_sqlite_foreign_keys(engine)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async_session_factory = SessionLocal
