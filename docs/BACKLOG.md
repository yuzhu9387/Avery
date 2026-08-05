# Avery — carry-forward backlog

Items found by the final whole-branch review of the backend that were deliberately
**not** fixed in that pass, to avoid expanding its scope. Each is real and reproduced.
Ordered by severity.

Backend state at the time of writing: 133 tests passing, commit `09d82b9`.

---

## Important — archiving a task leaves its reminders live

`app/services/reminders.py` — neither `list_reminders` nor `list_due` joins `Task.status`.

Reproduce: create task "Dentist" with a reminder at `2026-08-10T09:00`, then
`DELETE /api/tasks/{id}` (which archives). `GET /api/reminders` still returns it and
`list_due` still yields it, so the 15-minute sweep marks it sent — and once Plan 3 wires
Lark, it will push a reminder for a task the user deleted.

Before the API archived tasks this was handled by the DB cascade. Fix: filter archived
tasks out of `list_due` and `list_reminders`, and decide whether
`POST /api/reminders` / `POST /api/events` against an archived task should 409.

## Important — `find_or_create_by_name` resurrects archived tasks

`app/services/tasks.py` — the lookup matches on name only, with no status filter.

Reproduce: archive the seeded "Work" task, then `POST /api/weeks/{next}/materialize`. Four
new Work events attach to the archived task id. The task stays out of `GET /api/tasks`, so
the calendar shows events whose task appears in no picker — and the Sunday cron silently
re-populates it every week.

Fix alongside the item above; the two share a cause. Note `PATCH {"status":"todo"}` does
un-archive, so the user is not stuck.

## Important — tag-existence validation is asymmetric

`app/services/tasks.py`, `app/services/templates.py`

`assert_tags_exist` guards events and rules but not tasks or template blocks, and the
unguarded paths feed the guarded one. Reproduce: `POST /api/tasks {"tag_ids":[9999]}` →
201, then create an event with no tags → it inherits `[9999]`. Or put `7777` on a template
block and materialize. Those minutes sit permanently in `unassigned_minutes` with an id the
UI cannot resolve to a name — which is exactly the failure the validation was added to
prevent, reached from the other side.

Fix: call `assert_tags_exist` from `tasks.create_task` / `update_task` and from
`templates.create_block` / `update_block`.

## Important — no way to genuinely remove a task

`app/services/tasks.py` — `delete_task` no longer exists; archiving is the only path.

A task typo'd into existence via `task_name` on an event is permanent. Decide whether to
add a hard delete guarded on "has no events" (mirroring the rule/report guard), which would
also make the DB-level cascade reachable through the API again.

## Minor — the month payload still ships the ambiguous key name

`app/services/calendar.py` emits `minutes_by_tag`, while `/api/analytics/evaluate` now
emits `minutes_by_primary_tag` for the same semantics. Two names for one concept invites a
frontend to assume they differ. Rename before Plan 2 consumes either.

## Minor — `GET /api/months/9999-12` returns 500

`app/services/calendar.py` — `date(9999, 12, 1) + timedelta(days=31)` overflows.
`parse_month_key` accepts year 9999, so clamp there.

## Minor — missing endpoints Plan 2's UI will need

- `PATCH /api/templates/{id}` and an `update_template` service. The spec's §10 lists it and
  nothing implements it, so a template cannot be renamed and `is_active` cannot be toggled;
  switching templates relies on `get_active_template`'s `id.desc()` tiebreak with no
  invariant enforcing a single active row.
- A dry-run materialization endpoint for the Template editor's "Preview next week".
- Partial-payload `PATCH /api/template-blocks/{id}` — it currently demands a full
  `TemplateBlockCreate`.
- Per-task hours rollup (week / month / all-time) and a "floating = `is_floating` AND has
  no events" query, both of which the Task detail page needs. Without them the frontend
  computes them, which pushes logic out of the service layer.
- Embed the rule in `ReportOut`; the Review list otherwise needs an N+1 fetch to name the
  rule version, which the spec's report header requires.

## Minor — housekeeping

- `Event.template_block_id` is a plain `Integer`, not the FK the spec specifies, so
  `delete_block` leaves provenance dangling.
- `tests/conftest.py` shares one `AsyncSession` across every request in a test, unlike
  production's per-request session. It is why `populate_existing` was needed, and it makes
  a class of staleness bug untestable.
- Move `RuleSpec` / `GroupSpec` out of `services/rules.py` so `analytics.py`'s "no ORM
  imports" claim is structural rather than nominal.
- `HTTP_422_UNPROCESSABLE_ENTITY` is deprecated in the installed Starlette (6 warnings).
- Add an ORM-cascade test for Template → blocks; the DB-level cascades are covered but the
  ORM `delete-orphan` relationship is not.
