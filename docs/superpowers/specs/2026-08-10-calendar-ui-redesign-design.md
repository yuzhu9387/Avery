# Avery — Google-Calendar-grade week view

Design, 2026-08-10. Supersedes nothing; extends the week view built in Plan 2.

The week view today is a working but plain 06:00–24:00 grid. This redesign takes its
layout, chrome and interaction vocabulary from Google Calendar, keeps Avery's own
palette, and adds the things the current grid cannot express at all: a card that is a
*task* rather than a block of time, a completion state, category filtering, zoom, and
an end-of-day roll-over.

## Decisions already taken

These were settled before writing and are not open questions:

- **Palette stays.** The 春山景别 tokens in `frontend/src/theme.css` are unchanged. Only
  layout, hierarchy and interaction are copied from Google Calendar. The no-hex-literals
  rule in `frontend/README.md` continues to hold.
- **Typography changes globally to Inter.** The request was "math sans bold" — which is
  not a font but Unicode's Mathematical Sans-Serif Bold block (U+1D5D4–U+1D5ED), rendered
  on this Mac by `STIXTwoMath.otf`, whose sans-serif bold alphabet is a Helvetica-family
  neo-grotesque. Inter is the self-hostable equivalent.
- **`kind` and `completed_at` live in the database**, not in `localStorage`.
- **"Category" means Tag**, not rule group.
- **Hiding a category affects only what the week grid draws.** Ratios, the month view and
  the Review page keep counting every event. This preserves the existing "report the
  truth, don't normalise it away" stance documented on `DayTagBar`.
- **Zoom scales the calendar grid only**, not the whole page.

## Architecture

Four units, each independently testable:

| Unit | Owns | Depends on |
|---|---|---|
| Backend event kind/completion | `kind`, `completed_at`, roll-over transaction | nothing new |
| Grid geometry + zoom | minute↔pixel mapping at an arbitrary scale | nothing |
| Card gestures | click / double-click / long-press disambiguation | geometry |
| Shell (rail, chrome, dialogs) | filtering, persistence, roll-over prompt | the API client |

---

## 1. Backend

### Migration

One alembic revision on top of `1a43aac6fa94`, adding to `events`:

| Column | Type | Notes |
|---|---|---|
| `kind` | `VARCHAR(8) NOT NULL DEFAULT 'event'` | `'event'` \| `'task'` |
| `completed_at` | `DATETIME NULL` | when this card was ticked off |

`EventKind` joins `EventSource` in `app/models/event.py` as a `StrEnum`. Existing rows
become `kind='event'`, `completed_at=NULL` — which is what they are.

### Schemas

- `EventCreate` gains `kind: EventKind = EventKind.EVENT`.
- `EventOut` gains `kind` and `completed_at`.
- `EventUpdate` is **not** touched. It carries a `reject_explicit_null` validator, so it
  cannot express "clear `completed_at`". Completion gets its own endpoints instead.

### Endpoints

```
POST /api/events/{id}/complete     -> 200 EventOut
POST /api/events/{id}/uncomplete   -> 200 EventOut
POST /api/events/roll-over         -> 200 list[EventOut]
     body: { event_ids: list[int], to_date: date }
```

- `complete` sets `completed_at = datetime.now()`; 404 if absent; idempotent (completing
  an already-complete event returns it unchanged rather than moving the timestamp).
- `uncomplete` sets it to `NULL`; also idempotent.
- `roll-over` shifts each named event by the whole-day delta between its own start date
  and `to_date`, preserving wall-clock time and duration, in one transaction. It
  **rejects** (422) any id whose event is `kind='event'` or already complete, rather than
  silently skipping — a caller that asks to move an appointment has a bug, and swallowing
  it would hide the bug behind a partial success.

### Task coupling

Two rules, both deliberate:

1. **A `kind='task'` event always mints a fresh Task.** `create_event` currently routes
   `task_name` through `find_or_create_by_name`. For task cards that is wrong: two cards
   sharing one Task means completing one card marks the whole Task done, and the Tasks
   page and the calendar then disagree. `kind='task'` therefore bypasses the lookup and
   always creates.
   *Known cost:* a daily habit card creates one Task per day, and the backlog records that
   there is still no hard-delete path for a Task. This is accepted for now and belongs in
   the backlog as a follow-up, not in this plan.
