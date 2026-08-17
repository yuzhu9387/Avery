# Deploying Avery to Cloud Run + Cloud SQL

Avery runs as a single Cloud Run service: the FastAPI backend serves both the
`/api/*` routes and the built React frontend (see `backend/app/main.py`).
State lives in a Cloud SQL Postgres instance, reached over the Cloud SQL Unix
socket rather than a public IP.

This is a runbook, not a script — read it once before running commands.
Replace `PROJECT_ID`, `REGION`, and the resource names below with your own.

---

## 0. One-time gcloud setup

```bash
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com
```

## 1. Create the Cloud SQL instance, database, and user

```bash
gcloud sql instances create avery-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=REGION \
  --storage-size=10GB \
  --storage-auto-increase

gcloud sql databases create avery --instance=avery-db

gcloud sql users create avery_app \
  --instance=avery-db \
  --password="$(openssl rand -base64 24)"   # copy this once — see step 2
```

Note the fully-qualified instance connection name:

```bash
gcloud sql instances describe avery-db --format='value(connectionName)'
# -> PROJECT_ID:REGION:avery-db
```

`db-f1-micro` is the smallest tier and fine for one user's schedule data;
bump it if you plan on real concurrent load.

## 2. Store secrets in Secret Manager

Never put actual values in this file, in shell history that gets committed,
or in `--set-env-vars`. Create empty-named secrets and feed them values
interactively:

```bash
echo -n "postgresql+asyncpg://avery_app:PASSWORD@/avery?host=/cloudsql/PROJECT_ID:REGION:avery-db" \
  | gcloud secrets create avery-database-url --data-file=-

echo -n "GOOGLE_CLIENT_SECRET_VALUE" | gcloud secrets create avery-google-client-secret --data-file=-
echo -n "LARK_APP_SECRET_VALUE"     | gcloud secrets create avery-lark-app-secret --data-file=-
```

Secrets referenced by the deploy command below (names only, no values live in
this repo or this file beyond the literal secret *names* above):

| Secret name                     | Maps to env var         |
|----------------------------------|--------------------------|
| `avery-database-url`             | `DATABASE_URL`           |
| `avery-google-client-secret`     | `GOOGLE_CLIENT_SECRET`   |
| `avery-lark-app-secret`          | `LARK_APP_SECRET`        |

`GOOGLE_CLIENT_ID` and `LARK_APP_ID` aren't secret — pass them as plain
`--set-env-vars` instead of Secret Manager entries if you'd rather not create
secrets for them.

## 3. Deploy

```bash
gcloud run deploy avery \
  --source=. \
  --region=REGION \
  --allow-unauthenticated \
  --add-cloudsql-instances=PROJECT_ID:REGION:avery-db \
  --set-env-vars=GOOGLE_CLIENT_ID=...,LARK_APP_ID=...,OAUTH_REDIRECT_BASE=https://avery-xxxxx-REGION.a.run.app \
  --set-secrets=DATABASE_URL=avery-database-url:latest,GOOGLE_CLIENT_SECRET=avery-google-client-secret:latest,LARK_APP_SECRET=avery-lark-app-secret:latest \
  --min-instances=0 \
  --max-instances=2
```

`--source=.` has Cloud Build build the repo's `Dockerfile` remotely (no local
Docker needed); swap for `--image=IMAGE_URL` if you build and push yourself.

`OAUTH_REDIRECT_BASE` needs the service's real URL, which you only learn
*after* the first deploy. Deploy once without OAuth configured (or with a
placeholder), copy the printed URL, then redeploy (`gcloud run services
update avery --set-env-vars=OAUTH_REDIRECT_BASE=...`) once you know it — or
set up a custom domain first and use that from the start so it never has to
change.

`docker-entrypoint.sh` runs `alembic upgrade head` before starting the
server, so the very first deploy against a brand-new, empty Cloud SQL
database applies the entire migration chain — including
`0251ebefc744_require_user_id`, which enforces `user_id NOT NULL` on every
user-scoped table — with no existing account and no manual bootstrap step.
That migration only requires a user to exist when there's orphaned legacy
data (a NULL `user_id` row) that needs attaching to one; a fresh, empty
database has nothing to backfill, so it applies the constraint immediately
and the container reaches a healthy state on the first try. (See the
migration's docstring for the full three-way guard: empty database, no user
needed; NULL rows with a user present, backfilled as before; NULL rows with
no user, still refuses to guess.) Just sign up through the deployed UI once
the service is live to create the first account.

