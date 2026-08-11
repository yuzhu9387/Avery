from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Task, Routine, RoutineBlock
from app.models.event import EventSource
from app.models.task import TaskStatus
from app.schemas.routine import (
    RoutineBlockCreate,
    RoutineBlockUpdate,
    RoutineCreate,
    RoutineUpdate,
)
from app.services import events as event_service
from app.services import tags as tag_service


class NoActiveRoutine(Exception):
    """Raised when materialization is requested but no active routine exists."""


class ActiveRoutineError(Exception):
    """Raised when deleting the currently active routine version is attempted.

    Deleting it would leave nothing generating future weeks with no warning —
    the same silent-empty-week failure `_deactivate_others` exists to prevent
    on the create/activate side. The fix is the same: activate another version
    first, then delete this one.
    """


def week_bounds(any_day: date) -> tuple[date, date]:
    """Monday and the following Monday for the week containing `any_day`."""
    monday = any_day - timedelta(days=any_day.isoweekday() - 1)
    return monday, monday + timedelta(days=7)


async def list_routines(session: AsyncSession) -> list[Routine]:
    """Every version, most recently changed first — the order the version list shows.

    `id desc` breaks ties: two versions created in the same clock tick (which the
    tests do, and a fast double-click can) would otherwise come back in an
    arbitrary order and the list would appear to shuffle between loads.
    """
    stmt = select(Routine).order_by(Routine.updated_at.desc(), Routine.id.desc())
    return list((await session.scalars(stmt)).all())


async def _deactivate_others(session: AsyncSession, keep_id: int | None) -> None:
    """Enforce at most one active routine.

    Nothing in the schema enforces this, and before it was enforced here the
    consequence was silent: `create_routine` defaulted `is_active=True` without
    clearing anyone else, and `get_active_routine` then picked the highest id
    among the actives. Creating a second routine therefore shadowed the first,
    so week materialization read an empty routine and generated nothing —
    with no error anywhere.
    """
    stmt = select(Routine).where(Routine.is_active.is_(True))
    for other in (await session.scalars(stmt)).all():
        if other.id != keep_id:
            other.is_active = False


async def touch_routine(session: AsyncSession, routine_id: int) -> None:
    """Move a routine's `updated_at` because one of its blocks changed.

    A block lives in its own table, so adding or editing one does not touch the
    routine row and `onupdate` never fires. Without this the version list would
    order by when a routine was last *renamed*, which is not what changed.
    """
    routine = await session.get(Routine, routine_id)
    if routine is not None:
        routine.updated_at = datetime.now()


async def get_routine(session: AsyncSession, routine_id: int) -> Routine | None:
    # populate_existing re-runs the selectin load of `blocks`. Without it, a Routine
    # already in the identity map returns a stale block list after an add or delete.
    stmt = (
        select(Routine)
        .where(Routine.id == routine_id)
        .execution_options(populate_existing=True)
    )
    return (await session.scalars(stmt)).first()


async def get_active_routine(session: AsyncSession) -> Routine | None:
    stmt = (
        select(Routine)
        .where(Routine.is_active.is_(True))
        .order_by(Routine.id.desc())
        .execution_options(populate_existing=True)
    )
    return (await session.scalars(stmt)).first()


async def create_routine(session: AsyncSession, data: RoutineCreate) -> Routine:
    fields = data.model_dump()
    copy_blocks = fields.pop("copy_blocks_from_active")

    source_blocks: list[RoutineBlock] = []
    if copy_blocks:
        # Read the source before adding the new routine: creating an active one
        # deactivates the old active, which is exactly the routine we want to copy.
        active = await get_active_routine(session)
        if active is not None:
            source_blocks = list(active.blocks)

    routine = Routine(**fields)
    session.add(routine)
    await session.flush()  # assigns routine.id, needed for the copied blocks

    for block in source_blocks:
        session.add(
            RoutineBlock(
                routine_id=routine.id,
                days=list(block.days),
                start_time=block.start_time,
                end_time=block.end_time,
                task_name=block.task_name,
                tag_ids=list(block.tag_ids),
                sort_order=block.sort_order,
            )
        )

    if routine.is_active:
        await _deactivate_others(session, keep_id=routine.id)

    await session.commit()
    return await get_routine(session, routine.id)


