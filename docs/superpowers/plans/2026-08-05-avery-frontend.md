# Avery Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Avery's interface — the seven views from the spec, in the 春山景别 palette — on top of the finished backend, closing the backend gaps the UI needs first so no business logic leaks into the client.

**Architecture:** Vite + React 19 + TypeScript + Tailwind 4, with TanStack Query as the only data layer. A typed API client mirrors the backend's REST surface one module per object. The week grid is hand-built CSS Grid with absolutely positioned event blocks and native pointer-event drag, so the palette is never fighting a library's defaults. All time↔pixel arithmetic lives in one pure, exhaustively tested module.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS 4, react-router 7, @tanstack/react-query 5, recharts 3, Vitest.

**Spec:** `Avery/docs/superpowers/specs/2026-08-04-avery-schedule-agent-design.md`
**Backend plan (done):** `Avery/docs/superpowers/plans/2026-08-04-avery-backend.md`
**Carry-forward backlog:** `Avery/docs/BACKLOG.md`

## Global Constraints

- **Backend baseline: 133 tests passing.** Every backend task in Phase A must leave the suite green and growing. Run it as `arch -arm64 .venv/bin/python -m pytest tests/ -q` from `Avery/backend` — this venv's interpreter is a universal binary while the wheels are `arm64`, so an `ImportError: ... incompatible architecture` is a launch artifact, never a code failure.
- **Frontend lives at `Avery/frontend/`.** The client only ever calls relative `/api/...` paths; Vite's dev server proxies those to the backend at `http://127.0.0.1:8001`, so the browser sees same-origin and CORS never enters the picture.
- **The backend runs on port 8001, not 8000.** A Docker container on this machine holds `*:8000` on the IPv6 wildcard and answers there, so a backend started on 8000 is shadowed and the proxy silently reaches the wrong application. Use `127.0.0.1` rather than `localhost` in the proxy target for the same reason — `localhost` resolves to IPv6 first here.
- **No business logic in the client.** Ratios, hour rollups, verdicts, and band arithmetic come from the API. The client formats and positions; it does not compute. Where a number is missing from an endpoint, add the endpoint (Phase A) rather than computing it in React.
- **All datetimes are naive local strings** of the form `YYYY-MM-DDTHH:MM:SS`, exactly as the backend emits and accepts. Never send a `Z` suffix or an offset, and never round-trip through `toISOString()`, which converts to UTC. Use the `formatLocal` helper from Task 5 for every outbound datetime.
- **Tag colours come from the database**, never hardcoded. Components read `tag.color`. The palette tokens are for chrome only.
- **Palette — 春山景别.** Defined once in `src/theme.css` as CSS custom properties. No hex literal appears in any component.
- **Every task ends with a passing check and a commit.** Backend tasks run pytest; frontend tasks run `npm run build` (which type-checks) plus any Vitest suite the task adds.
- **UI language is English.**

## File Structure

### Phase A — backend (existing tree)

| File | Change |
|---|---|
| `backend/app/services/reminders.py` | exclude archived tasks from `list_due` / `list_reminders` |
| `backend/app/services/tasks.py` | `find_or_create_by_name` skips archived; tag validation; `task_stats`; floating query |
| `backend/app/services/templates.py` | `update_template`; `preview_week` |
| `backend/app/routers/{tasks,templates,reports}.py` | the routes for the above |
| `backend/app/schemas/report.py` | `ReportOut` embeds the rule |
| `backend/app/services/calendar.py` | rename `minutes_by_tag` → `minutes_by_primary_tag` |

### Phase B/C — frontend (new tree)

| File | Responsibility |
|---|---|
| `frontend/src/theme.css` | 春山景别 tokens, one place |
| `frontend/src/lib/datetime.ts` | naive-local parse/format, week and month arithmetic |
| `frontend/src/lib/geometry.ts` | **pure.** time↔pixel, snapping, per-day event segmentation |
| `frontend/src/lib/color.ts` | hex → rgba for event tints |
| `frontend/src/api/client.ts` | fetch wrapper, error shape |
| `frontend/src/api/*.ts` | one typed module per object |
| `frontend/src/api/keys.ts` | TanStack Query key factory |
| `frontend/src/hooks/*.ts` | one hook module per object, queries + mutations |
| `frontend/src/components/` | TagChip, RatioBars, EventBlock, Modal, Field, VerdictPill |
| `frontend/src/pages/` | Week, Month, Tasks, TaskDetail, Template, Rules, Review |
| `frontend/src/App.tsx` | shell, nav, router |

`geometry.ts` is the only frontend module with exhaustive unit tests — it is where a subtle error silently misplaces every block on the grid.

---

# Phase A — close the backend gaps

### Task 1: Archived tasks stop leaking

**Files:**
- Modify: `backend/app/services/reminders.py`, `backend/app/services/tasks.py`, `backend/app/services/templates.py`, `backend/app/routers/tasks.py`
- Modify: `backend/tests/test_reminders.py`, `backend/tests/test_tasks.py`, `backend/tests/test_templates.py`

**Interfaces:**
- Consumes: `Task`, `TaskStatus`, `tags.assert_tags_exist`
- Produces: `list_due`/`list_reminders` skip archived tasks; `find_or_create_by_name` never returns an archived task; `create_task`/`update_task` and `create_block`/`update_block` validate tag ids

Three findings from the backend's final review, all reproduced, all recorded in `docs/BACKLOG.md`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_reminders.py`:

```python
async def test_archived_task_reminders_do_not_fire(client, session):
    """Archiving is this app's delete. A reminder for an archived task must not be
    swept — once Lark is wired it would push a nudge for a task the user removed."""
    from datetime import datetime

    task_id = await _task(client, "Dentist")
    await client.post(
        "/api/reminders", json={"task_id": task_id, "remind_at": "2026-08-01T09:00:00"}
    )
    assert len(await service.list_due(session, datetime(2026, 8, 10, 12, 0))) == 1

    assert (await client.delete(f"/api/tasks/{task_id}")).status_code == 200

    assert await service.list_due(session, datetime(2026, 8, 10, 12, 0)) == []
    assert (await client.get("/api/reminders")).json() == []
```

Add to `backend/tests/test_tasks.py`:

```python
async def test_find_or_create_skips_an_archived_task(client, session):
    """Matching on name alone let the Sunday cron re-attach events to a task the
    user had archived, silently undoing the archive every week."""
    from app.services import tasks as service

    first = await service.find_or_create_by_name(session, "Work", [])
    await client.delete(f"/api/tasks/{first.id}")

    second = await service.find_or_create_by_name(session, "Work", [])
    assert second.id != first.id
    assert second.status == "todo"


async def test_task_rejects_an_unknown_tag_id(client):
    """Events and rules already validate tag ids. Tasks did not, and an event with
    no tags inherits the task's — so the bad id arrived by the back door."""
    bad = await client.post("/api/tasks", json={"name": "X", "tag_ids": [9999]})
    assert bad.status_code == 422

    ok = (await client.post("/api/tasks", json={"name": "Y", "tag_ids": []})).json()
    assert (
        await client.patch(f"/api/tasks/{ok['id']}", json={"tag_ids": [8888]})
    ).status_code == 422
```

Add to `backend/tests/test_templates.py`:

```python
async def test_block_rejects_an_unknown_tag_id(client):
    """A bad tag id on a block becomes a bad tag id on every event it materializes."""
    template_id = (await client.post("/api/templates", json={"name": "T"})).json()["id"]
    bad = await client.post(
        f"/api/templates/{template_id}/blocks",
        json={
            "days": [1],
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "task_name": "X",
            "tag_ids": [7777],
        },
    )
    assert bad.status_code == 422
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_reminders.py tests/test_tasks.py tests/test_templates.py -q`
Expected: 4 failures — reminders still returned, `find_or_create` reuses the archived row, all three tag ids accepted.

- [ ] **Step 3: Filter archived tasks out of the reminder queries**

In `backend/app/services/reminders.py`, import `Task` and `TaskStatus`, then add the join condition to both queries:

```python
def _not_archived() -> Any:
    """A reminder belongs to a task; an archived task's reminders are dormant."""
    return Reminder.task_id.in_(
        select(Task.id).where(Task.status != TaskStatus.ARCHIVED)
    )
```

Apply `.where(_not_archived())` in `list_reminders` and in `list_due`. Import `Any` from `typing`, `Task` from `app.models`, `TaskStatus` from `app.models.task`.

- [ ] **Step 4: Make `find_or_create_by_name` skip archived rows**

In `backend/app/services/tasks.py`:

```python
async def find_or_create_by_name(
    session: AsyncSession, name: str, tag_ids: list[int]
) -> Task:
    """Used by event creation and template materialization to keep one Task per name.

    Archived tasks are skipped deliberately: matching them would let the Sunday roll
    re-attach a fresh week of events to a task the user archived, undoing the archive
    every week and showing events whose task appears in no picker.
    """
    stmt = (
        select(Task)
        .where(Task.name == name, Task.status != TaskStatus.ARCHIVED)
        .order_by(Task.id)
    )
```

The rest of the function is unchanged.

- [ ] **Step 5: Validate tag ids on tasks and template blocks**

In `backend/app/services/tasks.py`, `create_task` calls `await tag_service.assert_tags_exist(session, data.tag_ids)` before constructing the row; `update_task` calls it when `"tag_ids" in fields`. Import `from app.services import tags as tag_service`.

In `backend/app/services/templates.py`, `create_block` and `update_block` each call it on `data.tag_ids`. Same import.

In `backend/app/routers/tasks.py` and `backend/app/routers/templates.py`, catch `tag_service.UnknownTagIds` on the affected routes and raise:

```python
    except tag_service.UnknownTagIds as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown tag ids: {exc}"
        )
```

- [ ] **Step 6: Run the full suite**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/ -q`
Expected: PASS (137 tests)

- [ ] **Step 7: Commit**

```bash
git add Avery/backend
git commit -m "fix: stop archived tasks leaking through reminders and materialization"
```

---

### Task 2: The endpoints the UI needs

**Files:**
- Modify: `backend/app/services/templates.py`, `backend/app/routers/templates.py`, `backend/app/schemas/template.py`, `backend/app/schemas/report.py`, `backend/app/services/calendar.py`
- Modify: `backend/tests/test_templates.py`, `backend/tests/test_reports.py`, `backend/tests/test_calendar.py`

**Interfaces:**
- Produces: `PATCH /api/templates/{id}`; `PATCH /api/template-blocks/{id}` accepting partial bodies; `GET /api/templates/{id}/preview/{any_date}`; `ReportOut.rule`; month payload key `minutes_by_primary_tag`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_templates.py`:

