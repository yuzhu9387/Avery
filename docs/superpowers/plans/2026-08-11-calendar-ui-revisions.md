# Calendar UI Revisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold in eight rounds of feedback on the rebuilt week view, plus the two tasks the first plan had not reached, and close the wave.

**Architecture:** Three small independent fixes, then a layout rework that replaces the two-rail chrome with Google Calendar's single rail, then a real Day view behind the new segmented switcher, then categories become fully CRUD-able (which needs a `description` column and a genuine delete on the backend).

**Tech Stack:** FastAPI + SQLAlchemy 2 async + alembic + pytest-asyncio; React 19 + TypeScript + Vite + Tailwind 4 + TanStack Query 5 + react-router 7 + vitest.

**Predecessor:** `2026-08-10-calendar-ui-redesign.md`, complete through its Task 16. Its Tasks 17 (roll-over) and 18 (Inter) are carried here as Tasks 9 and 10; its Task 19 close-out becomes Task 11.

## Global Constraints

- **Backend commands run from `Avery/backend` and must be prefixed `arch -arm64`.** The venv interpreter is universal, the wheels are arm64; an x86_64 launch fails on `pydantic_core`. That ImportError is never a code failure.
- **The backend runs on port 8001, never 8000.**
- **No hex colour literals in frontend components.** Every colour is a token from `src/theme.css` referenced as `var(--token)`, or a Tailwind class mapped to one in `src/index.css`. Tag colours arriving as API data are not literals.
- **The backend speaks naive local time.** Never call `toISOString()` on a Date bound for the API — use `formatLocal`/`formatDate`/`parseLocal` from `src/lib/datetime.ts`.
- **Vitest runs with `environment: 'node'`** — no DOM, no `localStorage`. Anything unit-tested takes its storage or clock as a parameter.
- **Any event write invalidates the whole calendar** via `invalidateCalendar` from `src/api/invalidate.ts`. Never hand-roll a narrower list.
- **Surface mutation errors** with `errorMessage` from `src/api/client.ts`. It never returns an empty string for a real failure.
- `npx tsc -b` clean and `npx vitest run` green before every frontend commit; the full pytest suite green before every backend commit.

---

## Decisions taken, so no task re-litigates them

- **Deleting a category is a real delete, guarded.** If any event carries the tag, the API refuses with the count and the UI offers archive instead. Silently stripping tags from historical events would rewrite the ratio maths and every stored Review report — the same reasoning that already makes tasks archive rather than delete.
- **The Day view is built**, not stubbed. A switcher offering a dead option is worse than no switcher.
- **The left rail becomes one column**, matching the reference screenshot: mini month, This week, Categories, and Rules/Review pinned to the bottom where account and settings will later join them.
- **`RatioBars` stops showing `key`.** The A/B/C in the UI comes from `compact ? g.key : g.label`; compact mode now shows `label` too.

---

## Task 1: A category can carry a description and be deleted

**Files:**
- Create: `Avery/backend/alembic/versions/c4f8a2d61b90_tag_description.py`
- Modify: `Avery/backend/app/models/tag.py`, `app/schemas/tag.py`, `app/services/tags.py`, `app/routers/tags.py`
- Test: `Avery/backend/tests/test_tag_crud.py`

**Interfaces:**
- Produces: `Tag.description: str` (non-null, default `""`); `TagCreate.description`, `TagUpdate.description`, `TagOut.description`; `service.delete_tag(session, tag_id) -> None` raising `TagInUse(count)`; `DELETE /api/tags/{id}` now **deletes**, `POST /api/tags/{id}/archive` takes over archiving.

- [ ] **Step 1: Write the failing test**

Create `Avery/backend/tests/test_tag_crud.py`:

