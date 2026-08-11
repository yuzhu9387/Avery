# Rail Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Two rail-scoped items from the latest round of feedback that can be delivered without touching files a concurrent session is rewriting.

**Scope note — read before starting.** Five items were requested. Three of them (moving the calendar header into the calendar section; deleting the left nav and redistributing Week/Month/Task/Routine/Rules; hiding all routine-sourced events) require `App.tsx`, `main.tsx` and `WeekPage.tsx`, all of which a second session is mid-way through renaming `Template`→`Routine`. Committing frontend code that expects the renamed API while the backend half of that rename stays uncommitted would leave a fresh checkout broken. Those three are deferred until that rename lands.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind 4 + TanStack Query 5 + vitest.

## Global Constraints

- Work from `Avery/frontend`.
- **No hex colour literals** — tokens from `src/theme.css` as `var(--token)`, or Tailwind classes mapped in `src/index.css`. Tag colours arriving as API data are not literals.
- **The backend speaks naive local time** — never `toISOString()` on a Date bound for the API.
- Vitest is `environment: 'node'` — no DOM, no `localStorage`. Anything unit-tested is pure and takes its dependencies as parameters.
- Mutation errors surface through `errorMessage` from `src/api/client.ts`.
- `npx tsc -b` clean and `npx vitest run` green before every commit.

## Shared working tree — binding on every task here

A second session holds ~50 uncommitted entries in this checkout, including a whole-backend `Template`→`Routine` rename and frontend edits to `App.tsx`, `main.tsx`, `WeekPage.tsx`, `MonthPage.tsx` and `api/types.ts`.

**Do not touch any of those five files.** If a task appears to need one, stop and report `BLOCKED` rather than editing it.

Stage by explicit path only — never `git add -A`, `git add .`, or `git commit -a`. Read `git diff --cached` in full before committing and paste it into your report; if anything appears that you did not write, `git reset` (plain, unstages without touching content) and report it. Four commits in this project have already absorbed that session's work.

---

## Task 1: The rule rail shows its full group names

**Files:** modify `Avery/frontend/src/components/RatioBars.tsx`

The "This week" rail renders each rule group's name beside its percentage and verdict pill. The names are now real words rather than letters — `Work & Study`, `Family care`, `Fitness` — and the first is truncating to `Work & Stu…` in a 224px rail.

- [ ] **Step 1: Make the row fit its content**

The row is a `justify-between` flex holding the label on one side and `{percentage}{VerdictPill}` on the other. The label has `truncate min-w-0`, so it is the part that yields.

Fix it so the full name shows. The budget is real — roughly 224px minus the rail's padding, shared with a percentage like `50.4%` and a pill reading `on target`. Options, in rough order of preference:

- Give the label the space instead of the pill: the verdict is already encoded in the bar's colour beneath, so the pill can shrink to a dot or an icon, or drop to the second line.
- Put the name on its own line above the bar, with the percentage and pill on the line below. Two short lines beat one truncated one.
- Shorten the rendered text with a deliberate abbreviation map — but only as a last resort, and never by blind truncation, because "Work & Stu…" and "Work & Study" differ only in the part that got cut.

Whatever you choose, it must hold for a longer name than today's: a user can rename a group to anything through the Rules page. Say in your report what the widest name is that still fits, and what happens past it.

Keep `compact` doing whatever it currently does for the non-rail rendering — the Review page uses the same component, and it has far more width. Do not regress that.

- [ ] **Step 2: Verify and commit**

`npx tsc -b` clean, `npx vitest run` green. State in your report what you could not verify without a browser.

```bash
git add Avery/frontend/src/components/RatioBars.tsx
git commit -m "fix(frontend): let the rule rail show its full group names"
```

---

## Task 2: Add and delete categories from the rail

**Files:** create `Avery/frontend/src/components/CategoryEditor.tsx`; modify `Avery/frontend/src/components/CategoryRail.tsx`, `src/api/tags.ts`

**Interfaces:** produces `CategoryEditor`; `createTag`, `updateTag`, `deleteTag`, `archiveTag` in `api/tags.ts` matching the current backend routes.

The Categories rail currently ends with a `None`/`All` control. That becomes a **`+`** that creates a category, and every row gains a **`−`** that deletes one.

**`CategoryRail` must own these mutations itself.** Its parent, `WeekPage.tsx`, is off-limits — so the rail cannot gain new props for this. It already receives the tag list; give it its own `useMutation` calls and its own editor state. That is a reasonable home for them anyway: the rail is the only place categories are managed.

- [ ] **Step 1: Correct the API client**

The backend changed under `src/api/tags.ts` in an earlier task and the client was never updated:

```ts
export const deleteTag = (id: number) => apiSend<void>('DELETE', `/tags/${id}`)
export const archiveTag = (id: number) => apiSend<Tag>('POST', `/tags/${id}/archive`)
```

`DELETE` now really deletes; archiving moved to its own route. Verify the current file before editing — if `archiveTag` still points at `DELETE`, it would archive-by-deleting, which is data loss.

`Tag` also gained a `description` column. **`src/api/types.ts` is off-limits**, so if `Tag` there lacks `description`, do not edit it — declare what you need locally in the editor component and note it in your report for a later task to fold in.

- [ ] **Step 2: Build the editor**

A side card, not a route: a small panel anchored beside the rail with **name**, a **colour** picker, and a **description** field. It serves both create and edit — no `tag` prop means create.

The colour picker offers the palette already in `theme.css` (`--pale`, `--blush`, `--sage`, `--clay`, `--rose`, `--rose-deep`, `--teal`) as swatches plus a free `<input type="color">`. The seeded categories use exactly those values, so the picker and the existing data agree by construction.

Escape and an outside press dismiss. A failed save keeps the panel open with `errorMessage`, matching `QuickCreatePopover`.

- [ ] **Step 3: Wire `+` and `−`**

The `+` replaces the existing `None`/`All` control at the Categories heading. **The select-all/none behaviour that control provided must not simply vanish** — decide deliberately where it goes and say so; a feature that was requested two rounds ago should not be silently dropped to make room.

Each row gains a `−`. The row is currently one `<button>` wrapping everything, so nested buttons are invalid HTML — restructure so the visibility checkbox, the name and the actions are siblings.

Deleting hits `DELETE /api/tags/{id}`, which **409s with a message naming what still uses the category** when events, tasks, routine blocks or rules reference it. Show that message verbatim — it already contains the count — and offer **Archive** as the next action in the same place.

- [ ] **Step 4: Invalidate correctly**

A tag write changes card colours across the grid, the rail's contents and the rule rail's labels. Invalidate `['tags']` **and** call `invalidateCalendar` from `src/api/invalidate.ts` — `useTagMap` feeds every card in the week.

- [ ] **Step 5: Verify and commit**

`npx tsc -b` clean, `npx vitest run` green.

```bash
git add Avery/frontend/src/components/CategoryEditor.tsx Avery/frontend/src/components/CategoryRail.tsx Avery/frontend/src/api/tags.ts
git commit -m "feat(frontend): add and delete categories from the rail"
```

---

## Deferred, and why

| Request | Needs | Blocked on |
|---|---|---|
| Calendar header moves into the calendar section | `App.tsx`, `WeekPage.tsx` | `Template`→`Routine` rename uncommitted |
| Delete the left nav; Week/Month to the calendar header, Task beside the logo, Routine/Rules bottom-left with account and settings | `App.tsx`, `main.tsx`, `WeekPage.tsx` | same |
| Hide all routine-sourced events from the Categories column | `WeekPage.tsx` for the filter, and `source === 'routine'` which exists only in that uncommitted rename | same |