```python
async def test_rename_and_deactivate_a_template(client):
    template_id = (await client.post("/api/templates", json={"name": "Old"})).json()["id"]

    renamed = await client.patch(f"/api/templates/{template_id}", json={"name": "New"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "New"

    off = await client.patch(f"/api/templates/{template_id}", json={"is_active": False})
    assert off.json()["is_active"] is False
    assert (await client.get("/api/templates/active")).status_code == 404


async def test_partial_block_patch_leaves_other_fields_alone(client):
    template_id = await _template(client, [WEEKDAY_BLOCK])
    block = (await client.get(f"/api/templates/{template_id}")).json()["blocks"][0]

    patched = await client.patch(
        f"/api/template-blocks/{block['id']}", json={"task_name": "Deep work"}
    )
    assert patched.status_code == 200
    assert patched.json()["task_name"] == "Deep work"
    assert patched.json()["days"] == block["days"]
    assert patched.json()["start_time"] == block["start_time"]


async def test_preview_does_not_write_anything(client):
    """The Template editor's "Preview next week" must be a pure read."""
    await _template(client, [WEEKDAY_BLOCK])

    preview = await client.get("/api/templates/active/preview/2026-08-03")
    assert preview.status_code == 200
    body = preview.json()
    assert body["week_start"] == "2026-08-03"
    assert len(body["events"]) == 5
    assert body["events"][0]["start_at"] == "2026-08-03T09:30:00"

    assert (await client.get("/api/events")).json() == []


async def test_preview_predicts_the_tags_that_will_be_created(client):
    """A block declaring no tags inherits the task's at materialization, so the preview
    must show those too. A preview that disagrees with what actually gets created is
    worse than no preview at all."""
    tag_id = (
        await client.post("/api/tags", json={"name": "Deep", "color": "#DA96A4"})
    ).json()["id"]
    await client.post("/api/tasks", json={"name": "Work", "tag_ids": [tag_id]})
    await _template(client, [WEEKDAY_BLOCK])  # WEEKDAY_BLOCK declares tag_ids: []

    preview = (await client.get("/api/templates/active/preview/2026-08-03")).json()
    assert preview["events"][0]["tag_ids"] == [tag_id]

    await client.post("/api/weeks/2026-08-03/materialize")
    created = (await client.get("/api/events")).json()
    assert created[0]["tag_ids"] == preview["events"][0]["tag_ids"]
```

`backend/tests/test_reports.py`:

```python
async def test_report_embeds_the_rule_it_snapshotted(client):
    """The Review header must name the rule version without an N+1 fetch."""
    await _setup(client)
    report = (await client.post("/api/reports/run", json={"month": "2026-08"})).json()

    assert report["rule"]["id"] == report["rule_id"]
    assert report["rule"]["name"] == "6:3:1 baseline"
    assert [g["ratio"] for g in report["rule"]["groups"]] == [6, 3, 1]
    assert report["rule"]["effective_from"] is not None
```

`backend/tests/test_calendar.py` — update the existing month assertions to the new key:

```python
    assert days["2026-08-03"]["minutes_by_primary_tag"][str(tag_id)] == 60
```

- [ ] **Step 2: Run to verify failures**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_templates.py tests/test_reports.py tests/test_calendar.py -q`
Expected: failures — no PATCH on templates, partial block patch 422s, no preview route, `report["rule"]` missing, month key mismatch.

- [ ] **Step 3: Add the template schemas**

In `backend/app/schemas/template.py`:

```python
class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None

    @field_validator("name", "is_active")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value


class TemplateBlockUpdate(BaseModel):
    """Partial patch. Every field optional; unset fields are left untouched."""

    days: list[int] | None = Field(default=None, min_length=1)
    start_time: time | None = None
    end_time: time | None = None
    task_name: str | None = Field(default=None, min_length=1, max_length=200)
    tag_ids: list[int] | None = None
    sort_order: int | None = None

    @field_validator("days", "start_time", "end_time", "task_name", "tag_ids", "sort_order")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value

    @field_validator("days")
    @classmethod
    def days_are_iso_weekdays(cls, value: list[int]) -> list[int]:
        if any(d < 1 or d > 7 for d in value):
            raise ValueError("days must be ISO weekdays 1-7")
        return value


class PreviewResult(BaseModel):
    week_start: str
    events: list[dict]
```

- [ ] **Step 4: Add the template services**

In `backend/app/services/templates.py`:

```python
async def update_template(
    session: AsyncSession, template_id: int, data: TemplateUpdate
) -> Template | None:
    template = await session.get(Template, template_id)
    if template is None:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(template, key, value)
    await session.commit()
    return await get_template(session, template_id)


async def update_block(
    session: AsyncSession, block_id: int, data: TemplateBlockUpdate
) -> TemplateBlock | None:
    block = await session.get(TemplateBlock, block_id)
    if block is None:
        return None
    fields = data.model_dump(exclude_unset=True)
    if "tag_ids" in fields:
        await tag_service.assert_tags_exist(session, fields["tag_ids"])
    for key, value in fields.items():
        setattr(block, key, value)
    await session.commit()
    await session.refresh(block)
    return block


async def preview_week(
    session: AsyncSession, any_day: date, template: Template | None = None
) -> tuple[date, list[dict]] | None:
    """What materialize_week WOULD create, without writing anything.

    Deliberately shares the day/block selection and the midnight-wrap arithmetic with
    materialize_week rather than reimplementing it — a preview that disagrees with what
    actually gets created is worse than no preview.
    """
    if template is None:
        template = await get_active_template(session)
    if template is None:
        return None

    monday, next_monday = week_bounds(any_day)
    occupied = await _days_with_events(session, monday, next_monday)

    # Mirror materialize_week's tag fallback: a block declaring no tags of its own
    # inherits the resolved task's. Resolve read-only — never create — so preview stays
    # a pure read while still predicting the tags materialization will really assign.
    # Archived tasks are skipped for the same reason find_or_create_by_name skips them.
    task_tags: dict[str, list[int]] = {}

    async def tags_for(block: TemplateBlock) -> list[int]:
        if block.tag_ids:
            return list(block.tag_ids)
        if block.task_name not in task_tags:
            existing = (
                await session.scalars(
                    select(Task)
                    .where(Task.name == block.task_name, Task.status != TaskStatus.ARCHIVED)
                    .order_by(Task.id)
                )
            ).first()
            task_tags[block.task_name] = list(existing.tag_ids) if existing else []
        return list(task_tags[block.task_name])

    rows: list[dict] = []
    for offset in range(7):
        day = monday + timedelta(days=offset)
        if day in occupied:
            continue
        for block in template.blocks:
            if day.isoweekday() not in block.days:
                continue
            start = datetime.combine(day, block.start_time)
            end = datetime.combine(day, block.end_time)
            if end <= start:
                end += timedelta(days=1)
            rows.append(
                {
                    "task_name": block.task_name,
                    "start_at": start.isoformat(timespec="seconds"),
                    "end_at": end.isoformat(timespec="seconds"),
                    "tag_ids": await tags_for(block),
                    "template_block_id": block.id,
                }
            )
    rows.sort(key=lambda r: r["start_at"])
    return monday, rows
```

Add `Task` to the model import and `TaskStatus` from `app.models.task`.

The `update_block` signature replaces the one from the backend plan's Task 8, which took a full `TemplateBlockCreate`. `create_block` is unchanged.

- [ ] **Step 5: Add the routes**

In `backend/app/routers/templates.py`, register `PATCH /{template_id}` and `GET /{template_id}/preview/{any_day}` on `router`, plus swap the block PATCH to `TemplateBlockUpdate`. The preview route accepts the literal `active` as `template_id` — resolve it via `get_active_template` — so the editor does not need to know the id:

```python
@router.get("/{template_ref}/preview/{any_day}", response_model=PreviewResult)
async def preview_week(
    template_ref: str, any_day: date, session: AsyncSession = Depends(get_session)
):
    if template_ref == "active":
        template = await service.get_active_template(session)
    elif template_ref.isdigit():
        template = await service.get_template(session, int(template_ref))
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "expected an id or 'active'")
    if template is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "template not found")

    result = await service.preview_week(session, any_day, template)
    monday, rows = result
    return PreviewResult(week_start=monday.isoformat(), events=rows)
```

Declare this route **before** `GET /{template_id}`, and note `/active` must still come first of all.

- [ ] **Step 6: Embed the rule in `ReportOut`**

In `backend/app/schemas/report.py`, add `rule: RuleOut` and import it. In `backend/app/services/reports.py`, eager-load the relationship or fetch it — the simplest correct route is a `relationship` on the model:

```python
    rule: Mapped["Rule"] = relationship(lazy="selectin")
```

added to `app/models/report.py` with `from sqlalchemy.orm import Mapped, mapped_column, relationship`. `lazy="selectin"` matters: without it the async serializer raises `MissingGreenlet` on attribute access.

- [ ] **Step 7: Rename the month payload key**

In `backend/app/services/calendar.py`, the day dict emits `"minutes_by_primary_tag"` instead of `"minutes_by_tag"`, matching `/api/analytics/evaluate`. Two names for one concept invites a client to assume they differ.

- [ ] **Step 8: Run the full suite**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/ -q`
Expected: PASS (142 tests)

- [ ] **Step 9: Commit**

```bash
git add Avery/backend
git commit -m "feat: add template patch, block partial patch, week preview, report rule embed"
```

---

### Task 3: Task stats and the floating query

**Files:**
- Modify: `backend/app/services/tasks.py`, `backend/app/routers/tasks.py`, `backend/app/schemas/task.py`
- Modify: `backend/tests/test_tasks.py`

**Interfaces:**
- Produces: `GET /api/tasks/{id}/stats` returning `TaskStats`; `GET /api/tasks?floating_only=true` meaning "is_floating AND has no events"

The Task detail page needs hours-this-week / this-month / all-time plus upcoming and recent occurrences. The Tasks page needs the real floating set. Both are business questions and belong here, not in React.

- [ ] **Step 1: Write the failing tests**

