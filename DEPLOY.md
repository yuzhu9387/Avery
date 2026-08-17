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

**⚠️ First deploy only — the migration bootstrap problem.** Read this before
your very first deploy against a brand-new, empty Cloud SQL database; it does
not apply to any deploy after the first.

## 4. First-deploy bootstrap (empty database only)

`docker-entrypoint.sh` runs `alembic upgrade head` before starting the
server. One migration in the chain, `0251ebefc744_require_user_id`, refuses
to run unless at least one row exists in `users` — its job is enforcing
`user_id NOT NULL` on every user-scoped table, and it needs a real user to
attach any legacy orphaned rows to before doing so. On a genuinely empty
database there is no such user yet, and the migration deliberately raises
rather than guessing (see the migration's docstring). **This means a
container can never start cleanly against a brand-new Cloud SQL database as
committed today** — the entrypoint's `alembic upgrade head` fails, the
revision never becomes healthy, and Cloud Run has no live instance to take
the signup request that would create the first user. This is a real gap, not
a Postgres-portability issue (it reproduces identically against a fresh
SQLite file) — it was out of scope for the Postgres-support work here to fix
by loosening a data-safety guard, so it's called out here instead of bodged.

Work around it once, on the very first deploy against a fresh database:

```bash
# 1. Deploy with the entrypoint overridden to stop one revision short —
#    schema created, but before user_id is made NOT NULL. Everything else
#    (all 14 other revisions) runs and the app is fully usable at this point.
gcloud run deploy avery \
  --source=. \
  --region=REGION \
  --command=alembic --args=upgrade,c9d2e85b3a11 \
  --add-cloudsql-instances=PROJECT_ID:REGION:avery-db \
  --set-secrets=DATABASE_URL=avery-database-url:latest \
  --execute-now   # or: run as a Cloud Run Job instead of a service revision

# 2. Deploy the real service normally (the command in step 3 above, no
#    --command override) so it's live and taking traffic.

# 3. Create the first account through the running app:
curl -X POST https://YOUR-SERVICE-URL/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","name":"You","password":"..."}'

# 4. Finish the migration, now that a user exists:
gcloud run jobs execute avery-migrate \
  --image=IMAGE_URL --command=alembic --args=upgrade,head \
  # or run `alembic upgrade head` locally via the Cloud SQL Auth Proxy

# 5. Every deploy from now on is just `gcloud run deploy` as in step 3 —
#    `alembic upgrade head` on startup is a no-op once the database is
#    already current.
```

If you'd rather not do this dance: the cleanest permanent fix is loosening
`0251ebefc744`'s guard to check "are there any NULL `user_id` rows across the
partitioned tables" instead of "does any user exist at all" — a fresh,
all-empty database has nothing to backfill and could apply the `NOT NULL`
constraint immediately with no user required. That's a real code change
(business logic, not portability) and wasn't made here; flagging it as the
recommended follow-up rather than making it silently.

## 5. Wire up GitHub continuous deployment

In the Cloud Console: **Cloud Run → avery → Edit & Deploy New Revision →
Continuously deploy from a repository → Set up with Cloud Build**. Point it
at `yuzhu9387/Avery`, branch `main`, build type "Dockerfile" (repo root).
Every push to `main` then triggers a Cloud Build build + Cloud Run deploy
automatically. Keep `--add-cloudsql-instances` and `--set-secrets` — the
trigger's generated `cloudbuild.yaml` / Cloud Run service config carries
those forward from the current revision; check they're still present after
setting the trigger up once, since some flows reset them to defaults.

## 6. Update OAuth redirect URIs

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

## 7. Seed data

Once you have an account (step 4.3, or by signing up through the deployed
UI), seed the default tags/rules/routine as that user:

```bash
# Sign in first to get a session cookie, then:
curl -X POST https://YOUR-SERVICE-URL/api/seed --cookie "avery_session=..."
```

or just click through the seed flow in the UI if one exists — `/api/seed`
requires an authenticated user (`get_current_user`), so there's no
unauthenticated bootstrap path here either.

---

## What's not solved: the scheduler

`ENABLE_SCHEDULER` defaults to `false` in the container image (see
`Dockerfile`). Cloud Run scales to zero and may run multiple instances of the
same revision concurrently; an in-process APScheduler job (the weekly
routine roll, the reminder sweep) would then fire zero times (nothing
running when the cron tick happens) or N times (N instances all firing at
once), neither of which is the once-only semantics the job needs.

The correct replacement — **not built as part of this work** — is:

1. Add an internal HTTP endpoint (e.g. `POST /api/internal/week-roll`) that
   runs `roll_next_week` / `sweep_reminders` from `app/scheduler/jobs.py`
   directly, guarded so it isn't publicly callable (a shared secret header,
   or restricting ingress and using OIDC-authenticated
   Cloud-Scheduler-to-Cloud-Run invocation).
2. Create a **Cloud Scheduler** job that HTTP-POSTs to that endpoint on the
   same cron schedule the in-process job used
   (`CronTrigger(day_of_week="sun", hour=WEEK_ROLL_HOUR)` for the roll,
   `*/15` for the reminder sweep).

Until that exists, the weekly roll and reminder sweep simply don't run in
the deployed environment — local dev (where `ENABLE_SCHEDULER` still
defaults to `true`) is unaffected.

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
