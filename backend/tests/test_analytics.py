from datetime import date, datetime, timedelta

import pytest

from app.services.analytics import EventSlice, evaluate, find_overlaps, split_minutes_by_day
from app.services.rules import GroupSpec, RuleSpec

REST, WORK, STUDY, COMMUTE, KIDS, CHORES, FITNESS, PERSONAL = 1, 2, 3, 4, 5, 6, 7, 8

RULE = RuleSpec(
    groups=(
        GroupSpec("A", "Work · Study · Commute", 6.0, (WORK, STUDY, COMMUTE)),
        GroupSpec("B", "Kids · Chores", 3.0, (KIDS, CHORES)),
        GroupSpec("C", "Fitness", 1.0, (FITNESS,)),
    ),
    tolerance=0.2,
    exclude_tag_ids=(REST, PERSONAL),
)

PERIOD_START = datetime(2026, 8, 1)
PERIOD_END = datetime(2026, 9, 1)


def slice_(id_: int, tag: int, day: int, start_h: int, hours: float) -> EventSlice:
    start = datetime(2026, 8, day, start_h)
    return EventSlice(
        id=id_, start_at=start, end_at=start + timedelta(hours=hours), tag_ids=(tag,)
    )


def test_target_shares_come_from_ratios():
    result = evaluate([slice_(1, WORK, 3, 9, 6.0)], RULE, PERIOD_START, PERIOD_END)
    by_key = {g.key: g for g in result.groups}
    assert by_key["A"].share_target == pytest.approx(0.6)
    assert by_key["B"].share_target == pytest.approx(0.3)
    assert by_key["C"].share_target == pytest.approx(0.1)


def test_perfect_631_all_pass():
    slices = [
        slice_(1, WORK, 3, 8, 6.0),
        slice_(2, KIDS, 3, 15, 3.0),
        slice_(3, FITNESS, 3, 19, 1.0),
    ]
    result = evaluate(slices, RULE, PERIOD_START, PERIOD_END)
    assert result.total_minutes == 600
    assert all(g.verdict == "pass" for g in result.groups)


def test_spec_worked_example_fitness_fails_under():
    """From the spec: a template weekday is 10h / 5h / 1h = 62/31/6%, so C is under."""
    slices = [
        slice_(1, WORK, 3, 9, 7.0),
        slice_(2, STUDY, 3, 21, 1.5),
        slice_(3, COMMUTE, 3, 8, 1.5),
        slice_(4, KIDS, 3, 17, 4.0),
        slice_(5, CHORES, 3, 6, 1.0),
        slice_(6, FITNESS, 3, 5, 1.0),
    ]
    result = evaluate(slices, RULE, PERIOD_START, PERIOD_END)
    by_key = {g.key: g for g in result.groups}

    assert by_key["A"].share_actual == pytest.approx(10 / 16)
    assert by_key["A"].verdict == "pass"
    assert by_key["B"].verdict == "pass"
    assert by_key["C"].share_actual == pytest.approx(1 / 16)
    assert by_key["C"].verdict == "under"


def test_excluded_tags_leave_the_denominator():
    slices = [
        slice_(1, WORK, 3, 8, 6.0),
        slice_(2, KIDS, 3, 15, 3.0),
        slice_(3, FITNESS, 3, 19, 1.0),
        slice_(4, REST, 3, 23, 8.0),
        slice_(5, PERSONAL, 4, 13, 3.0),
    ]
    result = evaluate(slices, RULE, PERIOD_START, PERIOD_END)
    assert result.total_minutes == 600
    assert result.excluded_minutes == 660
    assert all(g.verdict == "pass" for g in result.groups)