```python
async def test_task_stats_rolls_hours_and_occurrences(client):
    tag_id = (
        await client.post("/api/tags", json={"name": "W", "color": "#DA96A4"})
    ).json()["id"]
    task_id = (
        await client.post("/api/tasks", json={"name": "Work", "tag_ids": [tag_id]})
    ).json()["id"]
    for day, hours in (("2026-08-03", 2), ("2026-08-04", 3), ("2026-09-01", 4)):
        await client.post(
            "/api/events",
            json={
                "task_id": task_id,
                "start_at": f"{day}T09:00:00",
                "end_at": f"{day}T{9 + hours:02d}:00:00",
            },
        )

    stats = await client.get(f"/api/tasks/{task_id}/stats", params={"today": "2026-08-05"})
    assert stats.status_code == 200
    body = stats.json()
    assert body["minutes_all_time"] == 9 * 60
    assert body["minutes_this_week"] == 5 * 60   # Mon 3rd + Tue 4th, week of Aug 3
    assert body["minutes_this_month"] == 5 * 60  # September's 4h is a different month
    assert body["event_count"] == 3
    assert len(body["upcoming"]) == 1            # Sep 1 is after Aug 5
    assert body["upcoming"][0]["start_at"] == "2026-09-01T09:00:00"
    assert len(body["recent"]) == 2


async def test_task_stats_404s_for_a_missing_task(client):
    assert (await client.get("/api/tasks/999/stats")).status_code == 404


async def test_floating_only_excludes_tasks_that_have_events(client):
    """`is_floating` alone is not the Floating list: a floating task that has since
    been scheduled belongs under Scheduled."""
    bare = (
        await client.post(
            "/api/tasks", json={"name": "Renew passport", "tag_ids": [], "is_floating": True}
        )
    ).json()["id"]
    scheduled = (
        await client.post(
            "/api/tasks", json={"name": "Dentist", "tag_ids": [], "is_floating": True}
        )
    ).json()["id"]
    await client.post(
        "/api/events",
        json={
            "task_id": scheduled,
            "start_at": "2026-08-05T15:00:00",
            "end_at": "2026-08-05T16:00:00",
        },
    )

    ids = [t["id"] for t in (await client.get("/api/tasks", params={"floating_only": True})).json()]
    assert ids == [bare]
```

- [ ] **Step 2: Run to verify failures**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_tasks.py -q`
Expected: FAIL — no `/stats` route, `floating_only` unknown.

- [ ] **Step 3: Add the schema**

In `backend/app/schemas/task.py`:

```python
class TaskStats(BaseModel):
    task_id: int
    minutes_this_week: int
    minutes_this_month: int
    minutes_all_time: int
    event_count: int
    upcoming: list[EventOut]
    recent: list[EventOut]
```

Import `EventOut` from `app.schemas.event`.

- [ ] **Step 4: Add the service**

In `backend/app/services/tasks.py`:

```python
async def task_stats(
    session: AsyncSession, task_id: int, today: date | None = None
) -> dict | None:
    """Hour rollups and the occurrence lists the Task detail page shows.

    `today` is injectable so the result is testable without patching the clock; it
    defaults to the real current date.
    """
    task = await session.get(Task, task_id)
    if task is None:
        return None

    anchor = today or date.today()
    week_start, week_end = template_service.week_bounds(anchor)
    month_start = anchor.replace(day=1)
    month_end = date(
        anchor.year + (anchor.month == 12), (anchor.month % 12) + 1, 1
    )
    now = datetime.combine(anchor, datetime.min.time())

    rows = await event_service.list_events(session, task_id=task_id)

    def minutes_within(lo: date, hi: date) -> int:
        return sum(
            analytics.minutes_in_window(
                analytics.EventSlice(e.id, e.start_at, e.end_at, tuple(e.tag_ids)),
                datetime.combine(lo, datetime.min.time()),
                datetime.combine(hi, datetime.min.time()),
            )
            for e in rows
        )

    upcoming = [e for e in rows if e.start_at >= now][:10]
    recent = [e for e in reversed(rows) if e.start_at < now][:10]

    return {
        "task_id": task_id,
        "minutes_this_week": minutes_within(week_start, week_end),
        "minutes_this_month": minutes_within(month_start, month_end),
        "minutes_all_time": sum(e.duration_minutes for e in rows),
        "event_count": len(rows),
        "upcoming": upcoming,
        "recent": recent,
    }
```

Add imports: `from datetime import date, datetime`, `from app.services import analytics`, `from app.services import events as event_service`, `from app.services import templates as template_service`.

Reusing `analytics.minutes_in_window` is deliberate — the same clipping rule that decides ratios decides these totals, so the Task page can never disagree with the Review page.

Then extend `list_tasks` with `floating_only`:

```python
async def list_tasks(
    session: AsyncSession,
    *,
    status: TaskStatus | None = None,
    is_floating: bool | None = None,
    floating_only: bool = False,
    include_archived: bool = False,
) -> list[Task]:
    ...
    if floating_only:
        # The real Floating list: flagged floating AND not yet scheduled. A floating
        # task that has since been given events belongs under Scheduled.
        stmt = stmt.where(
            Task.is_floating.is_(True),
            ~Task.id.in_(select(Event.task_id)),
        )
```

Import `Event` from `app.models`.

- [ ] **Step 5: Add the routes**

In `backend/app/routers/tasks.py`, add `floating_only: bool = False` to the list route's parameters and pass it through, then:

```python
@router.get("/{task_id}/stats", response_model=TaskStats)
async def task_stats(
    task_id: int, today: date | None = None, session: AsyncSession = Depends(get_session)
):
    stats = await service.task_stats(session, task_id, today)
    if stats is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "task not found")
    return stats
```

Declare it before `GET /{task_id}` is not required — the paths differ — but keep it adjacent for readability. Import `date` and `TaskStats`.

- [ ] **Step 6: Run the full suite**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/ -q`
Expected: PASS (145 tests)

- [ ] **Step 7: Commit**

```bash
git add Avery/backend
git commit -m "feat: add task stats rollup and a true floating-task query"
```

---

# Phase B — frontend foundation

### Task 4: Scaffold, theme, shell

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/theme.css`, `frontend/src/index.css`, `frontend/src/App.tsx`, `frontend/.gitignore`

**Interfaces:**
- Produces: a building Vite app with routes for all seven views (placeholders), the palette as CSS variables, and a persistent nav shell

- [ ] **Step 1: Scaffold**

```bash
cd "Avery" && npm create vite@latest frontend -- --template react-ts
cd frontend && npm install
npm install react-router-dom@^7 @tanstack/react-query@^5 recharts@^3
npm install -D tailwindcss@^4 @tailwindcss/vite vitest
```

- [ ] **Step 2: Wire Tailwind and the dev proxy — `frontend/vite.config.ts`**

```ts
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8001' },
  },
  test: { environment: 'node' },
})
```

The proxy means the client always calls relative `/api/...`, so no base-URL config and no CORS surprises.

- [ ] **Step 3: Create `frontend/src/theme.css`**

```css
/* 春山景别 — the only place a colour is defined. */
:root {
  --bg: #f3f1e7;
  --surface: #fbfaf4;
  --surface-raised: #ffffff;

  --ink: #0b0505;
  --ink-muted: #6b6560;
  --ink-faint: #9b958e;
  --line: #e3e0d2;
  --line-strong: #cfcbb8;

  /* palette, also the seeded tag colours */
  --pale: #dedecf;
  --blush: #e7c8c8;
  --sage: #bdbd9b;
  --clay: #c9a88f;
  --rose: #da96a4;
  --rose-deep: #c97b8b;
  --teal: #8fa8a2;

  --pass: #8fa8a2;
  --over: #c97b8b;
  --under: #c9a88f;

  --radius: 12px;
  --radius-sm: 8px;
  --shadow-card: 0 1px 2px rgb(11 5 5 / 0.04), 0 8px 24px rgb(11 5 5 / 0.04);

  --font-display: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  --font-sans: ui-sans-serif, system-ui, -apple-system, 'Helvetica Neue', sans-serif;
}
```

- [ ] **Step 4: Create `frontend/src/index.css`**

```css
@import 'tailwindcss';
@import './theme.css';

@theme {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-ink-muted: var(--ink-muted);
  --color-ink-faint: var(--ink-faint);
  --color-line: var(--line);
  --color-rose: var(--rose);
  --color-teal: var(--teal);
  --color-clay: var(--clay);
  --color-sage: var(--sage);
  --color-pass: var(--pass);
  --color-over: var(--over);
  --color-under: var(--under);
  --font-display: var(--font-display);
  --radius-card: var(--radius);
}

html, body, #root { height: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3 { font-family: var(--font-display); font-weight: 600; letter-spacing: -0.01em; }
```

- [ ] **Step 5: Create `frontend/src/App.tsx`**

```tsx
import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Week' },
  { to: '/month', label: 'Month' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/template', label: 'Template' },
  { to: '/rules', label: 'Rules' },
  { to: '/review', label: 'Review' },
]

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-8 border-b border-line bg-surface px-6 py-3">
        <span className="font-display text-lg">Avery</span>
        <nav className="flex gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'rounded-[8px] px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-[var(--pale)] text-ink'
                    : 'text-ink-muted hover:bg-[var(--pale)]/50 hover:text-ink',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 6: Create `frontend/src/main.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'

import App from './App'
import './index.css'

const Placeholder = ({ name }: { name: string }) => (
  <div className="p-8 text-ink-muted">{name}</div>
)

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
})

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Placeholder name="Week" /> },
      { path: 'month', element: <Placeholder name="Month" /> },
      { path: 'tasks', element: <Placeholder name="Tasks" /> },
      { path: 'tasks/:taskId', element: <Placeholder name="Task detail" /> },
      { path: 'template', element: <Placeholder name="Template" /> },
      { path: 'rules', element: <Placeholder name="Rules" /> },
      { path: 'review', element: <Placeholder name="Review" /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] **Step 7: Verify the build**

Run: `cd Avery/frontend && npm run build`
Expected: type-checks and builds with no errors.

- [ ] **Step 8: Commit**

```bash
git add Avery/frontend
git commit -m "feat: scaffold Avery frontend with the 春山景别 palette and app shell"
```

---

### Task 5: Typed API client and query layer

**Files:**
- Create: `frontend/src/lib/datetime.ts`, `frontend/src/api/client.ts`, `frontend/src/api/types.ts`, `frontend/src/api/keys.ts`, `frontend/src/api/{tags,tasks,events,templates,rules,reports,reminders,calendar,analytics}.ts`, `frontend/src/lib/datetime.test.ts`

**Interfaces:**
- Produces: `apiGet/apiSend`, `ApiError`; `formatLocal`, `parseLocal`, `mondayOf`, `addDays`, `monthKey`; a typed function per endpoint; `qk` key factory

- [ ] **Step 1: Write the failing test — `frontend/src/lib/datetime.test.ts`**

```ts
import { describe, expect, it } from 'vitest'

