# Google-Calendar-grade Week View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Avery's week view with Google Calendar's layout and interaction vocabulary — task-vs-event cards, completion, category filtering, pinch zoom, end-of-day roll-over — on Avery's own palette.

**Architecture:** Four layers, built bottom-up. The backend gains `kind`/`completed_at` on `events` plus three endpoints. `lib/geometry.ts` stops treating pixels-per-hour as a constant so zoom can vary it. Card interaction moves into one gesture hook that arbitrates click vs double-click vs long-press. The shell (rail, chrome, dialogs) sits on top and owns persistence.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + alembic + pytest-asyncio (backend); React 19 + TypeScript + Vite + Tailwind 4 + TanStack Query 5 + react-router 7 + vitest (frontend).

**Spec:** `Avery/docs/superpowers/specs/2026-08-10-calendar-ui-redesign-design.md`

## Global Constraints

- **All commands run from the repo subdirectory**, not the repo root: backend commands from `Avery/backend`, frontend from `Avery/frontend`.
- **Every backend command must be prefixed `arch -arm64`.** The venv interpreter is a universal binary while the wheels are arm64; an x86_64 launch fails on `pydantic_core`. An "incompatible architecture" ImportError is never a code failure.
- **The backend runs on port 8001, never 8000.** A Docker container occupies `*:8000` on this machine and shadows anything started there.
- **No hex colour literals in frontend components.** Every colour is a token from `src/theme.css`, referenced as `var(--token)`. This is stated in `frontend/README.md` and holds for all new code.
- **The backend speaks naive local time.** Never call `toISOString()` on a Date destined for the API — use `formatLocal` / `formatDate` from `src/lib/datetime.ts`.
- **Vitest runs with `environment: 'node'`** (`vite.config.ts`). There is no DOM and no `localStorage` in tests. Anything tested must therefore be a pure function that takes its storage or clock as a parameter.
- **Query invalidation after any event write must cover all five keys**: `week`, `evaluate`, `month`, `tasks`, `events`. Four separate bugs in Plan 2 came from invalidating fewer. Task 8 extracts this into one helper; use it.
- **Commit after every task**, with the message given in that task's final step.

---

## File Structure

**Backend**

| Path | Responsibility |
|---|---|
| `alembic/versions/b7c21e4d9f10_event_kind_and_completion.py` | *new* — the two columns |
| `app/models/event.py` | *modify* — `EventKind`, `kind`, `completed_at` |
| `app/schemas/event.py` | *modify* — `kind` in/out, `completed_at` out, `EventRollOver` |
| `app/services/events.py` | *modify* — kind-aware create, complete, uncomplete, roll-over |
| `app/services/tasks.py` | *modify* — split `create_by_name` out of `find_or_create_by_name` |
| `app/routers/events.py` | *modify* — three endpoints |
| `tests/test_event_completion.py` | *new* — completion, task sync, roll-over |

**Frontend — pure logic (unit tested)**

| Path | Responsibility |
|---|---|
| `src/lib/geometry.ts` | *modify* — 24h grid, pixels-per-hour as a parameter |
| `src/lib/tagVisibility.ts` | *new* — hidden-tag persistence and the visibility predicate |
| `src/lib/rollover.ts` | *new* — the "should we prompt" predicate |

**Frontend — hooks**

| Path | Responsibility |
|---|---|
| `src/hooks/useGridZoom.ts` | *new* — pinch/ctrl-wheel → zoom scalar, anchored at the pointer |
| `src/hooks/useCardGestures.ts` | *new* — click vs double-click vs long-press arbitration |
| `src/hooks/useTagVisibility.ts` | *new* — React binding over `lib/tagVisibility` |
| `src/hooks/useRolloverPrompt.ts` | *new* — the 60s check and the prompt's open state |
| `src/hooks/useEventMutations.ts` | *new* — create / complete / uncomplete / roll-over |
| `src/hooks/useEventDrag.ts` | *modify* — zoom-aware, `pointercancel`, gesture-initiated |

**Frontend — components and pages**

| Path | Responsibility |
|---|---|
| `src/api/invalidate.ts` | *new* — the five-key invalidation, in one place |
| `src/components/EventCard.tsx` | *new*, replaces `EventBlock.tsx` — both card shapes |
| `src/components/Confetti.tsx` | *new* — the completion burst |
| `src/components/QuickCreatePopover.tsx` | *new* — click-empty-space creation |
| `src/components/CategoryRail.tsx` | *new* — tag swatches, shares, checkboxes |
| `src/components/MiniMonth.tsx` | *new* — the rail's month picker |
| `src/components/RolloverDialog.tsx` | *new* — the 22:00 prompt |
| `src/components/WeekGrid.tsx` | *modify* — one sticky scroll container |
| `src/pages/EventDetailPage.tsx` | *new* — `/events/:id` |
| `src/pages/WeekPage.tsx` | *modify* — wires the above together |
| `src/App.tsx` | *modify* — Google-style chrome, collapsible rail |

---

## Task 1: Event `kind` and `completed_at`

**Files:**
- Create: `Avery/backend/alembic/versions/b7c21e4d9f10_event_kind_and_completion.py`
- Modify: `Avery/backend/app/models/event.py`
- Modify: `Avery/backend/app/schemas/event.py`
- Test: `Avery/backend/tests/test_event_completion.py`

**Interfaces:**
- Produces: `EventKind` StrEnum (`EVENT = "event"`, `TASK = "task"`) in `app.models.event`; `Event.kind: str`, `Event.completed_at: datetime | None`; `EventCreate.kind: EventKind`; `EventOut.kind` and `EventOut.completed_at`.

- [ ] **Step 1: Write the failing test**

Create `Avery/backend/tests/test_event_completion.py`:

```python
from datetime import datetime


async def _event(client, *, kind="event", name="Work block", start="2026-08-03T09:00:00",
                 end="2026-08-03T10:00:00"):
    res = await client.post(
        "/api/events",
        json={"task_name": name, "kind": kind, "start_at": start, "end_at": end, "tag_ids": []},
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_event_defaults_to_kind_event(client):
    created = await _event(client)
    assert created["kind"] == "event"
    assert created["completed_at"] is None


async def test_event_can_be_created_as_a_task_card(client):
    created = await _event(client, kind="task", name="Renew passport")
    assert created["kind"] == "task"


async def test_unknown_kind_is_rejected(client):
    bad = await client.post(
        "/api/events",
        json={
            "task_name": "Nonsense",
            "kind": "reminder",
            "start_at": "2026-08-03T09:00:00",
            "end_at": "2026-08-03T10:00:00",
        },
    )
    assert bad.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_event_completion.py -v`
Expected: FAIL — `kind` is not a recognised field, so `created["kind"]` raises `KeyError`.

- [ ] **Step 3: Add the enum and columns to the model**

In `app/models/event.py`, add the enum next to `EventSource`:

```python
class EventKind(StrEnum):
    EVENT = "event"
    TASK = "task"
```

and two columns to `Event`, after `source`:

```python
    kind: Mapped[str] = mapped_column(String(8), default=EventKind.EVENT, nullable=False)
    # A card's own completion, distinct from Task.status: an appointment happening is
    # not a to-do being finished. Only kind="task" cards sync the two (see services).
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 4: Add the fields to the schemas**

In `app/schemas/event.py`, extend the import:

```python
from app.models.event import EventKind, EventSource
```

Add to `EventCreate`, after `tag_ids`:

```python
    kind: EventKind = EventKind.EVENT
```

Add to `EventOut`, after `tag_ids`:

```python
    kind: EventKind
    completed_at: datetime | None
