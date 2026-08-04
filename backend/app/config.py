from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///data/avery.db"
    enable_scheduler: bool = True
    week_roll_hour: int = 20  # Sunday 20:00 local

    def resolved_database_url(self) -> str:
        """Rewrite a relative sqlite path to an absolute one under the project dir."""
        prefix = "sqlite+aiosqlite:///"
        if not self.database_url.startswith(prefix):
            return self.database_url
        raw = self.database_url[len(prefix) :]
        if raw == ":memory:" or raw.startswith("/"):
            return self.database_url
        target = (PROJECT_DIR / raw).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        return f"{prefix}{target}"


settings = Settings()
