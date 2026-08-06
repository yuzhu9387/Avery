# Avery backend

FastAPI + async SQLAlchemy + SQLite. Single user, no auth.

## Setup

```bash
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env
```

## Run

```bash
.venv/bin/uvicorn app.main:app --reload --port 8001
```

Interactive API docs: http://localhost:8001/docs

**Use port 8001, not 8000.** On this machine a Docker container listens on `*:8000`
over the IPv6 wildcard and answers on both `localhost` and `127.0.0.1`. A backend
started on 8000 is shadowed by it — requests appear to succeed but are silently
answered by the unrelated container, not by Avery. The frontend's dev proxy already
expects the backend on 8001; see `../frontend/README.md` for the UI, which proxies
`/api` there.

## First run

```bash
curl -X POST 127.0.0.1:8001/api/seed
```

Creates the eight tags, the 6:3:1 rule, and the default weekly template.

## Test

```bash
.venv/bin/pytest -v
```

### If native imports fail with "incompatible architecture"

On Apple Silicon the framework interpreter is a universal binary, so it can start as
either `arm64` or `x86_64`. The installed wheels are `arm64`, so an `x86_64` launch fails
on `pydantic_core` and any other compiled extension. Force the native architecture:

```bash
arch -arm64 .venv/bin/python -m pytest -v
```

## Migrations

```bash
.venv/bin/alembic revision --autogenerate -m "describe change"
.venv/bin/alembic upgrade head
```

## Layout

- `app/services/` — all business logic. Routers and (later) agent tools are thin
  adapters over it, so the REST API and natural-language paths cannot diverge.
- `app/services/analytics.py` — pure: no I/O, no ORM imports. The rule math lives
  here and is covered exhaustively in `tests/test_analytics.py`.
- Rules are append-only versions; reports are append-only and snapshot the rule
  active at generation time.