import { addDays, formatLocal, mondayOf, monthKey, parseLocal } from './datetime'

describe('naive local datetimes', () => {
  it('round-trips without drifting into UTC', () => {
    const s = '2026-08-03T09:30:00'
    expect(formatLocal(parseLocal(s))).toBe(s)
  })

  it('never emits a Z or an offset', () => {
    expect(formatLocal(new Date(2026, 7, 3, 23, 0, 0))).toBe('2026-08-03T23:00:00')
  })

  it('finds the Monday of any day, including a Sunday', () => {
    expect(mondayOf(new Date(2026, 7, 5))).toEqual(new Date(2026, 7, 3)) // Wed -> Mon
    expect(mondayOf(new Date(2026, 7, 3))).toEqual(new Date(2026, 7, 3)) // Mon -> itself
    expect(mondayOf(new Date(2026, 7, 9))).toEqual(new Date(2026, 7, 3)) // Sun -> that Mon
  })

  it('adds days across a month boundary', () => {
    expect(addDays(new Date(2026, 7, 31), 1)).toEqual(new Date(2026, 8, 1))
  })

  it('formats a month key', () => {
    expect(monthKey(new Date(2026, 7, 5))).toBe('2026-08')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Avery/frontend && npx vitest run src/lib/datetime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/lib/datetime.ts`**

```ts
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The backend speaks naive local time. `toISOString()` converts to UTC and would
 * shift every timestamp by the machine's offset, so it is never used here.
 */
export function formatLocal(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parses `YYYY-MM-DDTHH:MM:SS` as local wall-clock, not UTC. */
export function parseLocal(s: string): Date {
  const [datePart, timePart = '00:00:00'] = s.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm, ss] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, ss || 0)
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

/** ISO weeks start Monday. `getDay()` returns 0 for Sunday, hence the remap. */
export function mondayOf(d: Date): Date {
  const iso = d.getDay() === 0 ? 7 : d.getDay()
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  out.setDate(out.getDate() - (iso - 1))
  return out
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function formatTimeRange(startAt: string, endAt: string): string {
  const s = parseLocal(startAt)
  const e = parseLocal(endAt)
  return `${pad(s.getHours())}:${pad(s.getMinutes())}–${pad(e.getHours())}:${pad(e.getMinutes())}`
}
```

- [ ] **Step 4: Create `frontend/src/api/client.ts`**

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail)
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    // FastAPI sends {detail: string} for HTTPException and
    // {detail: [{loc, msg, ...}]} for validation failures.
    const detail = body?.detail
    const message = Array.isArray(detail)
      ? detail.map((d: { msg: string }) => d.msg).join('; ')
      : typeof detail === 'string'
        ? detail
        : res.statusText
    throw new ApiError(res.status, message)
  }
  return body as T
}

export async function apiGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const qs = params
    ? '?' +
      new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      )
    : ''
  return unwrap<T>(await fetch(`/api${path}${qs}`))
}

export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  return unwrap<T>(
    await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}
```

- [ ] **Step 5: Create `frontend/src/api/types.ts`**

Mirror the backend schemas exactly. Field names are the API's, not camelCased — renaming would invite a mismatch nothing catches.

```ts
export type Verdict = 'pass' | 'over' | 'under'
export type TaskStatus = 'todo' | 'doing' | 'done' | 'archived'
export type Priority = 'low' | 'normal' | 'high'
export type EventSource = 'template' | 'manual' | 'agent'
export type Channel = 'inapp' | 'lark' | 'both'

export interface Tag {
  id: number
  name: string
  color: string
  icon: string | null
  sort_order: number
  archived: boolean
}

export interface Task {
  id: number
  name: string
  tag_ids: number[]
  notes: string
  status: TaskStatus
  due_date: string | null
  est_minutes: number | null
  is_floating: boolean
  priority: Priority
  created_at: string
  completed_at: string | null
}

export interface AveryEvent {
  id: number
  task_id: number
  start_at: string
  end_at: string
  tag_ids: number[]
  source: EventSource
  template_block_id: number | null
  notes: string
}

export interface TemplateBlock {
  id: number
  template_id: number
  days: number[]
  start_time: string
  end_time: string
  task_name: string
  tag_ids: number[]
  sort_order: number
}

export interface Template {
  id: number
  name: string
  is_active: boolean
  created_at: string
  blocks: TemplateBlock[]
}

export interface RuleGroup {
  key: string
  label: string
  ratio: number
  tag_ids: number[]
}

export interface Rule {
  id: number
  name: string
  groups: RuleGroup[]
  tolerance: number
  exclude_tag_ids: number[]
  effective_from: string
  effective_to: string | null
  note: string
  created_at: string
}

export interface GroupResult {
  key: string
  label: string
  ratio: number
  minutes: number
  hours: number
  share_actual: number
  share_target: number
  deviation: number
  verdict: Verdict
}

export interface Metrics {
  has_data: boolean
  total_minutes: number
  total_hours: number
  groups: GroupResult[]
  minutes_by_primary_tag: Record<string, number>
  unassigned_minutes: number
  unassigned_tag_ids: number[]
  untagged_minutes: number
  excluded_minutes: number
  overlaps: number[][]
}

export interface Report {
  id: number
  period_start: string
  period_end: string
  rule_id: number
  rule: Rule
  metrics: Metrics
  narrative: string
  created_at: string
}

export interface Reminder {
  id: number
  task_id: number
  remind_at: string
  channel: Channel
  sent_at: string | null
  dismissed_at: string | null
}

export interface WeekPayload {
  week_start: string
  week_end: string
  materialized: boolean
  events: AveryEvent[]
}

export interface MonthDay {
  date: string
  event_count: number
  total_minutes: number
  minutes_by_primary_tag: Record<string, number>
}

export interface MonthPayload {
  year: number
  month: number
  days: MonthDay[]
}

export interface TaskStats {
  task_id: number
  minutes_this_week: number
  minutes_this_month: number
  minutes_all_time: number
  event_count: number
  upcoming: AveryEvent[]
  recent: AveryEvent[]
}

export interface Evaluation {
  period_start: string
  period_end: string
  rule: Rule
  metrics: Metrics
}

export interface PreviewResult {
  week_start: string
  events: {
    task_name: string
    start_at: string
    end_at: string
    tag_ids: number[]
    template_block_id: number
  }[]
}
```

- [ ] **Step 6: Create `frontend/src/api/keys.ts`**

```ts
export const qk = {
  tags: ['tags'] as const,
  tasks: (params?: Record<string, unknown>) => ['tasks', params ?? {}] as const,
  task: (id: number) => ['task', id] as const,
  taskStats: (id: number) => ['task', id, 'stats'] as const,
  events: (params?: Record<string, unknown>) => ['events', params ?? {}] as const,
  week: (day: string) => ['week', day] as const,
  month: (key: string) => ['month', key] as const,
  templates: ['templates'] as const,
  activeTemplate: ['template', 'active'] as const,
  preview: (day: string) => ['template', 'preview', day] as const,
  rules: ['rules'] as const,
  activeRule: ['rule', 'active'] as const,
  reports: (month?: string) => ['reports', month ?? 'all'] as const,
  reminders: (params?: Record<string, unknown>) => ['reminders', params ?? {}] as const,
  evaluate: (start: string, end: string) => ['evaluate', start, end] as const,
}
```

- [ ] **Step 7: Create the per-object API modules**

Each is a thin typed wrapper. `frontend/src/api/tags.ts`:

```ts
import type { Tag } from './types'
import { apiGet, apiSend } from './client'

export const listTags = (includeArchived = false) =>
  apiGet<Tag[]>('/tags', { include_archived: includeArchived })

export const createTag = (body: Partial<Tag>) => apiSend<Tag>('POST', '/tags', body)
export const updateTag = (id: number, body: Partial<Tag>) =>
  apiSend<Tag>('PATCH', `/tags/${id}`, body)
export const archiveTag = (id: number) => apiSend<Tag>('DELETE', `/tags/${id}`)
```

Write the remaining modules the same way, covering exactly these calls:

- `tasks.ts` — `listTasks(params)`, `getTask(id)`, `createTask`, `updateTask`, `archiveTask`, `getTaskStats(id, today?)`
- `events.ts` — `listEvents({start, end, task_id})`, `createEvent`, `updateEvent`, `moveEvent(id, start_at)`, `deleteEvent`
- `calendar.ts` — `getWeek(day)`, `getMonth(monthKey)`
- `templates.ts` — `listTemplates`, `getActiveTemplate`, `createTemplate`, `updateTemplate`, `createBlock`, `updateBlock`, `deleteBlock`, `previewWeek(day)`, `materializeWeek(day)`
- `rules.ts` — `listRules`, `getActiveRule`, `createRuleVersion`, `deleteRule`
- `reports.ts` — `listReports(month?)`, `runReport(month)`, `deleteReport`
- `reminders.ts` — `listReminders(params)`, `createReminder`, `updateReminder`, `deleteReminder`
- `analytics.ts` — `evaluatePeriod({period_start, period_end, rule_id?})`

- [ ] **Step 8: Run the tests and the build**

Run: `cd Avery/frontend && npx vitest run && npm run build`
Expected: 5 tests pass; build clean.

- [ ] **Step 9: Commit**

```bash
git add Avery/frontend
git commit -m "feat: add typed API client, naive-local datetime helpers, query keys"
```

---

### Task 6: Grid geometry and shared components

**Files:**
- Create: `frontend/src/lib/geometry.ts`, `frontend/src/lib/geometry.test.ts`, `frontend/src/lib/color.ts`, `frontend/src/components/{TagChip,VerdictPill,RatioBars,Modal,Field}.tsx`, `frontend/src/hooks/useTags.ts`

**Interfaces:**
- Produces: `GRID`, `snapMinutes`, `minutesToPx`, `pxToMinutes`, `segmentsForEvent`, `tint`; `TagChip`, `VerdictPill`, `RatioBars`, `Modal`, `Field`; `useTagMap()`

`geometry.ts` is pure and gets exhaustive tests. Everything on the week grid is positioned by it, and an overnight rest block crossing both the midnight boundary and the grid's 06:00 floor is exactly where a naive implementation goes wrong.

- [ ] **Step 1: Write the failing test — `frontend/src/lib/geometry.test.ts`**

```ts
import { describe, expect, it } from 'vitest'

import { parseLocal } from './datetime'
import { GRID, pxToMinutes, minutesToPx, segmentsForEvent, snapMinutes } from './geometry'

const week = new Date(2026, 7, 3) // Monday 2026-08-03

const seg = (startAt: string, endAt: string) =>
  segmentsForEvent(parseLocal(startAt), parseLocal(endAt), week)

describe('snapping', () => {
  it('snaps to the nearest 15 minutes', () => {
    expect(snapMinutes(0)).toBe(0)
    expect(snapMinutes(7)).toBe(0)
    expect(snapMinutes(8)).toBe(15)
    expect(snapMinutes(22)).toBe(15)
    expect(snapMinutes(23)).toBe(30)
    expect(snapMinutes(-8)).toBe(-15)
  })
})

describe('pixel conversion', () => {
  it('round-trips through minutes', () => {
    expect(pxToMinutes(minutesToPx(90))).toBeCloseTo(90)
  })

  it('measures an hour as PX_PER_HOUR', () => {
    expect(minutesToPx(60)).toBe(GRID.pxPerHour)
  })
})

describe('segmentsForEvent', () => {
  it('places a simple same-day event in one column', () => {
    const s = seg('2026-08-03T09:30:00', '2026-08-03T16:30:00')
    expect(s).toHaveLength(1)
    expect(s[0].dayIndex).toBe(0)
    expect(s[0].topPx).toBe(minutesToPx((9.5 - GRID.startHour) * 60))
    expect(s[0].heightPx).toBe(minutesToPx(7 * 60))
    expect(s[0].isStart && s[0].isEnd).toBe(true)
  })

  it('splits an overnight block and drops the off-grid small hours', () => {
    // 23:00 Mon -> 07:00 Tue. The grid runs 06:00-24:00, so Monday shows 23:00-24:00
    // and Tuesday shows 06:00-07:00; 00:00-06:00 Tuesday is outside the grid.
    const s = seg('2026-08-03T23:00:00', '2026-08-04T07:00:00')
    expect(s).toHaveLength(2)

    expect(s[0].dayIndex).toBe(0)
    expect(s[0].heightPx).toBe(minutesToPx(60))
    expect(s[0].isStart).toBe(true)
    expect(s[0].isEnd).toBe(false)

    expect(s[1].dayIndex).toBe(1)
    expect(s[1].topPx).toBe(0)
    expect(s[1].heightPx).toBe(minutesToPx(60))
    expect(s[1].isStart).toBe(false)
    expect(s[1].isEnd).toBe(true)
  })

  it('clips an event that starts before the grid floor', () => {
    const s = seg('2026-08-03T04:00:00', '2026-08-03T07:00:00')
    expect(s).toHaveLength(1)
    expect(s[0].topPx).toBe(0)
    expect(s[0].heightPx).toBe(minutesToPx(60))
    expect(s[0].isStart).toBe(false)
  })

  it('returns nothing for an event entirely inside the off-grid hours', () => {
    expect(seg('2026-08-03T01:00:00', '2026-08-03T05:00:00')).toEqual([])
  })

  it('returns nothing for an event outside the week', () => {
    expect(seg('2026-08-11T09:00:00', '2026-08-11T10:00:00')).toEqual([])
    expect(seg('2026-08-02T09:00:00', '2026-08-02T10:00:00')).toEqual([])
  })

  it('covers a multi-day event on every day it touches', () => {
    const s = seg('2026-08-03T22:00:00', '2026-08-06T08:00:00')
    expect(s.map((x) => x.dayIndex)).toEqual([0, 1, 2, 3])
    expect(s[1].heightPx).toBe(minutesToPx((24 - GRID.startHour) * 60))
  })

  it('gives a very short event the minimum legible height', () => {
    const s = seg('2026-08-03T09:00:00', '2026-08-03T09:05:00')
    expect(s[0].heightPx).toBe(GRID.minBlockPx)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Avery/frontend && npx vitest run src/lib/geometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/lib/geometry.ts`**

```ts
import { addDays } from './datetime'

export const GRID = {
  /** The grid shows 06:00–24:00. Sleep before 06:00 is off-grid by design; the
   *  week view is about waking hours, and the seeded rest block ends at 07:00. */
  startHour: 6,
  endHour: 24,
  pxPerHour: 56,
  slotMinutes: 15,
  /** A 5-minute event would otherwise render as a 4px sliver with unreadable text. */
  minBlockPx: 14,
} as const

export const GRID_MINUTES = (GRID.endHour - GRID.startHour) * 60
export const GRID_HEIGHT_PX = (GRID.endHour - GRID.startHour) * GRID.pxPerHour

export function minutesToPx(minutes: number): number {
  return (minutes / 60) * GRID.pxPerHour
}

export function pxToMinutes(px: number): number {
  return (px / GRID.pxPerHour) * 60
}

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / GRID.slotMinutes) * GRID.slotMinutes
}

export interface Segment {
  dayIndex: number
  topPx: number
  heightPx: number
  /** False when the block is continued from the previous day, so the UI can square
   *  off that edge and omit the resize handle. */
  isStart: boolean
  isEnd: boolean
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * Break an event into the visible slices it occupies on a Mon-start week grid.
 *
 * Three things make this non-trivial and are why it is tested rather than inlined:
 * an event can cross midnight into another column; the grid floor at 06:00 means
 * part of an event may be invisible; and an event can lie entirely outside either
 * the week or the visible hours, in which case it contributes nothing.
 */
export function segmentsForEvent(start: Date, end: Date, weekStart: Date): Segment[] {
  const out: Segment[] = []
  const weekBegin = startOfDay(weekStart)

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const day = addDays(weekBegin, dayIndex)
    const visibleFrom = new Date(day)
    visibleFrom.setHours(GRID.startHour, 0, 0, 0)
    const visibleTo = new Date(day)
    visibleTo.setHours(0, 0, 0, 0)
    visibleTo.setHours(GRID.endHour, 0, 0, 0)

    const lo = start > visibleFrom ? start : visibleFrom
    const hi = end < visibleTo ? end : visibleTo
    if (hi <= lo) continue

    const topMinutes = (lo.getTime() - visibleFrom.getTime()) / 60000
    const durationMinutes = (hi.getTime() - lo.getTime()) / 60000

    out.push({
      dayIndex,
      topPx: minutesToPx(topMinutes),
      heightPx: Math.max(GRID.minBlockPx, minutesToPx(durationMinutes)),
      isStart: lo.getTime() === start.getTime(),
      isEnd: hi.getTime() === end.getTime(),
    })
  }

  return out
}

/** Hour labels down the gutter. */
export function hourMarks(): number[] {
  const out: number[] = []
  for (let h = GRID.startHour; h <= GRID.endHour; h += 1) out.push(h)
  return out
}
```

Note `visibleTo` is built by setting hours to `GRID.endHour` on a midnight-normalised
date, so `endHour === 24` correctly lands on the next midnight.

- [ ] **Step 4: Create `frontend/src/lib/color.ts`**

```ts
/** Event blocks are the tag colour at low opacity with a solid bar in the full colour.
 *  Tag colours arrive from the database as `#rrggbb`. */
export function tint(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
```

- [ ] **Step 5: Create `frontend/src/hooks/useTags.ts`**

```ts
import { useQuery } from '@tanstack/react-query'

import { listTags } from '../api/tags'
import { qk } from '../api/keys'
import type { Tag } from '../api/types'

export function useTags(includeArchived = false) {
  return useQuery({
    queryKey: [...qk.tags, includeArchived],
    queryFn: () => listTags(includeArchived),
  })
}

/** Archived tags are included: events keep pointing at them, so the grid still
 *  needs their colour and name to render history. */
export function useTagMap() {
  const { data } = useTags(true)
  const map = new Map<number, Tag>()
  for (const tag of data ?? []) map.set(tag.id, tag)
  return map
}
```

- [ ] **Step 6: Create the shared components**

`frontend/src/components/TagChip.tsx`:

```tsx
import { tint } from '../lib/color'
import type { Tag } from '../api/types'

export function TagChip({ tag, size = 'sm' }: { tag: Tag | undefined; size?: 'sm' | 'xs' }) {
  if (!tag) return null
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-2 py-px text-[11px]',
      ].join(' ')}
      style={{ background: tint(tag.color, 0.35), color: 'var(--ink)' }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: tag.color }}
        aria-hidden
      />
      {tag.name}
    </span>
  )
}
```

`frontend/src/components/VerdictPill.tsx`:

```tsx
import type { Verdict } from '../api/types'

const STYLE: Record<Verdict, { bg: string; label: string }> = {
  pass: { bg: 'var(--pass)', label: 'on target' },
  over: { bg: 'var(--over)', label: 'over' },
  under: { bg: 'var(--under)', label: 'under' },
}

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const s = STYLE[verdict]
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
      style={{ background: s.bg }}
    >
      {s.label}
    </span>
  )
}
```

`frontend/src/components/RatioBars.tsx` — the component that makes the rule visible. It draws each group's actual share against its permitted band, so "am I inside the rule" is answerable at a glance:

```tsx
import type { GroupResult } from '../api/types'
import { VerdictPill } from './VerdictPill'
import { formatMinutes } from '../lib/datetime'

