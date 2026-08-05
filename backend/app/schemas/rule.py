from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