```

Leave `EventUpdate` untouched — its `reject_explicit_null` validator cannot express
"clear `completed_at`", which is why completion gets its own endpoints in Task 2.

- [ ] **Step 5: Write the migration**

Create `Avery/backend/alembic/versions/b7c21e4d9f10_event_kind_and_completion.py`:

```python
"""event kind and completion

Revision ID: b7c21e4d9f10
Revises: 1a43aac6fa94
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7c21e4d9f10"
down_revision: Union[str, Sequence[str], None] = "1a43aac6fa94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default is required, not cosmetic: existing rows have no value and the
    # column is NOT NULL. Existing events are events, which is what they always were.
    op.add_column(
        "events",
        sa.Column("kind", sa.String(length=8), nullable=False, server_default="event"),
    )
    op.add_column("events", sa.Column("completed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "completed_at")
    op.drop_column("events", "kind")
```

- [ ] **Step 6: Run the tests and the migration**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_event_completion.py -v`
Expected: PASS (3 tests)

Run: `cd Avery/backend && arch -arm64 .venv/bin/alembic upgrade head && arch -arm64 .venv/bin/alembic downgrade -1 && arch -arm64 .venv/bin/alembic upgrade head`
Expected: three clean runs, no error. This proves the migration is reversible.

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest -q`
Expected: the full suite still passes (147 tests + 3 new).

- [ ] **Step 7: Commit**

```bash
git add Avery/backend/app/models/event.py Avery/backend/app/schemas/event.py Avery/backend/alembic/versions/b7c21e4d9f10_event_kind_and_completion.py Avery/backend/tests/test_event_completion.py
git commit -m "feat(backend): give events a kind and a completion timestamp"
```

---

## Task 2: A task card owns its Task one-to-one

**Files:**
- Modify: `Avery/backend/app/services/tasks.py`
- Modify: `Avery/backend/app/services/events.py:37-64`
- Test: `Avery/backend/tests/test_event_completion.py`

**Interfaces:**
- Consumes: `EventKind` from Task 1.
- Produces: `task_service.create_by_name(session, name, tag_ids) -> Task`.

- [ ] **Step 1: Write the failing test**

Append to `Avery/backend/tests/test_event_completion.py`:

```python
async def test_two_event_cards_with_one_name_share_a_task(client):
    a = await _event(client, name="Standup", start="2026-08-03T09:00:00",
                     end="2026-08-03T09:15:00")
    b = await _event(client, name="Standup", start="2026-08-04T09:00:00",
                     end="2026-08-04T09:15:00")
    assert a["task_id"] == b["task_id"]


async def test_two_task_cards_with_one_name_get_their_own_tasks(client):
    # A task card is a to-do with a slot. Sharing one Task would mean completing
    # Monday's card silently completes Tuesday's, and the Tasks page and the
    # calendar would then disagree about what is done.
    a = await _event(client, kind="task", name="Water plants",
                     start="2026-08-03T09:00:00", end="2026-08-03T09:15:00")
    b = await _event(client, kind="task", name="Water plants",
                     start="2026-08-04T09:00:00", end="2026-08-04T09:15:00")
    assert a["task_id"] != b["task_id"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_event_completion.py -k task_cards -v`
Expected: FAIL — the two ids are equal, because `find_or_create_by_name` reuses the Task.

- [ ] **Step 3: Split the create half out of `find_or_create_by_name`**

In `app/services/tasks.py`, replace the body of `find_or_create_by_name` and add a
sibling above it:

```python
async def create_by_name(session: AsyncSession, name: str, tag_ids: list[int]) -> Task:
    """Always mints a new Task. Used where reuse would be wrong — see create_event."""
    task = Task(name=name, tag_ids=list(tag_ids))
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


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
    existing = (await session.scalars(stmt)).first()
    if existing is not None:
        return existing
    return await create_by_name(session, name, tag_ids)
```

- [ ] **Step 4: Route task cards to `create_by_name` and persist `kind`**

In `app/services/events.py`, extend the import:

```python
from app.models.event import EventKind
```

Replace the task-resolution branch inside `create_event`:

```python
    if data.task_id is not None:
        task = await session.get(Task, data.task_id)
        if task is None:
            raise TaskNotFound(f"task {data.task_id} not found")
    elif data.kind == EventKind.TASK:
        # A task card is 1:1 with its Task so completion can sync without two cards
        # fighting over one status. Event cards keep reusing a Task by name, so
        # repeated "Standup" blocks still roll up to a single task's minutes.
        task = await task_service.create_by_name(session, data.task_name, tag_ids)
    else:
        task = await task_service.find_or_create_by_name(session, data.task_name, tag_ids)
```

and add `kind` to the `Event(...)` construction, after `tag_ids=tag_ids,`:

```python
        kind=data.kind,
```

- [ ] **Step 5: Run the tests**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_event_completion.py tests/test_events.py -v`
Expected: PASS

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest -q`
Expected: full suite green — template materialization still reuses tasks by name, because it creates `kind="event"` rows.

- [ ] **Step 6: Commit**

```bash
git add Avery/backend/app/services/tasks.py Avery/backend/app/services/events.py Avery/backend/tests/test_event_completion.py
git commit -m "feat(backend): give each task card its own Task"
```

---

## Task 3: Complete and uncomplete endpoints

**Files:**
- Modify: `Avery/backend/app/services/events.py`
- Modify: `Avery/backend/app/routers/events.py`
- Test: `Avery/backend/tests/test_event_completion.py`

**Interfaces:**
- Consumes: `EventKind`, `Event.completed_at` from Task 1.
- Produces: `POST /api/events/{id}/complete` and `POST /api/events/{id}/uncomplete`, both returning `EventOut`; service functions `complete_event(session, event_id) -> Event | None` and `uncomplete_event(session, event_id) -> Event | None`.

- [ ] **Step 1: Write the failing test**

Append to `Avery/backend/tests/test_event_completion.py`:

```python
async def test_complete_sets_the_timestamp_and_is_idempotent(client):
    event = await _event(client)
    first = await client.post(f"/api/events/{event['id']}/complete")
    assert first.status_code == 200
    assert first.json()["completed_at"] is not None

    second = await client.post(f"/api/events/{event['id']}/complete")
    assert second.status_code == 200
    # Completing twice must not slide the timestamp forward — a double-click that
    # lands twice would otherwise rewrite when the work happened.
    assert second.json()["completed_at"] == first.json()["completed_at"]


async def test_uncomplete_clears_the_timestamp_and_is_idempotent(client):
    event = await _event(client)
    await client.post(f"/api/events/{event['id']}/complete")
    cleared = await client.post(f"/api/events/{event['id']}/uncomplete")
    assert cleared.json()["completed_at"] is None
    again = await client.post(f"/api/events/{event['id']}/uncomplete")
    assert again.status_code == 200
    assert again.json()["completed_at"] is None


async def test_completing_a_task_card_marks_its_task_done(client):
    event = await _event(client, kind="task", name="Renew passport")
    await client.post(f"/api/events/{event['id']}/complete")
    task = (await client.get(f"/api/tasks/{event['task_id']}")).json()
    assert task["status"] == "done"
    assert task["completed_at"] is not None

    await client.post(f"/api/events/{event['id']}/uncomplete")
    task = (await client.get(f"/api/tasks/{event['task_id']}")).json()
    assert task["status"] == "todo"
    assert task["completed_at"] is None


async def test_completing_an_event_card_leaves_its_task_alone(client):
    event = await _event(client, name="Dentist")
    await client.post(f"/api/events/{event['id']}/complete")
    task = (await client.get(f"/api/tasks/{event['task_id']}")).json()
    assert task["status"] == "todo"


async def test_uncompleting_does_not_resurrect_an_archived_task(client):
    event = await _event(client, kind="task", name="Old chore")
    await client.post(f"/api/events/{event['id']}/complete")
    await client.delete(f"/api/tasks/{event['task_id']}")  # archives it
    await client.post(f"/api/events/{event['id']}/uncomplete")
    task = (await client.get(f"/api/tasks/{event['task_id']}")).json()
    assert task["status"] == "archived"


async def test_complete_on_a_missing_event_is_404(client):
    assert (await client.post("/api/events/9999/complete")).status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_event_completion.py -k "complete" -v`
Expected: FAIL — the routes do not exist, so every call returns 404 (405 for the missing-event case).

- [ ] **Step 3: Write the service functions**

In `app/services/events.py`, extend the model import to bring in `TaskStatus`:

```python
from app.models.task import TaskStatus
```

and append:

```python
async def complete_event(session: AsyncSession, event_id: int) -> Event | None:
    """Idempotent: an already-complete event keeps its original timestamp."""
    event = await session.get(Event, event_id)
    if event is None:
        return None
    if event.completed_at is None:
        event.completed_at = datetime.now()
    if event.kind == EventKind.TASK:
        task = await session.get(Task, event.task_id)
        # An archived task stays archived: completion must not un-archive it.
        if task is not None and task.status != TaskStatus.ARCHIVED:
            task.status = TaskStatus.DONE
            task.completed_at = event.completed_at
    await session.commit()
    await session.refresh(event)
    return event


async def uncomplete_event(session: AsyncSession, event_id: int) -> Event | None:
    event = await session.get(Event, event_id)
    if event is None:
        return None
    event.completed_at = None
    if event.kind == EventKind.TASK:
        task = await session.get(Task, event.task_id)
        # Guarded on DONE rather than "not archived": reopening a card must not drag
        # an archived task back into the active list.
        if task is not None and task.status == TaskStatus.DONE:
            task.status = TaskStatus.TODO
            task.completed_at = None
    await session.commit()
    await session.refresh(event)
    return event
```

- [ ] **Step 4: Add the routes**

In `app/routers/events.py`, insert above the `DELETE /{event_id}` route:

```python
@router.post("/{event_id}/complete", response_model=EventOut)
async def complete_event(event_id: int, session: AsyncSession = Depends(get_session)):
    event = await service.complete_event(session, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return event


@router.post("/{event_id}/uncomplete", response_model=EventOut)
async def uncomplete_event(event_id: int, session: AsyncSession = Depends(get_session)):
    event = await service.uncomplete_event(session, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    return event
```

- [ ] **Step 5: Run the tests**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_event_completion.py -v`
Expected: PASS

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest -q`
Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add Avery/backend/app/services/events.py Avery/backend/app/routers/events.py Avery/backend/tests/test_event_completion.py
git commit -m "feat(backend): complete and uncomplete an event"
```

---

## Task 4: Roll-over endpoint

**Files:**
- Modify: `Avery/backend/app/schemas/event.py`
- Modify: `Avery/backend/app/services/events.py`
- Modify: `Avery/backend/app/routers/events.py`
- Test: `Avery/backend/tests/test_event_completion.py`

**Interfaces:**
- Produces: `POST /api/events/roll-over` taking `{event_ids: list[int], to_date: date}` and returning `list[EventOut]`; `service.roll_over(session, event_ids, to_date) -> list[Event]`; `service.RollOverRejected` exception.

- [ ] **Step 1: Write the failing test**

Append to `Avery/backend/tests/test_event_completion.py`:

```python
async def test_roll_over_preserves_wall_clock_time(client):
    event = await _event(client, kind="task", name="Water plants",
                         start="2026-08-03T21:30:00", end="2026-08-03T22:15:00")
    rolled = await client.post(
        "/api/events/roll-over",
        json={"event_ids": [event["id"]], "to_date": "2026-08-04"},
    )
    assert rolled.status_code == 200
    moved = rolled.json()[0]
    assert moved["start_at"] == "2026-08-04T21:30:00"
    assert moved["end_at"] == "2026-08-04T22:15:00"


async def test_roll_over_refuses_an_event_card(client):
    event = await _event(client, name="Dentist")
    bad = await client.post(
        "/api/events/roll-over",
        json={"event_ids": [event["id"]], "to_date": "2026-08-04"},
    )
    # Refused, not silently skipped: a caller asking to move an appointment has a
    # bug, and a partial success would hide it.
    assert bad.status_code == 422


async def test_roll_over_refuses_an_already_complete_card(client):
    event = await _event(client, kind="task", name="Water plants")
    await client.post(f"/api/events/{event['id']}/complete")
    bad = await client.post(
        "/api/events/roll-over",
        json={"event_ids": [event["id"]], "to_date": "2026-08-04"},
    )
    assert bad.status_code == 422


async def test_roll_over_refuses_an_unknown_id_without_moving_the_rest(client):
    event = await _event(client, kind="task", name="Water plants",
                         start="2026-08-03T21:30:00", end="2026-08-03T22:15:00")
    bad = await client.post(
        "/api/events/roll-over",
        json={"event_ids": [event["id"], 9999], "to_date": "2026-08-04"},
    )
    assert bad.status_code == 422
    unchanged = (await client.get(f"/api/events/{event['id']}")).json()
    assert unchanged["start_at"] == "2026-08-03T21:30:00"


async def test_roll_over_requires_at_least_one_id(client):
    bad = await client.post(
        "/api/events/roll-over", json={"event_ids": [], "to_date": "2026-08-04"}
    )
    assert bad.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_event_completion.py -k roll_over -v`
Expected: FAIL — the route does not exist; `POST /api/events/roll-over` is matched by the
`POST /api/events/{event_id}/...` patterns or 404s.

- [ ] **Step 3: Add the request schema**

In `app/schemas/event.py`, extend the datetime import to `from datetime import date, datetime`
and append:

```python
class EventRollOver(BaseModel):
    event_ids: list[int] = Field(min_length=1)
    to_date: date
```

- [ ] **Step 4: Write the service function**

In `app/services/events.py`, add the exception next to `TaskNotFound`:

```python
class RollOverRejected(Exception):
    """Raised when a roll-over request names something it may not move."""
```

and append:

```python
async def roll_over(
    session: AsyncSession, event_ids: list[int], to_date: date
) -> list[Event]:
    """Shift whole task cards onto another date, keeping wall-clock time and duration.

    All-or-nothing on purpose: every id is validated before anything moves, so a
    request with one bad id leaves the calendar exactly as it was.
    """
    stmt = select(Event).where(Event.id.in_(event_ids)).order_by(Event.start_at, Event.id)
    events = list((await session.scalars(stmt)).all())

    found = {e.id for e in events}
    missing = [i for i in event_ids if i not in found]
    if missing:
        raise RollOverRejected(f"unknown event ids: {missing}")
    not_tasks = [e.id for e in events if e.kind != EventKind.TASK]
    if not_tasks:
        raise RollOverRejected(f"not task cards, will not be moved: {not_tasks}")
    already_done = [e.id for e in events if e.completed_at is not None]
    if already_done:
        raise RollOverRejected(f"already complete: {already_done}")

    for event in events:
        # A whole-day delta, so an event that runs past midnight keeps its shape.
        delta = to_date - event.start_at.date()
        event.start_at = event.start_at + delta
        event.end_at = event.end_at + delta

    await session.commit()
    for event in events:
        await session.refresh(event)
    return events
```

Add `date` to the top-level datetime import: `from datetime import date, datetime`.

- [ ] **Step 5: Add the route**

In `app/routers/events.py`, extend the schema import to include `EventRollOver`, and
insert the route **above** `@router.get("/{event_id}")` — a literal path segment
registered after a parameterised one is never reached:

```python
@router.post("/roll-over", response_model=list[EventOut])
async def roll_over(data: EventRollOver, session: AsyncSession = Depends(get_session)):
    try:
        return await service.roll_over(session, data.event_ids, data.to_date)
    except service.RollOverRejected as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
```

- [ ] **Step 6: Run the tests**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_event_completion.py -v`
Expected: PASS

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest -q`
Expected: full suite green.

- [ ] **Step 7: Commit**

```bash
git add Avery/backend/app/schemas/event.py Avery/backend/app/services/events.py Avery/backend/app/routers/events.py Avery/backend/tests/test_event_completion.py
git commit -m "feat(backend): roll incomplete task cards onto another date"
```

---

## Task 5: A 24-hour grid with a variable scale

**Files:**
- Modify: `Avery/frontend/src/lib/geometry.ts`
- Modify: `Avery/frontend/src/lib/geometry.test.ts`
- Modify (only if it references the removed constant): `Avery/frontend/src/lib/drag.test.ts`

**Interfaces:**
- Produces: `GRID.basePxPerHour = 56`, `GRID.baseColumnPx = 120`, `GRID.minZoom = 0.5`, `GRID.maxZoom = 3`; `gridHeightPx(pxPerHour)`; `minutesToPx(minutes, pxPerHour)`; `pxToMinutes(px, pxPerHour)`; `segmentsForEvent(start, end, weekStart, pxPerHour)`. `GRID.pxPerHour` no longer exists — every caller passes a scale.

- [ ] **Step 1: Rewrite the test file**

Replace `Avery/frontend/src/lib/geometry.test.ts` entirely:

```ts
import { describe, expect, it } from 'vitest'

import { parseLocal } from './datetime'
import { GRID, gridHeightPx, pxToMinutes, minutesToPx, segmentsForEvent, snapMinutes } from './geometry'

const week = new Date(2026, 7, 3) // Monday 2026-08-03
const PX = GRID.basePxPerHour

const seg = (startAt: string, endAt: string, pxPerHour = PX) =>
  segmentsForEvent(parseLocal(startAt), parseLocal(endAt), week, pxPerHour)

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
  it('round-trips through minutes at any scale', () => {
    expect(pxToMinutes(minutesToPx(90, PX), PX)).toBeCloseTo(90)
    expect(pxToMinutes(minutesToPx(90, PX * 2.5), PX * 2.5)).toBeCloseTo(90)
  })

  it('measures an hour as the scale it was given', () => {
    expect(minutesToPx(60, PX)).toBe(PX)
    expect(minutesToPx(60, 140)).toBe(140)
  })

  it('is a full day tall', () => {
    expect(gridHeightPx(PX)).toBe(24 * PX)
  })
})

describe('segmentsForEvent', () => {
  it('places a simple same-day event in one column', () => {
    const s = seg('2026-08-03T09:30:00', '2026-08-03T16:30:00')
    expect(s).toHaveLength(1)
    expect(s[0].dayIndex).toBe(0)
    expect(s[0].topPx).toBe(minutesToPx(9.5 * 60, PX))
    expect(s[0].heightPx).toBe(minutesToPx(7 * 60, PX))
    expect(s[0].isStart && s[0].isEnd).toBe(true)
  })

  it('scales with the pixels-per-hour it is given', () => {
    const s = seg('2026-08-03T09:00:00', '2026-08-03T10:00:00', 140)
    expect(s[0].topPx).toBe(9 * 140)
    expect(s[0].heightPx).toBe(140)
  })

  it('splits an overnight block across midnight, keeping the small hours', () => {
    // 23:00 Mon -> 07:00 Tue. The grid now runs the full 24h, so Monday shows
    // 23:00-24:00 and Tuesday shows the whole 00:00-07:00 stretch.
    const s = seg('2026-08-03T23:00:00', '2026-08-04T07:00:00')
    expect(s).toHaveLength(2)

    expect(s[0].dayIndex).toBe(0)
    expect(s[0].topPx).toBe(minutesToPx(23 * 60, PX))
    expect(s[0].heightPx).toBe(minutesToPx(60, PX))
    expect(s[0].isStart).toBe(true)
    expect(s[0].isEnd).toBe(false)

    expect(s[1].dayIndex).toBe(1)
    expect(s[1].topPx).toBe(0)
    expect(s[1].heightPx).toBe(minutesToPx(7 * 60, PX))
    expect(s[1].isStart).toBe(false)
    expect(s[1].isEnd).toBe(true)
  })

  it('shows an early-morning event in full', () => {
    const s = seg('2026-08-03T04:00:00', '2026-08-03T07:00:00')
    expect(s).toHaveLength(1)
    expect(s[0].topPx).toBe(minutesToPx(4 * 60, PX))
    expect(s[0].heightPx).toBe(minutesToPx(3 * 60, PX))
    expect(s[0].isStart).toBe(true)
  })

  it('returns nothing for an event outside the week', () => {
    expect(seg('2026-08-11T09:00:00', '2026-08-11T10:00:00')).toEqual([])
    expect(seg('2026-08-02T09:00:00', '2026-08-02T10:00:00')).toEqual([])
  })

  it('covers a multi-day event on every day it touches', () => {
    const s = seg('2026-08-03T22:00:00', '2026-08-06T08:00:00')
    expect(s.map((x) => x.dayIndex)).toEqual([0, 1, 2, 3])
    expect(s[1].heightPx).toBe(minutesToPx(24 * 60, PX))
  })

  it('gives a very short event the minimum legible height', () => {
    const s = seg('2026-08-03T09:00:00', '2026-08-03T09:05:00')
    expect(s[0].heightPx).toBe(GRID.minBlockPx)
  })
})
```

The old case *"returns nothing for an event entirely inside the off-grid hours"* is
deliberately gone: there are no off-grid hours any more. The out-of-week case still
covers "contributes nothing".

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Avery/frontend && npx vitest run src/lib/geometry.test.ts`
Expected: FAIL — `gridHeightPx` is not exported and `GRID.basePxPerHour` is undefined.

- [ ] **Step 3: Rewrite geometry.ts**

Replace the top of `Avery/frontend/src/lib/geometry.ts` down to `pxToMinutes`:

```ts
import { addDays } from './datetime'

export const GRID = {
  /** The grid shows the full day. Nothing is off-grid: an event at 03:00 is a real
   *  event, and hiding it made the week lie about what was scheduled. */
  startHour: 0,
  endHour: 24,
  /** Pixels per hour at zoom 1. The live value is a parameter, not this constant —
   *  pinch zoom varies it, and anything that hardcodes it drags to the wrong time. */
  basePxPerHour: 56,
  /** Minimum width of a day column at zoom 1. Above zoom 1 the seven columns exceed
   *  the container and the grid scrolls horizontally. */
  baseColumnPx: 120,
  minZoom: 0.5,
  maxZoom: 3,
  slotMinutes: 15,
  /** A 5-minute event would otherwise render as a 4px sliver with unreadable text. */
  minBlockPx: 14,
} as const

export const GRID_MINUTES = (GRID.endHour - GRID.startHour) * 60

export function gridHeightPx(pxPerHour: number): number {
  return (GRID.endHour - GRID.startHour) * pxPerHour
}

export function minutesToPx(minutes: number, pxPerHour: number): number {
  return (minutes / 60) * pxPerHour
}

export function pxToMinutes(px: number, pxPerHour: number): number {
  return (px / pxPerHour) * 60
}
```

Delete the old `GRID_HEIGHT_PX` export. In `segmentsForEvent`, add the parameter and
thread it through:

```ts
export function segmentsForEvent(
  start: Date,
  end: Date,
  weekStart: Date,
  pxPerHour: number,
): Segment[] {
```

and inside the loop replace the two `minutesToPx` calls:

```ts
      topPx: minutesToPx(topMinutes, pxPerHour),
      heightPx: Math.max(GRID.minBlockPx, minutesToPx(durationMinutes, pxPerHour)),
```

Update the docstring above `segmentsForEvent`: the sentence about "the grid floor at
06:00 means part of an event may be invisible" is no longer true — replace that clause
with "and an event can lie entirely outside the week, in which case it contributes
nothing."

- [ ] **Step 4: Run the tests**

Run: `cd Avery/frontend && npx vitest run src/lib/geometry.test.ts`
Expected: PASS

Run: `cd Avery/frontend && npx vitest run`
Expected: `drag.test.ts` and the others still pass — `lib/drag.ts` reads only
`GRID.slotMinutes`, which is unchanged. If `drag.test.ts` imports `GRID.pxPerHour`,
change it to `GRID.basePxPerHour`.

Run: `cd Avery/frontend && npx tsc -b`
Expected: errors in `WeekGrid.tsx` and `useEventDrag.ts` for the missing arguments —
those are fixed in Tasks 6 and 11. Note them and move on; do not fix them here.

- [ ] **Step 5: Commit**

```bash
git add Avery/frontend/src/lib/geometry.ts Avery/frontend/src/lib/geometry.test.ts Avery/frontend/src/lib/drag.test.ts
git commit -m "feat(frontend): show all 24 hours and make the grid scale a parameter"
```

---

## Task 6: One sticky scroll container

**Files:**
- Modify: `Avery/frontend/src/components/WeekGrid.tsx`

**Interfaces:**
- Consumes: `gridHeightPx`, `minutesToPx`, `segmentsForEvent` from Task 5.
- Produces: `WeekGrid` gains required props `pxPerHour: number` and `columnPx: number`, and forwards its scroll container through a new optional prop `scrollRef?: React.RefObject<HTMLDivElement | null>`.

- [ ] **Step 1: Restructure the markup**

The header row and the body are two sibling grids today, which cannot scroll together
horizontally. Merge them into one grid inside one scroll container.

In `Avery/frontend/src/components/WeekGrid.tsx`, change the imports:

```ts
import {
  GRID,
  GRID_MINUTES,
  gridHeightPx,
  hourMarks,
  minutesToPx,
  segmentsForEvent,
  type Segment,
} from '../lib/geometry'
```

Add to the props type:

```ts
  /** Pixels per hour at the current zoom. */
  pxPerHour: number
  /** Minimum width of one day column at the current zoom. */
  columnPx: number
  /** The scroll container, so the page can position it and zoom can anchor to it. */
  scrollRef?: React.RefObject<HTMLDivElement | null>
```

Replace `const GRID_COLUMNS = '56px repeat(7, minmax(0, 1fr))'` with a function, since
the gutter width is fixed but the columns now have a zoom-dependent minimum:

```ts
const GUTTER_PX = 56
```

Replace the whole returned JSX with a single container:

```tsx
  const heightPx = gridHeightPx(pxPerHour)

  return (
    <div ref={scrollRef} className="h-full min-h-0 overflow-auto">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${GUTTER_PX}px repeat(7, minmax(0, 1fr))`,
          // When the columns' minimum exceeds the container the grid overflows and the
          // container scrolls horizontally; below that the 1fr columns just fill it.
          minWidth: GUTTER_PX + 7 * columnPx,
        }}
      >
        {/* corner: sticky on both axes so it covers the gutter under the header */}
        <div className="sticky left-0 top-0 z-30 border-b border-line bg-surface" />
        {days.map((d, i) => {
          const isToday = i === todayIndex
          return (
            <div
              key={i}
              className="sticky top-0 z-20 border-b border-l border-line bg-surface px-2 py-2 text-center"
            >
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">
                {DAY_NAMES[i]}
              </div>
              <div
                className={
                  isToday
                    ? 'mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-bold'
                    : 'mt-0.5 text-sm font-medium text-ink-muted'
                }
                style={
                  isToday
                    ? { background: 'var(--rose-deep)', color: 'var(--surface-raised)' }
                    : undefined
                }
              >
                {d.getDate()}
              </div>
            </div>
          )
        })}

        <div
          className="sticky left-0 z-10 bg-surface"
          style={{ height: heightPx }}
        >
          {marks.map((h) => (
            <div
              key={h}
              className="absolute right-0 w-full -translate-y-1/2 pr-2 text-right text-[11px] text-ink-faint"
              style={{ top: minutesToPx((h - GRID.startHour) * 60, pxPerHour) }}
            >
              {h === GRID.startHour ? '' : hourLabel(h)}
            </div>
          ))}
        </div>

        {days.map((_, dayIndex) => {
          const isToday = dayIndex === todayIndex
          return (
            <div
              key={dayIndex}
              className="relative border-l border-line"
              style={{ height: heightPx }}
            >
              {isToday && (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: 'var(--pale)', opacity: 0.28 }}
                />
              )}
              {marks
                .filter((h) => h !== GRID.startHour)
                .map((h) => (
                  <div
                    key={h}
                    className="pointer-events-none absolute inset-x-0 border-t border-line"
                    style={{ top: minutesToPx((h - GRID.startHour) * 60, pxPerHour) }}
                  />
                ))}
              {isToday && showNowLine && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 h-px"
                  style={{
                    top: minutesToPx(nowMinutes, pxPerHour),
                    background: 'var(--rose-deep)',
                  }}
                />
              )}
              {segmentsByDay[dayIndex].map(({ event, segment }) => {
                /* unchanged from the existing implementation */
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
```

The gutter's first label is blanked rather than dropped: `hourLabel(0)` would render
"12 AM" half-clipped above the grid's top edge.

Update the two call sites of `segmentsForEvent` and `minutesToPx` inside the component
body to pass `pxPerHour`:

```ts
    const segments = segmentsForEvent(
      parseLocal(event.start_at),
      parseLocal(event.end_at),
      weekStart,
      pxPerHour,
    )
```

The `isDragging` resize-preview block still uses `GRID.minBlockPx`, which is unchanged.

- [ ] **Step 2: Scroll to 07:00 on mount**

In `Avery/frontend/src/pages/WeekPage.tsx`, add near the other hooks:

```ts
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrolledOnce = useRef(false)

  // Open on waking hours. Without this the full-day grid opens on six empty rows.
  useEffect(() => {
    if (scrolledOnce.current || !week.isSuccess) return
    const el = scrollRef.current
    if (!el) return
    scrolledOnce.current = true
    el.scrollTop = minutesToPx(7 * 60, GRID.basePxPerHour)
  }, [week.isSuccess])
```

and pass `scrollRef`, `pxPerHour={GRID.basePxPerHour}` and `columnPx={GRID.baseColumnPx}`
to `<WeekGrid>`. Task 7 replaces the two constants with the zoom hook's values.

Add the imports `useEffect`, `useRef` from react and `GRID`, `minutesToPx` from
`../lib/geometry`.

- [ ] **Step 3: Verify in the browser**

Run: `cd Avery/frontend && npx tsc -b`
Expected: `WeekGrid.tsx` and `WeekPage.tsx` clean. `useEventDrag.ts` may still error on
`pxToMinutes` arity — fixed in Task 11.

Start the backend and the dev server, then check by hand: the grid shows 00:00–24:00,
opens scrolled to 07:00, the day header stays pinned while scrolling vertically, and the
hour gutter stays pinned while scrolling horizontally (temporarily set
`columnPx={220}` to force overflow, then set it back).

- [ ] **Step 4: Commit**

```bash
git add Avery/frontend/src/components/WeekGrid.tsx Avery/frontend/src/pages/WeekPage.tsx
git commit -m "feat(frontend): put the week grid in one scroll container with sticky header and gutter"
```

---

## Task 7: Pinch zoom

**Files:**
- Create: `Avery/frontend/src/hooks/useGridZoom.ts`
- Modify: `Avery/frontend/src/pages/WeekPage.tsx`

**Interfaces:**
- Consumes: `GRID.minZoom`, `GRID.maxZoom`, `GRID.basePxPerHour`, `GRID.baseColumnPx` from Task 5; the `scrollRef` from Task 6.
- Produces: `useGridZoom(ref) -> { zoom: number, pxPerHour: number, columnPx: number }`.

- [ ] **Step 1: Write the hook**

Create `Avery/frontend/src/hooks/useGridZoom.ts`:

```ts
import { useEffect, useState } from 'react'

import { GRID } from '../lib/geometry'

/** A Safari-only gesture event. Not in lib.dom, so the shape it is used through is
 *  declared here rather than cast to `any` at each site. */
interface GestureLikeEvent extends Event {
  scale: number
  clientX: number
  clientY: number
}

/**
 * Trackpad zoom over the week grid.
 *
 * macOS delivers a two-finger pinch to the browser as a `wheel` event with `ctrlKey`
 * set — there is no separate pinch event in Chrome. Without `preventDefault` the
 * browser applies its own page zoom instead, which would scale the whole app and
 * break every pointer-to-minute calculation on the grid. Safari additionally sends
 * `gesture*` events, handled here for the same reason.
 *
 * Zoom is deliberately not persisted: it is a reading posture, not a preference.
 */
export function useGridZoom(ref: React.RefObject<HTMLDivElement | null>) {
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    /** Scale by `factor`, keeping the grid point under the cursor under the cursor. */
    const applyAt = (factor: number, clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      const offsetX = clientX - rect.left
      const offsetY = clientY - rect.top
      const gridX = el.scrollLeft + offsetX
      const gridY = el.scrollTop + offsetY

      setZoom((prev) => {
        const next = Math.min(GRID.maxZoom, Math.max(GRID.minZoom, prev * factor))
        if (next === prev) return prev
        const ratio = next / prev
        // The new layout does not exist until React repaints, so the scroll
        // correction has to wait a frame or it lands against the old height.
        requestAnimationFrame(() => {
          el.scrollLeft = gridX * ratio - offsetX
          el.scrollTop = gridY * ratio - offsetY
        })
        return next
      })
    }

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      // Exponential so a pinch feels linear; /180 is the damping that makes a full
      // trackpad pinch cover roughly one doubling.
      applyAt(Math.exp(-e.deltaY / 180), e.clientX, e.clientY)
    }

    let lastScale = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      lastScale = 1
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as GestureLikeEvent
      applyAt(g.scale / lastScale, g.clientX, g.clientY)
      lastScale = g.scale
    }

    // Non-passive: a passive listener cannot preventDefault, and the browser would
    // page-zoom over the top of us.
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
    }
  }, [ref])

  return {
    zoom,
    pxPerHour: GRID.basePxPerHour * zoom,
    columnPx: GRID.baseColumnPx * zoom,
  }
}
```

- [ ] **Step 2: Wire it into the page**

In `Avery/frontend/src/pages/WeekPage.tsx`:

```ts
  const { pxPerHour, columnPx } = useGridZoom(scrollRef)
```

and replace the two constants passed to `<WeekGrid>`:

```tsx
              pxPerHour={pxPerHour}
              columnPx={columnPx}
```

The mount scroll from Task 6 must use the live scale, so change its body to
`el.scrollTop = minutesToPx(7 * 60, pxPerHour)` and leave `pxPerHour` out of the
dependency array — the effect is guarded by `scrolledOnce` and must not re-fire on zoom.

- [ ] **Step 3: Verify by hand**

Run: `cd Avery/frontend && npx tsc -b` — expected clean apart from the known
`useEventDrag` arity error.

In the browser: two-finger pinch out over the grid makes the hours taller and the columns
wider until a horizontal scrollbar appears; pinch in shrinks back. The browser's own page
zoom must **not** fire. The hour under the cursor stays under the cursor. Zoom stops at
half and triple size.

- [ ] **Step 4: Commit**

```bash
git add Avery/frontend/src/hooks/useGridZoom.ts Avery/frontend/src/pages/WeekPage.tsx
git commit -m "feat(frontend): pinch to zoom the week grid"
```

---

## Task 8: Client types, mutations, and one invalidation helper

**Files:**
- Modify: `Avery/frontend/src/api/types.ts`
- Modify: `Avery/frontend/src/api/events.ts`
- Create: `Avery/frontend/src/api/invalidate.ts`
- Create: `Avery/frontend/src/hooks/useEventMutations.ts`
- Modify: `Avery/frontend/src/hooks/useEventDrag.ts:32-43`
- Modify: `Avery/frontend/src/pages/WeekPage.tsx:59-76`

**Interfaces:**
- Consumes: the endpoints from Tasks 1–4.
- Produces: `EventKind` type; `AveryEvent.kind` and `AveryEvent.completed_at`; `completeEvent(id)`, `uncompleteEvent(id)`, `rollOverEvents(ids, toDate)` in `api/events.ts`; `invalidateCalendar(queryClient)` in `api/invalidate.ts`; `useEventMutations() -> { create, complete, uncomplete, rollOver }`.

- [ ] **Step 1: Extend the types**

In `Avery/frontend/src/api/types.ts`, add next to `EventSource`:

```ts
export type EventKind = 'event' | 'task'
```

and add to `AveryEvent`, after `tag_ids`:

```ts
  kind: EventKind
  completed_at: string | null
```

- [ ] **Step 2: Add the API calls**

In `Avery/frontend/src/api/events.ts`, append:

```ts
export const completeEvent = (id: number) =>
  apiSend<AveryEvent>('POST', `/events/${id}/complete`)

export const uncompleteEvent = (id: number) =>
  apiSend<AveryEvent>('POST', `/events/${id}/uncomplete`)

export const rollOverEvents = (event_ids: number[], to_date: string) =>
  apiSend<AveryEvent[]>('POST', '/events/roll-over', { event_ids, to_date })
```

- [ ] **Step 3: Extract the invalidation**

Create `Avery/frontend/src/api/invalidate.ts`:

```ts
import type { QueryClient } from '@tanstack/react-query'

/**
 * Everything a written event can be seen through.
 *
 * Four separate bugs in the previous wave came from invalidating a subset: staleTime
 * is 30s with no refetch on focus, so a wrong answer stays on screen rather than
 * blinking. Any mutation that creates, moves, completes or deletes an event calls
 * this — do not hand-roll a shorter list.
 */
export function invalidateCalendar(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['week'] })
  queryClient.invalidateQueries({ queryKey: ['evaluate'] })
  queryClient.invalidateQueries({ queryKey: ['month'] })
  queryClient.invalidateQueries({ queryKey: ['task'] })
  queryClient.invalidateQueries({ queryKey: ['tasks'] })
  queryClient.invalidateQueries({ queryKey: ['events'] })
}
```

- [ ] **Step 4: Replace the three hand-rolled copies**

In `Avery/frontend/src/hooks/useEventDrag.ts`, replace the `settle` callback body with
`invalidateCalendar(queryClient)` and delete the now-redundant comment block, keeping one
line pointing at the helper:

```ts
  // Every key an event is visible through — see invalidateCalendar for why all of them.
  const settle = useCallback(() => invalidateCalendar(queryClient), [queryClient])
```

In `Avery/frontend/src/pages/WeekPage.tsx`, replace the `materialize` mutation's
`onSuccess` body with `() => invalidateCalendar(queryClient)`, keeping the comment that
explains materialization creates both events and tasks.

- [ ] **Step 5: Write the mutations hook**

Create `Avery/frontend/src/hooks/useEventMutations.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { completeEvent, createEvent, rollOverEvents, uncompleteEvent } from '../api/events'
import { invalidateCalendar } from '../api/invalidate'
import type { AveryEvent, EventKind } from '../api/types'

export interface NewEvent {
  task_name: string
  kind: EventKind
  start_at: string
  end_at: string
  tag_ids: number[]
}

/** Every write the week view can make. Each settles by invalidating the whole
 *  calendar; none of them swallows its error — the callers surface `isError`. */
export function useEventMutations() {
  const queryClient = useQueryClient()
  const settle = () => invalidateCalendar(queryClient)

  const create = useMutation({
    mutationFn: (body: NewEvent) => createEvent(body as Partial<AveryEvent>),
    onSettled: settle,
  })

  const complete = useMutation({
    mutationFn: (id: number) => completeEvent(id),
    onSettled: settle,
  })

  const uncomplete = useMutation({
    mutationFn: (id: number) => uncompleteEvent(id),
    onSettled: settle,
  })

  const rollOver = useMutation({
    mutationFn: ({ ids, toDate }: { ids: number[]; toDate: string }) =>
      rollOverEvents(ids, toDate),
    onSettled: settle,
  })

  return { create, complete, uncomplete, rollOver }
}
```

- [ ] **Step 6: Verify**

Run: `cd Avery/frontend && npx tsc -b`
Expected: clean apart from the known `useEventDrag` `pxToMinutes` arity error.

Run: `cd Avery/frontend && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add Avery/frontend/src/api/types.ts Avery/frontend/src/api/events.ts Avery/frontend/src/api/invalidate.ts Avery/frontend/src/hooks/useEventMutations.ts Avery/frontend/src/hooks/useEventDrag.ts Avery/frontend/src/pages/WeekPage.tsx
git commit -m "feat(frontend): event completion and roll-over mutations, with one invalidation helper"
```

---

## Task 9: Two card shapes and a completed state

**Files:**
- Create: `Avery/frontend/src/components/EventCard.tsx`
- Delete: `Avery/frontend/src/components/EventBlock.tsx`
- Modify: `Avery/frontend/src/components/WeekGrid.tsx`

**Interfaces:**
- Consumes: `AveryEvent.kind`, `AveryEvent.completed_at` from Task 8.
- Produces: `EventCard`, taking `{ event, segment, tag, title, onPointerDown?, isDragging?, dragOffset? }`. The `<Link>` is gone — navigation moves into the gesture hook in Task 11, so a card must never contain a nested anchor that would swallow the pointer stream.

- [ ] **Step 1: Write the card**

Create `Avery/frontend/src/components/EventCard.tsx`:

```tsx
import type { AveryEvent, Tag } from '../api/types'
import type { Segment } from '../lib/geometry'
import { formatTimeRange } from '../lib/datetime'
import { tint } from '../lib/color'

/** The strip of column left free down the right-hand side of every card. It is a live
 *  hit target for creating a new card at that time, which is the point of leaving it. */
export const CARD_RIGHT_GUTTER_PX = 12

export function EventCard({
  event,
  segment,
  tag,
  title,
  onPointerDown,
  isDragging,
  dragOffset,
}: {
  event: AveryEvent
  segment: Segment
  tag: Tag | undefined
  title: string
  onPointerDown?: (e: React.PointerEvent) => void
  isDragging?: boolean
  dragOffset?: { dx: number; dy: number }
}) {
  const color = tag?.color ?? 'var(--pale)'
  const isTask = event.kind === 'task'
  const isDone = event.completed_at !== null

  const corners = {
    borderTopLeftRadius: segment.isStart ? 6 : 0,
    borderTopRightRadius: segment.isStart ? 6 : 0,
    borderBottomLeftRadius: segment.isEnd ? 6 : 0,
    borderBottomRightRadius: segment.isEnd ? 6 : 0,
  }

  // A task card reads as a to-do with a slot: light surface, thin outline, a tick box.
  // An event card reads as occupied time: filled, with a solid spine on the left.
  const shape = isTask
    ? {
        background: isDone ? 'transparent' : 'var(--surface-raised)',
        border: `1px solid ${color}`,
      }
    : {
        background: isDone ? 'transparent' : tint(color, 0.22),
        borderLeft: `3px solid ${color}`,
      }

  return (
    <div
      className="absolute overflow-hidden text-left select-none"
      style={{
        top: segment.topPx,
        height: segment.heightPx,
        left: 2,
        right: CARD_RIGHT_GUTTER_PX,
        ...corners,
        ...shape,
        opacity: isDone ? 0.45 : isDragging ? 0.85 : undefined,
        cursor: isDragging ? 'grabbing' : onPointerDown ? 'pointer' : 'default',
        transform: dragOffset ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px)` : undefined,
        zIndex: isDragging ? 20 : undefined,
        boxShadow: isDragging ? 'var(--shadow-card)' : undefined,
      }}
      onPointerDown={onPointerDown}
    >
      <div className="flex items-start gap-1 px-1.5 py-0.5">
        {isTask && (
          <span className="mt-px shrink-0 text-[11px] leading-tight" style={{ color }}>
            {isDone ? '✓' : '○'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[11px] font-bold leading-tight"
            style={isDone ? { textDecoration: 'line-through' } : undefined}
          >
            {title}
          </div>
          {segment.heightPx > 30 && (
            <div className="truncate text-[10px] font-medium text-ink-muted">
              {formatTimeRange(event.start_at, event.end_at)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

The resize handles from `EventBlock` are gone from the card itself; Task 11 re-attaches
them from `WeekGrid`, where the gesture hook that must not compete with them lives.

- [ ] **Step 2: Swap it into the grid**

In `Avery/frontend/src/components/WeekGrid.tsx`, replace the `EventBlock` import with
`EventCard`, and change the render call inside `segmentsByDay[dayIndex].map`:

```tsx
                  <EventCard
                    key={`${event.id}-${segment.dayIndex}`}
                    event={event}
                    segment={renderSegment}
                    tag={tagMap.get(event.tag_ids[0])}
                    title={taskMap.get(event.task_id)?.name ?? `Task #${event.task_id}`}
                    onPointerDown={onEventPointerDown?.(event, segment)}
                    isDragging={isDragging}
                    dragOffset={dragOffset}
                  />
```

Rename the prop `onEventPointerDownMove` to `onEventPointerDown` in the props type, with
signature `(event: AveryEvent, segment: Segment) => (e: React.PointerEvent) => void`.
Leave `onEventPointerDownResize` in the props type; Task 11 rewires it.

Delete `Avery/frontend/src/components/EventBlock.tsx`.

- [ ] **Step 3: Verify by hand**

Run: `cd Avery/frontend && npx tsc -b` — resolve any prop-name mismatches in `WeekPage`.

In the browser, seed a task card from the API and confirm both shapes render:

```bash
curl -s -X POST 127.0.0.1:8001/api/events -H 'Content-Type: application/json' \
  -d '{"task_name":"Renew passport","kind":"task","start_at":"2026-08-10T14:00:00","end_at":"2026-08-10T15:00:00","tag_ids":[]}'
```

Then complete it and confirm the strikethrough and fade:

```bash
curl -s -X POST 127.0.0.1:8001/api/events/1/complete
```

Every card should leave a visible strip of empty column down its right side.

- [ ] **Step 4: Commit**

```bash
git add Avery/frontend/src/components/EventCard.tsx Avery/frontend/src/components/WeekGrid.tsx
git rm Avery/frontend/src/components/EventBlock.tsx
git commit -m "feat(frontend): distinct task and event cards with a completed state"
```

---

## Task 10: Completion confetti

**Files:**
- Create: `Avery/frontend/src/components/Confetti.tsx`

**Interfaces:**
- Produces: `Confetti` taking `{ burst: Burst | null, onDone: () => void }` where `Burst = { id: number; x: number; y: number }` (viewport coordinates); `onDone` **must** be a stable reference (wrap it in `useCallback` at the call site) or the effect re-runs every render and the animation restarts.

- [ ] **Step 1: Write the component**

Create `Avery/frontend/src/components/Confetti.tsx`:

```tsx
import { useEffect, useRef } from 'react'

const PARTICLE_COUNT = 24
const DURATION_MS = 900
/** px per ms², tuned so particles arc rather than fly straight out. */
const GRAVITY = 0.0016

/** Read from the theme rather than duplicated as hex, so the burst follows the
 *  palette by construction instead of drifting out of sync with it. */
const THEME_VARS = ['--rose', '--rose-deep', '--blush', '--sage', '--clay', '--teal']

export interface Burst {
  /** Changing id is what re-triggers the effect; two bursts at the same point still fire. */
  id: number
  x: number
  y: number
}

export function Confetti({ burst, onDone }: { burst: Burst | null; onDone: () => void }) {
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!burst) return
    const root = layer.current
    if (!root) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDone()
      return
    }

    const particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const el = document.createElement('div')
      const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + Math.random() * 0.3
      const speed = 0.18 + Math.random() * 0.22
      el.style.cssText = [
        'position:absolute',
        'width:6px',
        'height:6px',
        'border-radius:2px',
        'pointer-events:none',
        'will-change:transform,opacity',
        `background:var(${THEME_VARS[i % THEME_VARS.length]})`,
        `left:${burst.x}px`,
        `top:${burst.y}px`,
      ].join(';')
      root.appendChild(el)
      return {
        el,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.15,
        spin: (Math.random() - 0.5) * 720,
      }
    })

    // The particles are moved by writing style directly rather than through state:
    // 24 elements re-rendered at 60fps would drag the whole grid through React.
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = now - start
      if (t >= DURATION_MS) {
        for (const p of particles) p.el.remove()
        onDone()
        return
      }
      const fade = 1 - t / DURATION_MS
      for (const p of particles) {
        const x = p.vx * t
        const y = p.vy * t + 0.5 * GRAVITY * t * t
        p.el.style.transform = `translate(${x}px, ${y}px) rotate(${(p.spin * t) / DURATION_MS}deg)`
        p.el.style.opacity = String(fade)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      for (const p of particles) p.el.remove()
    }
  }, [burst, onDone])

  return <div ref={layer} className="pointer-events-none fixed inset-0 z-[60]" />
}
```

- [ ] **Step 2: Verify by hand**

There is no DOM in the vitest environment, so this is checked in the browser once Task 11
wires it up. Confirm then: particles burst from the click point in theme colours, arc
downward, fade out in under a second, and leave no elements behind (inspect the overlay
div in devtools — it must be empty after the burst).

- [ ] **Step 3: Commit**

```bash
git add Avery/frontend/src/components/Confetti.tsx
git commit -m "feat(frontend): confetti burst in the theme palette"
```

---

## Task 11: Click, double-click, long-press

**Files:**
- Create: `Avery/frontend/src/hooks/useCardGestures.ts`
- Modify: `Avery/frontend/src/hooks/useEventDrag.ts`
- Modify: `Avery/frontend/src/components/WeekGrid.tsx`
- Modify: `Avery/frontend/src/pages/WeekPage.tsx`

**Interfaces:**
- Consumes: `Confetti`/`Burst` from Task 10; `useEventMutations` from Task 8.
- Produces: `GestureOrigin = { el: HTMLElement; clientX: number; clientY: number; pointerId: number }`; `useCardGestures({ onOpen, onToggleComplete, onDragStart }) -> { onPointerDown }`. `useEventDrag` becomes `useEventDrag(pxPerHour: number)` and exposes `beginMove(event, origin, columnWidth)` plus the unchanged `onPointerDownResize`.

- [ ] **Step 1: Write the gesture hook**

Create `Avery/frontend/src/hooks/useCardGestures.ts`:

```ts
import { useCallback, useEffect, useRef } from 'react'

const LONG_PRESS_MS = 250
const DOUBLE_CLICK_MS = 220
const MOVE_TOLERANCE_PX = 6

/** What a drag needs from the press that started it. The React synthetic event cannot
 *  be held past its handler — `currentTarget` is nulled — so the pieces are copied out. */
export interface GestureOrigin {
  el: HTMLElement
  clientX: number
  clientY: number
  pointerId: number
}

/**
 * Arbitrates the three gestures a card supports over one pointer stream.
 *
 *   hold 250ms            -> drag (the card lifts)
 *   move >6px before that -> nothing; neither a drag nor a click
 *   quick press, alone    -> open the detail page
 *   quick press, twice    -> toggle completion
 *
 * Opening waits out the double-click window rather than firing on pointer-up. The
 * browser dispatches click before dblclick, so navigating on the first press would
 * leave the page before the second could arrive — the delay is the whole reason this
 * is a hook and not three handlers.
 */
export function useCardGestures({
  onOpen,
  onToggleComplete,
  onDragStart,
}: {
  onOpen: () => void
  onToggleComplete: (point: { x: number; y: number }) => void
  onDragStart: (origin: GestureOrigin) => void
}) {
  const longPressTimer = useRef<number | undefined>(undefined)
  const clickTimer = useRef<number | undefined>(undefined)
  const press = useRef<{ x: number; y: number; lifted: boolean } | null>(null)

  useEffect(
    () => () => {
      window.clearTimeout(longPressTimer.current)
      window.clearTimeout(clickTimer.current)
    },
    [],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // A second press inside the window completes; it is not the start of a gesture.
      if (clickTimer.current !== undefined) {
        window.clearTimeout(clickTimer.current)
        clickTimer.current = undefined
        window.clearTimeout(longPressTimer.current)
        longPressTimer.current = undefined
        press.current = null
        onToggleComplete({ x: e.clientX, y: e.clientY })
        return
      }

      const origin: GestureOrigin = {
        el: e.currentTarget as HTMLElement,
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
      }
      press.current = { x: e.clientX, y: e.clientY, lifted: false }

      const cleanup = () => {
        window.clearTimeout(longPressTimer.current)
        longPressTimer.current = undefined
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }

      const onMove = (ev: PointerEvent) => {
        const state = press.current
        if (!state || state.lifted) return
        const moved =
          Math.abs(ev.clientX - state.x) > MOVE_TOLERANCE_PX ||
          Math.abs(ev.clientY - state.y) > MOVE_TOLERANCE_PX
        // Travelling before the hold completes abandons the gesture: the card never
        // lifted, so it is not a drag, and the pointer moved, so it is not a click.
        if (moved) {
          press.current = null
          cleanup()
        }
      }

      const onUp = () => {
        const state = press.current
        press.current = null
        cleanup()
        // A lifted card resolves as a drag however short its travel — it must not
        // fall through and open the page.
        if (!state || state.lifted) return
        clickTimer.current = window.setTimeout(() => {
          clickTimer.current = undefined
          onOpen()
        }, DOUBLE_CLICK_MS)
      }

      const onCancel = () => {
        press.current = null
        cleanup()
      }

      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = undefined
        if (!press.current) return
        press.current.lifted = true
        onDragStart(origin)
      }, LONG_PRESS_MS)

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
      window.addEventListener('pointercancel', onCancel, { once: true })
    },
    [onOpen, onToggleComplete, onDragStart],
  )

  return { onPointerDown }
}
```

- [ ] **Step 2: Make the drag hook zoom-aware and gesture-initiated**

In `Avery/frontend/src/hooks/useEventDrag.ts`:

Change the signature to `export function useEventDrag(pxPerHour: number)`.

Replace `onPointerDownMove` with `beginMove`, which takes a `GestureOrigin` instead of a
React event because the press that started it has already ended its handler:

```ts
  const beginMove = useCallback(
    (event: AveryEvent, origin: GestureOrigin) => {
      const el = origin.el
      // Measured, not assumed: the day column is this card's parent, and reading its
      // width here keeps deltaDays correct across window resizes and zoom changes.
      const columnWidth = el.parentElement?.getBoundingClientRect().width ?? 0
      const originX = origin.clientX
      const originY = origin.clientY

      // Pointer capture lets this element keep receiving move/up events once the
      // cursor leaves the card's bounds.
      el.setPointerCapture(origin.pointerId)
      setDraft({ eventId: event.id, kind: 'move', dx: 0, dy: 0 })

      const handleMove = (ev: PointerEvent) => {
        setDraft({ eventId: event.id, kind: 'move', dx: ev.clientX - originX, dy: ev.clientY - originY })
      }

      const finish = () => {
        el.removeEventListener('pointermove', handleMove)
        el.removeEventListener('pointerup', handleUp)
        el.removeEventListener('pointercancel', handleCancel)
        try {
          el.releasePointerCapture(origin.pointerId)
        } catch {
          // The pointer is already gone on a cancel; releasing it again is not an error.
        }
        setDraft(null)
      }

      const handleUp = (ev: PointerEvent) => {
        const deltaMinutes = pxToMinutes(ev.clientY - originY, pxPerHour)
        const deltaDays = columnWidth > 0 ? Math.round((ev.clientX - originX) / columnWidth) : 0
        finish()
        const plan = resolveDrag(event, { kind: 'move', deltaMinutes, deltaDays })
        if (!plan || plan.kind !== 'move') return
        move.mutate({ id: event.id, start_at: plan.start_at })
      }

      // A cancelled gesture must clear the draft. Without this the card stays drawn at
      // a time it does not occupy until the next render.
      const handleCancel = () => finish()

      el.addEventListener('pointermove', handleMove)
      el.addEventListener('pointerup', handleUp, { once: true })
      el.addEventListener('pointercancel', handleCancel, { once: true })
    },
    [move, pxPerHour],
  )
```

Apply the same `pxPerHour` argument and `pointercancel` handling to
`onPointerDownResize`'s `pxToMinutes` call and listener set.

Import `GestureOrigin` from `./useCardGestures`, and return `{ draft, beginMove,
onPointerDownResize }`.

- [ ] **Step 3: Wire the grid**

`WeekGrid` needs one gesture handler per card, and hooks cannot be called in a loop.
Extract a small component in `WeekGrid.tsx`, above the `WeekGrid` function:

```tsx
function GridCard({
  event,
  segment,
  tag,
  title,
  isDragging,
  dragOffset,
  onOpen,
  onToggleComplete,
  onDragStart,
  onPointerDownResize,
}: {
  event: AveryEvent
  segment: Segment
  tag: Tag | undefined
  title: string
  isDragging: boolean
  dragOffset?: { dx: number; dy: number }
  onOpen: (event: AveryEvent) => void
  onToggleComplete: (event: AveryEvent, point: { x: number; y: number }) => void
  onDragStart: (event: AveryEvent, origin: GestureOrigin) => void
  onPointerDownResize?: (e: React.PointerEvent, edge: 'start' | 'end') => void
}) {
  const { onPointerDown } = useCardGestures({
    onOpen: useCallback(() => onOpen(event), [onOpen, event]),
    onToggleComplete: useCallback((p) => onToggleComplete(event, p), [onToggleComplete, event]),
    onDragStart: useCallback((o) => onDragStart(event, o), [onDragStart, event]),
  })

  return (
    <div className="contents">
      <EventCard
        event={event}
        segment={segment}
        tag={tag}
        title={title}
        onPointerDown={onPointerDown}
        isDragging={isDragging}
        dragOffset={dragOffset}
      />
      {onPointerDownResize && segment.isStart && (
        <div
          className="absolute z-10 h-1.5 cursor-ns-resize"
          style={{ top: segment.topPx, left: 2, right: CARD_RIGHT_GUTTER_PX }}
          onPointerDown={(e) => {
            e.stopPropagation()
            onPointerDownResize(e, 'start')
          }}
        />
      )}
      {onPointerDownResize && segment.isEnd && (
        <div
          className="absolute z-10 h-1.5 cursor-ns-resize"
          style={{
            top: segment.topPx + segment.heightPx - 6,
            left: 2,
            right: CARD_RIGHT_GUTTER_PX,
          }}
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

The handles are siblings of the card rather than children of it, so a press on a handle
never enters the gesture hook's stream at all — resize stays immediate, as intended,
without racing the long-press timer.

Replace `WeekGrid`'s per-segment render with `<GridCard …/>`, and change its props to
take `onOpen`, `onToggleComplete`, `onDragStart` and `onEventPointerDownResize`.

- [ ] **Step 4: Wire the page**

In `Avery/frontend/src/pages/WeekPage.tsx`:

```ts
  const navigate = useNavigate()
  const { complete, uncomplete } = useEventMutations()
  const { draft, beginMove, onPointerDownResize } = useEventDrag(pxPerHour)
  const [burst, setBurst] = useState<Burst | null>(null)
  const clearBurst = useCallback(() => setBurst(null), [])

  const onOpen = useCallback((event: AveryEvent) => navigate(`/events/${event.id}`), [navigate])

  const onToggleComplete = useCallback(
    (event: AveryEvent, point: { x: number; y: number }) => {
      if (event.completed_at) {
        uncomplete.mutate(event.id)
        return
      }
      complete.mutate(event.id)
      // Only on completion. Reopening a card is a correction, not an achievement.
      setBurst({ id: Date.now(), x: point.x, y: point.y })
    },
    [complete, uncomplete],
  )
```

Render `<Confetti burst={burst} onDone={clearBurst} />` at the end of the page, and pass
`onOpen`, `onToggleComplete`, `onDragStart={beginMove}` and
`onEventPointerDownResize={onPointerDownResize}` to `<WeekGrid>`.

Surface the write errors instead of swallowing them, in the bar above the grid:

```tsx
        {(complete.isError || uncomplete.isError) && (
          <div className="border-b border-line px-4 py-2 text-xs" style={{ color: 'var(--over)' }}>
            Couldn't update that card. It's still as it was.
          </div>
        )}
```

- [ ] **Step 5: Verify by hand**

Run: `cd Avery/frontend && npx tsc -b` — expected clean. `/events/:id` does not exist
until Task 13; clicking a card navigates to a blank route until then, which is expected.

Run: `cd Avery/frontend && npx vitest run` — expected PASS.

In the browser check each row of the gesture table: a quick click navigates after a beat;
a double-click completes with confetti and no navigation; a 250ms hold lifts the card and
drags it; a quick swipe across a card does nothing; dragging the top or bottom edge
resizes immediately.

- [ ] **Step 6: Commit**

```bash
git add Avery/frontend/src/hooks/useCardGestures.ts Avery/frontend/src/hooks/useEventDrag.ts Avery/frontend/src/components/WeekGrid.tsx Avery/frontend/src/pages/WeekPage.tsx
git commit -m "feat(frontend): click to open, double-click to complete, hold to drag"
```

---

## Task 12: Quick create on empty space

**Files:**
- Create: `Avery/frontend/src/components/QuickCreatePopover.tsx`
- Modify: `Avery/frontend/src/components/WeekGrid.tsx`
- Modify: `Avery/frontend/src/pages/WeekPage.tsx`

**Interfaces:**
- Consumes: `useEventMutations().create` and `NewEvent` from Task 8; `useTags` (existing).
- Produces: `SlotClick = { day: Date; minutes: number; x: number; y: number }`; `QuickCreatePopover` taking `{ slot, tags, onClose, onSave, isPending, error }`. `WeekGrid` gains `onEmptyClick?: (slot: SlotClick) => void`.

- [ ] **Step 1: Report empty-space clicks from the grid**

In `WeekGrid.tsx`, add the type and the handler on each day column's `<div>`:

```ts
export interface SlotClick {
  day: Date
  /** Minutes from midnight, snapped to the grid's 15-minute slots. */
  minutes: number
  x: number
  y: number
}
```

```tsx
              onPointerDown={(e) => {
                // Cards and resize handles stop propagation, so reaching here means
                // the press landed on empty column — including the gutter strip that
                // every card deliberately leaves free down its right-hand side.
                if (!onEmptyClick) return
                const rect = e.currentTarget.getBoundingClientRect()
                onEmptyClick({
                  day: days[dayIndex],
                  minutes: snapMinutes(pxToMinutes(e.clientY - rect.top, pxPerHour)),
                  x: e.clientX,
                  y: e.clientY,
                })
              }}
```

Add `pxToMinutes` and `snapMinutes` to the geometry import.

A press on a card must not also register as a press on the empty column beneath it. The
column's handler is on an ancestor, so it fires during the **bubble** phase after the
card's own handler — stopping propagation from the card is enough, and stopping it in
the *capture* phase would kill the card's handler too. Give `GridCard`'s wrapper a bubble-
phase stop:

```tsx
    <div className="contents" onPointerDown={(e) => e.stopPropagation()}>
```

React attaches both handlers at the root and replays the synthetic phases in order, so
the card's `onPointerDown` (on a descendant) runs first, then this wrapper stops the event
before it reaches the column. Leave `EventCard` itself untouched.

- [ ] **Step 2: Write the popover**

Create `Avery/frontend/src/components/QuickCreatePopover.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'

import type { EventKind, Tag } from '../api/types'
import type { SlotClick } from './WeekGrid'
import { addDays, formatLocal } from '../lib/datetime'

const POPOVER_WIDTH = 320
const DEFAULT_DURATION_MINUTES = 60

const pad = (n: number) => String(n).padStart(2, '0')
const toTimeInput = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
const fromTimeInput = (value: string) => {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

export interface QuickCreateDraft {
  task_name: string
  kind: EventKind
  start_at: string
  end_at: string
  tag_ids: number[]
}

export function QuickCreatePopover({
  slot,
  tags,
  isPending,
  error,
  onClose,
  onSave,
}: {
  slot: SlotClick
  tags: Tag[]
  isPending: boolean
  error: string | null
  onClose: () => void
  onSave: (draft: QuickCreateDraft) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<EventKind>('event')
  const [startMinutes, setStartMinutes] = useState(slot.minutes)
  const [endMinutes, setEndMinutes] = useState(slot.minutes + DEFAULT_DURATION_MINUTES)
  const [tagId, setTagId] = useState<number | ''>('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => nameRef.current?.focus(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    if (!name.trim() || isPending) return
    const midnight = new Date(slot.day.getFullYear(), slot.day.getMonth(), slot.day.getDate())
    const start = new Date(midnight.getTime() + startMinutes * 60000)
    // An end at or before the start is read as crossing midnight, which is what a
    // 23:00-01:00 block means — the same convention the template already uses.
    const end =
      endMinutes > startMinutes
        ? new Date(midnight.getTime() + endMinutes * 60000)
        : new Date(addDays(midnight, 1).getTime() + endMinutes * 60000)
    onSave({
      task_name: name.trim(),
      kind,
      start_at: formatLocal(start),
      end_at: formatLocal(end),
      tag_ids: tagId === '' ? [] : [tagId],
    })
  }

  // Kept inside the viewport: anchored at the click, but flipped left or lifted up
  // when the click was near the right or bottom edge.
  const left = Math.min(slot.x + 8, window.innerWidth - POPOVER_WIDTH - 16)
  const top = Math.min(slot.y - 24, window.innerHeight - 340)

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div
        className="fixed z-50 p-4"
        style={{
          left: Math.max(16, left),
          top: Math.max(16, top),
          width: POPOVER_WIDTH,
          background: 'var(--surface-raised)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-card)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={nameRef}
          value={name}
          placeholder="Add title"
          className="mb-3 w-full border-b-2 pb-1 text-base font-bold outline-none"
          style={{ borderColor: 'var(--rose-deep)', background: 'transparent' }}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        <div className="mb-3 flex gap-1">
          {(['event', 'task'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="rounded-[8px] px-3 py-1 text-xs font-bold capitalize transition-colors"
              style={
                kind === option
                  ? { background: 'var(--rose-deep)', color: 'var(--surface-raised)' }
                  : { background: 'var(--pale)', color: 'var(--ink-muted)' }
              }
              onClick={() => setKind(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="time"
            step={900}
            value={toTimeInput(startMinutes)}
            className="rounded-[8px] px-2 py-1"
            style={{ background: 'var(--surface)' }}
            onChange={(e) => setStartMinutes(fromTimeInput(e.target.value))}
          />
          <span className="text-ink-faint">–</span>
          <input
            type="time"
            step={900}
            value={toTimeInput(endMinutes)}
            className="rounded-[8px] px-2 py-1"
            style={{ background: 'var(--surface)' }}
            onChange={(e) => setEndMinutes(fromTimeInput(e.target.value))}
          />
        </div>

        <select
          value={tagId}
          className="mb-3 w-full rounded-[8px] px-2 py-1 text-sm"
          style={{ background: 'var(--surface)' }}
          onChange={(e) => setTagId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">No category</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>

        {error && (
          <p className="mb-2 text-xs" style={{ color: 'var(--over)' }}>
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="px-3 py-1 text-sm text-ink-muted" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || isPending}
            className="rounded-[8px] px-4 py-1 text-sm font-bold disabled:opacity-50"
            style={{ background: 'var(--rose-deep)', color: 'var(--surface-raised)' }}
            onClick={submit}
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Wire the page**

In `WeekPage.tsx`:

```ts
  const [slot, setSlot] = useState<SlotClick | null>(null)
  const tags = useTags()
  const { create } = useEventMutations()
```

Pass `onEmptyClick={setSlot}` to `<WeekGrid>` and render:

```tsx
      {slot && (
        <QuickCreatePopover
          slot={slot}
          tags={tags.data ?? []}
          isPending={create.isPending}
          error={create.error instanceof ApiError ? create.error.detail : null}
          onClose={() => {
            setSlot(null)
            create.reset()
          }}
          onSave={(draft) =>
            create.mutate(draft, {
              onSuccess: () => setSlot(null),
            })
          }
        />
      )}
```

The popover stays open on failure with the message shown, rather than closing and losing
what was typed.

- [ ] **Step 4: Verify by hand**

Run: `cd Avery/frontend && npx tsc -b` — expected clean.

In the browser: clicking empty grid opens the popover at the clicked time; the Event/Task
toggle produces the two card shapes; the new card appears without a manual refresh;
Escape and an outside click both dismiss without saving; clicking the free strip to the
right of an existing card opens the popover rather than selecting that card.

- [ ] **Step 5: Commit**

```bash
git add Avery/frontend/src/components/QuickCreatePopover.tsx Avery/frontend/src/components/WeekGrid.tsx Avery/frontend/src/pages/WeekPage.tsx
git commit -m "feat(frontend): create an event or task by clicking empty grid"
```

---

## Task 13: The event detail page

**Files:**
- Create: `Avery/frontend/src/pages/EventDetailPage.tsx`
- Modify: `Avery/frontend/src/api/events.ts`
- Modify: `Avery/frontend/src/api/keys.ts`
- Modify: `Avery/frontend/src/main.tsx`

**Interfaces:**
- Consumes: `useEventMutations` from Task 8.
- Produces: route `/events/:eventId`; `getEvent(id)` in `api/events.ts`; `qk.event(id)`.

- [ ] **Step 1: Add the fetch and the key**

In `Avery/frontend/src/api/events.ts`:

```ts
export const getEvent = (id: number) => apiGet<AveryEvent>(`/events/${id}`)
```

In `Avery/frontend/src/api/keys.ts`, add to `qk`:

```ts
  event: (id: number) => ['events', 'one', id] as const,
```

It nests under `events` so `invalidateCalendar`'s `['events']` invalidation reaches it.

- [ ] **Step 2: Write the page**

Create `Avery/frontend/src/pages/EventDetailPage.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { deleteEvent, getEvent } from '../api/events'
import { invalidateCalendar } from '../api/invalidate'
import { qk } from '../api/keys'
import { getTask } from '../api/tasks'
import { useEventMutations } from '../hooks/useEventMutations'
import { useTagMap } from '../hooks/useTags'
import { formatTimeRange, parseLocal } from '../lib/datetime'

export default function EventDetailPage() {
  const { eventId } = useParams()
  const id = Number(eventId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tagMap = useTagMap()
  const { complete, uncomplete } = useEventMutations()

  const event = useQuery({ queryKey: qk.event(id), queryFn: () => getEvent(id) })
  const task = useQuery({
    queryKey: qk.task(event.data?.task_id ?? 0),
    queryFn: () => getTask(event.data!.task_id),
    enabled: event.isSuccess,
  })

  const remove = useMutation({
    mutationFn: () => deleteEvent(id),
    onSuccess: () => {
      invalidateCalendar(queryClient)
      navigate('/')
    },
  })

  if (event.isLoading) return <p className="p-6 text-sm text-ink-faint">Loading…</p>
  if (event.isError || !event.data)
    return <p className="p-6 text-sm text-ink-faint">Couldn't load that event.</p>

  const data = event.data
  const isDone = data.completed_at !== null
  const day = parseLocal(data.start_at)

  return (
    <div className="mx-auto max-w-lg p-6">
      <Link to="/" className="text-xs text-ink-muted">
        ‹ Back to the week
      </Link>

      <h1 className="mt-3 text-xl" style={isDone ? { textDecoration: 'line-through' } : undefined}>
        {task.data?.name ?? `Task #${data.task_id}`}
      </h1>

      <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
        <dt className="text-ink-faint">Kind</dt>
        <dd className="capitalize">{data.kind}</dd>
        <dt className="text-ink-faint">When</dt>
        <dd>
          {day.toDateString()} · {formatTimeRange(data.start_at, data.end_at)}
        </dd>
        <dt className="text-ink-faint">Categories</dt>
        <dd>{data.tag_ids.map((t) => tagMap.get(t)?.name ?? `#${t}`).join(', ') || '—'}</dd>
        <dt className="text-ink-faint">Source</dt>
        <dd>{data.source}</dd>
        <dt className="text-ink-faint">Notes</dt>
        <dd>{data.notes || '—'}</dd>
      </dl>

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          className="rounded-[8px] px-3 py-1.5 text-sm font-bold"
          style={{ background: 'var(--pale)' }}
          onClick={() => (isDone ? uncomplete.mutate(id) : complete.mutate(id))}
        >
          {isDone ? 'Mark not done' : 'Mark done'}
        </button>
        <Link
          to={`/tasks/${data.task_id}`}
          className="rounded-[8px] px-3 py-1.5 text-sm text-ink-muted"
        >
          Open the task
        </Link>
        <button
          type="button"
          className="ml-auto rounded-[8px] px-3 py-1.5 text-sm"
          style={{ color: 'var(--over)' }}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </button>
      </div>

      {remove.isError && (
        <p className="mt-2 text-xs" style={{ color: 'var(--over)' }}>
          Couldn't delete that event.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Register the route**

In `Avery/frontend/src/main.tsx`, import the page and add inside `children`:

```tsx
      { path: 'events/:eventId', element: <EventDetailPage /> },
```

- [ ] **Step 4: Verify by hand**

Run: `cd Avery/frontend && npx tsc -b` — expected clean.

In the browser: clicking a card opens this page; Mark done round-trips and the week grid
reflects it on return; Delete removes the card and returns to the week; "Open the task"
reaches the existing task page.

- [ ] **Step 5: Commit**

```bash
git add Avery/frontend/src/pages/EventDetailPage.tsx Avery/frontend/src/api/events.ts Avery/frontend/src/api/keys.ts Avery/frontend/src/main.tsx
git commit -m "feat(frontend): an event detail page a card can open"
```

---

## Task 14: Category filter

**Files:**
- Create: `Avery/frontend/src/lib/tagVisibility.ts`
- Create: `Avery/frontend/src/lib/tagVisibility.test.ts`
- Create: `Avery/frontend/src/hooks/useTagVisibility.ts`
- Create: `Avery/frontend/src/components/CategoryRail.tsx`
- Modify: `Avery/frontend/src/pages/WeekPage.tsx`

**Interfaces:**
- Produces: `readHiddenTags(storage)`, `writeHiddenTags(storage, hidden)`, `isEventVisible(tagIds, hidden)` in `lib/tagVisibility.ts`; `useTagVisibility() -> { hidden: Set<number>, toggle: (id: number) => void }`; `CategoryRail`.

- [ ] **Step 1: Write the failing test**

Create `Avery/frontend/src/lib/tagVisibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { isEventVisible, readHiddenTags, writeHiddenTags } from './tagVisibility'

/** vitest runs in the node environment, so there is no real localStorage. */
function fakeStorage(initial?: string) {
  const box = { value: initial }
  return {
    getItem: () => box.value ?? null,
    setItem: (_key: string, value: string) => {
      box.value = value
    },
    read: () => box.value,
  }
}

describe('readHiddenTags', () => {
  it('is empty when nothing has been stored', () => {
    expect(readHiddenTags(fakeStorage())).toEqual(new Set())
  })

  it('round-trips through writeHiddenTags', () => {
    const storage = fakeStorage()
    writeHiddenTags(storage, new Set([3, 1]))
    expect(readHiddenTags(storage)).toEqual(new Set([1, 3]))
  })

  it('falls back to nothing hidden on unparseable JSON', () => {
    expect(readHiddenTags(fakeStorage('{oops'))).toEqual(new Set())
  })

  it('falls back to nothing hidden when the stored value is not an array', () => {
    expect(readHiddenTags(fakeStorage('{"a":1}'))).toEqual(new Set())
  })

  it('drops non-numeric entries rather than poisoning the set', () => {
    expect(readHiddenTags(fakeStorage('[1,"two",3]'))).toEqual(new Set([1, 3]))
  })
})

describe('isEventVisible', () => {
  it('hides an event whose primary tag is hidden', () => {
    expect(isEventVisible([2, 5], new Set([2]))).toBe(false)
  })

  it('shows an event whose primary tag is visible, even if a secondary is hidden', () => {
    expect(isEventVisible([5, 2], new Set([2]))).toBe(true)
  })

  it('always shows an untagged event', () => {
    // Hiding it would make it unreachable: no checkbox exists that could bring it back.
    expect(isEventVisible([], new Set([1, 2, 3]))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Avery/frontend && npx vitest run src/lib/tagVisibility.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

Create `Avery/frontend/src/lib/tagVisibility.ts`:

```ts
export const HIDDEN_TAGS_KEY = 'avery.hiddenTags'

type Readable = { getItem: (key: string) => string | null }
type Writable = { setItem: (key: string, value: string) => void }

/**
 * Which categories the week grid is currently not drawing.
 *
 * HIDDEN ids are stored, never visible ones. A tag created after the list was saved
 * is then visible by default, instead of being born invisible because it happened not
 * to be in a list written before it existed.
 *
 * Every failure mode returns "nothing hidden": a corrupt value should show too much,
 * never silently blank the calendar.
 */
export function readHiddenTags(storage: Readable): Set<number> {
  try {
    const raw = storage.getItem(HIDDEN_TAGS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is number => typeof v === 'number'))
  } catch {
    return new Set()
  }
}

export function writeHiddenTags(storage: Writable, hidden: Set<number>): void {
  storage.setItem(HIDDEN_TAGS_KEY, JSON.stringify([...hidden].sort((a, b) => a - b)))
}

/** Keyed on the PRIMARY tag — the same field the card takes its colour from, so what
 *  you switch off is exactly what you saw that colour on. An untagged event is always
 *  visible; no checkbox could bring it back. */
export function isEventVisible(tagIds: number[], hidden: Set<number>): boolean {
  if (tagIds.length === 0) return true
  return !hidden.has(tagIds[0])
}
```

- [ ] **Step 4: Run the test**

Run: `cd Avery/frontend && npx vitest run src/lib/tagVisibility.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Write the hook and the rail**

Create `Avery/frontend/src/hooks/useTagVisibility.ts`:

```ts
import { useCallback, useState } from 'react'

import { readHiddenTags, writeHiddenTags } from '../lib/tagVisibility'

export function useTagVisibility() {
  const [hidden, setHidden] = useState<Set<number>>(() => readHiddenTags(window.localStorage))

  const toggle = useCallback((id: number) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      writeHiddenTags(window.localStorage, next)
      return next
    })
  }, [])

  return { hidden, toggle }
}
```

Create `Avery/frontend/src/components/CategoryRail.tsx`:

```tsx
import type { Tag } from '../api/types'
import { formatMinutes } from '../lib/datetime'

export function CategoryRail({
  tags,
  minutesByTag,
  totalMinutes,
  hidden,
  onToggle,
}: {
  tags: Tag[]
  minutesByTag: Record<string, number>
  totalMinutes: number
  hidden: Set<number>
  onToggle: (id: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {tags.map((tag) => {
        const minutes = minutesByTag[String(tag.id)] ?? 0
        const isHidden = hidden.has(tag.id)
        return (
          <button
            key={tag.id}
            type="button"
            className="text-left"
            onClick={() => onToggle(tag.id)}
            aria-pressed={!isHidden}
          >
            <div className="flex items-center gap-2">
              <span
                className="grid size-3.5 shrink-0 place-items-center rounded-[3px] text-[9px] leading-none"
                style={{
                  background: isHidden ? 'transparent' : tag.color,
                  border: `1.5px solid ${tag.color}`,
                  color: 'var(--surface-raised)',
                }}
              >
                {isHidden ? '' : '✓'}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-xs font-bold"
                style={{ color: isHidden ? 'var(--ink-faint)' : 'var(--ink)' }}
              >
                {tag.name}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                {formatMinutes(minutes)}
              </span>
            </div>
            {/* Share of the week. Scaled against the week's total, not against the sum
                of the buckets, so untagged time shows as the gap it is. */}
            <div className="mt-1 ml-5 h-1 rounded-full" style={{ background: 'var(--line)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: totalMinutes > 0 ? `${(minutes / totalMinutes) * 100}%` : '0%',
                  background: tag.color,
                  opacity: isHidden ? 0.3 : 1,
                }}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6: Filter the grid and render the rail**

In `Avery/frontend/src/pages/WeekPage.tsx`:

```ts
  const { hidden, toggle } = useTagVisibility()
  const visibleEvents = useMemo(
    () => events.filter((e) => isEventVisible(e.tag_ids, hidden)),
    [events, hidden],
  )
```

Pass `events={visibleEvents}` to `<WeekGrid>`. The ratio rail keeps reading the unfiltered
`ratios.data`: hiding a category is about what is drawn, not about what is true.

Render below the existing `RatioBars` in the aside:

```tsx
        <h2 className="mb-3 mt-6 text-xs font-bold uppercase tracking-wide text-ink-faint">
          Categories
        </h2>
        <CategoryRail
          tags={(tags.data ?? []).filter((t) => !t.archived)}
          minutesByTag={ratios.data?.metrics.minutes_by_primary_tag ?? {}}
          totalMinutes={ratios.data?.metrics.total_minutes ?? 0}
          hidden={hidden}
          onToggle={toggle}
        />
```

- [ ] **Step 7: Verify**

Run: `cd Avery/frontend && npx vitest run` — expected PASS.
Run: `cd Avery/frontend && npx tsc -b` — expected clean.

In the browser: unchecking a category removes its cards from the grid while the ratio bars
above stay put; a full page reload preserves the selection; re-checking restores the cards.

- [ ] **Step 8: Commit**

```bash
git add Avery/frontend/src/lib/tagVisibility.ts Avery/frontend/src/lib/tagVisibility.test.ts Avery/frontend/src/hooks/useTagVisibility.ts Avery/frontend/src/components/CategoryRail.tsx Avery/frontend/src/pages/WeekPage.tsx
git commit -m "feat(frontend): show and hide categories, remembered across reloads"
```

---

## Task 15: Mini month

**Files:**
- Create: `Avery/frontend/src/components/MiniMonth.tsx`
- Modify: `Avery/frontend/src/pages/WeekPage.tsx`

**Interfaces:**
- Produces: `MiniMonth` taking `{ selectedWeekStart: Date; onPick: (day: Date) => void }`.

- [ ] **Step 1: Write the component**

Create `Avery/frontend/src/components/MiniMonth.tsx`:

```tsx
import { useState } from 'react'

import { addDays, formatDate, mondayOf } from '../lib/datetime'

const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Six rows of seven always, so the rail never changes height as months are paged. */
function gridDays(cursor: Date): Date[] {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const start = mondayOf(firstOfMonth)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function MiniMonth({
  selectedWeekStart,
  onPick,
}: {
  selectedWeekStart: Date
  onPick: (day: Date) => void
}) {
  const [cursor, setCursor] = useState(() => new Date(selectedWeekStart))
  const days = gridDays(cursor)
  const todayKey = formatDate(new Date())
  const weekEnd = addDays(selectedWeekStart, 6)

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold">
          {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
        </span>
        <span className="flex gap-1">
          <button
            type="button"
            aria-label="Previous month"
            className="px-1 text-ink-muted"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next month"
            className="px-1 text-ink-muted"
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
          >
            ›
          </button>
        </span>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {DAY_INITIALS.map((d, i) => (
          <span key={i} className="text-[9px] text-ink-faint">
            {d}
          </span>
        ))}
        {days.map((day) => {
          const key = formatDate(day)
          const inMonth = day.getMonth() === cursor.getMonth()
          const inSelectedWeek = day >= selectedWeekStart && day <= weekEnd
          const isToday = key === todayKey
          return (
            <button
              key={key}
              type="button"
              className="mx-auto grid size-5 place-items-center rounded-full text-[10px] tabular-nums"
              style={{
                background: isToday
                  ? 'var(--rose-deep)'
                  : inSelectedWeek
                    ? 'var(--pale)'
                    : 'transparent',
                color: isToday
                  ? 'var(--surface-raised)'
                  : inMonth
                    ? 'var(--ink)'
                    : 'var(--ink-faint)',
                fontWeight: isToday || inSelectedWeek ? 700 : 500,
              }}
              onClick={() => onPick(day)}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the rail**

In `WeekPage.tsx`, render at the top of the `<aside>`, above the "This week" heading:

```tsx
        <MiniMonth selectedWeekStart={monday} onPick={(day) => setMonday(mondayOf(day))} />
```

- [ ] **Step 3: Verify by hand**

Run: `cd Avery/frontend && npx tsc -b` — expected clean.

In the browser: the mini month highlights today in a filled circle and the shown week in
pale; clicking any day jumps the main grid to that day's week; the month arrows page the
mini calendar without moving the main grid; the grid is always six rows tall.

- [ ] **Step 4: Commit**

```bash
git add Avery/frontend/src/components/MiniMonth.tsx Avery/frontend/src/pages/WeekPage.tsx
git commit -m "feat(frontend): a mini month picker in the rail"
```

---

## Task 16: Google-style chrome

**Files:**
- Modify: `Avery/frontend/src/App.tsx`

**Interfaces:**
- Produces: a header carrying the hamburger, wordmark, Today, ‹ ›, title and view switcher; the secondary nav moves into the collapsible rail.

- [ ] **Step 1: Restructure the shell**

`Today` and `‹ ›` belong to the week page's own date state, which the header cannot reach.
Rather than lifting that state, the header renders a slot the page fills through an
outlet context.

Replace `Avery/frontend/src/App.tsx`:

```tsx
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

/** Filled by the active page through the outlet context, so the date controls can
 *  live in the shared header without lifting the week's state out of WeekPage. */
export interface HeaderSlot {
  setControls: (node: React.ReactNode) => void
}

const RAIL_LINKS = [
  { to: '/', label: 'Week' },
  { to: '/month', label: 'Month' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/template', label: 'Template' },
  { to: '/rules', label: 'Rules' },
  { to: '/review', label: 'Review' },
]

export default function App() {
  const [railOpen, setRailOpen] = useState(true)
  const [controls, setControls] = useState<React.ReactNode>(null)
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <button
          type="button"
          aria-label="Toggle sidebar"
          className="rounded-full px-2 py-1 text-lg text-ink-muted transition-colors hover:bg-[var(--pale)]/50"
          onClick={() => setRailOpen((v) => !v)}
        >
          ☰
        </button>
        <span className="shrink-0 text-lg font-bold tracking-tight">Avery</span>
        {controls}
        <select
          value={location.pathname === '/month' ? '/month' : '/'}
          className="ml-auto rounded-[8px] px-2 py-1 text-sm font-bold"
          style={{ background: 'var(--pale)' }}
          onChange={(e) => navigate(e.target.value)}
        >
          <option value="/">Week</option>
          <option value="/month">Month</option>
        </select>
      </header>

      <div className="flex min-h-0 flex-1">
        {railOpen && (
          <nav className="w-52 shrink-0 overflow-y-auto border-r border-line bg-surface p-3">
            {RAIL_LINKS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  [
                    'mb-0.5 block rounded-full px-3 py-1.5 text-sm font-bold transition-colors',
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
        )}
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet context={{ setControls } satisfies HeaderSlot} />
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Move the week's date controls into the header**

In `WeekPage.tsx`, replace the local nav bar with a push into the slot:

```tsx
  const { setControls } = useOutletContext<HeaderSlot>()

  useEffect(() => {
    setControls(
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1 text-sm font-bold transition-colors hover:bg-[var(--pale)]/50"
          onClick={() => setMonday(mondayOf(new Date()))}
        >
          Today
        </button>
        <button type="button" aria-label="Previous week" className={NAV_BUTTON}
          onClick={() => setMonday((m) => addDays(m, -7))}>‹</button>
        <button type="button" aria-label="Next week" className={NAV_BUTTON}
          onClick={() => setMonday((m) => addDays(m, 7))}>›</button>
        <span className="text-lg font-bold">{rangeLabel(monday)}</span>
      </div>,
    )
    // Leaving the page must not leave stale controls in a shared header.
    return () => setControls(null)
  }, [monday, setControls])
```

The week page's own `<aside>` stays where it is: it holds the mini month and the
categories, which belong to the week, not to the app.

- [ ] **Step 3: Verify by hand**

Run: `cd Avery/frontend && npx tsc -b` — expected clean.

In the browser: the header shows Avery, Today, ‹ ›, the date range and the Week/Month
switcher; the hamburger collapses the nav rail; navigating to Tasks clears the date
controls rather than leaving them stranded; the Week/Month switcher routes correctly.

- [ ] **Step 4: Commit**

```bash
git add Avery/frontend/src/App.tsx Avery/frontend/src/pages/WeekPage.tsx
git commit -m "feat(frontend): Google-Calendar-style header and collapsible nav rail"
```

---

## Task 17: End-of-day roll-over

**Files:**
- Create: `Avery/frontend/src/lib/rollover.ts`
- Create: `Avery/frontend/src/lib/rollover.test.ts`
- Create: `Avery/frontend/src/hooks/useRolloverPrompt.ts`
- Create: `Avery/frontend/src/components/RolloverDialog.tsx`
- Modify: `Avery/frontend/src/pages/WeekPage.tsx`

**Interfaces:**
- Consumes: `useEventMutations().rollOver` from Task 8; the existing `Modal`.
- Produces: `shouldPromptRollover({ now, promptedOn, incompleteCount })`, `incompleteTaskCardsOn(events, day)` in `lib/rollover.ts`; `useRolloverPrompt(events) -> { candidates, isOpen, dismiss }`; `RolloverDialog`.

- [ ] **Step 1: Write the failing test**

Create `Avery/frontend/src/lib/rollover.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { AveryEvent } from '../api/types'
import { incompleteTaskCardsOn, shouldPromptRollover } from './rollover'

const event = (over: Partial<AveryEvent>): AveryEvent => ({
  id: 1,
  task_id: 1,
  start_at: '2026-08-10T09:00:00',
  end_at: '2026-08-10T10:00:00',
  tag_ids: [],
  kind: 'task',
  completed_at: null,
  source: 'manual',
  template_block_id: null,
  notes: '',
  ...over,
})

const at = (hour: number) => new Date(2026, 7, 10, hour, 0, 0)

describe('shouldPromptRollover', () => {
  it('stays quiet before the cutoff', () => {
    expect(shouldPromptRollover({ now: at(21), promptedOn: null, incompleteCount: 2 })).toBe(false)
  })

  it('prompts at the cutoff', () => {
    expect(shouldPromptRollover({ now: at(22), promptedOn: null, incompleteCount: 2 })).toBe(true)
  })

  it('still prompts later the same evening', () => {
    expect(shouldPromptRollover({ now: at(23), promptedOn: null, incompleteCount: 1 })).toBe(true)
  })

  it('stays quiet once today has been answered', () => {
    // Both buttons record the day, so dismissing is respected until tomorrow.
    expect(
      shouldPromptRollover({ now: at(23), promptedOn: '2026-08-10', incompleteCount: 2 }),
    ).toBe(false)
  })

  it('prompts again the next day', () => {
    expect(
      shouldPromptRollover({ now: at(23), promptedOn: '2026-08-09', incompleteCount: 2 }),
    ).toBe(true)
  })

  it('stays quiet when nothing is outstanding', () => {
    expect(shouldPromptRollover({ now: at(23), promptedOn: null, incompleteCount: 0 })).toBe(false)
  })
})

describe('incompleteTaskCardsOn', () => {
  const day = new Date(2026, 7, 10)

  it('picks up an incomplete task card on the day', () => {
    expect(incompleteTaskCardsOn([event({})], day).map((e) => e.id)).toEqual([1])
  })

  it('skips a completed card', () => {
    expect(incompleteTaskCardsOn([event({ completed_at: '2026-08-10T10:05:00' })], day)).toEqual([])
  })

  it('skips an event card — appointments do not move', () => {
    expect(incompleteTaskCardsOn([event({ kind: 'event' })], day)).toEqual([])
  })

  it('skips a card on another day', () => {
    expect(
      incompleteTaskCardsOn([event({ start_at: '2026-08-11T09:00:00' })], day),
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Avery/frontend && npx vitest run src/lib/rollover.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the module**

Create `Avery/frontend/src/lib/rollover.ts`:

```ts
import type { AveryEvent } from '../api/types'
import { formatDate, parseLocal } from './datetime'

/** Late enough that the day is genuinely over, early enough to still be awake for it. */
export const ROLLOVER_HOUR = 22
export const ROLLOVER_KEY = 'avery.rolloverPrompted'

/**
 * Whether to raise the end-of-day prompt.
 *
 * Pure so the 22:00 boundary is testable without faking a clock: the caller supplies
 * `now`, the stored day key, and how many cards are outstanding.
 */
export function shouldPromptRollover({
  now,
  promptedOn,
  incompleteCount,
}: {
  now: Date
  promptedOn: string | null
  incompleteCount: number
}): boolean {
  if (incompleteCount === 0) return false
  if (now.getHours() < ROLLOVER_HOUR) return false
  // Both buttons write today's key, so a dismissal holds for the rest of the day.
  return promptedOn !== formatDate(now)
}

/** Only unfinished task cards on that day. An event card is an appointment: it stays
 *  where it is whether or not it happened. */
export function incompleteTaskCardsOn(events: AveryEvent[], day: Date): AveryEvent[] {
  const key = formatDate(day)
  return events.filter(
    (e) =>
      e.kind === 'task' &&
      e.completed_at === null &&
      formatDate(parseLocal(e.start_at)) === key,
  )
}
```

- [ ] **Step 4: Run the test**

Run: `cd Avery/frontend && npx vitest run src/lib/rollover.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Write the hook**

Create `Avery/frontend/src/hooks/useRolloverPrompt.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { AveryEvent } from '../api/types'
import { formatDate } from '../lib/datetime'
import { ROLLOVER_KEY, incompleteTaskCardsOn, shouldPromptRollover } from '../lib/rollover'

const CHECK_INTERVAL_MS = 60_000

export function useRolloverPrompt(events: AveryEvent[]) {
  const [isOpen, setIsOpen] = useState(false)
  const today = useMemo(() => new Date(), [])
  const candidates = useMemo(() => incompleteTaskCardsOn(events, today), [events, today])

  useEffect(() => {
    // Runs immediately as well as on the interval, so opening the app at 23:30 after
    // closing it before 22:00 still prompts rather than waiting a minute.
    const check = () => {
      const should = shouldPromptRollover({
        now: new Date(),
        promptedOn: window.localStorage.getItem(ROLLOVER_KEY),
        incompleteCount: candidates.length,
      })
      if (should) setIsOpen(true)
    }
    check()
    const timer = window.setInterval(check, CHECK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [candidates.length])

  const dismiss = useCallback(() => {
    window.localStorage.setItem(ROLLOVER_KEY, formatDate(new Date()))
    setIsOpen(false)
  }, [])

  return { candidates, isOpen, dismiss }
}
```

- [ ] **Step 6: Write the dialog**

Create `Avery/frontend/src/components/RolloverDialog.tsx`:

```tsx
import { useState } from 'react'

import type { AveryEvent, Task } from '../api/types'
import { Modal } from './Modal'
import { formatTimeRange } from '../lib/datetime'

export function RolloverDialog({
  open,
  candidates,
  taskMap,
  isPending,
  error,
  onDismiss,
  onConfirm,
}: {
  open: boolean
  candidates: AveryEvent[]
  taskMap: Map<number, Task>
  isPending: boolean
  error: string | null
  onDismiss: () => void
  onConfirm: (ids: number[]) => void
}) {
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const selected = candidates.filter((e) => !excluded.has(e.id)).map((e) => e.id)

  return (
    <Modal open={open} onClose={onDismiss} title="Unfinished today">
      <p className="mb-3 text-sm text-ink-muted">
        Move these to tomorrow at the same time? Your events stay where they are.
      </p>

      <ul className="mb-4 flex flex-col gap-2">
        {candidates.map((event) => (
          <li key={event.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!excluded.has(event.id)}
                onChange={() =>
                  setExcluded((prev) => {
                    const next = new Set(prev)
                    if (!next.delete(event.id)) next.add(event.id)
                    return next
                  })
                }
              />
              <span className="min-w-0 flex-1 truncate font-bold">
                {taskMap.get(event.task_id)?.name ?? `Task #${event.task_id}`}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                {formatTimeRange(event.start_at, event.end_at)}
              </span>
            </label>
          </li>
        ))}
      </ul>

      {error && (
        <p className="mb-2 text-xs" style={{ color: 'var(--over)' }}>
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="px-3 py-1.5 text-sm text-ink-muted" onClick={onDismiss}>
          Not now
        </button>
        <button
          type="button"
          disabled={selected.length === 0 || isPending}
          className="rounded-[8px] px-4 py-1.5 text-sm font-bold disabled:opacity-50"
          style={{ background: 'var(--rose-deep)', color: 'var(--surface-raised)' }}
          onClick={() => onConfirm(selected)}
        >
          {isPending ? 'Moving…' : `Roll over ${selected.length}`}
        </button>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 7: Wire the page**

In `WeekPage.tsx`:

```tsx
  const { rollOver } = useEventMutations()
  const rollover = useRolloverPrompt(events)
```

`events`, not `visibleEvents`: a card you have filtered out of view is still unfinished.

```tsx
      <RolloverDialog
        open={rollover.isOpen}
        candidates={rollover.candidates}
        taskMap={taskMap}
        isPending={rollOver.isPending}
        error={rollOver.error instanceof ApiError ? rollOver.error.detail : null}
        onDismiss={rollover.dismiss}
        onConfirm={(ids) =>
          rollOver.mutate(
            { ids, toDate: formatDate(addDays(new Date(), 1)) },
            // The dialog stays open on failure — the move is all-or-nothing, so
            // retrying is meaningful and closing would hide that nothing happened.
            { onSuccess: () => rollover.dismiss() },
          )
        }
      />
```

- [ ] **Step 8: Verify**

Run: `cd Avery/frontend && npx vitest run` — expected PASS.
Run: `cd Avery/frontend && npx tsc -b` — expected clean.

To check the dialog without waiting until 22:00, temporarily set `ROLLOVER_HOUR = 0` in
`lib/rollover.ts`, reload, confirm the flow, then **set it back to 22 and re-run the
test suite**. Confirm: only task cards are listed, completed cards are absent, event cards
are absent, "Not now" suppresses it for the rest of the day (check
`localStorage['avery.rolloverPrompted']`), and confirming moves the cards to tomorrow at
the same time.

- [ ] **Step 9: Commit**

```bash
git add Avery/frontend/src/lib/rollover.ts Avery/frontend/src/lib/rollover.test.ts Avery/frontend/src/hooks/useRolloverPrompt.ts Avery/frontend/src/components/RolloverDialog.tsx Avery/frontend/src/pages/WeekPage.tsx
git commit -m "feat(frontend): offer to roll unfinished task cards into tomorrow"
```

---

## Task 18: Inter

**Files:**
- Modify: `Avery/frontend/package.json`
- Modify: `Avery/frontend/src/main.tsx`
- Modify: `Avery/frontend/src/theme.css`
- Modify: `Avery/frontend/src/index.css`
- Modify: `Avery/frontend/README.md`

- [ ] **Step 1: Install the font**

Run: `cd Avery/frontend && npm i @fontsource-variable/inter`

Self-hosted rather than loaded from a CDN: the app makes no external requests at runtime
today, and a font is not a good reason to start.

- [ ] **Step 2: Import it**

At the top of `Avery/frontend/src/main.tsx`, above `import './index.css'`:

```ts
import '@fontsource-variable/inter'
```

- [ ] **Step 3: Point the tokens at it**

In `Avery/frontend/src/theme.css`, replace the two font tokens:

```css
  /* "Math sans bold" in the brief is Unicode's Mathematical Sans-Serif Bold block,
     not a typeface — the glyphs come from whichever installed font covers it, a
     Helvetica-family neo-grotesque. Inter is the self-hostable equivalent, and it
     carries tabular figures, which the grid's hour column needs. */
  --font-display: 'Inter Variable', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, -apple-system, sans-serif;
```

In `Avery/frontend/src/index.css`, replace the heading rule and set the body weight:

```css
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-sans);
  font-weight: 500;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3 { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.02em; }
```

- [ ] **Step 4: Record it in the README**

In `Avery/frontend/README.md`, under `## Theme`, append:

```markdown
Type is Inter, self-hosted through `@fontsource-variable/inter` and imported once in
`src/main.tsx`. Both `--font-display` and `--font-sans` point at it; headings and card
titles run at 700, body at 500. This replaced the previous Iowan Old Style serif across
every page, not just the calendar.
```

- [ ] **Step 5: Verify**

Run: `cd Avery/frontend && npm run build`
Expected: `tsc -b` clean and the Vite build succeeds. The recharts chunk-size warning is
pre-existing and expected.

In the browser, with devtools' Network tab filtered to Font: the Inter files are served
from the dev server's own origin, and no request leaves for a third-party host.

Check every page — Week, Month, Tasks, Template, Rules, Review — for the new type.

- [ ] **Step 6: Commit**

```bash
git add Avery/frontend/package.json Avery/frontend/package-lock.json Avery/frontend/src/main.tsx Avery/frontend/src/theme.css Avery/frontend/src/index.css Avery/frontend/README.md
git commit -m "feat(frontend): set the app's type in Inter"
```

---

## Task 19: Close the wave

**Files:**
- Modify: `Avery/docs/BACKLOG.md`

- [ ] **Step 1: Run everything**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest -q`
Expected: all green.

Run: `cd Avery/frontend && npx vitest run && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 2: End-to-end check against a real backend**

```bash
cd Avery/backend
arch -arm64 .venv/bin/alembic upgrade head
arch -arm64 .venv/bin/python -m uvicorn app.main:app --port 8001
```

In another shell: `curl -s -X POST 127.0.0.1:8001/api/seed`

Then walk the eight requirements in the browser: full 24-hour grid; click empty space to
create; the right-hand gutter on every card; distinct task and event cards with a kind
picker; click opens the detail page and hold drags; the category rail filters and survives
a reload; pinch zooms with scrollbars appearing; double-click completes with confetti and
a strikethrough; and the roll-over dialog (temporarily lowering `ROLLOVER_HOUR` as in
Task 17, then restoring it).

- [ ] **Step 3: Update the backlog**

In `Avery/docs/BACKLOG.md`, add to the "Closed by" note and record the three items this
wave deliberately deferred:

```markdown
**Closed by Plan 3** — the 06:00 grid floor, `pointercancel` handling in the drag hook,
the duplicated five-key invalidation (now `api/invalidate.ts`), and the missing UI path
to create or delete an individual event (`/events/:id`).

### A daily task card accumulates one Task per day

`app/services/events.py` — `kind="task"` deliberately bypasses `find_or_create_by_name`
so completion can sync 1:1. A habit scheduled every day therefore mints a Task per
occurrence, and `archive_task` is still the only way to get rid of one. A hard delete
guarded on "has no events" would make this tractable.

### There is no all-day event

`Event` has no all-day concept, so the row Google Calendar reserves at the top of the
week for all-day items has nothing to put in it and was left out.

### Overlapping cards still stack exactly

Cards now leave a right-hand gutter but still draw on top of each other when they
overlap, which is more visible than it was. Splitting the column would need the per-day
overlap pairs the month payload is already missing.
```

- [ ] **Step 4: Commit**

```bash
git add Avery/docs/BACKLOG.md
git commit -m "docs: refresh the backlog after Plan 3"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §1 migration, schemas | 1 |
| §1 task coupling | 2 |
| §1 complete/uncomplete | 3 |
| §1 roll-over endpoint | 4 |
| §2 full 24 hours, scale as parameter, test rewrite | 5 |
| §2 one sticky scroll container, scroll to 07:00 | 6 |
| §2 `useGridZoom` | 7 |
| §3 two card shapes, right gutter, completed state | 9 |
| §3 gestures | 11 |
| §3 confetti | 10 |
| §3 the detail page a card opens | 13 |
| §4 quick create | 12 |
| §5 rail: mini month | 15 |
| §5 rail: categories, `useTagVisibility` | 14 |
| §5 chrome | 16 |
| §6 roll-over prompt | 17 |
| §7 typography | 18 |
| Error handling | 11, 12, 13, 17 (each surfaces `isError`) |
| Testing | 1–5, 14, 17 |
| Deferred items | 19 |

**Type consistency** — `pxPerHour` is the parameter name in `geometry.ts` (Task 5), the
`WeekGrid` prop (Task 6), the `useGridZoom` return (Task 7) and the `useEventDrag`
argument (Task 11). `GestureOrigin` is defined once in Task 11 and consumed by
`useEventDrag` in the same task. `invalidateCalendar` is defined in Task 8 and used in
Tasks 8, 11, 13. `CARD_RIGHT_GUTTER_PX` is defined in Task 9 and used in Tasks 11 and 12.
`Burst` is defined in Task 10 and consumed in Task 11. `SlotClick` is defined in Task 12's
`WeekGrid` change and imported by the popover in the same task.