## 4. Wire up GitHub continuous deployment

In the Cloud Console: **Cloud Run → avery → Edit & Deploy New Revision →
Continuously deploy from a repository → Set up with Cloud Build**. Point it
at `yuzhu9387/Avery`, branch `main`, build type "Dockerfile" (repo root).
Every push to `main` then triggers a Cloud Build build + Cloud Run deploy
automatically. Keep `--add-cloudsql-instances` and `--set-secrets` — the
trigger's generated `cloudbuild.yaml` / Cloud Run service config carries
those forward from the current revision; check they're still present after
setting the trigger up once, since some flows reset them to defaults.

## 5. Update OAuth redirect URIs

Once the service has a stable URL (or custom domain), register the exact
callback URL in each provider's console — this only needs doing once, or
again if the URL changes:

- **Google Cloud Console → APIs & Services → Credentials** → your OAuth
  client → Authorized redirect URIs → add
  `https://YOUR-SERVICE-URL/api/auth/oauth/google/callback`
- **Lark/Feishu Developer Console** → your app → Security settings →
  Redirect URLs → add
  `https://YOUR-SERVICE-URL/api/auth/oauth/lark/callback`

(See `docs/OAUTH_SETUP.md` for the full walkthrough of creating these apps
in the first place — this step just updates the redirect URI to the deployed
URL instead of `localhost:5173`.)

## 6. Seed data

Once you have an account (by signing up through the deployed UI), seed the
default tags/rules/routine as that user:

```bash
# Sign in first to get a session cookie, then:
curl -X POST https://YOUR-SERVICE-URL/api/seed --cookie "avery_session=..."
```

or just click through the seed flow in the UI if one exists — `/api/seed`
requires an authenticated user (`get_current_user`), so there's no
unauthenticated bootstrap path here either.

---

## 7. The scheduler: Cloud Scheduler + HTTP job endpoints

`ENABLE_SCHEDULER` defaults to `false` in the container image (see
`Dockerfile`) and stays that way in production. Cloud Run scales to zero and
may run multiple instances of the same revision concurrently, so an
in-process APScheduler job (the weekly routine roll, the reminder sweep)
would fire zero times (nothing running when the cron tick happens) or N
times (N instances all firing at once), never the once-only semantics the
job needs. Locally, `ENABLE_SCHEDULER` still defaults to `true` — APScheduler
keeps working for anyone running Avery on their laptop without any of this.

In the deployed environment, `app/routers/jobs.py` exposes the same two job
functions over HTTP instead, and **Cloud Scheduler** calls them directly:

- `POST /api/jobs/roll-week` → `roll_next_week`
- `POST /api/jobs/sweep-reminders` → the reminder sweep

Both endpoints are idempotent (materialize_week skips any day that already
has an event; the reminder sweep only ever selects `sent_at IS NULL` rows),
so a Cloud Scheduler retry or an overlapping run is harmless. Both accept an
optional date/time override in the JSON body (`{"today": "..."}`,
`{"now": "..."}`) for replaying a specific run; Cloud Scheduler's normal
calls should send `{}` and let the endpoint use the real clock.

### Auth: a shared secret, checked in constant time

These endpoints mutate every user's data and run with no user attached to
the request, so they sit behind a dedicated secret — `JOBS_TOKEN` — instead
of the normal cookie/agent-token auth. The caller sends it as the
`X-Jobs-Token` header; `app/deps.py`'s `verify_jobs_token` compares it with
`hmac.compare_digest`. If `JOBS_TOKEN` is unset, both endpoints return **503**
and never call the job function — "no token configured" must never silently
mean "no auth required".

Store it in Secret Manager like the other secrets:

```bash
echo -n "$(openssl rand -base64 32)" | gcloud secrets create avery-jobs-token --data-file=-
```

and add it to the deploy command's `--set-secrets`:

```bash
--set-secrets=...,JOBS_TOKEN=avery-jobs-token:latest
```

### The container's timezone

