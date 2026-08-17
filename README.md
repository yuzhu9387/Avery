# Avery

A personal schedule agent that holds the three things you can't hold in your head at once:

- **what a normal week looks like** — a *routine*, your recurring blocks
- **what actually happened** — real calendar events, which always drift from the routine
- **what should be true over a month** — a *rule*, a ratio you commit to in advance

Avery is not a calendar. It's a feedback loop: the routine stamps out a week, the week records
reality, and the ratio tells you whether reality matched what you said mattered. Then you adjust
either your behaviour or the rule.

It runs entirely on your machine — a FastAPI backend over SQLite, a React calendar, and an MCP
server so an assistant like Claude can read and change your schedule in conversation.

---

## Contents

- [What's in the box](#whats-in-the-box)
- [Concepts](#concepts)
- [Features](#features)
- [Install — the web app](#install--the-web-app)
- [Install — the MCP server](#install--the-mcp-server)
- [Connecting Google / Lark calendars](#connecting-google--lark-calendars)
- [API surface](#api-surface)
- [Tests](#tests)
- [Known gaps](#known-gaps)

---

## What's in the box

```
backend/          FastAPI + async SQLAlchemy + SQLite + Alembic
  app/            models, routers, services, scheduler
  mcp_server/     stdio MCP server exposing 4 intent-shaped tools
  tests/          pytest (308 passing)
frontend/         React 19 + TypeScript + Vite + Tailwind 4
  src/            pages, components, hooks, pure-logic lib (133 vitest passing)
docs/             design specs, plans, backlog, OAuth setup
data/             your SQLite database lives here (git-ignored)
```

---

## Concepts

Four nouns. Getting these straight makes everything else obvious.

| | |
|---|---|
| **Routine** | A named, versioned weekly template. Contains **routine blocks** — "Work, Mon–Fri 09:30–16:30". One routine is active; materialising a week stamps its blocks out as real events. |
| **Event** | One slot on the calendar. Owns its own `title`. Has a `kind`: an **event** is time you spent, a **task** is a to-do with a slot and a checkbox. |
| **Task** | A to-do. Has a due date, a status, and optionally a scheduled event. A task with no event is just a to-do you haven't planned yet. |
| **Rule** | A versioned ratio target — e.g. 6 : 3 : 1 across *Work & Study* / *Family care* / *Fitness*, with a tolerance. Editing a rule closes the old version and opens a new one, so old reports still mean what they meant. |

Events carry **categories** (tags) with colours, which is what the ratio maths groups on.

Two things worth internalising:

- **Times are naive local wall-clock.** `2026-08-12T15:00:00` — no timezone, no `Z`. The API rejects
  timezone-suffixed input rather than guessing.
- **Routine-born events are background.** They render as tinted bands behind real events, and are
  read-only on the calendar — you edit the *block*, and the change applies to every occurrence.

---

## Features

### Calendar

- **Week view** — full 24 hours, opens scrolled to 07:00. Trackpad **pinch to zoom** (0.5×–3×),
  anchored at the pointer, with both scrollbars appearing as the grid grows.
- **Overlapping events sit side by side** rather than hiding each other. Each card expands into
  whatever columns are genuinely free at its own time, so one long background block doesn't shred
  the whole day into slivers.
- **Routine bands** render behind everything, inert to clicks — so the time they cover is still
  free for quick-create.
- **Month view** with per-day event counts and a stacked tag-proportion bar; click a day for its
  schedule in a side panel.
- **Mini month** in the sidebar for jumping weeks; it follows the grid but never fights your paging.

### Working with events

- **Quick-create** — click any empty grid space (including the 12px strip beside an existing card,
  so you can book over a busy hour). Pick Event or Task, set the time, choose a category.
- **Gestures** on a card: move it to drag; single click opens its detail page; double-click marks it
  done with a confetti burst; drag its top or bottom edge to resize. Drag and resize snap to 15
  minutes.
- **Detail page** — edit title, time (to the *minute*), category and notes. Routine-born events are
  read-only here, with a link through to the block that owns them.
- **Roll over** — at 22:00 Avery offers to move today's unfinished task cards to tomorrow, keeping
  their wall-clock time. Events never move; only to-dos.

### Categories

Create, edit and delete categories from the sidebar — name, colour, description. Deleting one that's
still in use is refused with a count ("12 event(s) still use this category") and archiving offered
instead, so historical hour totals are never silently rewritten. Toggle any category's visibility;
**Hide routine** strips every routine-generated block out of the view in one click. Your selection
survives a reload.

Hiding only changes what's *drawn* — ratios, month aggregates and reports always count everything.

### Routine

Multiple named versions, one active. Fork the active version to start a new one, preview what a week
*would* materialise without writing anything, then activate. Materialising skips any day that already
has events, so it never stomps on work you've already done.

### Rules and analytics

Versioned ratio targets with a tolerance band. The evaluator sums minutes per tag, drops excluded
tags, rolls them into groups, and returns a verdict per group — *on target*, *over*, *under*. It
handles cross-midnight events, zero-ratio groups, untagged time and overlapping events (reported as
warnings rather than silently deduplicated).

The week sidebar shows live progress against the active rule.

### Tasks

Grouped by due date — ascending, with a trailing "no due date" bucket — paginated, with completed
tasks struck through in their own section. A task's due date falls back to the end of its latest
scheduled event when not set explicitly.

### Accounts

Email + password (scrypt) or Google / Lark OAuth sign-in. Sessions are opaque tokens in an httponly
cookie with a 30-day sliding window. **Every API route requires authentication.**

### Reminders

Set reminders against tasks; a background job sweeps every 15 minutes and marks them due. A second
job rolls next week's routine every Sunday.

---

## Install — the web app

### Requirements

- **Python 3.11+** (check with `python3 --version` — 3.10 will not work)
- **Node 20+**

### Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env
.venv/bin/alembic upgrade head
```

Run it — **on port 8001, not 8000**:

```bash
.venv/bin/uvicorn app.main:app --reload --port 8001
```

> **Apple Silicon:** prefix every backend command with `arch -arm64`
> (`arch -arm64 .venv/bin/uvicorn …`). The venv's Python is a universal binary that can launch as
> x86_64 while the installed wheels are arm64-only; the mismatch surfaces as a confusing
> `incompatible architecture` ImportError on `pydantic_core` that looks like a code bug.

> **Why 8001:** port 8000 is commonly occupied by a Docker container binding the IPv6 wildcard,
> which silently shadows anything you start there on both `localhost` and `127.0.0.1`. The frontend
> proxy and the MCP server both default to 8001.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to `127.0.0.1:8001`.

### First run

1. Open the app and **create an account** — the API is authenticated, so nothing works until you do.
2. Seed the starter data — eight categories, a 6:3:1 rule, and a default weekly routine. From the
   browser console while signed in:

   ```js
   await fetch('/api/seed', { method: 'POST' }).then(r => r.json())
   ```

   (Seeding is per-user and idempotent — running it twice creates nothing the second time.)
3. Go to the week view. It materialises the current week from your routine on first read.

### Environment variables

All optional unless you want OAuth. Names only — set values in `backend/.env`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite path; defaults to `data/avery.db` |
| `ENABLE_SCHEDULER` | Turn the background jobs on/off |
| `WEEK_ROLL_HOUR` | Local hour on Sunday to materialise next week |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in + calendar |
| `LARK_APP_ID` / `LARK_APP_SECRET` | Lark sign-in + calendar |
| `OAUTH_REDIRECT_BASE` | Base URL OAuth providers redirect back to |

---

## Install — the MCP server

Lets an MCP client (Claude Code, Claude Desktop, …) read and change your schedule in conversation.
It talks to the same HTTP API over stdio, authenticating with an **agent token**.

### 1. Issue an agent token

There is **no UI for this yet**. With the backend running and while signed in to the web app, open
the browser console and run:

```js
await fetch('/api/agent-tokens', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'claude', workspace: 'personal' }),
}).then(r => r.json())
```

Copy the `token` field. **It is shown exactly once** — only its hash is stored. Revoke it later with
`DELETE /api/agent-tokens/{id}`.

### 2. Point your client at the server

Copy `.mcp.json.example` to `.mcp.json`, replace the two absolute paths and paste your token:

```json
{
  "mcpServers": {
    "avery": {
      "command": "/absolute/path/to/avery/backend/.venv/bin/python",
      "args": ["-m", "mcp_server"],
      "cwd": "/absolute/path/to/avery/backend",
      "env": {
        "AVERY_BASE_URL": "http://127.0.0.1:8001",
        "AVERY_AGENT_TOKEN": "paste-the-token-here"
      }
    }
  }
}
```

`.mcp.json` is git-ignored — it holds a live credential.

### 3. Tools it exposes

Four, shaped around intent rather than mirroring the REST API:

| Tool | What it does |
|---|---|
| `avery_today(date?)` | One call for "what's my day" — that day's schedule, open to-dos, and anything overdue |
| `avery_schedule(title, start_at, end_at, …)` | Books a calendar event |
| `avery_capture_task(name, due_date?, …)` | Records a to-do with no slot |
| `avery_complete(event_id? \| task_id?)` | Marks exactly one thing done |

All of them require naive-local datetimes (`2026-08-12T15:00:00`) and reject timezone suffixes
outright rather than guessing what you meant.

The server fails loudly at startup if `AVERY_AGENT_TOKEN` is missing, rather than on the first tool
call.

---

## Connecting Google / Lark calendars

See [`docs/OAUTH_SETUP.md`](docs/OAUTH_SETUP.md) for provider setup. Sign-in and calendar access are
**separate consents** — signing in with Google does not grant Avery your calendar.

Once connected, Avery **mirrors** provider events into its own table (`source: google` / `lark`),
which means **they count toward your ratios**. Edits to a mirrored Google event push back to Google;
Lark write-back is not implemented.

> `docs/OAUTH_SETUP.md` is stale on this point — it describes an earlier design where external events
> were an overlay that never entered the database and never counted. The code mirrors and counts them.
> Trust the code.

Google apps in *Testing* mode only authorise whitelisted test users, and their refresh tokens expire
after about seven days, so the connection needs periodic reconnecting.

---

## API surface

Everything is under `/api` and requires authentication (session cookie **or** `Authorization: Bearer
<agent-token>`).

| Router | Routes |
|---|---|
| `/api/auth` | signup, login, logout, me, password, OAuth start/callback/link |
| `/api/agent-tokens` | issue, list, revoke |
| `/api/tags` | CRUD + `POST /{id}/archive` (delete 409s when in use) |
| `/api/tasks` | CRUD + `GET /{id}/stats` (week/month/all-time rollups) |
| `/api/events` | CRUD + `/move`, `/complete`, `/uncomplete`, `/roll-over` |
| `/api/routines` | CRUD, `/active`, `/{ref}/preview/{day}`, blocks; `POST /api/weeks/{day}/materialize` |
| `/api/rules` | CRUD + `/active` (delete 409s if a report references it) |
| `/api/reports` | list, `POST /run`, get, delete |
| `/api/reminders` | CRUD |
| `/api/analytics/evaluate` | Metrics + verdicts for a period |
| `/api/weeks/{day}`, `/api/months/{yyyy-mm}` | Calendar payloads |
| `/api/integrations` | Provider status, calendar authorize/disconnect, sync |
| `/api/seed` | Idempotent per-user starter data |

Interactive docs at `http://127.0.0.1:8001/docs` while signed in.

---

## Tests

```bash
cd backend  && arch -arm64 .venv/bin/pytest -q     # 308 passing
cd frontend && npx vitest run                       # 133 passing
cd frontend && npx tsc -b                           # typecheck
```

The frontend suite runs in a Node environment with no DOM, so the pure logic — grid geometry, overlap
layout, tag visibility, due-date grouping, roll-over predicates — is unit-tested, while component
behaviour is verified in a browser.

---

## Known gaps

Honest list; see [`docs/BACKLOG.md`](docs/BACKLOG.md) for detail.

- **No UI for agent tokens** — issuing one needs the API call above.
- **The monthly Review page is switched off** in the router. The backend computes reports fine; the
  page is one line in `frontend/src/main.tsx` away from returning. Report narratives are a hardcoded
  placeholder — the LLM writer was never built.
- **Tasks have no hard delete** — only archive. A daily habit created as a task card mints a fresh
  task each day.
- **`Event.routine_block_id` is not a foreign key**, so deleting a routine block leaves dangling
  provenance on historical events.
- **No Lark notifications.** `Reminder.channel` offers `lark`/`both`, but nothing sends them; they
  behave as in-app only.
- **No dedicated day view.**
- The design specs under `docs/superpowers/specs/` predate several redesigns — notably they describe a
  single-user, no-auth system with an in-app chat agent. Accounts, OAuth and the MCP server all
  arrived later.