2. **Completion syncs one way, for task cards only.** `complete` on a `kind='task'` event
   also sets its Task to `status='done'`, `completed_at=now`; `uncomplete` returns it to
   `status='todo'`, `completed_at=NULL`. A `kind='event'` card never touches its Task —
   an appointment happening is not a to-do being finished.

### Tests

New backend tests covering: the migration round-trip; `kind` defaulting on template
materialization; complete/uncomplete idempotence; the Task sync in both directions;
`roll-over` preserving wall-clock time across a date change; `roll-over` rejecting an
`kind='event'` id; `roll-over` rejecting an already-complete id.

---

## 2. Grid geometry and zoom

### Full 24 hours

`GRID.startHour` becomes `0`. `GRID_HEIGHT_PX` becomes `24 × pxPerHour`. The comment
justifying the 06:00 floor is removed with the floor.

The grid scrolls to 07:00 on mount so the view opens on waking hours rather than on six
empty rows.

This changes what three existing cases in `lib/geometry.test.ts` mean:

- *"splits an overnight block and drops the off-grid small hours"* — 23:00→07:00 is now
  Mon 23:00–24:00 (1h) plus Tue 00:00–07:00 (7h). Rename and re-assert.
- *"clips an event that starts before the grid floor"* — nothing clips any more; 04:00–07:00
  is fully visible with `isStart: true`. Rewrite as a plain early-morning case.
- *"returns nothing for an event entirely inside the off-grid hours"* — there are no
  off-grid hours. **Delete it.** The surviving out-of-week case still covers "contributes
  nothing".

### Scale as a parameter, not a constant

`GRID.pxPerHour` is read directly today by `geometry.ts`, `drag.ts`, `useEventDrag.ts` and
`WeekGrid.tsx`. Zoom makes it a runtime value, so:

```ts
minutesToPx(minutes: number, pxPerHour: number): number
pxToMinutes(px: number, pxPerHour: number): number
segmentsForEvent(start, end, weekStart, pxPerHour): Segment[]
```

`GRID.pxPerHour` survives as `GRID.basePxPerHour = 56`, the value at zoom 1.
`GRID.slotMinutes` and `GRID.minBlockPx` are unaffected — snapping is in minutes and the
minimum legible height is in real pixels regardless of scale.

`lib/drag.ts` reads only `GRID.slotMinutes`, so it needs no change; `useEventDrag` must
thread the live `pxPerHour` into its `pxToMinutes` calls or a drag will resolve to the
wrong duration at any zoom other than 1.

### One scroll container

The header row and the body are two sibling grids today, which cannot scroll together
horizontally. They merge into a single `overflow: auto` container:

- day header row: `position: sticky; top: 0`
- hour gutter column: `position: sticky; left: 0`
- their intersection (top-left corner cell): sticky on both axes

### `useGridZoom`

State: `zoom`, clamped to `[0.5, 3]`, initial `1`.

- macOS trackpad pinch arrives as `wheel` with `ctrlKey: true`. The handler is attached
  non-passively and calls `preventDefault()` so the browser's own page zoom does not fire.
- Safari additionally emits `gesturestart` / `gesturechange` / `gestureend`; those are
  handled too, and `gesturestart` is `preventDefault`ed.
- Zoom is anchored at the pointer: the grid coordinate under the cursor stays under the
  cursor, by adjusting `scrollTop`/`scrollLeft` after the scale change.

Vertical: `pxPerHour = GRID.basePxPerHour × zoom`.
Horizontal: each day column takes `min-width: GRID.baseColumnPx × zoom` (base 120px). At
zoom 1 the columns are `1fr` and fill the container; above 1 they exceed it and the
container's horizontal scrollbar appears.

Zoom is **not** persisted. It is a transient reading posture, not a preference.

---

## 3. Cards

### Two shapes

`EventBlock` splits into a shared shell plus two presentations, keyed on `kind`:

- **Event card** — unchanged from today: tag colour at 22% fill, 3px solid tag-colour left
  bar, title, time range when tall enough.