export function RatioBars({
  groups,
  tolerance,
  compact = false,
}: {
  groups: GroupResult[]
  tolerance: number
  compact?: boolean
}) {
  // The widest share across groups sets the scale, so a 60% band and a 10% band are
  // both legible instead of the small one collapsing to a sliver.
  const scale = Math.max(...groups.map((g) => Math.max(g.share_actual, g.share_target * (1 + tolerance))), 0.01)

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => {
        const lo = g.share_target * (1 - tolerance)
        const hi = g.share_target * (1 + tolerance)
        return (
          <div key={g.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-xs text-ink-muted">{compact ? g.key : g.label}</span>
              <span className="flex items-center gap-2 text-xs">
                <span className="tabular-nums">{(g.share_actual * 100).toFixed(1)}%</span>
                <VerdictPill verdict={g.verdict} />
              </span>
            </div>
            <div className="relative h-2.5 rounded-full" style={{ background: 'var(--line)' }}>
              {/* the permitted band */}
              <div
                className="absolute inset-y-0 rounded-full"
                style={{
                  left: `${(lo / scale) * 100}%`,
                  width: `${((hi - lo) / scale) * 100}%`,
                  background: 'var(--pale)',
                }}
              />
              {/* the actual share */}
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${(g.share_actual / scale) * 100}%`,
                  background:
                    g.verdict === 'pass' ? 'var(--pass)' : g.verdict === 'over' ? 'var(--over)' : 'var(--under)',
                  opacity: 0.85,
                }}
              />
              {/* the target */}
              <div
                className="absolute inset-y-[-3px] w-px"
                style={{ left: `${(g.share_target / scale) * 100}%`, background: 'var(--ink)' }}
              />
            </div>
            {!compact && (
              <div className="mt-1 text-[11px] text-ink-faint">
                {formatMinutes(g.minutes)} · target {(g.share_target * 100).toFixed(0)}% · band{' '}
                {(lo * 100).toFixed(0)}–{(hi * 100).toFixed(0)}%
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

`frontend/src/components/Modal.tsx` and `Field.tsx`: a `<dialog>`-free overlay (fixed backdrop, centred card using `--surface-raised`, `--radius`, `--shadow-card`, Escape to close, click-backdrop to close) and a labelled input wrapper. Keep both under 40 lines; they are chrome.

- [ ] **Step 7: Run the tests and the build**

Run: `cd Avery/frontend && npx vitest run && npm run build`
Expected: 15 tests pass (5 datetime + 10 geometry); build clean.

- [ ] **Step 8: Commit**

```bash
git add Avery/frontend
git commit -m "feat: add tested grid geometry and shared display components"
```

---

# Phase C — the views

### Task 7: Week view — the grid

**Files:**
- Create: `frontend/src/hooks/useWeek.ts`, `frontend/src/components/EventBlock.tsx`, `frontend/src/components/WeekGrid.tsx`, `frontend/src/pages/WeekPage.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `getWeek`, `segmentsForEvent`, `useTagMap`, `evaluatePeriod`
- Produces: `useWeek(day)`; `<WeekGrid>` rendering positioned blocks; `WeekPage` with `‹ › Today` and the rule rail

- [ ] **Step 1: Create `frontend/src/hooks/useWeek.ts`**

```ts
import { useQuery } from '@tanstack/react-query'

import { getWeek } from '../api/calendar'
import { evaluatePeriod } from '../api/analytics'
import { qk } from '../api/keys'
import { addDays, formatDate, formatLocal } from '../lib/datetime'

export function useWeek(monday: Date) {
  const day = formatDate(monday)
  return useQuery({ queryKey: qk.week(day), queryFn: () => getWeek(day) })
}

/** The rule rail: the same evaluation the Review page runs, scoped to this week. */
export function useWeekRatios(monday: Date) {
  const start = formatLocal(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate()))
  const end = formatLocal(addDays(monday, 7))
  return useQuery({
    queryKey: qk.evaluate(start, end),
    queryFn: () => evaluatePeriod({ period_start: start, period_end: end }),
    retry: false, // a 409 "no active rule" is a state, not a transient failure
  })
}
```

- [ ] **Step 2: Create `frontend/src/components/EventBlock.tsx`**

```tsx
import { Link } from 'react-router-dom'

import type { AveryEvent, Tag } from '../api/types'
import type { Segment } from '../lib/geometry'
import { formatTimeRange } from '../lib/datetime'
import { tint } from '../lib/color'

export function EventBlock({
  event,
  segment,
  tag,
  title,
  onPointerDownMove,
  onPointerDownResize,
}: {
  event: AveryEvent
  segment: Segment
  tag: Tag | undefined
  title: string
  onPointerDownMove?: (e: React.PointerEvent) => void
  onPointerDownResize?: (e: React.PointerEvent, edge: 'start' | 'end') => void
}) {
  const color = tag?.color ?? 'var(--pale)'
  return (
    <div
      className="absolute inset-x-1 overflow-hidden text-left"
      style={{
        top: segment.topPx,
        height: segment.heightPx,
        background: tint(color, 0.22),
        borderLeft: `3px solid ${color}`,
        borderTopLeftRadius: segment.isStart ? 6 : 0,
        borderTopRightRadius: segment.isStart ? 6 : 0,
        borderBottomLeftRadius: segment.isEnd ? 6 : 0,
        borderBottomRightRadius: segment.isEnd ? 6 : 0,
        cursor: onPointerDownMove ? 'grab' : 'default',
      }}
      onPointerDown={onPointerDownMove}
    >
      {segment.isStart && onPointerDownResize && (
        <div
          className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
          onPointerDown={(e) => {
            e.stopPropagation()
            onPointerDownResize(e, 'start')
          }}
        />
      )}
      <Link
        to={`/tasks/${event.task_id}`}
        className="block px-1.5 py-0.5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="truncate text-[11px] font-medium leading-tight">{title}</div>
        {segment.heightPx > 30 && (
          <div className="truncate text-[10px] text-ink-muted">
            {formatTimeRange(event.start_at, event.end_at)}
          </div>
        )}
      </Link>
      {segment.isEnd && onPointerDownResize && (
        <div
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
          onPointerDown={(e) => {
            e.stopPropagation()
            onPointerDownResize(e, 'end')
          }}
        />
      )}
    </div>
  )
}
```

The `Link` stops pointer-down propagation so clicking the title navigates instead of starting a drag; the resize strips stop it so grabbing an edge resizes instead of moving.

- [ ] **Step 3: Create `frontend/src/components/WeekGrid.tsx`**

Renders the gutter, seven day columns with hour rules, a "now" line when the week contains today, and one `EventBlock` per segment. It takes `events`, `weekStart`, `tagMap`, and optional drag callbacks, and computes segments with `segmentsForEvent`. Height is `GRID_HEIGHT_PX`; the container scrolls. Keep drag logic out of this file — Task 8 adds it via the callback props already in `EventBlock`.

Key structure:

```tsx
<div className="grid" style={{ gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }}>
  {/* gutter with hourMarks() labels */}
  {/* 7 columns, each `relative` with height GRID_HEIGHT_PX and hour separator divs */}
</div>
```

- [ ] **Step 4: Create `frontend/src/pages/WeekPage.tsx`**

Owns the visible Monday in state (`useState(() => mondayOf(new Date()))`), renders `‹ › Today` plus the week's date range, the `WeekGrid`, and a left rail showing `RatioBars` from `useWeekRatios` in compact form. Shows a one-line notice when `week.materialized` is true — "Generated from your template" — and a quiet empty state with a "Generate from template" button (calling `materializeWeek`) when the week is empty and in the past.

Wire the real pages into `main.tsx`, replacing the `Week` placeholder.

- [ ] **Step 5: Verify against the running backend**

Start the backend, then `npm run dev`, and confirm: the current week renders 53 seeded events; the rest block appears on both the day it starts and the next; `›` twice shows an empty far-future week; the rail shows A/B/C bars.

Run: `cd Avery/frontend && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add Avery/frontend
git commit -m "feat: add the week grid with positioned event blocks and the rule rail"
```

---

### Task 8: Week view — drag to move and resize

**Files:**
- Modify first (backend prerequisite): `backend/app/services/calendar.py`, `backend/tests/test_calendar.py`
- Create: `frontend/src/hooks/useEventDrag.ts`, `frontend/src/lib/drag.ts`, `frontend/src/lib/drag.test.ts`
- Modify: `frontend/src/components/WeekGrid.tsx`, `frontend/src/hooks/useWeek.ts`

**Prerequisite — a bled-over event must not suppress the week.** Found while verifying
Task 7 and reproduced: `get_week` gates lazy materialization on `if not rows`, where
`rows` is every event *overlapping* the week. So a single event from the previous Sunday
running past midnight makes the new week look touched, and nothing materializes — you open
Monday to one sliver instead of your week.

Judge emptiness by whether any event *starts* inside the week. An event bleeding in from
before is not the user having touched this week. In `get_week`:

```python
    rows = await event_service.list_events(session, start=start, end=end)
    # An event bleeding in from the previous week is not the user having touched this
    # one. Gating on overlap let a single Sunday-night block suppress the whole week's
    # materialization, leaving a blank Monday.
    starts_here = [e for e in rows if start <= e.start_at < end]
    materialized = False

    if not starts_here and allow_materialize and _is_materializable(monday):
```

The rest of the function is unchanged. `materialize_week`'s own per-day guard still
protects the day the bleed lands on, so that day is skipped while the other six fill —
which is the accepted day-level coarseness, not a new problem.

Add to `backend/tests/test_calendar.py`:

```python
async def test_an_event_bleeding_in_does_not_suppress_the_week(client):
    """Gating materialization on overlap let one Sunday-night block from the previous
    week blank the entire following week."""
    await _template(client, [WEEKDAY_BLOCK])
    monday = _this_monday()
    prev_sunday = monday - timedelta(days=1)

    await client.post(
        "/api/events",
        json={
            "task_name": "Late night",
            "start_at": f"{prev_sunday.isoformat()}T22:00:00",
            "end_at": f"{monday.isoformat()}T02:00:00",
        },
    )

    body = (await client.get(f"/api/weeks/{monday.isoformat()}")).json()
    assert body["materialized"] is True
    # Monday itself is skipped because the bleed occupies it; the other four weekdays fill.
    assert len(body["events"]) == 5  # 4 materialized + the bled-over one
```

Import `timedelta` in that test module if it is not already imported.

**Interfaces:**
- Consumes: `moveEvent`, `updateEvent`, `snapMinutes`, `pxToMinutes`
- Produces: `resolveDrag(...)` pure planner; `useEventDrag()` binding pointer events to optimistic mutations

- [ ] **Step 1: Write the failing test — `frontend/src/lib/drag.test.ts`**

```ts
import { describe, expect, it } from 'vitest'

import { parseLocal } from './datetime'
import { resolveDrag } from './drag'

const ev = { start_at: '2026-08-03T09:00:00', end_at: '2026-08-03T10:30:00' }

describe('resolveDrag — move', () => {
  it('snaps and preserves duration', () => {
    const r = resolveDrag(ev, { kind: 'move', deltaMinutes: 22, deltaDays: 0 })
    expect(r).toEqual({ kind: 'move', start_at: '2026-08-03T09:15:00' })
  })

  it('shifts whole days', () => {
    const r = resolveDrag(ev, { kind: 'move', deltaMinutes: 0, deltaDays: 2 })
    expect(r).toEqual({ kind: 'move', start_at: '2026-08-05T09:00:00' })
  })

  it('is a no-op when nothing moved', () => {
    expect(resolveDrag(ev, { kind: 'move', deltaMinutes: 3, deltaDays: 0 })).toBeNull()
  })
})

describe('resolveDrag — resize', () => {
  it('drags the end edge later', () => {
    const r = resolveDrag(ev, { kind: 'resize', edge: 'end', deltaMinutes: 30 })
    expect(r).toEqual({ kind: 'patch', body: { end_at: '2026-08-03T11:00:00' } })
  })

  it('drags the start edge earlier', () => {
    const r = resolveDrag(ev, { kind: 'resize', edge: 'start', deltaMinutes: -60 })
    expect(r).toEqual({ kind: 'patch', body: { start_at: '2026-08-03T08:00:00' } })
  })

  it('refuses to collapse an event below one slot', () => {
    // end dragged back past start would invert it; clamp to a 15-minute floor.
    const r = resolveDrag(ev, { kind: 'resize', edge: 'end', deltaMinutes: -120 })
    expect(r).toEqual({ kind: 'patch', body: { end_at: '2026-08-03T09:15:00' } })
  })

  it('refuses to collapse from the start edge either', () => {
    const r = resolveDrag(ev, { kind: 'resize', edge: 'start', deltaMinutes: 120 })
    expect(r).toEqual({ kind: 'patch', body: { start_at: '2026-08-03T10:15:00' } })
  })

  it('preserves an overnight event when only the end moves', () => {
    const overnight = { start_at: '2026-08-03T23:00:00', end_at: '2026-08-04T07:00:00' }
    const r = resolveDrag(overnight, { kind: 'resize', edge: 'end', deltaMinutes: 60 })
    expect(r).toEqual({ kind: 'patch', body: { end_at: '2026-08-04T08:00:00' } })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Avery/frontend && npx vitest run src/lib/drag.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/lib/drag.ts`**

```ts
import { GRID, snapMinutes } from './geometry'
import { formatLocal, parseLocal } from './datetime'

export type DragIntent =
  | { kind: 'move'; deltaMinutes: number; deltaDays: number }
  | { kind: 'resize'; edge: 'start' | 'end'; deltaMinutes: number }

export type DragPlan =
  | { kind: 'move'; start_at: string }
  | { kind: 'patch'; body: { start_at?: string; end_at?: string } }

const shift = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60000)

/**
 * Turn a pointer gesture into the request to send, or null when nothing changed.
 *
 * Pure on purpose: this is where snapping, day shifts and the minimum-duration clamp
 * live, and all three are easy to get subtly wrong in the middle of an event handler.
 * A move goes to POST /events/{id}/move, which preserves duration server-side; a
 * resize goes to PATCH, which validates the new bounds.
 */
export function resolveDrag(
  event: { start_at: string; end_at: string },
  intent: DragIntent,
): DragPlan | null {
  const start = parseLocal(event.start_at)
  const end = parseLocal(event.end_at)

  if (intent.kind === 'move') {
    const minutes = snapMinutes(intent.deltaMinutes) + intent.deltaDays * 24 * 60
    if (minutes === 0) return null
    return { kind: 'move', start_at: formatLocal(shift(start, minutes)) }
  }

  const minutes = snapMinutes(intent.deltaMinutes)
  if (minutes === 0) return null

  if (intent.edge === 'end') {
    const floor = shift(start, GRID.slotMinutes)
    const next = shift(end, minutes)
    return { kind: 'patch', body: { end_at: formatLocal(next < floor ? floor : next) } }
  }

  const ceiling = shift(end, -GRID.slotMinutes)
  const next = shift(start, minutes)
  return { kind: 'patch', body: { start_at: formatLocal(next > ceiling ? ceiling : next) } }
}
```

- [ ] **Step 4: Create `frontend/src/hooks/useEventDrag.ts`**

A hook returning `{ draft, onPointerDownMove, onPointerDownResize }`. On pointer-down it captures the pointer, records the origin, and tracks `draft` (the event id plus a live pixel offset) so the block follows the cursor without refetching. On pointer-up it calls `resolveDrag`, and if a plan comes back it fires the mutation:

```ts
  const move = useMutation({
    mutationFn: ({ id, start_at }: { id: number; start_at: string }) => moveEvent(id, start_at),
    onSettled: () => {
      // The week payload and every ratio derived from it are now stale.
      queryClient.invalidateQueries({ queryKey: ['week'] })
      queryClient.invalidateQueries({ queryKey: ['evaluate'] })
      queryClient.invalidateQueries({ queryKey: ['month'] })
    },
  })
```

The same `onSettled` applies to the resize mutation. Invalidating `evaluate` matters: moving an hour of work into the evening changes the ratios the rail displays, and a stale rail is worse than a blank one.

Column width for `deltaDays` comes from the grid element's measured width — read it once on pointer-down via `getBoundingClientRect()` on the column container rather than assuming a fixed size, so the drag stays correct when the window resizes.

- [ ] **Step 5: Wire it into `WeekGrid`**

Pass `onPointerDownMove` / `onPointerDownResize` to `EventBlock` and offset the rendered block by `draft` while a drag is live. Give the dragged block `cursor: grabbing`, raise its `z-index`, and drop opacity slightly so the drop target underneath stays readable.

- [ ] **Step 6: Run the tests and verify by hand**

Run: `cd Avery/frontend && npx vitest run && npm run build`
Expected: 22 frontend tests pass (5 + 10 + 7) and the backend suite reaches 146; build clean.

By hand against the running backend: drag a work block two hours later and confirm it lands on the quarter hour and the rail's percentages change; drag one to another day; drag the bottom edge to lengthen it; try to drag the bottom edge above the top and confirm it clamps to 15 minutes rather than inverting.

- [ ] **Step 7: Commit**

```bash
git add Avery/frontend
git commit -m "feat: add drag-to-move and drag-to-resize on the week grid"
```

---

### Task 9: Month view

**Files:**
- Create: `frontend/src/hooks/useMonth.ts`, `frontend/src/components/DayTagBar.tsx`, `frontend/src/pages/MonthPage.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `getMonth`, `listEvents`, `useTagMap`
- Produces: a month grid whose cells carry a stacked tag bar, with a side panel for the selected day

- [ ] **Step 1: Build the month grid**

`MonthPage` holds `viewMonth: Date` and `selected: string | null`. It renders a 7-column grid with leading blanks for the first-of-month's weekday, one cell per day showing the day number, `event_count`, `formatMinutes(total_minutes)`, and a `DayTagBar`. Today gets a ring; the selected day gets a filled background.

`DayTagBar` takes `minutes_by_primary_tag` and the tag map and renders a 4px stacked bar with one flex segment per tag, width proportional to minutes, coloured by `tag.color`. When the map lacks a tag id (archived and not yet loaded) fall back to `var(--pale)` rather than skipping the segment — dropping it would silently understate the day.

- [ ] **Step 2: Add the day panel**

Selecting a date fetches that day's events with `listEvents({start, end})` over `[date, date+1)` and lists them in a right-hand panel: time range, task name via the event's task, tag chips, and a link to the task detail. Above the list, show the day's total and, when `overlaps` is non-empty for the day, a quiet warning — the backend reports overlaps rather than deduplicating them, and the month total counts both.

- [ ] **Step 3: Verify and commit**

Confirm the seeded August shows bars on Aug 3–9 and empty cells elsewhere, that the overnight block contributes to two adjacent cells, and that clicking Aug 3 lists 8 events.

Run: `cd Avery/frontend && npm run build`

```bash
git add Avery/frontend
git commit -m "feat: add the month view with per-day tag bars and a day panel"
```

---

### Task 10: Tasks list and Task detail

**Files:**
- Create: `frontend/src/hooks/useTasks.ts`, `frontend/src/pages/TasksPage.tsx`, `frontend/src/pages/TaskDetailPage.tsx`, `frontend/src/components/TaskForm.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `listTasks`, `getTask`, `getTaskStats`, `createTask`, `updateTask`, `archiveTask`, `listReminders`, `createReminder`, `deleteReminder`
- Produces: three-section task list; detail page with the stats rollup and reminder management

- [ ] **Step 1: Build the list**

Three sections, matching the spec: **Scheduled** (`listTasks()` filtered to non-floating, non-done), **Floating** (`listTasks({floating_only: true})` — the real query added in Task 3, not a client-side guess), **Done** (`listTasks({status_filter: 'done'})`). Each row: name, tag chips, due date, a reminder bell when one is pending, and a checkbox that PATCHes `status`. Overdue rows tint with `--over`. A "New task" button opens `TaskForm` in a `Modal`.

- [ ] **Step 2: Build the detail page**

Header: name (inline-editable), tag chips, status control, notes textarea saving on blur. Then the rollup from `getTaskStats` as three figures — this week / this month / all time — using `formatMinutes`, plus `event_count`. Then two lists: **Upcoming** and **Recent**, each row linking to its day in the month view. Then reminders: existing ones with a dismiss and delete, and a form to add one (datetime input plus channel select).

Archiving is the removal path and the button must say so — "Archive" with a confirming modal explaining that its events and history are preserved. Do not label it "Delete"; the backend does not delete, and mislabelling it invites the user to expect data to disappear.

- [ ] **Step 3: Verify and commit**

Confirm the seeded "Work" task shows 50h this week and 15 tasks total appear under Scheduled with none under Floating.

Run: `cd Avery/frontend && npm run build`

```bash
git add Avery/frontend
git commit -m "feat: add the task list and task detail with the hours rollup"
```

---

### Task 11: Template editor

**Files:**
- Create: `frontend/src/hooks/useTemplate.ts`, `frontend/src/pages/TemplatePage.tsx`, `frontend/src/components/BlockForm.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `getActiveTemplate`, `updateTemplate`, `createBlock`, `updateBlock`, `deleteBlock`, `previewWeek`
- Produces: the three-column editor mirroring the source layout, plus a non-writing preview

- [ ] **Step 1: Build the three columns**

Group blocks by **exact** `days` match into four canonical columns, then a fifth for the rest:

| `days` | Column |
|---|---|
| `[1,2,3,4,5,6,7]` | **Every day** |
| `[1,2,3,4,5]` | **Mon–Fri** |
| `[6]` | **Saturday** |
| `[7]` | **Sunday** |
| anything else | **Custom**, with the day set spelled out |

**Match exactly — never by superset.** The seeded rest block is `[1..7]`, and folding it into
Mon–Fri because it contains those days would tell the user sleep is scheduled on weekdays
only, when in fact it runs every night. It is the one block that genuinely applies daily,
which is why "Every day" is its own column rather than a Custom oddity.

The data model allows arbitrary day sets, so the Custom column must exist and must spell
out its members; silently hiding a block would lose part of the schedule with no
indication.

Each block row shows time range, task name, and a tag chip, sorted by `start_time`. Clicking opens `BlockForm` for a partial PATCH; a delete button removes it.

- [ ] **Step 2: Add the preview**

A "Preview next week" button calls `previewWeek(formatDate(addDays(mondayOf(new Date()), 7)))` and renders the returned rows in a read-only `WeekGrid`-shaped list. Label it clearly as a preview that writes nothing, and show the count. If the response's `events` is empty because every day is already occupied, say that rather than showing a blank grid.

- [ ] **Step 3: Verify and commit**

Confirm the seeded template's 19 blocks distribute as **Every day 1, Mon–Fri 7, Saturday 5, Sunday 6, Custom 0** — verified against `SEED_BLOCKS`, whose day-sets are exactly `[6]`×5, `[7]`×6, `[1,2,3,4,5]`×7, and `[1..7]`×1. Also confirm renaming a block persists across a reload, and that previewing creates no events (compare `GET /api/events` counts before and after).

Run: `cd Avery/frontend && npm run build`

```bash
git add Avery/frontend
git commit -m "feat: add the template editor with a non-writing week preview"
```

---

### Task 12: Rules editor

**Files:**
- Create: `frontend/src/hooks/useRules.ts`, `frontend/src/pages/RulesPage.tsx`, `frontend/src/components/RuleEditor.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `getActiveRule`, `listRules`, `createRuleVersion`, `deleteRule`, `useTags`
- Produces: the active-rule editor and the version timeline

- [ ] **Step 1: Build the active rule card**

Group rows with a ratio stepper, a tolerance slider (0–50%, shown as a percentage), and a tag picker per group. Beneath, an "Excluded from the ratio" picker. Live-preview the resulting bands as text — "A: 48–72%" — recomputed from the edited ratios and tolerance, so the consequence of a change is visible before saving.

**Saving creates a version, and the UI must say so.** The save button reads "Save as new version" and opens a modal requiring a `note` ("why are you changing this?"), because the note is the feedback record the monthly review reads. Explain in one line that past reports keep the rule they were generated with.

- [ ] **Step 2: Surface the backend's validation**

The backend rejects a tag that is both excluded and grouped, a tag in two groups, and duplicate group keys — all 422. Catch `ApiError` and show its `detail` inline rather than a generic failure. Better still, disable the save button and explain the conflict while it exists: the picker knows which tags are already taken, so this is preventable client-side, and the 422 is the backstop.

- [ ] **Step 3: Build the version timeline**

`listRules()` newest-first, each entry showing name, date range, tolerance, ratios, and the note. The open version is marked active. A version no report references can be deleted; one that is referenced returns 409, so show that message rather than a crash.

- [ ] **Step 4: Verify and commit**

Confirm the seeded rule renders as 6:3:1 with bands 48–72 / 24–36 / 8–12, that a conflicting tag assignment is blocked, and that saving a change produces a second timeline entry with the first one closed.

Run: `cd Avery/frontend && npm run build`

```bash
git add Avery/frontend
git commit -m "feat: add the rules editor with band preview and version timeline"
```

---

### Task 13: Review page

**Files:**
- Create: `frontend/src/hooks/useReports.ts`, `frontend/src/pages/ReviewPage.tsx`, `frontend/src/components/GroupChart.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `listReports`, `runReport`, `evaluatePeriod`, `Report.rule`
- Produces: month picker, run action, the report view with charts and warnings

- [ ] **Step 1: Build the report view**

A month picker defaulting to last month, a "Run review" button, and the resulting report. The header names the rule version and its `effective_from` — available directly on `report.rule`, which is why Task 2 embedded it.

Body: `RatioBars` in full form, then a `GroupChart` (recharts `BarChart`) plotting each group's actual share against its band as a reference area, then the totals — tracked, excluded, unassigned, untagged. Show `narrative` when it is not the placeholder; when it is, say the written summary arrives with the agent rather than printing the placeholder string.

- [ ] **Step 2: Surface the honest warnings**

Three conditions the backend reports and the UI must not swallow:

- `unassigned_minutes > 0` — name the tag ids and link to the Rules page, since the fix is to assign them to a group.
- `untagged_minutes > 0` — say how many hours have no tag at all; these are invisible to the rule.
- `overlaps` non-empty — say how many pairs overlap and that both were counted, because the total is inflated by the overlap.

`has_data === false` gets an explicit empty state, not a page of zeros.

- [ ] **Step 3: List prior runs**

Reports are append-only, so a month can have several. Show the latest by default with earlier runs listed beneath by `created_at`, each selectable. Two runs of the same month under different rules are legitimately different, and the header's rule name is what distinguishes them.

- [ ] **Step 4: Verify and commit**

Run a review for 2026-08 against the seeded data and confirm A pass / B over / C under for the full month, that the rule name shows, and that re-running appends a second entry rather than replacing the first.

Run: `cd Avery/frontend && npm run build`

```bash
git add Avery/frontend
git commit -m "feat: add the review page with group charts and honest data warnings"
```

---

### Task 14: Launch config, README, end-to-end pass

**Files:**
- Create: `Avery/.claude/launch.json`, `frontend/README.md`
- Modify: `Avery/backend/README.md`

- [ ] **Step 1: Add `Avery/.claude/launch.json`**

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "avery-frontend",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 5173
    }
  ]
}
```

- [ ] **Step 2: Write `frontend/README.md`**

Cover: `npm install`; `npm run dev` on 5173 proxying `/api` to 8001; that the backend must be running on 8001 and seeded first; `npx vitest run` for the geometry and drag suites; and that the palette lives only in `src/theme.css`.

- [ ] **Step 3: Cross-link the backend README**

Add a line pointing at `../frontend` and noting the dev proxy, so someone starting from the backend finds the UI.

- [ ] **Step 4: Full end-to-end pass**

With both running against a freshly seeded database, walk every view: week renders and drags; month drills in; a task shows its rollup; a template block edits and previews; a rule saves a version and shows its bands; a review runs and warns. Fix whatever this surfaces.

- [ ] **Step 5: Final checks**

```bash
cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/ -q   # 144
cd Avery/frontend && npx vitest run && npm run build                   # 22, clean
```

- [ ] **Step 6: Commit**

```bash
git add Avery
git commit -m "chore: add frontend launch config, READMEs, and end-to-end verification"
```

---

## Self-Review

**Spec coverage**

| Spec section | Covered by |
|---|---|
| §7 Week view (grid, arrows, drag-to-move, drag-to-resize, card→task) | Tasks 7, 8 |
| §7 Week view rule rail | Task 7 (`useWeekRatios` + `RatioBars`) |
| §7 Month view (stacked tag bar, day drill-down) | Task 9 |
| §7 Tasks (Scheduled / Floating / Done, reminder bells) | Task 10 + Task 3's `floating_only` |
| §7 Task detail (hours rollups, occurrences, reminders) | Task 10 + Task 3's `/stats` |
| §7 Template editor (three columns, preview) | Task 11 + Task 2's preview route |
| §7 Rules editor (ratio steppers, tolerance, tag pickers, version timeline) | Task 12 |
| §7 Review (bars vs bands, charts, narrative, warnings) | Task 13 + Task 2's rule embed |
| §11 Theme | Task 4 `theme.css`, used everywhere via tokens |
| §7 Avery agent drawer | **Plan 3** — not in scope here |
| §12 Testing (light frontend, smoke per route) | Tasks 5, 6, 8 unit suites; Task 14 manual pass |

Backlog items closed by this plan: archived-task reminder leak, `find_or_create_by_name` resurrecting archived tasks, tag validation on tasks and template blocks, `PATCH /api/templates`, partial block patch, week preview, `ReportOut` rule embed, `minutes_by_tag` rename, task stats, floating query.

Backlog items deliberately still open: `Event.template_block_id` as a real FK; the `conftest.py` per-request session; moving `RuleSpec` out of `services/rules.py`; the `HTTP_422_UNPROCESSABLE_ENTITY` rename; the Template→blocks ORM cascade test; `GET /api/months/9999-12` overflow; and whether a task should ever be hard-deletable.

**Placeholder scan:** no TBD or TODO. Tasks 9–13 describe components in prose rather than full code, deliberately — they are compositions of the primitives built in Tasks 4–6, and the load-bearing arithmetic (geometry, drag, band rendering) is given as complete tested code in Tasks 6 and 8. Every task states its files, its data sources, and a concrete verification against the seeded database.

**Type consistency:** `Segment` is defined in Task 6 and consumed in Tasks 7–8. `AveryEvent` avoids colliding with the DOM `Event` type and is used consistently. `formatLocal` is the only path for outbound datetimes, defined in Task 5 and used in Tasks 8, 10, 13. `qk` keys defined in Task 5 are the same strings invalidated in Task 8. `TaskStats` and `PreviewResult` are produced by Phase A and typed in Task 5's `types.ts`. The backend's `minutes_by_primary_tag` rename in Task 2 matches the `MonthDay` and `Metrics` interfaces in Task 5.

**Test counts:** backend 133 → 137 (Task 1) → 142 (Task 2) → 145 (Task 3) → 146 (Task 8 prerequisite). Frontend 5 (Task 5) → 15 (Task 6) → 22 (Task 8).