async def update_routine(
    session: AsyncSession, routine_id: int, data: RoutineUpdate
) -> Routine | None:
    routine = await session.get(Routine, routine_id)
    if routine is None:
        return None
    fields = data.model_dump(exclude_unset=True)
    for key, value in fields.items():
        setattr(routine, key, value)

    # Only a change to the version's own content moves `updated_at`. Activating or
    # retiring a version is not an edit to it -- treating it as one would make every
    # switch rewrite both rows' timestamps and destroy the ordering the list depends on.
    if any(key in fields for key in ("name", "note")):
        routine.updated_at = datetime.now()

    # Activating this version is what retires whichever one was active before;
    # that is the whole mechanism for switching back to an older version.
    if routine.is_active:
        await _deactivate_others(session, keep_id=routine.id)
    await session.commit()
    return await get_routine(session, routine_id)


async def delete_routine(session: AsyncSession, routine_id: int) -> bool:
    routine = await session.get(Routine, routine_id)
    if routine is None:
        return False
    if routine.is_active:
        raise ActiveRoutineError(routine_id)
    await session.delete(routine)
    await session.commit()
    return True


async def create_block(
    session: AsyncSession, routine_id: int, data: RoutineBlockCreate
) -> RoutineBlock | None:
    if await session.get(Routine, routine_id) is None:
        return None
    await tag_service.assert_tags_exist(session, data.tag_ids)
    block = RoutineBlock(routine_id=routine_id, **data.model_dump())
    session.add(block)
    await touch_routine(session, routine_id)
    await session.commit()
    await session.refresh(block)
    return block


async def update_block(
    session: AsyncSession, block_id: int, data: RoutineBlockUpdate
) -> RoutineBlock | None:
    block = await session.get(RoutineBlock, block_id)
    if block is None:
        return None
    fields = data.model_dump(exclude_unset=True)
    if "tag_ids" in fields:
        await tag_service.assert_tags_exist(session, fields["tag_ids"])
    for key, value in fields.items():
        setattr(block, key, value)
    await touch_routine(session, block.routine_id)
    await session.commit()
    await session.refresh(block)
    return block


async def delete_block(session: AsyncSession, block_id: int) -> bool:
    block = await session.get(RoutineBlock, block_id)
    if block is None:
        return False
    # Read the parent id before the delete: afterwards `block` is detached and
    # touching its attributes would raise rather than return the id.
    routine_id = block.routine_id
    await session.delete(block)
    await touch_routine(session, routine_id)
    await session.commit()
    return True


async def _days_with_events(session: AsyncSession, monday: date, next_monday: date) -> set[date]:
    """Days on which the user already has something scheduled.

    Occupancy is judged by where an event *starts*, not by every day it touches.
    Judging by touch looked safer and was catastrophic: the seeded rest block runs
    23:00->07:00 nightly, so Sunday's rest always bled into Monday, marked it occupied,
    and silently dropped Monday's eight blocks from every week after the first.

    The cost of this choice is that a long manual event spilling past midnight can now
    have routine blocks materialized over it, producing an overlap. Overlaps are a
    condition this system already detects (`Evaluation.overlaps`) and the Review page
    warns about, so they are visible and fixable. Silent loss is neither. This also makes
    the rule agree with `get_week`'s gate instead of contradicting it.
    """
    rows = await event_service.list_events(
        session,
        start=datetime.combine(monday, datetime.min.time()),
        end=datetime.combine(next_monday, datetime.min.time()),
    )
    return {
        e.start_at.date() for e in rows if monday <= e.start_at.date() < next_monday
    }


