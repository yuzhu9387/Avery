#!/bin/sh
# Cloud Run entrypoint: apply pending migrations, then start the server.
#
# Migrations run on every container start, which is safe because Alembic
# revisions are idempotent (each just moves the schema from its declared
# down_revision to itself) -- a container that starts against an
# already-current database is a no-op here. Cloud Run may start several
# instances concurrently on a fresh deploy; if that ever becomes a problem in
# practice, move this to a separate one-off `gcloud run jobs execute` step
# instead of running it from every instance's entrypoint.
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Starting server on port ${PORT:-8080}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}"
