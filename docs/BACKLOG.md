# Avery — carry-forward backlog

Open items after Plan 1 (backend) and Plan 2 (frontend + the backend gaps it needed).
Each was found by review, reproduced, and deliberately not fixed in order to keep a
wave's scope closed. Ordered by severity.

State at the time of writing: backend **147** tests, frontend **31**, commit `2ceaa0a`.

**Closed by Plan 2** — the archived-task reminder leak, `find_or_create_by_name`
resurrecting archived tasks, tag-existence validation on tasks and template blocks,
`PATCH /api/templates`, partial block PATCH, the non-writing week preview, `ReportOut.rule`,
the `minutes_by_tag` rename, `/tasks/{id}/stats`, and `floating_only`.

---

## Should fix soon

### The month payload cannot warn about overlapping time

`app/services/calendar.py` — the per-day payload carries `date`, `event_count`,
`total_minutes`, `minutes_by_primary_tag` and nothing else.

Overlapping events are both counted by design (the system reports overlaps rather than
guessing which is real), and the Review page warns for a whole period. But a month cell can
read "10h · 5 events" with no hint the total is inflated. Add per-day overlap pairs to the
payload so the month view can mark the day; do not compute it in the client.

This got sharper in Plan 2: materialization now deliberately allows a template block to
land on top of an event that spilled past midnight, so overlaps are an expected state, not
an anomaly.

### There is still no way to genuinely remove a task

`app/services/tasks.py` — `delete_task` no longer exists; archiving is the only path.

A task typo'd into existence via `task_name` on an event is permanent, and now visible
forever in the Tasks UI. Plan 3's agent will mint them by accident. Consider a hard delete
guarded on "has no events", mirroring the rule/report guard — which would also make the
DB-level cascade reachable through the API again.

### `conftest.py` shares one session across every request in a test

`backend/tests/conftest.py`

Production yields a fresh session per request; the tests reuse one. It is why
`populate_existing` was needed, and why all four stale-cache races were found by hand
rather than by tests. A per-request session in the fixture would make that class of bug
testable.

### Band arithmetic is duplicated in three client places

`frontend/src/components/RatioBars.tsx`, `GroupChart.tsx`, `frontend/src/hooks/useRules.ts`

The backend never emits band edges, so the client derives `share × (1 ∓ tolerance)` three
times. Only `useRules`' version — previewing an unsaved draft — legitimately belongs in the
client. None of the three knows about `TOLERANCE_EPSILON`, so at an exact edge (group C at
8.0% of 6:3:1 @ 20%) the verdict pill says `pass` while the bar renders a hair outside its
band. Harmless today; a change to tolerance semantics would diverge silently.

Fix by adding `band_low` / `band_high` to each `GroupResult`.

### Upcoming and Recent don't deep-link the day

`frontend/src/pages/TaskDetailPage.tsx` links to `/month` with no date, because
`MonthPage`'s selection is local state. It reads as a broken link. A `?day=` query param on
MonthPage is about ten lines.

### "Scheduled" isn't what the spec says

`frontend/src/pages/TasksPage.tsx` implements Scheduled as "not floating and not done".
The spec says "has upcoming events", so a non-floating task with zero events currently
files under Scheduled. Needs either an event-count field on `TaskOut` or a dedicated query.

### "Upcoming" uses midnight, not now

`app/services/tasks.py` — the boundary between Upcoming and Recent is midnight of the
anchor day, so this morning's 07:00 event still counts as upcoming at 20:00.

---

## Minor

- **Template column hour totals are computed client-side** (`TemplatePage.tsx`), re-deriving
  the midnight-wrap convention. The labels are also ambiguous: "15h scheduled" is per-day
  for both Mon–Fri and Every day, which invites reading it as a week total.
- **No `pointercancel` handling** in `useEventDrag.ts` — a cancelled gesture leaves the
  drag draft set, so the block stays drawn at a time it does not occupy. Related: during a
  drag the block's label still shows the pre-drag time range.
- **`VerdictPill` contrast** — white 11px text on `--pass` and `--under` is roughly 2.3:1,
  below WCAG AA. And `--over` versus `--under` are hard to distinguish as the sole encoding
  of a verdict on the `GroupChart` bars.
- **The month day panel doesn't mark a bled-in event** as coming from the previous day; it
  simply lists "23:00–07:00" under the later date.
- **`materialize.isError` is never surfaced** on the week page, so "Generate from template"
  with no active template (409) fails silently.
- **`TaskDetailPage` commits an empty name** on blur; `TemplatePage` guards this and the
  task page does not.
- **`ReviewPage` accepts a cleared month input** and requests `month=""`.
- **`RuleEditor` pickers use non-archived tags**, so a rule group or exclusion list holding
  an archived tag renders as though the tag were absent.
- **`GET /api/months/9999-12` returns 500** — `date(9999,12,1) + timedelta(days=31)`
  overflows. Clamp in `parse_month_key`. Needs ~95,000 clicks on `›` to reach.
- **`Event.template_block_id` is a plain Integer**, not the FK the spec specifies, so
  `delete_block` leaves provenance dangling.
- **`RuleSpec` / `GroupSpec` live in `services/rules.py`**, which imports models — so
  `analytics.py`'s "no ORM imports" claim is true of names but not of the import graph.
- **`HTTP_422_UNPROCESSABLE_ENTITY` is deprecated** in the installed Starlette (8 warnings).
- **No ORM-cascade test for Template → blocks.** The DB-level cascades are covered; the
  `delete-orphan` relationship is not.
- **No UI path to create or delete an individual event, or to manage tags.**
  `createEvent`, `deleteEvent`, `createTag`, `updateTag`, `archiveTag`, `deleteReport`,
  `listTemplates` and `createTemplate` are all defined in the API client and unreferenced.
  Events currently arrive only from the template; tags only from the seed.
- **The bundle trips Vite's chunk-size warning** (recharts, ~692 kB / 208 kB gzip).
  Irrelevant for a local single-user app.

---

## Environment notes, not defects

- **Port 8000 is unusable on this machine.** A Docker container listens on `*:8000` over
  the IPv6 wildcard and answers on both `localhost` and `127.0.0.1`, so a backend started
  there is shadowed. Everything uses **8001**, and the Vite proxy targets `127.0.0.1:8001`
  rather than `localhost` because `localhost` resolves IPv6 first here.
- **`arch -arm64` is required** for every backend command. The venv interpreter is a
  universal binary while the installed wheels are arm64; an x86_64 launch fails on
  `pydantic_core`. An "incompatible architecture" ImportError is never a code failure.
- **A stale `avery.db` plus an orphaned uvicorn** cost two separate tasks real debugging
  time. Before trusting a number that looks slightly wrong, check
  `lsof -nP -iTCP:8001 -sTCP:LISTEN` and reset with `alembic upgrade head` plus a reseed.