Avery stores and compares **naive local** datetimes everywhere — `date.today()`
chooses the day a week rolls into, `datetime.now()` stamps each reminder sweep,
and events carry no offset. A container defaults to UTC, so an image without a
timezone silently treats UTC as local: evening events land on the following
day, and a Sunday-20:00 roll fires Saturday afternoon Pacific.

`Dockerfile` therefore sets it:

```
ENV TZ=America/Los_Angeles
```

It lives in the image, not in `--set-env-vars`, for two reasons: a fresh deploy
following this runbook gets it without a step to forget, and `--set-env-vars`
*replaces* the whole variable set, so a later unrelated env change can't quietly
drop it. Use `--update-env-vars` when changing one variable, and if you do
override `TZ` on the service, that value wins over the image's.

Change the zone here **and** in the two Cloud Scheduler jobs below — they are
separate clocks, and a mismatch between them is exactly the kind of bug that
only shows up one hour a year, at a DST boundary.

### Create the two Cloud Scheduler jobs

Same cadence the in-process scheduler used to run
(`CronTrigger(day_of_week="sun", hour=WEEK_ROLL_HOUR)` for the roll, `*/15`
for the sweep) — adjust the timezone and hour to match `WEEK_ROLL_HOUR`
**and the image's `TZ`**:

```bash
JOBS_TOKEN=$(gcloud secrets versions access latest --secret=avery-jobs-token)
SERVICE_URL=https://YOUR-SERVICE-URL

gcloud scheduler jobs create http avery-roll-week \
  --schedule="0 20 * * 0" \
  --time-zone="America/Los_Angeles" \
  --uri="$SERVICE_URL/api/jobs/roll-week" \
  --http-method=POST \
  --headers="X-Jobs-Token=$JOBS_TOKEN,Content-Type=application/json" \
  --message-body="{}"

gcloud scheduler jobs create http avery-sweep-reminders \
  --schedule="*/15 * * * *" \
  --time-zone="America/Los_Angeles" \
  --uri="$SERVICE_URL/api/jobs/sweep-reminders" \
  --http-method=POST \
  --headers="X-Jobs-Token=$JOBS_TOKEN,Content-Type=application/json" \
  --message-body="{}"
```

Don't put `$JOBS_TOKEN` in shell history that gets committed anywhere — pull
it fresh from Secret Manager as above rather than pasting the literal value.

### Stronger alternative: OIDC instead of a shared secret

The shared secret above is what's needed because step 3 deploys with
`--allow-unauthenticated`, so the endpoints are reachable by anyone who has
the URL and must gate themselves. If the service is instead made private
(drop `--allow-unauthenticated`, restrict ingress), Cloud Scheduler's HTTP
target can authenticate with an **OIDC identity token** instead
(`--oidc-service-account-email=...`), verified by Cloud Run's platform layer
before the request reaches the app at all — no header, no app-level secret
to rotate or leak. That's a stronger setup but means the whole service (not
just `/api/jobs/*`) stops being publicly reachable, which is a bigger change
than this task made; noting it here as the natural next step rather than
building it now.

### What's still not addressed

Reminder *delivery* (actually notifying the user — Lark, push, etc.) is
still a stub; `sweep_reminders` only marks reminders sent, per its own
docstring ("Lark delivery is wired in during Plan 3"). Wiring up Cloud
Scheduler makes the sweep run on a real cadence in production; it doesn't by
itself make the sweep do anything more than it already did.

## Rough monthly cost

For one user, light traffic:

- **Cloud Run**: `min-instances=0`, pay-per-request. Comfortably inside the
  free tier (2M requests, 360k GB-seconds/month) for personal use — likely
  **$0**.
- **Cloud SQL** `db-f1-micro`, 10 GB SSD: roughly **$9–12/month** compute +
  ~**$1.70/month** storage ≈ **$10–15/month**. This is the dominant cost and
  the instance runs continuously (Cloud SQL has no scale-to-zero).
- **Secret Manager**: 3 secrets × ~$0.06/secret/month, well under the free
  access-operation allotment — effectively **$0**.

**Total: roughly $10–15/month**, almost entirely Cloud SQL. Scales up if you
raise `--max-instances`, move off `db-f1-micro`, or add real traffic.
