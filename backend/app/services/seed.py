"""Seeds the tag set, the 6:3:1 rule, and the default weekly template.

Idempotent: running twice creates nothing the second time.
"""

from datetime import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Rule, Tag, Template
from app.schemas.rule import RuleCreate, RuleGroup
from app.schemas.tag import TagCreate
from app.schemas.template import TemplateBlockCreate, TemplateCreate
from app.services import rules as rule_service
from app.services import tags as tag_service
from app.services import templates as template_service

SEED_TAGS: list[tuple[str, str, str]] = [
    ("Rest", "#DEDECF", "moon"),
    ("Work", "#DA96A4", "briefcase"),
    ("Study", "#C9A88F", "book"),
    ("Commute", "#BDBD9B", "bus"),
    ("Kids/Family", "#8FA8A2", "family"),
    ("Chores/Prep", "#E7C8C8", "home"),
    ("Fitness", "#DA96A4", "dumbbell"),
    ("Personal", "#C9A88F", "user"),
]

WEEKDAYS = [1, 2, 3, 4, 5]
SATURDAY = [6]
SUNDAY = [7]
ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]

# (days, start, end, task name, tag name)
SEED_BLOCKS: list[tuple[list[int], time, time, str, str]] = [
    (ALL_DAYS, time(23, 0), time(7, 0), "Rest", "Rest"),
    (WEEKDAYS, time(7, 0), time(8, 0), "Morning routine", "Chores/Prep"),
    (WEEKDAYS, time(8, 0), time(9, 0), "Workout", "Fitness"),
    (WEEKDAYS, time(9, 0), time(9, 30), "Commute in", "Commute"),
    (WEEKDAYS, time(9, 30), time(16, 30), "Work", "Work"),
    (WEEKDAYS, time(16, 30), time(17, 30), "Commute home", "Commute"),
    (WEEKDAYS, time(17, 30), time(21, 30), "Dinner & kids", "Kids/Family"),
    (WEEKDAYS, time(21, 30), time(23, 0), "Study / overtime", "Study"),
    (SATURDAY, time(7, 0), time(9, 0), "Morning walk with kid", "Kids/Family"),
    (SATURDAY, time(9, 0), time(11, 30), "Family outing", "Kids/Family"),
    (SATURDAY, time(11, 30), time(13, 30), "Lunch & nap", "Kids/Family"),
    (SATURDAY, time(13, 30), time(16, 30), "Personal time", "Personal"),
    (SATURDAY, time(19, 30), time(21, 30), "Family time", "Kids/Family"),
    (SUNDAY, time(7, 0), time(9, 0), "Morning walk with kid", "Kids/Family"),
    (SUNDAY, time(9, 0), time(11, 30), "Family outing", "Kids/Family"),
    (SUNDAY, time(11, 30), time(13, 30), "Lunch & nap", "Kids/Family"),
    (SUNDAY, time(13, 30), time(16, 30), "Baby food prep", "Chores/Prep"),
    (SUNDAY, time(16, 30), time(18, 0), "Rest", "Rest"),
    (SUNDAY, time(19, 30), time(21, 0), "Prep for Monday", "Chores/Prep"),
]


class SeedTagsMissing(Exception):
    """A tag the seed rule or template must reference is absent.

    Reachable in normal use: `DELETE /api/tags/{id}` archives rather than removes, and
    a tag can be renamed. If the rule or template then needs re-seeding, the lookup has
    nothing to resolve — which used to surface as an unhandled KeyError 500.
    """

    def __init__(self, names: list[str]) -> None:
        super().__init__(", ".join(names))
        self.names = names


async def _any(session: AsyncSession, model) -> bool:
    return (await session.scalars(select(model.id).limit(1))).first() is not None


async def seed_all(session: AsyncSession) -> dict[str, int]:
    created = {"tags": 0, "rules": 0, "templates": 0}

    if not await _any(session, Tag):
        for index, (name, color, icon) in enumerate(SEED_TAGS):
            await tag_service.create_tag(
                session, TagCreate(name=name, color=color, icon=icon, sort_order=index)
            )
            created["tags"] += 1

    # include_archived=True: archiving is this app's delete, so an archived seed tag is
    # still a real row whose id the rule and template must keep pointing at. Excluding
    # them here turned a re-seed into a KeyError.
    by_name = {
        t.name: t.id for t in await tag_service.list_tags(session, include_archived=True)
    }

    needs_rule = not await _any(session, Rule)
    needs_template = not await _any(session, Template)
    if needs_rule or needs_template:
        missing = [name for name, _, _ in SEED_TAGS if name not in by_name]
        if missing:
            raise SeedTagsMissing(missing)

    if needs_rule:
        await rule_service.create_rule_version(
            session,
            RuleCreate(
                name="6:3:1 baseline",
                tolerance=0.2,
                exclude_tag_ids=[by_name["Rest"], by_name["Personal"]],
                note="Initial commitment.",
                groups=[
                    RuleGroup(
                        key="A",
                        label="Work · Study · Commute",
                        ratio=6,
                        tag_ids=[by_name["Work"], by_name["Study"], by_name["Commute"]],
                    ),
                    RuleGroup(
                        key="B",
                        label="Kids · Chores",
                        ratio=3,
                        tag_ids=[by_name["Kids/Family"], by_name["Chores/Prep"]],
                    ),
                    RuleGroup(key="C", label="Fitness", ratio=1, tag_ids=[by_name["Fitness"]]),
                ],
            ),
        )
        created["rules"] += 1

    if needs_template:
        template = await template_service.create_template(
            session, TemplateCreate(name="Default week")
        )
        for order, (days, start, end, task_name, tag_name) in enumerate(SEED_BLOCKS):
            await template_service.create_block(
                session,
                template.id,
                TemplateBlockCreate(
                    days=days,
                    start_time=start,
                    end_time=end,
                    task_name=task_name,
                    tag_ids=[by_name[tag_name]],
                    sort_order=order,
                ),
            )
        created["templates"] += 1

    return created