async def _resolve_inherited_tags(
    session: AsyncSession, task_name: str, cache: dict[str, list[int]]
) -> list[int]:
    """Tags a block with no tags of its own inherits from a same-named Task.

    Read-only — never creates a Task. Materialization stopped minting Tasks for
    routine blocks, but a task of that name may still exist (created by hand, or
    a leftover from before this change), and its tags are still the fallback a
    block with none of its own should pick up. Archived tasks are skipped: an
    archived task's tags must not leak into newly materialized events.
    """
    if task_name not in cache:
        existing = (
            await session.scalars(
                select(Task)
                .where(Task.name == task_name, Task.status != TaskStatus.ARCHIVED)
                .order_by(Task.id)
            )
        ).first()
        cache[task_name] = list(existing.tag_ids) if existing else []
    return list(cache[task_name])


async def preview_week(
    session: AsyncSession, any_day: date, routine: Routine | None = None
) -> tuple[date, list[dict]] | None:
    """What materialize_week WOULD create, without writing anything.

    Deliberately shares the day/block selection and the midnight-wrap arithmetic with
    materialize_week rather than reimplementing it — a preview that disagrees with what
    actually gets created is worse than no preview.
    """
    if routine is None:
        routine = await get_active_routine(session)
    if routine is None:
        return None

    monday, next_monday = week_bounds(any_day)
    occupied = await _days_with_events(session, monday, next_monday)

    # Mirrors materialize_week's tag fallback: a block declaring no tags of its own
    # inherits a same-named task's, resolved read-only so preview stays a pure read
    # while still predicting the tags materialization will really assign.
    task_tags: dict[str, list[int]] = {}

    async def tags_for(block: RoutineBlock) -> list[int]:
        if block.tag_ids:
            return list(block.tag_ids)
        return await _resolve_inherited_tags(session, block.task_name, task_tags)

    rows: list[dict] = []
    for offset in range(7):
        day = monday + timedelta(days=offset)
        if day in occupied:
            continue
        for block in routine.blocks:
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
                    "routine_block_id": block.id,
                }
            )
    rows.sort(key=lambda r: r["start_at"])
    return monday, rows


async def materialize_week(
    session: AsyncSession, any_day: date, routine: Routine | None = None
) -> tuple[date, list[Event], list[date]]:
    """Create routine events for the week containing `any_day`.

    Days that already hold any event are skipped entirely, so materialization never
    merges into a day the user has already touched, and a re-run is a no-op.

    Routine-born events mint no Task: they carry their own title (the block's
    task_name) and routine_block_id identifies them, so there is nothing left for
    a Task to do here except (read-only) donate its tags to an untagged block —
    see `_resolve_inherited_tags`.

    **The whole week's events land in a single commit.** Committing per event would
    let an interrupted run leave a day half-filled — and because the guard above skips
    any day holding *any* event, that day would then be skipped forever, permanently
    missing its remaining blocks. Task 13 runs this unattended from cron, so that
    failure mode has to be impossible rather than merely unlikely.
    """
    if routine is None:
        routine = await get_active_routine(session)
    if routine is None:
        raise NoActiveRoutine()

    monday, next_monday = week_bounds(any_day)
    occupied = await _days_with_events(session, monday, next_monday)
    skipped = sorted(occupied)

    wanted: list[tuple[date, RoutineBlock]] = []
    for offset in range(7):
        day = monday + timedelta(days=offset)
        if day in occupied:
            continue
        for block in routine.blocks:
            if day.isoweekday() in block.days:
                wanted.append((day, block))

    tag_cache: dict[str, list[int]] = {}
    created: list[Event] = []
    for day, block in wanted:
        start = datetime.combine(day, block.start_time)
        end = datetime.combine(day, block.end_time)
        if end <= start:  # crosses midnight
            end += timedelta(days=1)
        event = Event(
            task_id=None,
            title=block.task_name,
            start_at=start,
            end_at=end,
            tag_ids=list(block.tag_ids)
            or await _resolve_inherited_tags(session, block.task_name, tag_cache),
            source=EventSource.ROUTINE,
            routine_block_id=block.id,
        )
        session.add(event)
        created.append(event)

    if created:
        await session.commit()

    return monday, created, skipped
