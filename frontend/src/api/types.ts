export type Verdict = 'pass' | 'over' | 'under'
export type TaskStatus = 'todo' | 'doing' | 'done' | 'archived'
export type Priority = 'low' | 'normal' | 'high'
export type EventSource = 'routine' | 'manual' | 'agent'
export type EventKind = 'event' | 'task'
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
  routine_block_id: number | null
  notes: string
  kind: EventKind
  completed_at: string | null
}

export interface RoutineBlock {
  id: number
  routine_id: number
  days: number[]
  start_time: string
  end_time: string
  task_name: string
  tag_ids: number[]
  sort_order: number
}

/** One version of the weekly routine. At most one is active; the rest are history
 *  you can read and switch back to. */
export interface Routine {
  id: number
  name: string
  note: string
  is_active: boolean
  created_at: string
  /** Moves whenever the version changes, including when one of its blocks does.
   *  This is what the version list sorts by. */
  updated_at: string
  blocks: RoutineBlock[]
}

export interface NewRoutine {
  name: string
  note?: string
  is_active?: boolean
  /** Start this version from the active routine's blocks rather than empty. A new
   *  version usually means "the current one, with a change", and starting empty is
   *  how an active routine ends up with no blocks and silently generates nothing. */
  copy_blocks_from_active?: boolean
}

export interface RuleGroup {
  key: string
  label: string
  ratio: number
  tag_ids: number[]
}

/** A patch to an existing rule version. Ratios are editable in place so several
 *  named rules ("chill life", "heavy work") can be kept and tuned rather than
 *  forked on every tweak. `exclude_tag_ids` may only be sent together with
 *  `groups` — the backend refuses it alone, because with no groups in the same
 *  request there is nothing to check it against. */
export interface RuleUpdate {
  name?: string
  note?: string
  groups?: RuleGroup[]
  tolerance?: number
  exclude_tag_ids?: number[]
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
    routine_block_id: number
  }[]
}