def test_unassigned_tag_is_reported_not_counted():
    unknown = 99
    slices = [
        slice_(1, WORK, 3, 8, 6.0),
        slice_(2, KIDS, 3, 15, 3.0),
        slice_(3, FITNESS, 3, 19, 1.0),
        slice_(4, unknown, 4, 10, 3.5),
    ]
    result = evaluate(slices, RULE, PERIOD_START, PERIOD_END)
    assert result.total_minutes == 600
    assert result.unassigned_minutes == 210
    assert result.unassigned_tag_ids == [unknown]


def test_empty_period_has_no_data():
    result = evaluate([], RULE, PERIOD_START, PERIOD_END)
    assert result.has_data is False
    assert result.total_minutes == 0
    assert all(g.minutes == 0 for g in result.groups)


def test_all_events_excluded_has_no_data():
    result = evaluate([slice_(1, REST, 3, 23, 8.0)], RULE, PERIOD_START, PERIOD_END)
    assert result.has_data is False
    assert result.excluded_minutes == 480


def test_zero_minute_group_is_under_with_minus_one_deviation():
    slices = [slice_(1, WORK, 3, 8, 6.0), slice_(2, KIDS, 3, 15, 3.0)]
    result = evaluate(slices, RULE, PERIOD_START, PERIOD_END)
    fitness = next(g for g in result.groups if g.key == "C")
    assert fitness.minutes == 0
    assert fitness.deviation == pytest.approx(-1.0)
    assert fitness.verdict == "under"


def test_events_are_clipped_to_the_period():
    """A rest-of-July event bleeding into August contributes only its August minutes."""
    spanning = EventSlice(
        id=1,
        start_at=datetime(2026, 7, 31, 22),
        end_at=datetime(2026, 8, 1, 6),
        tag_ids=(WORK,),
    )
    result = evaluate([spanning], RULE, PERIOD_START, PERIOD_END)
    assert result.total_minutes == 360


def test_primary_tag_attributes_the_whole_event():
    multi = EventSlice(
        id=1,
        start_at=datetime(2026, 8, 3, 9),
        end_at=datetime(2026, 8, 3, 11),
        tag_ids=(WORK, FITNESS),
    )
    result = evaluate([multi], RULE, PERIOD_START, PERIOD_END)
    by_key = {g.key: g for g in result.groups}
    assert by_key["A"].minutes == 120
    assert by_key["C"].minutes == 0


def test_untagged_event_counts_as_unassigned():
    bare = EventSlice(
        id=1, start_at=datetime(2026, 8, 3, 9), end_at=datetime(2026, 8, 3, 10), tag_ids=()
    )
    result = evaluate([bare], RULE, PERIOD_START, PERIOD_END)
    assert result.unassigned_minutes == 60
    assert result.has_data is False


def test_overlaps_are_counted_and_reported():
    a = EventSlice(1, datetime(2026, 8, 3, 9), datetime(2026, 8, 3, 11), (WORK,))
    b = EventSlice(2, datetime(2026, 8, 3, 10), datetime(2026, 8, 3, 12), (KIDS,))
    result = evaluate([a, b], RULE, PERIOD_START, PERIOD_END)
    assert result.total_minutes == 240
    assert result.overlaps == [(1, 2)]


def test_find_overlaps_ignores_touching_events():
    a = EventSlice(1, datetime(2026, 8, 3, 9), datetime(2026, 8, 3, 10), (WORK,))
    b = EventSlice(2, datetime(2026, 8, 3, 10), datetime(2026, 8, 3, 11), (WORK,))
    assert find_overlaps([a, b]) == []


def test_split_minutes_by_day_divides_at_midnight():
    overnight = EventSlice(
        1, datetime(2026, 8, 3, 23), datetime(2026, 8, 4, 7), (REST,)
    )
    assert split_minutes_by_day(overnight) == {date(2026, 8, 3): 60, date(2026, 8, 4): 420}


def test_split_minutes_by_day_single_day():
    same_day = EventSlice(1, datetime(2026, 8, 3, 9), datetime(2026, 8, 3, 10, 30), (WORK,))
    assert split_minutes_by_day(same_day) == {date(2026, 8, 3): 90}
