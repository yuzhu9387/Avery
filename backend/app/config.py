from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent
# Vite's build output. Present in a container image (the Dockerfile copies the
# built frontend here, as a sibling of backend/) and absent in local dev,
# where Vite's own dev server serves the UI on :5173 instead.
FRONTEND_DIST_DIR = PROJECT_DIR / "frontend" / "dist"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///data/avery.db"
    enable_scheduler: bool = True
    week_roll_hour: int = 20  # Sunday 20:00 local

    # OAuth (empty = provider not configured; /oauth/{provider}/start answers 501).
    google_client_id: str = ""
    google_client_secret: str = ""
    lark_app_id: str = ""
    lark_app_secret: str = ""
    # Where the browser lands after an OAuth round-trip — the frontend origin.
    # The provider-facing redirect_uri is derived from it too
    # ({base}/api/auth/oauth/{provider}/callback), which works because the
    # frontend dev server proxies /api to this backend.
    oauth_redirect_base: str = "http://localhost:5173"

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
