# MCP Full-CRUD Design

**Date:** 2026-08-18
**Status:** Approved direction; spec awaiting review
**Supersedes:** the "four intent-shaped tools only" decision in `backend/mcp_server/server.py`'s header comment (that comment must be rewritten as part of this work).

## Context

The MCP server exposes 4 intent-shaped tools (`avery_today`, `avery_schedule`,
`avery_capture_task`, `avery_complete`). The user now drives Avery through a
Lark bot whose agent connects over this MCP server, and wants the LLM to be
able to query and modify **all** of their schedule data — full CRUD across
every entity — not just the four high-frequency intents.

The original 4-tool decision was made to avoid flooding tool selection with
~40 REST endpoints. That concern stands; this design covers the full data
surface with 11 tools instead of 50 by grouping per entity with an `action`
enum.

## Goals

- Every data entity (events, tasks, tags, routines, routine blocks, rules,
  reminders, reports, calendar views, analytics) readable and writable through
  MCP.
- One user's agent can only ever touch that user's data (see Security model).
- Keep the semantic guardrails that the intent tools encoded (Event/Task
  separation, naive-local datetimes, `task_name` vs `title`).

## Non-goals

- Multi-account support. One MCP server process serves one agent token serves
  one Avery account. The design must not *bake in* single-user assumptions in
  tool schemas (no hardcoded user references — which is already true since
  identity lives entirely in the token), but no per-Lark-user mapping is built.
- Exposing `auth`, `agent_tokens`, or `jobs` routers (see Security model).
- Changing the REST API. The MCP server remains a pure HTTP client; new
  capability comes only from covering existing endpoints. (Exception: none
  known. If implementation discovers a missing endpoint, that is a scope
  upgrade to flag, not silently add.)

## Tool inventory

Dropped: `avery_schedule`, `avery_capture_task`, `avery_complete` — fully
covered by `avery_events` / `avery_tasks`; keeping both layers would make two
tools claim the same job. Their docstring guidance (Event vs Task separation,
"booking a meeting must not mint a to-do") moves verbatim into the
descriptions of `avery_events` and `avery_tasks`.

Kept: `avery_today` — cross-entity aggregation (schedule + open tasks +
overdue) that no single entity tool replaces.

New: 10 entity tools, each a single MCP tool taking an `action` parameter
(enum, validated in the tool) plus action-specific parameters.

| Tool | Actions | REST routes covered |
|---|---|---|
| `avery_events` | list, get, create, update, delete, move, complete, uncomplete, roll_over | `/api/events` (9) |
| `avery_tasks` | list, get, create, update, archive, stats | `/api/tasks` (6) — `DELETE /{task_id}` archives; there is no hard delete, so the action is named `archive`, not `delete` |
| `avery_tags` | list, get, create, update, delete, archive | `/api/tags` (6) |
| `avery_routines` | list, get, active, create, update, delete, preview, materialize | `/api/routines`, `/api/weeks/{day}/materialize` (8) — activation and forking go through `update`/`create` as the API defines them; no invented actions without routes |
| `avery_routine_blocks` | create, update, delete | `/api/routines/{ref}/blocks` (3) — no list route; blocks arrive embedded in `avery_routines` get |
| `avery_rules` | list, get, active, create, update, delete | `/api/rules` (6) |
| `avery_reminders` | list, get, create, update, delete | `/api/reminders` (5) |
| `avery_reports` | list, run, get, delete | `/api/reports` (4) |
| `avery_calendar` | week, month | `/api/weeks/{day}`, `/api/months/{yyyy-mm}` (2) |
| `avery_analytics` | evaluate | `/api/analytics/evaluate` (1) |

11 tools total (10 entity + `avery_today`). `avery_routine_blocks` is split
from `avery_routines` because 11 actions on one tool makes an unreadable
description; blocks are also the piece the user edits most.

## Parameter conventions

- `action: str` — first parameter of every entity tool; unknown action returns
  a tool error listing valid actions (never a silent no-op).
- All datetimes are naive local (`2026-08-12T15:00:00`). Reuse the existing
  `_require_naive_local` on **every** datetime parameter; timezone suffixes are
  rejected with the existing error message.
- IDs are integers, named per entity (`event_id`, `task_id`, `tag_id`, …) —
  never a bare `id`, so a model juggling two entities cannot cross-wire them.
- Optional fields absent from a call are omitted from the request body
  (PATCH semantics preserved; explicit-null rejection stays server-side).
- Every mutating action returns the created/updated resource as Avery returned
  it; delete/archive return a short confirmation dict `{deleted: id}` /
  `{archived: id}`.

## Semantic guardrails (carried into tool descriptions)

These are the traps that motivated per-entity tools over a generic
`avery_request(method, path, body)` proxy:

1. **Event vs Task** — separate lists; creating one never creates the other.
   The old `avery_schedule`/`avery_capture_task` docstring text moves into
   `avery_events`/`avery_tasks`.
