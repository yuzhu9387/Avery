# syntax=docker/dockerfile:1

# ---- Stage 1: build the frontend ------------------------------------------
FROM node:20-slim AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend + runtime --------------------------------------------
FROM python:3.12-slim AS runtime

# Postgres client libs aren't needed: asyncpg is a pure-C-extension wheel with
# no libpq dependency, and there is no compiler here (no build toolchain in
# the final image) -- pip installs prebuilt wheels for every dependency.
RUN groupadd --system avery && useradd --system --gid avery --create-home avery

WORKDIR /app/backend

# setuptools' package-discovery needs app/ and mcp_server/ present to build the
# wheel, so unlike a requirements.txt-based image this can't install
# dependencies from pyproject.toml alone before the rest of the source lands
# -- copy everything (app/, alembic/, alembic.ini, mcp_server/), then install.
COPY backend/ ./
RUN pip install --no-cache-dir . \
    && chmod +x docker-entrypoint.sh

# Built frontend, placed as a sibling of backend/ -- app.config.FRONTEND_DIST_DIR
# is `<repo root>/frontend/dist`, mirroring the local dev layout exactly.
COPY --from=frontend-build /src/frontend/dist /app/frontend/dist

# Writable in case DATABASE_URL is left unset and the app falls back to its
# default SQLite path; Cloud Run always sets DATABASE_URL to Postgres in
# practice (see DEPLOY.md), so this is a safety net, not the intended path.
RUN mkdir -p /app/data && chown -R avery:avery /app

USER avery

# Cloud Run injects $PORT (default 8080 here matches Cloud Run's default) and
# expects the process to bind 0.0.0.0, not 127.0.0.1.
ENV PORT=8080
# Cloud Run scales to zero and may run multiple instances concurrently, so an
# in-process APScheduler job would then fire zero or N times instead of
# exactly once. Off by default here; local dev's Settings default (true) is
# unaffected since that default lives in code, not this image. See DEPLOY.md
# for the Cloud Scheduler replacement.
ENV ENABLE_SCHEDULER=false
# Avery stores and compares naive local datetimes throughout -- `date.today()`
# picks the day a week rolls into, `datetime.now()` stamps every reminder sweep.
# A container defaults to UTC, so without this the app silently treats UTC as
# local: evening events land on the following day, and the Sunday roll fires on
# Saturday afternoon Pacific. Baked into the image rather than left as a Cloud
# Run env var so a fresh deploy from DEPLOY.md cannot miss it and a stray
# `--set-env-vars` (which replaces the whole set) cannot drop it.
# `python:3.12-slim` ships tzdata, so this resolves rather than falling back to
# UTC -- verified: TZ=America/Los_Angeles gives time.tzname ('PST', 'PDT').
ENV TZ=America/Los_Angeles

EXPOSE 8080

CMD ["./docker-entrypoint.sh"]
