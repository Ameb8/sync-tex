from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str
    name: Optional[str] = None

class UserResponse(UserBase):
    id: int
    created_at: datetime
    name: Optional[str] = None
    
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
    name: Optional[str] = None

    class Config:
        from_attributes = True

class InternalUsersResponse(BaseModel):
    users: list[InternalUserResponse]
    not_found: list[str]