- **Task card** — `--surface-raised` background, 1px tag-colour border, and a leading ○
  glyph before the title. Visibly lighter than an event card, matching the second
  reference screenshot.

Both are tag-coloured, so a category reads the same whichever shape it takes.

### Right gutter

Cards change from `inset-x-1` (4px both sides) to `left: 2px; right: 12px`. The 12px strip
is a live hit target for creating a new card at that time — which is the point of leaving
it, not merely decoration.

### Completed state

`completed_at != null` renders as: `line-through` on the title, whole card at `opacity:
0.45`, fill dropped to transparent so only the border/left bar remains, and the task
card's ○ becoming ✓.

### Gestures — `useCardGestures`

The single hardest part of this design, because click, double-click and long-press share
one pointer stream.

| Gesture | Result |
|---|---|
| press, hold ≥ 250ms | enter drag; card lifts (scale + shadow) |
| press, move > 6px before 250ms | cancel the long-press timer; no drag, no click |
| press and release < 250ms, no second click within 220ms | navigate to the card's detail page |
| two presses within 220ms | toggle completion |
| press on a top/bottom resize handle | resize immediately, no hold required |

A press held past 250ms and released without moving has entered drag mode and resolves to
nothing — it does **not** fall through to navigation. Once the card lifts, the gesture was
a drag, however short its travel.

Navigation **must** be deferred by 220ms. The browser fires `click` before `dblclick`, so
navigating on the first click would leave the page before the second click could arrive.

Resize handles stay on an immediate drag: they are a distinct affordance with their own
`ns-resize` cursor, and requiring a hold on an explicitly-grabbed edge would feel broken.

`useEventDrag` also gains the `pointercancel` handling the backlog already asks for —
long-press makes a cancelled gesture more likely, not less.

### Confetti

On completion only (never on un-completion), ~24 particles burst from the double-click
point. Hand-written with `requestAnimationFrame` on an absolutely-positioned overlay; no
library. Particle colours are drawn from `--rose`, `--rose-deep`, `--blush`, `--sage`,
`--clay`, `--teal` — read from the theme, so the effect follows the palette by
construction rather than by a parallel hard-coded list.

Under `prefers-reduced-motion: reduce` the burst is skipped; the completion itself still
applies.

### The detail page a card opens

Cards link to a **new `/events/:id` route**, not to `/tasks/:id` as they do today. A card is
an event, and sending an appointment's click to a task page misreports what was clicked.
The page shows the block's own fields — time range, kind, tags, notes, completion — with a
link through to its Task, and carries the first UI path to editing or deleting a single
event (the backlog records that `createEvent`, `updateEvent` and `deleteEvent` are all
defined in the API client and unreferenced).

`TaskDetailPage` stays where it is and keeps its rollups.

---

## 4. Quick create

Clicking empty grid space opens a popover anchored at the click, mirroring the second
reference screenshot:

- title input, autofocused
- an `Event | Task` segmented control
- start/end time, defaulting to the clicked 15-minute slot for one hour, both editable
- a tag picker
- Save

Save posts to `/api/events` with `task_name`, `kind`, `start_at`, `end_at`, `tag_ids`. An
`Event` save still routes `task_name` through `find_or_create_by_name`, so repeated
"Standup" blocks keep rolling up under one Task; only a `Task` save bypasses it, per §1.
The mutation then
invalidates `week`, `evaluate`, `month`, `tasks` and `events` — the same five keys the
existing materialize mutation invalidates, and for the same reason: a new event is visible
through all of them.

Escape or an outside click dismisses without saving. Drag-to-size on empty space is **not**
in scope.

---

## 5. Left rail and chrome

### Rail, top to bottom

1. **Create** button — opens the same quick-create popover, centred rather than anchored.
2. **Mini month** — pure date arithmetic, no fetch. Clicking a day navigates the main grid
   to that week. Its own ‹ › arrows page the month without moving the week.
3. **This week** — the existing `RatioBars` on the active rule, unchanged.
4. **Categories** — one row per non-archived tag: colour swatch, full tag name, a thin bar
   showing that tag's share of the week's minutes, and a checkbox.

### Visibility filter — `useTagVisibility`

