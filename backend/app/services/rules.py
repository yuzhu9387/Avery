from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Rule
from app.schemas.rule import RuleCreate


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


async def list_rules(session: AsyncSession) -> list[Rule]:
    stmt = select(Rule).order_by(Rule.effective_from.desc(), Rule.id.desc())
    return list((await session.scalars(stmt)).all())


async def get_rule(session: AsyncSession, rule_id: int) -> Rule | None:
    return await session.get(Rule, rule_id)


async def get_active_rule(session: AsyncSession) -> Rule | None:
    stmt = (
        select(Rule)
        .where(Rule.effective_to.is_(None))
        .order_by(Rule.effective_from.desc(), Rule.id.desc())
    )
    return (await session.scalars(stmt)).first()


async def create_rule_version(session: AsyncSession, data: RuleCreate) -> Rule:
    """Closes the currently open rule and inserts a new one. Never mutates in place."""
    today = date.today()
    current = await get_active_rule(session)
    if current is not None:
        current.effective_to = today

    rule = Rule(
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


async def delete_rule(session: AsyncSession, rule_id: int) -> bool:
    rule = await session.get(Rule, rule_id)
    if rule is None:
        return False
    await session.delete(rule)
    await session.commit()
    return True
