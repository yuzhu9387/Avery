# Calendar Fixes, Second Round

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Five defects and refinements reported from using the rebuilt calendar.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + alembic + pytest-asyncio; React 19 + TypeScript + Vite + Tailwind 4 + TanStack Query 5 + vitest.

**Predecessor:** `2026-08-11-calendar-ui-revisions.md`, complete through its Task 4. Its Tasks 5-11 (layout, toolbar, day view, category CRUD, roll-over, Inter, close-out) remain outstanding and are unaffected by this plan except where noted.

## Global Constraints

- Backend from `Avery/backend`, **every command prefixed `arch -arm64`**; port 8001, never 8000.
- **No hex colour literals** in components — tokens from `src/theme.css` as `var(--token)`, or Tailwind classes mapped in `src/index.css`. Tag colours arriving as API data are not literals.
- **The backend speaks naive local time.** Never `toISOString()` on a Date bound for the API — use `formatLocal`/`formatDate`/`parseLocal`.
- **Vitest is `environment: 'node'`** — no DOM, no `localStorage`. Anything unit-tested is pure and takes its clock/storage as a parameter.
- Any event write invalidates via `invalidateCalendar`; mutation errors surface through `errorMessage`.
- `npx tsc -b` clean and `npx vitest run` green before every frontend commit; full pytest green before every backend commit.

## A note on the working tree

A second session has been editing this same checkout: `useCardGestures.ts` and `MonthPage.tsx` carry uncommitted changes, and `MonthChip.tsx`, `lib/monthGrid.ts`, `lib/monthGrid.test.ts` are untracked. **Task 2 of this plan modifies `useCardGestures.ts`.** Before editing it, read the file as it currently stands rather than assuming the last committed version, and `git add` only the specific files your task names — never `git add -A`.

---

## Task 1: Show or hide every category at once

**Files:** modify `Avery/frontend/src/components/CategoryRail.tsx`, `src/hooks/useTagVisibility.ts`, `src/lib/tagVisibility.ts` (+ its test)

**Interfaces:** produces `useTagVisibility` returning `showAll()` and `hideAll()` alongside `toggle`.

The request: the category list should switch all on or all off in one click. These categories are what the template's routine blocks are tagged with, so "all off" is how you strip the routine out of the view and see only what you added by hand.

- [ ] **Step 1: Extend the pure module and test it first**

`hideAll` needs the ids to hide, which is the same selectable set `pruneHidden` already takes. Add nothing to `lib/tagVisibility.ts` that the hook can do trivially — if `showAll` is just "write an empty set", keep it in the hook and say so.

Tests for whatever you do add go in `tagVisibility.test.ts`, following the existing table style.

- [ ] **Step 2: Wire the control**

One control at the Categories heading, not two buttons. It reads **All** when anything is hidden and **None** when everything is shown, and does the opposite of what the current state is — so a single target toggles the whole list. Give it an `aria-label` that states the action.

It must persist through the same `writeHiddenTags` path, so a reload keeps the choice, and it must respect the "hidden ids only" storage rule.

- [ ] **Step 3: Verify and commit**

`npx tsc -b` clean, `npx vitest run` green.

```bash
git add Avery/frontend/src/components/CategoryRail.tsx Avery/frontend/src/hooks/useTagVisibility.ts Avery/frontend/src/lib/tagVisibility.ts Avery/frontend/src/lib/tagVisibility.test.ts
git commit -m "feat(frontend): show or hide every category at once"
```

---

## Task 2: Dragging starts when you move, not when you wait

**Files:** modify `Avery/frontend/src/hooks/useCardGestures.ts`

**Interfaces:** `GestureOrigin` and the hook's signature are unchanged.

The complaint: the 250ms hold is too long. Holding and trying to move should move the card immediately.

- [ ] **Step 1: Replace the timer trigger with a movement trigger**

The hook currently arms a `LONG_PRESS_MS` timer; moving more than `MOVE_TOLERANCE_PX` **before** it fires abandons the gesture entirely. Invert that: movement past the threshold is what *starts* the drag, whenever it happens.

The resulting contract:

| gesture | result |
|---|---|
| press, move > 6px | drag begins at once, at any point in the press |
| press, release without moving, no second press within 450ms | navigate to the detail page |
| two presses within 450ms | toggle completion |
| press on a resize handle | resize immediately, as now |

Delete `LONG_PRESS_MS` and its timer. The `lifted` flag stays — it is what stops a completed drag falling through to navigation — but it is now set by the move handler rather than by a timeout.