```python
async def _tag(client, name="Reading", color="#8FA8A2", description=""):
    res = await client.post(
        "/api/tags",
        json={"name": name, "color": color, "description": description},
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_tag_round_trips_a_description(client):
    tag = await _tag(client, description="Books, papers, long-form")
    assert tag["description"] == "Books, papers, long-form"
    fetched = await client.get(f"/api/tags/{tag['id']}")
    assert fetched.json()["description"] == "Books, papers, long-form"


async def test_description_defaults_to_empty(client):
    res = await client.post("/api/tags", json={"name": "Plain", "color": "#DEDECF"})
    assert res.json()["description"] == ""


async def test_an_unused_tag_is_really_deleted(client):
    tag = await _tag(client, name="Unused")
    assert (await client.delete(f"/api/tags/{tag['id']}")).status_code == 204
    assert (await client.get(f"/api/tags/{tag['id']}")).status_code == 404


async def test_a_tag_in_use_refuses_deletion_and_says_how_many(client):
    tag = await _tag(client, name="Busy")
    for day in ("2026-08-03", "2026-08-04"):
        await client.post(
            "/api/events",
            json={
                "task_name": "Something",
                "start_at": f"{day}T09:00:00",
                "end_at": f"{day}T10:00:00",
                "tag_ids": [tag["id"]],
            },
        )
    refused = await client.delete(f"/api/tags/{tag['id']}")
    assert refused.status_code == 409
    # The count is the whole point: the UI shows it and offers archive instead.
    assert "2" in refused.json()["detail"]
    assert (await client.get(f"/api/tags/{tag['id']}")).status_code == 200


async def test_archive_is_still_available_on_its_own_route(client):
    tag = await _tag(client, name="Retired")
    archived = await client.post(f"/api/tags/{tag['id']}/archive")
    assert archived.status_code == 200
    assert archived.json()["archived"] is True
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest tests/test_tag_crud.py -v`
Expected: FAIL — `description` is not a field, and `DELETE` returns 200 with an archived tag rather than 204.

- [ ] **Step 3: Add the column**

`app/models/tag.py`, after `color`:

```python
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
```

Import `Text` from sqlalchemy.

`app/schemas/tag.py`: add `description: str = ""` to `TagCreate`, `description: str | None = None` to `TagUpdate`, and `description: str` to `TagOut`.

- [ ] **Step 4: Write the migration**

Create `Avery/backend/alembic/versions/c4f8a2d61b90_tag_description.py` with `revision = "c4f8a2d61b90"`, `down_revision = "b7c21e4d9f10"`, and:

```python
def upgrade() -> None:
    op.add_column(
        "tags",
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("tags", "description")
```

- [ ] **Step 5: Replace archive-on-DELETE with a guarded delete**

In `app/services/tags.py`:

```python
class TagInUse(Exception):
    """Raised when a delete is refused because events still carry the tag."""

    def __init__(self, count: int) -> None:
        self.count = count
        super().__init__(f"{count} event(s) still use this category")


async def delete_tag(session: AsyncSession, tag_id: int) -> bool:
    """Really deletes — but only when nothing points at it.

    Events store tag ids in a JSON column, so a delete cannot cascade. Stripping the
    id from historical events instead would silently rewrite every ratio and every
    stored Review report, which is why an in-use tag is refused rather than cleaned up.
    """
    tag = await session.get(Tag, tag_id)
    if tag is None:
        return False
    rows = (await session.scalars(select(Event.tag_ids))).all()
    count = sum(1 for tag_ids in rows if tag_id in (tag_ids or []))
    if count:
        raise TagInUse(count)
    await session.delete(tag)
    await session.commit()
    return True
```

Keep the existing archive logic, renamed `archive_tag`, untouched in behaviour.

- [ ] **Step 6: Rewire the routes**

In `app/routers/tags.py`, replace the `DELETE` handler and add the archive route:

```python
@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(tag_id: int, session: AsyncSession = Depends(get_session)):
    try:
        deleted = await service.delete_tag(session, tag_id)
    except service.TagInUse as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tag not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{tag_id}/archive", response_model=TagOut)
async def archive_tag(tag_id: int, session: AsyncSession = Depends(get_session)):
    tag = await service.archive_tag(session, tag_id)
    if tag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "tag not found")
    return tag
```

409 rather than 422: the request is well-formed, the *state* forbids it.

- [ ] **Step 7: Verify and commit**

Run: `cd Avery/backend && arch -arm64 .venv/bin/python -m pytest -q` — full suite green.
Run: `cd Avery/backend && arch -arm64 .venv/bin/alembic upgrade head && arch -arm64 .venv/bin/alembic downgrade -1 && arch -arm64 .venv/bin/alembic upgrade head`

