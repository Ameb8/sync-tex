from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserBase(BaseModel):
    email: EmailStr


class UserCreate(UserBase):
    password: str
    name: str | None = None


class UserResponse(UserBase):
    id: int
    created_at: datetime
    name: str | None = None

    class Config:
        from_attributes = True  # SQLAlchemy compatibility


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    token: str
    user_id: int
    email: str


class TokenData(BaseModel):
    user_id: int
    email: str


class InternalUserResponse(BaseModel):
    id: str
    email: str
    name: str | None = None

    class Config:
        from_attributes = True


class InternalUsersResponse(BaseModel):
    users: list[InternalUserResponse]
    not_found: list[str]
