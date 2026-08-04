from pydantic import BaseModel, ConfigDict, Field, field_validator


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: str | None = None
    sort_order: int = 0


class TagUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    icon: str | None = None
    sort_order: int | None = None
    archived: bool | None = None

    # `icon` is omitted deliberately: Tag.icon is nullable, so explicit null clears it.
    @field_validator("name", "color", "sort_order", "archived")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str
    icon: str | None
    sort_order: int
    archived: bool