Search the frontend for callers of the old archive-on-DELETE (`archiveTag` in `src/api/tags.ts`) and note them for Task 8 — do not change the frontend here.

```bash
git add Avery/backend
git commit -m "feat(backend): categories carry a description and can be deleted when unused"
```

---

## Task 2: Rule groups read as words, not letters

**Files:**
- Modify: `Avery/backend/app/services/seed.py`
- Modify: `Avery/frontend/src/components/RatioBars.tsx`
- Test: `Avery/backend/tests/test_seed.py` (or wherever seed assertions live — find it)

**Interfaces:** none new.

- [ ] **Step 1: Rename the seeded groups**

In `app/services/seed.py`, the 6:3:1 rule's groups become:

| key | label |
|---|---|
| `A` | `Work & Study` |
| `B` | `Family care` |
| `C` | `Fitness` |

`key` stays `A`/`B`/`C` — it is the stable identifier that `GroupResult` and stored `Report` rows join on, and rewriting it would orphan historical reports. Only the human-facing `label` changes.

- [ ] **Step 2: Stop rendering `key` anywhere**

`RatioBars.tsx:26` is `{compact ? g.key : g.label}` — that single expression is the entire source of "A / B / C" in the UI. Change it to render `g.label` in both modes.

The `compact` prop still controls the sub-line (`{!compact && ...}` at line 58); leave that. If `compact` now controls only that, say so in your report — a prop that no longer earns its name is worth flagging even if it still has one use.

Labels are longer than one letter, so check the compact rail row still lays out: the label and the percentage share a `justify-between` flex row. Add `truncate` and a `min-w-0` to the label span if it can overflow.

- [ ] **Step 3: Update the running database**

The seed only affects fresh databases; the dev DB already holds the old labels. Update it through the API rather than by hand:

```bash
curl -s 127.0.0.1:8001/api/rules/active | python3 -m json.tool | head -30
```

then `PATCH /api/rules/{id}` with the three renamed groups, preserving each group's `key`, `ratio` and `tag_ids` exactly. Show the before and after in your report.

- [ ] **Step 4: Verify and commit**

Backend suite green; `npx tsc -b` clean; `npx vitest run` green.

```bash
git add Avery/backend/app/services/seed.py Avery/frontend/src/components/RatioBars.tsx
git commit -m "feat: name the rule groups instead of lettering them"
```

---

## Task 3: Enter during IME composition must not submit