2. **Task cards** — `avery_events` `create` with `kind="task"` sends the name
   as both `title` and `task_name` (the title-only 500 was fixed on
   2026-08-17, but sending both is compatible with deployed versions predating
   the fix).
3. **Versioned rules** — `avery_rules` `update` explains that editing
   supersedes: old version closes, new one opens, old reports keep meaning.
4. **Routine materialise** — skips days that already have events; the
   description says so, so the model does not retry a "partial" materialise.
5. **Deletes are real** — description instructs the model to confirm with the
   user before `delete` on events, routines, reminders and reports (soft
   guard); tags and rules rely on the server's 409-when-referenced guard
   (hard), and the tool surfaces the 409 detail (counts of referencing rows)
   verbatim so the model can offer `archive` instead. Tasks cannot be hard
   deleted at all — `avery_tasks` has only `archive`, and its description says
   so, so the model never promises a deletion the API cannot perform.

## Security model

Threat considered: an attacker using or influencing the agent (including via
prompt injection in Lark messages) tries to read or modify **another user's**
data, or to escalate the agent's own privileges.

**Server-side isolation is the boundary; the MCP layer adds no new trust.**
Verified properties of the existing REST API that this design relies on:

- No route accepts a caller-supplied `user_id`. Identity comes only from the
  credential (`Authorization: Bearer <agent token>` → one `AgentToken` row →
  one `user_id`). Verified by inspection: zero matches for caller-supplied
  `user_id` across `app/routers/`.
- Cross-user access by id is 404 (not 403 — existence is not leaked), list
  endpoints exclude other users' rows, and creates/updates cannot reference
  another user's tags/tasks. Covered by `tests/test_cross_user_isolation.py`
  (11 tests, including `test_agent_token_does_not_cross_users`).
- Agent tokens are stored hashed (SHA-256 of a 256-bit CSPRNG value); a DB
  leak does not yield working credentials.

Rules this design adds at the MCP layer:

1. **No tool takes `user_id`, email, or any account identifier.** There is
   nothing the model can send to name a victim. Enforced by a test that walks
   every registered tool's JSON schema and asserts no such parameter exists.
2. **`auth`, `agent_tokens`, `jobs`, and `seed` routers are not exposed.**
   `agent_tokens` in particular would let the agent mint itself new
   credentials (privilege escalation) and `auth` would expose password
   change/OAuth linking to prompt injection. A test asserts the tool list is
   exactly the 11 designed tools.
3. **The client sends the token only to `AVERY_BASE_URL`.** Already true
   (single `httpx` client with a fixed base URL); a test asserts the
   Authorization header is not attached to redirects to other hosts
   (`follow_redirects` stays off).
4. **Token at rest:** the token lives in `~/.claude.json` (user scope) and
   `.mcp.json` (git-ignored). Both are plaintext on the user's own machine —
   same trust level as the browser cookie jar; acceptable for personal use and
   called out in README. Revocation is `DELETE /api/agent-tokens/{id}` from
   the web app (deliberately *not* from MCP, per rule 2).

**Residual risk, out of scope for this repo:** anyone who can message the
Lark bot speaks *as* the account owner — same-account risk, not cross-account.
Mitigation lives in the bridge's access config (`allowedUsers` /
`allowedChats`), currently empty (= unrestricted). Recommendation recorded
here: restrict `allowedUsers` to the owner's Lark user id on both profiles.

## Error handling

- Avery 4xx → tool error carrying the server's `detail` verbatim (the 409
  in-use counts, the 422 validation messages — they are written for humans and
  the model relays them).
- Avery 5xx / network failure → tool error "Avery is unreachable / returned
  500" without a stack trace.
- Unknown `action` / missing required parameter for an action → tool error
  before any HTTP call, listing what the action needs.
- Startup fails loudly if `AVERY_AGENT_TOKEN` is missing (existing behaviour,
  kept).

## Implementation shape

- `mcp_server/client.py`: add one generic `request(method, path, *, params,
  json)` used by all tools; keep the existing typed helpers only where
  `avery_today` needs them.
- `mcp_server/server.py`: rewrite header comment (the 4-tool rationale is
  superseded); keep FastMCP instance, `_require_naive_local`, and startup
  check. Each tool is a thin dispatcher: validate action + params, map to
  method/path, call, shape the response.
- If `server.py` grows unreadable, split to `mcp_server/tools/<entity>.py`
  registered onto the shared FastMCP instance — implementer's call, flagged in
  the plan.
- Tests live beside the existing `tests/test_mcp_server.py` pattern (tools
  invoked in-process against a fake/real backend): per action a happy path,
  plus regressions for each semantic guardrail and the two security
  assertions (schema walk; tool list exact-match).

## Rollout

No deploy dependency: the MCP server runs on the user's machine and talks to
prod over HTTPS. Ship = merge + the user's agents pick it up on their next
spawn (bridge spawns a fresh `claude` per message; Claude Code sessions pick
it up on restart).
