"""Pure ratio analytics. No I/O, no ORM imports — only dataclasses in and out.

This is the module most likely to be subtly wrong, so it is kept free of
infrastructure and covered exhaustively.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from app.services.rules import RuleSpec

PASS = "pass"
OVER = "over"
UNDER = "under"

# `deviation` is the result of two float divisions, so a share sitting exactly on a
# band edge lands a few ULPs outside it — 8.0% of a 6:3:1 group C computes as
# -0.20000000000000004 against a 0.2 tolerance and would read "under" while the
# payload printed -0.2. The bands are documented as inclusive; this makes them so.
TOLERANCE_EPSILON = 1e-9


@dataclass(frozen=True)
class EventSlice:
    """An Event reduced to exactly what analytics needs."""

    id: int
    start_at: datetime
    end_at: datetime
    tag_ids: tuple[int, ...] = ()

    @property
    def primary_tag_id(self) -> int | None:
        return self.tag_ids[0] if self.tag_ids else None


@dataclass(frozen=True)
class GroupResult:
    key: str
    label: str
    ratio: float
    minutes: int
    share_actual: float
    share_target: float
    deviation: float
    verdict: str

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "ratio": self.ratio,
            "minutes": self.minutes,
            "hours": round(self.minutes / 60, 2),
            "share_actual": round(self.share_actual, 4),
            "share_target": round(self.share_target, 4),
            "deviation": round(self.deviation, 4),
            "verdict": self.verdict,
        }


@dataclass(frozen=True)
class Evaluation:
    total_minutes: int
    groups: list[GroupResult]
    minutes_by_tag: dict[int, int]
    unassigned_minutes: int
    unassigned_tag_ids: list[int]
    excluded_minutes: int
    untagged_minutes: int
    overlaps: list[tuple[int, int]] = field(default_factory=list)

    @property
    def has_data(self) -> bool:
        return self.total_minutes > 0

    def to_dict(self) -> dict:
        return {
            "has_data": self.has_data,
            "total_minutes": self.total_minutes,
            "total_hours": round(self.total_minutes / 60, 2),
            "groups": [g.to_dict() for g in self.groups],
            "minutes_by_primary_tag": {str(k): v for k, v in self.minutes_by_tag.items()},
            "unassigned_minutes": self.unassigned_minutes,
            "unassigned_tag_ids": self.unassigned_tag_ids,
            "excluded_minutes": self.excluded_minutes,
            "untagged_minutes": self.untagged_minutes,
            "overlaps": [list(pair) for pair in self.overlaps],
        }


def minutes_in_window(slice_: EventSlice, start: datetime, end: datetime) -> int:
    """Minutes of `slice_` falling inside the half-open window [start, end)."""
    lo = max(slice_.start_at, start)
    hi = min(slice_.end_at, end)
    if hi <= lo:
        return 0
    return int((hi - lo).total_seconds() // 60)


def split_minutes_by_day(slice_: EventSlice) -> dict[date, int]:
    """Distribute an event's minutes across the calendar days it touches."""
    out: dict[date, int] = {}
    cursor = slice_.start_at
    while cursor < slice_.end_at:
        day_end = datetime.combine(cursor.date(), datetime.min.time()) + timedelta(days=1)
        chunk_end = min(day_end, slice_.end_at)
        minutes = int((chunk_end - cursor).total_seconds() // 60)
        if minutes:
            out[cursor.date()] = out.get(cursor.date(), 0) + minutes
        cursor = chunk_end
    return out


def find_overlaps(slices: list[EventSlice]) -> list[tuple[int, int]]:
    """Pairs of event ids whose intervals genuinely intersect. Touching is not overlap."""
    ordered = sorted(slices, key=lambda s: (s.start_at, s.id))
    pairs: list[tuple[int, int]] = []
    for i, a in enumerate(ordered):
        for b in ordered[i + 1 :]:
            if b.start_at >= a.end_at:
                break
            pairs.append((a.id, b.id))
    return pairs


def evaluate(
    slices: list[EventSlice],
    rule: RuleSpec,
    period_start: datetime,
    period_end: datetime,
) -> Evaluation:
    excluded = set(rule.exclude_tag_ids)
    tag_to_group: dict[int, str] = {
        tag_id: group.key for group in rule.groups for tag_id in group.tag_ids
    }

    minutes_by_tag: dict[int, int] = {}
    minutes_by_group: dict[str, int] = {g.key: 0 for g in rule.groups}
    unassigned_minutes = 0
    unassigned_tags: set[int] = set()
    excluded_minutes = 0
    untagged_minutes = 0

    for s in slices:
        minutes = minutes_in_window(s, period_start, period_end)
        if minutes == 0:
            continue
        tag_id = s.primary_tag_id
        if tag_id is not None:
            minutes_by_tag[tag_id] = minutes_by_tag.get(tag_id, 0) + minutes
        if tag_id in excluded:
            excluded_minutes += minutes
            continue
        if tag_id is None:
            # No tags at all — distinct from a tag that exists but maps to no group,
            # so "Unassigned — Nh across M tags" never renders "across 0 tags".
            untagged_minutes += minutes
            continue
        group_key = tag_to_group.get(tag_id)
        if group_key is None:
            unassigned_minutes += minutes
            unassigned_tags.add(tag_id)
            continue
        minutes_by_group[group_key] += minutes

    total = sum(minutes_by_group.values())
    ratio_sum = sum(g.ratio for g in rule.groups)

    groups: list[GroupResult] = []
    for g in rule.groups:
        minutes = minutes_by_group[g.key]
        share_target = g.ratio / ratio_sum if ratio_sum else 0.0
        share_actual = minutes / total if total else 0.0
        if share_target == 0:
            deviation = 0.0
        else:
            deviation = (share_actual - share_target) / share_target
        if not total:
            verdict = UNDER
        elif share_target == 0:
            # A zero-ratio group asks for no time at all, so any time spent in it
            # overshoots. Without this branch deviation is 0.0 and the group would
            # report "pass" while holding a third of the week and diluting every
            # other group's share.
            verdict = PASS if share_actual == 0 else OVER
        elif abs(deviation) <= rule.tolerance + TOLERANCE_EPSILON:
            verdict = PASS
        else:
            verdict = OVER if deviation > 0 else UNDER
        groups.append(
            GroupResult(
                key=g.key,
                label=g.label,
                ratio=g.ratio,
                minutes=minutes,
                share_actual=share_actual,
                share_target=share_target,
                deviation=deviation,
                verdict=verdict,
            )
        )

    in_period = [s for s in slices if minutes_in_window(s, period_start, period_end) > 0]

    return Evaluation(
        total_minutes=total,
        groups=groups,
        minutes_by_tag=minutes_by_tag,
        unassigned_minutes=unassigned_minutes,
        unassigned_tag_ids=sorted(unassigned_tags),
        excluded_minutes=excluded_minutes,
        untagged_minutes=untagged_minutes,
        overlaps=find_overlaps(in_period),
    )
