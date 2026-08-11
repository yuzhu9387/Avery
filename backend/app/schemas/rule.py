from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class RuleGroup(BaseModel):
    key: str = Field(min_length=1, max_length=16)
    label: str = Field(min_length=1, max_length=120)
    ratio: float = Field(gt=0)
    tag_ids: list[int] = Field(default_factory=list)


class RuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    groups: list[RuleGroup] = Field(min_length=1)
    tolerance: float = Field(default=0.2, ge=0, le=1)
    exclude_tag_ids: list[int] = Field(default_factory=list)
    note: str = ""

    @model_validator(mode="after")
    def check_tag_mapping(self) -> "RuleCreate":
        keys = [g.key for g in self.groups]
        if len(keys) != len(set(keys)):
            raise ValueError("group keys must be unique")

        seen: dict[int, str] = {}
        for group in self.groups:
            for tag_id in group.tag_ids:
                if tag_id in seen:
                    raise ValueError(
                        f"tag {tag_id} appears in both group {seen[tag_id]} and {group.key}"
                    )
                seen[tag_id] = group.key

        overlap = sorted(set(self.exclude_tag_ids) & seen.keys())
        if overlap:
            raise ValueError(
                f"tags {overlap} are both excluded and assigned to a group; "
                "excluded tags leave the ratio entirely"
            )
        return self


class RuleUpdate(BaseModel):
    """Cosmetic-only patch: name and note (the UI's "description").

    Deliberately excludes `groups`, `tolerance`, and `exclude_tag_ids` — a rule
    version's ratios are immutable by design (`create_rule_version` supersedes,
    never edits, and a stored Report snapshots the rule it was measured
    against). `extra="forbid"` makes that a 422 at the boundary rather than a
    silently-ignored field, so a client that tries to sneak a ratio change in
    finds out immediately instead of believing it worked.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    # A description may legitimately be cleared, so "" is allowed where a name is not.
    note: str | None = None

    @field_validator("name", "note")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value


class RuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    groups: list[RuleGroup]
    tolerance: float
    exclude_tag_ids: list[int]
    effective_from: date
    effective_to: date | None
    note: str
    created_at: datetime