- Persisted at `localStorage['avery.hiddenTags']` as an array of tag ids.
- **Hidden ids are stored, not visible ids.** A tag created later is then visible by
  default instead of being born invisible because it was absent from a saved list.
- Filtering keys on the primary tag `tag_ids[0]`, the same field the card takes its colour
  from. An event with no tags is always visible.
- Corrupt or non-array stored values fall back to "nothing hidden" rather than throwing.

### Chrome

Header becomes: hamburger (collapses the rail), wordmark, **Today** pill, ‹ ›, the
month/range title, and a `Week ▾` dropdown routing to `/` or `/month`. The remaining nav
links (Tasks, Template, Rules, Review) move behind the hamburger rail so the header reads
like the reference rather than carrying six tabs. The current-day number in the day header
becomes a filled circle with inverted text, replacing today's `--pale` chip.

**Not in scope: the all-day row.** The reference screenshot shows all-day chips
("Flight to Beijing"), but `Event` has no all-day concept — adding one is a second
migration and a change to every consumer of `start_at`/`end_at`. It goes to the backlog.

---

## 6. Roll-over — `useRolloverPrompt`

- A 60-second interval checks three conditions: local time is at or past **22:00**;
  `localStorage['avery.rolloverPrompted']` is not today's `YYYY-MM-DD`; and at least one
  `kind='task'`, `completed_at=null` event falls on today.
- All three true → open a modal listing those cards (name and time range), each with a
  checkbox, all checked by default.
- Buttons: **Roll over to tomorrow** and **Not now**. *Both* write today's key to
  `localStorage`, so dismissing is respected for the rest of the day.
- Confirm posts `/api/events/roll-over` with the checked ids and tomorrow's date, then
  invalidates the same five query keys.
- `kind='event'` cards never appear. Appointments do not move.

The check also runs on mount, so closing the app before 22:00 and reopening at 23:30 still
prompts.

---

## 7. Typography

`npm i @fontsource-variable/inter` — self-hosted, no CDN request, consistent with the app
having no external dependencies at runtime.

`--font-sans` and `--font-display` in `theme.css` both become Inter. Headings and card
titles at 700, body at 500.

This **replaces the Iowan Old Style serif on every page**, not just the week view —
Tasks, Rules, Template, Review and the app wordmark all change. That is the intended
reading of a global font instruction, and is called out here so it is not a surprise.

---

## Error handling

- Every new mutation surfaces its failure in the UI rather than failing silently. The
  backlog already records `materialize.isError` being swallowed on this page; the new
  complete / uncomplete / roll-over / create paths must not repeat it.
- A failed completion reverts the card's optimistic state and shows an inline message.
- A failed roll-over leaves the modal open with the error, since the transaction is
  all-or-nothing and retrying is meaningful.
- With the backend down, the grid keeps its existing "couldn't load this week" degradation.

## Testing

- **Backend:** as listed in §1.
- **Frontend pure logic** (vitest, no backend): the rewritten `geometry.test.ts` for a
  24-hour grid and for `pxPerHour` as a parameter; `drag.test.ts` unchanged in intent but
  re-checked at a non-1 zoom; a new `tagVisibility.test.ts` for the hidden-id persistence
  including the corrupt-value fallback; a new `rollover.test.ts` for the "should we
  prompt" predicate across the 22:00 boundary, the already-prompted key, and the
  no-incomplete-tasks case.
- Gesture disambiguation and zoom anchoring are verified by hand in the browser; their
  timing behaviour is not worth a fake-timer harness in a single-user app.

## Implementation phases

1. Backend: migration, schemas, endpoints, task coupling, tests.
2. Grid: 24 hours, `pxPerHour` as a parameter, single sticky scroll container, zoom.
3. Cards: task/event shapes, right gutter, completed state, gestures, confetti, quick
   create, the `/events/:id` detail page.
4. Shell: mini month, category rail and persistence, chrome, roll-over, Inter.

Each phase ends with its test suite green before the next begins.

## Deferred to the backlog

- No hard-delete for the Tasks a daily task card accumulates.
- No all-day event row.
- Overlapping cards still stack exactly on top of each other rather than splitting the
  column, which the existing "overlaps are an expected state" note makes more visible now
  that a card no longer fills its column's width.