Removing the timer also removes the unmount-cleanup path that cleared it; make sure the `activePressCleanup` ref (which tears down an in-flight press's window listeners on unmount) still does its job, and that the double-click branch still clears whatever remains.

Keep `MOVE_TOLERANCE_PX` at 6: it is what stops a shaky click from turning into a drag, and it matters more now that it is the sole drag trigger.

- [ ] **Step 2: Verify and commit**

`npx tsc -b` clean, `npx vitest run` green. Walk each row of the table above against your code in the report.

```bash
git add Avery/frontend/src/hooks/useCardGestures.ts
git commit -m "feat(frontend): start a drag on movement rather than on a hold"
```

---

## Task 3: A wrapping template block covers the week's first morning

**Files:** modify `Avery/backend/app/services/templates.py`; test in `Avery/backend/tests/test_templates.py`

The bug: a block like Rest `23:00 → 07:00` on every day materialises as *Monday 23:00 → Tuesday 07:00*. Nothing covers **Monday 00:00 – 07:00**, because that would come from the previous Sunday's occurrence — which does not exist in a week materialised on its own. The week opens with an empty first morning.

- [ ] **Step 1: Write the failing test**

Against a template holding one all-days block that wraps midnight, materialise a week and assert an event exists covering the Monday 00:00–07:00 stretch — specifically one that *starts on the Sunday before the week* and ends at 07:00 on the Monday.

Also assert the count: a 7-day wrapping block should now produce **8** occurrences for a week (the spillover plus seven), and a non-wrapping block still produces exactly as many as it has days. That second assertion is what stops the fix over-generating.

- [ ] **Step 2: Emit the spillover occurrence**

In `materialize_week`, for a block whose `end_time <= start_time` (the existing midnight-wrap convention) **and** whose `days` include Sunday, also emit the occurrence anchored to the Sunday *before* `week_start`.

Two things to get right:
- **Idempotence.** Materialising twice must not double up. The function already guards against re-creating events for a block; make sure the spillover is covered by the same guard, keyed on the occurrence's own start.
- **Do not leak into the previous week.** The spillover event legitimately starts before `week_start`. Confirm what that does to the previous week's payload — `list_events` selects on overlap, so it will appear there too, which is correct — but check it does not make the previous week look "materialized" when it was not.

- [ ] **Step 3: Verify and commit**

Full pytest green; state the new total.

```bash
git add Avery/backend/app/services/templates.py Avery/backend/tests/test_templates.py
git commit -m "fix(backend): cover the first morning of a materialized week"
```

---

## Task 4: Overlapping events sit side by side

**Files:** create `Avery/frontend/src/lib/overlap.ts` + `overlap.test.ts`; modify `src/components/WeekGrid.tsx`, `src/components/EventCard.tsx`

**Interfaces:** produces `layoutSegments(segments) -> Array<segment & { columnIndex, columnCount }>`.

Today two events at the same time draw exactly on top of each other and the one underneath is unreachable.

- [ ] **Step 1: Write the pure layout function, test first**

Group segments on a day into **clusters** of transitively-overlapping events, then assign each a column within its cluster. Standard approach: sort by start, then end; walk the list keeping the active set; a segment takes the lowest free column index; a cluster's `columnCount` is the maximum concurrency reached within it.

Cases the test must pin:
- two events fully overlapping → columns 0 and 1, count 2 for both
- three concurrent → columns 0, 1, 2, count 3
- A overlaps B, B overlaps C, but A and C do not → all one cluster of count 3 (transitivity is what makes this non-trivial)
- back-to-back events (one ends exactly where the next starts) → **not** overlapping, both column 0 count 1
- an event fully containing two sequential shorter ones → count 2, and the two short ones share a column

Work in minutes or pixels consistently and say which. Do not mutate the input.

- [ ] **Step 2: Apply it in the grid**

`WeekGrid` builds `segmentsByDay`; run each day's list through `layoutSegments` and pass `columnIndex`/`columnCount` to the card.

`EventCard` currently spans `left: 2px; right: CARD_RIGHT_GUTTER_PX`. Divide that span into `columnCount` slots and place the card in its own, keeping the right-hand gutter free at the outer edge — that strip is the quick-create hit target and must not be consumed by the split.

Give the cards a small horizontal gap so two adjacent ones read as two, not one. At `columnCount` 1 the rendering must be byte-identical to today.

- [ ] **Step 3: Verify and commit**

`npx tsc -b` clean, `npx vitest run` green.

```bash
git add Avery/frontend/src/lib/overlap.ts Avery/frontend/src/lib/overlap.test.ts Avery/frontend/src/components/WeekGrid.tsx Avery/frontend/src/components/EventCard.tsx
git commit -m "feat(frontend): lay overlapping events out side by side"
```

---

## Task 5: Minute-accurate times on the detail page

**Files:** modify `Avery/frontend/src/pages/EventDetailPage.tsx`

The grid snaps to 15 minutes, which is right for dragging — `GRID.slotMinutes` already enforces it and stays as is. The detail page is where an exact time gets set, and it is currently read-only.

- [ ] **Step 1: Make the times editable**

Replace the read-only "When" row with editable start and end. Use `<input type="time">` with `step={60}` — one-minute granularity; `step={900}` is what the quick-create popover uses and is deliberately different.

Saving goes through `updateEvent` (`PATCH /api/events/{id}`), which validates that end is after start. Send `start_at`/`end_at` via `formatLocal`, never `toISOString()`.

- [ ] **Step 2: Handle the failure and the wrap**

An end at or before the start means crossing midnight, exactly as `QuickCreatePopover` treats it — reuse that convention rather than inventing a second one, and check whether the backend's "end must be after start" validation rejects what you send. If it does, the wrap has to be resolved client-side into a next-day end before the request goes out.

Surface failures with `errorMessage`, in the page's existing error style.

- [ ] **Step 3: Verify and commit**

`npx tsc -b` clean, `npx vitest run` green.

```bash
git add Avery/frontend/src/pages/EventDetailPage.tsx
git commit -m "feat(frontend): set an event's time to the minute from its detail page"
```

---

## Self-Review

**Coverage:** (1) Task 1. (2) Task 2. (3) Task 3. (4) Task 4. (5) Task 5 — the 15-minute grid snap already exists via `GRID.slotMinutes` and is left untouched.

**Ordering:** Task 4 and the predecessor plan's Task 7 (Day view) both change `WeekGrid`. Task 4 lands first, so the Day view inherits the column layout rather than needing it retrofitted.

**Type consistency:** `layoutSegments` is defined in Task 4 Step 1 and consumed in Step 2. `showAll`/`hideAll` are defined and consumed inside Task 1.
