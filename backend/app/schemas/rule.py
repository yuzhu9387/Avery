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
    """A full patch: name, note, and the ratio definition itself.

    `groups`, `tolerance` and `exclude_tag_ids` used to be rejected here, on the
    grounds that a version's ratios were immutable. That was over-strict. The thing
    immutability was protecting is a stored Report, and a Report does not read its
    rule back — it snapshots its own `metrics` (group labels, shares and verdicts
    included) at generation time, so editing a rule cannot rewrite a past report's
    numbers. What editing does cost is provenance: `report.rule_id` then points at a
    definition that has since moved, so "which rule produced this" gets fuzzier.
    That is the accepted trade, made deliberately so several named rules can be kept
    and tuned in place ("chill life", "heavy work") instead of every tweak forking a
    new version.

    `extra="forbid"` stays: a typo'd field name should 422 rather than be silently
    dropped and reported as saved.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    # A description may legitimately be cleared, so "" is allowed where a name is not.
    note: str | None = None
    groups: list[RuleGroup] | None = Field(default=None, min_length=1)
    tolerance: float | None = Field(default=None, ge=0, le=1)
    exclude_tag_ids: list[int] | None = None

    @field_validator("name", "note", "groups", "tolerance", "exclude_tag_ids")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value

    @model_validator(mode="after")
    def check_tag_mapping(self) -> "RuleUpdate":
        """The same coherence rules `RuleCreate` enforces, applied to whatever subset
        of the ratio definition this patch carries.

        Only checkable when `groups` is present: the group→tag mapping is what the
        uniqueness and exclusion rules are about, and a patch that touches only
        `exclude_tag_ids` cannot be validated against groups it was not given —
        so that combination is rejected rather than let through unchecked, which
        would be the way to smuggle a tag into both a group and the exclude list.
        """
        if self.groups is None:
            if self.exclude_tag_ids is not None:
                raise ValueError(
                    "exclude_tag_ids can only be patched together with groups, so the "
                    "two can be checked against each other"
                )
            return self

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

        overlap = sorted(set(self.exclude_tag_ids or []) & seen.keys())
        if overlap:
            raise ValueError(
                f"tags {overlap} are both excluded and assigned to a group; "
                "excluded tags leave the ratio entirely"
            )
        return self


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