**Files:**
- Modify: `Avery/frontend/src/components/QuickCreatePopover.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Guard the Enter handler**

`QuickCreatePopover.tsx:103` is `onKeyDown={(e) => e.key === 'Enter' && submit()}`.

Typing Chinese, Japanese or Korean goes through an IME: keystrokes build a composition, and **Enter commits the composition rather than submitting the form**. The browser still fires `keydown` with `key === 'Enter'` for that commit, so the current handler creates the event while the user is still mid-word.

React's synthetic event does not carry `isComposing`; the native one does. Guard on it:

```tsx
          onKeyDown={(e) => {
            // An IME commits its composition with Enter, and the browser reports that
            // keydown with isComposing set. Without this guard, typing 陪娃去看牙医 and
            // pressing Enter to accept the characters would create the event instead.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          }}
```

- [ ] **Step 2: Verify**

`npx tsc -b` clean, `npx vitest run` green.

This cannot be unit-tested in the `node` vitest environment and cannot be driven by synthetic events — `isComposing` is set by the browser's IME, not by dispatched events. The controller will verify it by typing Chinese into the real popover with an IME active. Say plainly in your report that you did not verify it yourself.

- [ ] **Step 3: Commit**

```bash
git add Avery/frontend/src/components/QuickCreatePopover.tsx
git commit -m "fix(frontend): don't create an event when Enter only commits an IME composition"
```

---

## Task 4: The circle on a task card completes it

**Files:**
- Modify: `Avery/frontend/src/components/EventCard.tsx`
- Modify: `Avery/frontend/src/components/WeekGrid.tsx`

**Interfaces:**
- Produces: `EventCard` gains `onToggleComplete?: (point: { x: number; y: number }) => void`; when present and the card is a task, the ○/✓ glyph becomes a button.

- [ ] **Step 1: Make the glyph a real target**

In `EventCard.tsx` the glyph is a `<span>` at lines 69-71. Turn it into a `<button>` when `onToggleComplete` is supplied, with `aria-label` reflecting the action (`Mark done` / `Mark not done`).

It must call `e.stopPropagation()` on `onPointerDown` so the press never reaches the card's gesture handler underneath — otherwise one click on the circle both completes the card and starts the click/long-press arbitration, and the pending navigation fires 450ms later.

Pass the click point through, so the confetti bursts from the circle:

```tsx
          onPointerDown={(e) => {
            e.stopPropagation()
            onToggleComplete({ x: e.clientX, y: e.clientY })
          }}
```

Give it a hit area large enough to click comfortably — the glyph is 11px type. Pad it out without changing the card's layout.

- [ ] **Step 2: Wire it through the grid**

`GridCard` in `WeekGrid.tsx` already receives `onToggleComplete(event, point)` and hands it to `useCardGestures`. Pass a bound version down to `EventCard` too, through the same latest-ref indirection the other handlers use, so the circle cannot fire against a stale event.

- [ ] **Step 3: Verify**

`npx tsc -b` clean, `npx vitest run` green.

By inspection confirm: clicking the circle completes without navigating; the card's own double-click still completes; a long press starting on the circle does not drag (stopPropagation prevents it) — note that behaviour in your report so the controller can judge whether it is acceptable.

- [ ] **Step 4: Commit**

```bash
git add Avery/frontend/src/components/EventCard.tsx Avery/frontend/src/components/WeekGrid.tsx
git commit -m "feat(frontend): tick a task card off from its circle"
```

---

## Task 5: One left rail, with Rules and Review at its foot

**Files:**
- Modify: `Avery/frontend/src/App.tsx`
- Modify: `Avery/frontend/src/pages/WeekPage.tsx`

**Interfaces:**
- Produces: `App` no longer renders a nav rail. `HeaderSlot` keeps `setControls` and `railOpen`.

- [ ] **Step 1: Delete the nav rail from `App`**

Remove the `<nav>` and `RAIL_LINKS`. `App` keeps: the hamburger, the wordmark, the header-controls slot, and `<Outlet />`. `railOpen` stays in `App` (it is chrome state) and continues to travel through `HeaderSlot`.

The wordmark becomes a link to `/` — clicking "Avery" returns to the week.

- [ ] **Step 2: Give the week's aside a footer**

`WeekPage`'s `<aside>` becomes the app's only left column. It keeps mini month, This week, Categories, and gains a footer pinned to the bottom holding **Rules** and **Review** links.

Pinned means pinned: the aside is `flex flex-col`, the scrolling content is `flex-1 overflow-y-auto`, and the footer sits outside that scroll area so it stays visible however long the category list grows. Account and settings will join this footer later — leave room for that rather than styling it as a two-item list.

- [ ] **Step 3: Keep every route reachable**

Removing the rail strands `/tasks`, `/template`, `/rules` and `/review`. Rules and Review are handled by the footer; **Tasks** goes into Task 6's toolbar; **Template** has no home left. Put Template in the footer beside Rules and Review, and flag in your report that it is a placement of convenience for the controller to review.

- [ ] **Step 4: Verify**

`npx tsc -b` clean, `npx vitest run` green. Confirm by reading back that all six destinations are still reachable and the hamburger still collapses the whole left column.

- [ ] **Step 5: Commit**

```bash
git add Avery/frontend/src/App.tsx Avery/frontend/src/pages/WeekPage.tsx
git commit -m "feat(frontend): one left rail, with Rules and Review at its foot"
```

---

## Task 6: A calendar toolbar above the grid

**Files:**
- Create: `Avery/frontend/src/components/CalendarToolbar.tsx`
- Modify: `Avery/frontend/src/pages/WeekPage.tsx`, `src/pages/MonthPage.tsx`

**Interfaces:**
- Produces: `CalendarToolbar` taking `{ view: 'day' | 'week' | 'month', title: string, onPrev, onNext, onToday }`.

- [ ] **Step 1: Build the toolbar**

Layout, matching the reference: `‹ Today ›` as one group with **Today between the arrows** — that ordering is the explicit request, and it is what the pre-redesign page had. The range title sits beside it, and a segmented `Day | Week | Month` control sits at the right.

The segmented control is three buttons in a rounded track, active one raised in `--surface-raised` with the others plain — not a `<select>`. Each routes to `/day`, `/` or `/month`.

Wrap the group in `role="group"` and give the active button `aria-current="page"`.

- [ ] **Step 2: Move the controls out of the header**

This supersedes the header-slot arrangement for the date controls: the toolbar lives above the grid on the page, not in the app header. `WeekPage` stops pushing `‹ Today ›` and the range into `setControls`.

Decide whether `HeaderSlot.setControls` still has a user. If nothing pushes controls any more, delete it rather than leaving a dead channel — and say so. If you keep it, name what still uses it.

- [ ] **Step 3: Give MonthPage the same toolbar**

`MonthPage` has its own local header row. Replace it with `CalendarToolbar` so the two views are consistent and the switcher is reachable from both. Its `onPrev`/`onNext` step by month; `onToday` returns to the current month.

- [ ] **Step 4: Verify and commit**

`npx tsc -b` clean, `npx vitest run` green.

```bash
git add Avery/frontend/src/components/CalendarToolbar.tsx Avery/frontend/src/pages/WeekPage.tsx Avery/frontend/src/pages/MonthPage.tsx
git commit -m "feat(frontend): a calendar toolbar with a day/week/month switcher"
```

---

## Task 7: The Day view

**Files:**
- Create: `Avery/frontend/src/pages/DayPage.tsx`
- Modify: `Avery/frontend/src/components/WeekGrid.tsx`, `src/main.tsx`

**Interfaces:**
- Produces: route `/day`; `WeekGrid` gains `dayCount?: number` (default 7).

- [ ] **Step 1: Let the grid render fewer columns**

A day view is a week grid with one column. Rather than a second grid component, give `WeekGrid` a `dayCount` prop defaulting to 7 and derive its columns, day headers and `segmentsByDay` from it.

`segmentsForEvent` returns segments indexed 0-6 against a Monday-start week. For a single day, pass that day as `weekStart` and keep only `dayIndex === 0` segments. Verify the midnight-crossing case still works: an event running 23:00→07:00 on the shown day should render its evening portion, and the next morning's portion belongs to the *next* day and must not appear.

Add cases to `geometry.test.ts` if the existing ones do not already pin that behaviour — they were written for a 7-day grid.

- [ ] **Step 2: Build the page**

`DayPage` mirrors `WeekPage`'s composition: the same aside, the same toolbar with `view="day"`, the same gestures, quick create, confetti and roll-over prompt, with `dayCount={1}`.

Factor the shared parts rather than copying them. `WeekPage` is already large; a `DayPage` that duplicates it wholesale doubles the surface where the two can drift apart. Extract what both need — the aside, the mutations wiring, the gesture plumbing — and say in your report what you extracted and what you deliberately left duplicated.

If the extraction turns out larger than the feature, stop and report `DONE_WITH_CONCERNS` describing the shape you found rather than forcing it.

- [ ] **Step 3: Register the route and verify**

`/day` in `main.tsx`. `npx tsc -b` clean, `npx vitest run` green.

- [ ] **Step 4: Commit**

```bash
git add Avery/frontend/src
git commit -m "feat(frontend): a single-day calendar view"
```

---

## Task 8: Create, edit and delete a category

**Files:**
- Create: `Avery/frontend/src/components/CategoryEditor.tsx`
- Modify: `Avery/frontend/src/components/CategoryRail.tsx`, `src/api/tags.ts`, `src/hooks/useTags.ts`, `src/pages/WeekPage.tsx`

**Interfaces:**
- Consumes: Task 1's `description`, guarded `DELETE`, and `POST /tags/{id}/archive`.
- Produces: `CategoryEditor`, a side card for creating and editing; `deleteTag(id)` and `archiveTag(id)` in `api/tags.ts` matching the new routes.

- [ ] **Step 1: Correct the API client**

`src/api/tags.ts`'s `archiveTag` currently calls `DELETE /tags/{id}`, which now deletes. Split it:

```ts
export const deleteTag = (id: number) => apiSend<void>('DELETE', `/tags/${id}`)
export const archiveTag = (id: number) => apiSend<Tag>('POST', `/tags/${id}/archive`)
```

Add `description` to the `Tag` type in `src/api/types.ts`.

Check every existing caller of `archiveTag` — Task 1's report lists them. A caller that meant "archive" and now deletes is a data-loss bug, so audit rather than assume.

- [ ] **Step 2: Build the editor**

`CategoryEditor` is a side card, not a route: a panel anchored beside the rail with name, a colour picker, and a description field. It serves both create and edit — `tag` prop absent means create.

The colour picker offers the palette already in `theme.css` (`--pale`, `--blush`, `--sage`, `--clay`, `--rose`, `--rose-deep`, `--teal`) as swatches, plus a free `<input type="color">`. Seeded tags use those same values, so the picker and the existing data agree by construction.

Escape and an outside click dismiss. A failed save keeps the panel open with `errorMessage`, matching `QuickCreatePopover`.

- [ ] **Step 3: Add the + button and the row actions**

`CategoryRail` gains a `+` beside its heading, and each row gains edit and delete affordances that do not interfere with the existing checkbox toggle — the row is currently one big `<button>`, so nested buttons are invalid HTML. Restructure the row so the checkbox, the name, and the actions are siblings.

On a 409 from delete, show the server's message and offer Archive as the next action in the same place. That message already contains the count, so do not recompute it client-side.

- [ ] **Step 4: Invalidate correctly**

A tag write changes card colours, rail contents and the ratio rail's labels. Invalidate `['tags']` plus the calendar (`invalidateCalendar`), since `useTagMap` feeds every card.

- [ ] **Step 5: Verify and commit**

`npx tsc -b` clean, `npx vitest run` green.

```bash
git add Avery/frontend/src
git commit -m "feat(frontend): create, edit and delete categories from the rail"
```

---

## Task 9: End-of-day roll-over

Carried unchanged from the predecessor plan's Task 17. Read it at
`Avery/docs/superpowers/plans/2026-08-10-calendar-ui-redesign.md`, section "Task 17".

Two amendments from this plan:
- The dialog must also appear on `/day`, not only `/week` — mount it wherever the shared composition from Task 7 lives.
- Use `errorMessage` for the failure surface rather than a fixed string.

---

## Task 10: Inter

Carried unchanged from the predecessor plan's Task 18. Read it at
`Avery/docs/superpowers/plans/2026-08-10-calendar-ui-redesign.md`, section "Task 18".

---

## Task 11: Close the wave

- [ ] **Step 1: Full verification**

Backend: `arch -arm64 .venv/bin/python -m pytest -q`.
Frontend: `npx vitest run && npm run lint && npm run build`.

- [ ] **Step 2: End-to-end pass**

Walk all eight original requirements plus these eight revisions against a live backend, including the two the controller could not previously exercise: **resize an event by its top and bottom edges** (broken between the predecessor's Tasks 9 and 11, never re-verified) and **the roll-over dialog**.

- [ ] **Step 3: Update the backlog**

Record in `Avery/docs/BACKLOG.md`: the `key`/`label` split now that labels are user-facing; Template's placement in the rail footer; and anything parked during this wave.

- [ ] **Step 4: Commit**

```bash
git add Avery/docs/BACKLOG.md
git commit -m "docs: refresh the backlog after the revisions wave"
```

---

## Self-Review

**Coverage of the eight requests:** (1) Task 3. (2) Task 4. (3) Task 6. (4) Tasks 1 and 8. (5) Task 2. (6) Tasks 5 and 6. (7) Task 5 Step 1. (8) Task 5 — the hamburger already collapses the whole left column; Task 5 keeps that true once the rail is gone.

**Carried forward:** roll-over (Task 9) and Inter (Task 10) from the predecessor plan; close-out (Task 11).

**Type consistency:** `description` is added to the backend in Task 1 and to the client `Tag` type in Task 8 Step 1 — Task 8 must not assume it is already there. `deleteTag`/`archiveTag` are defined in Task 8 against routes created in Task 1. `dayCount` is introduced in Task 7 Step 1 and consumed in Step 2. `CalendarToolbar`'s props are fixed in Task 6 and reused by Task 7's page.

**Known ordering hazard:** Task 1 changes what `DELETE /api/tags/{id}` does while the frontend still calls it expecting archive. The window closes in Task 8 Step 1. Tasks 2-7 must not touch tag deletion.
