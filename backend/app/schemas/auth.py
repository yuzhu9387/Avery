import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import User

# Deliberately loose — enough to catch typos, not an RFC 5322 parser. Kept as a
# plain regex because the email-validator package is not a project dependency.
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(value: str) -> str:
    value = value.strip().lower()
    if not EMAIL_RE.match(value):
        raise ValueError("not a valid email address")
    return value


class SignupIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=120)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _validate_email(value)


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _validate_email(value)


class MeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=254)

    @field_validator("name", "email")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("field cannot be set to null")
        return value

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _validate_email(value)


class PasswordUpdate(BaseModel):
    # Required iff the account already has a password — enforced in the service,
    # since the schema cannot see the account.
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class OAuthLinkIn(BaseModel):
    """Only reached when the provider would not vouch for an email address.

    Carries no password: linking onto an *existing* account is refused here
    (409) rather than gated behind one, because a typed address proves nothing
    about who typed it. `extra="forbid"` so a client still sending `password`
    gets told plainly instead of having it silently ignored.
    """

    model_config = ConfigDict(extra="forbid")

    link_token: str = Field(min_length=1, max_length=128)
    email: str = Field(max_length=254)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _validate_email(value)


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    has_password: bool
    providers: list[str]
    created_at: datetime

    @classmethod
    def from_user(cls, user: User) -> "UserOut":
        providers = []
        if user.google_sub is not None:
            providers.append("google")
        if user.lark_open_id is not None:
            providers.append("lark")
        return cls(
            id=user.id,
            email=user.email,
            name=user.name,
            has_password=user.password_hash is not None,
            providers=providers,
            created_at=user.created_at,
        )
