from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Report, Rule
from app.schemas.rule import RuleCreate, RuleUpdate
from app.services.tags import assert_tags_exist


class RuleInUse(Exception):
    """Raised when a rule cannot be deleted because a report snapshots it."""


@dataclass(frozen=True)
class GroupSpec:
    key: str
    label: str
    ratio: float
    tag_ids: tuple[int, ...]


@dataclass(frozen=True)
class RuleSpec:
    """Plain, I/O-free view of a Rule, consumed by the pure analytics module."""

    groups: tuple[GroupSpec, ...]
    tolerance: float
    exclude_tag_ids: tuple[int, ...]


def to_spec(rule: Rule) -> RuleSpec:
    return RuleSpec(
        groups=tuple(
            GroupSpec(
                key=g["key"],
                label=g["label"],
                ratio=float(g["ratio"]),
                tag_ids=tuple(g.get("tag_ids", [])),
            )
            for g in rule.groups
        ),
        tolerance=float(rule.tolerance),
        exclude_tag_ids=tuple(rule.exclude_tag_ids),
    )


async def list_rules(session: AsyncSession, user_id: int) -> list[Rule]:
    stmt = (
        select(Rule)
        .where(Rule.user_id == user_id)
        .order_by(Rule.effective_from.desc(), Rule.id.desc())
    )
    return list((await session.scalars(stmt)).all())


async def get_rule(session: AsyncSession, rule_id: int, user_id: int) -> Rule | None:
    stmt = select(Rule).where(Rule.id == rule_id, Rule.user_id == user_id)
    return (await session.scalars(stmt)).first()


async def get_active_rule(session: AsyncSession, user_id: int) -> Rule | None:
    stmt = (
        select(Rule)
        .where(Rule.effective_to.is_(None), Rule.user_id == user_id)
        .order_by(Rule.effective_from.desc(), Rule.id.desc())
    )
    return (await session.scalars(stmt)).first()


async def create_rule_version(session: AsyncSession, data: RuleCreate, user_id: int) -> Rule:
    """Closes the currently open rule and inserts a new one. Never mutates in place."""
    all_tag_ids: set[int] = set(data.exclude_tag_ids)
    for group in data.groups:
        all_tag_ids.update(group.tag_ids)
    await assert_tags_exist(session, all_tag_ids, user_id)

    today = date.today()
    current = await get_active_rule(session, user_id)
    if current is not None:
        current.effective_to = today

    rule = Rule(
        user_id=user_id,
        name=data.name,
        groups=[g.model_dump() for g in data.groups],
        tolerance=data.tolerance,
        exclude_tag_ids=list(data.exclude_tag_ids),
        effective_from=today,
        effective_to=None,
        note=data.note,
    )
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return rule


async def update_rule(
    session: AsyncSession, rule_id: int, data: RuleUpdate, user_id: int
) -> Rule | None:
    """Edits a version in place — name, note, and the ratio definition itself.

    A stored Report is unaffected: it snapshots its own `metrics` at generation time
    and never reads its rule back, so changing the ratios here cannot rewrite a past
    report's numbers. See `RuleUpdate` for the provenance trade this accepts.
    """
    rule = await get_rule(session, rule_id, user_id)
    if rule is None:
        return None
    fields = data.model_dump(exclude_unset=True)

    # Same guard `create_rule_version` applies. Without it a patch could point a
    # group at a tag id that does not exist, and the rule would evaluate forever
    # against a group that can never match anything — with no error to explain why.
    referenced = {
        tag_id for group in fields.get("groups") or [] for tag_id in group["tag_ids"]
    } | set(fields.get("exclude_tag_ids") or [])
    if referenced:
        await assert_tags_exist(session, sorted(referenced), user_id)

    for key, value in fields.items():
        setattr(rule, key, value)
    await session.commit()
    await session.refresh(rule)
    return rule


async def delete_rule(session: AsyncSession, rule_id: int, user_id: int) -> bool:
    rule = await get_rule(session, rule_id, user_id)
    if rule is None:
        return False
    referencing = (
        await session.scalars(select(Report.id).where(Report.rule_id == rule_id).limit(1))
    ).first()
    if referencing is not None:
        raise RuleInUse(rule_id)
    await session.delete(rule)
    await session.commit()
    return True
