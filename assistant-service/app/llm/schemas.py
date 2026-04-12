from pydantic import BaseModel, field_validator
from typing import Optional, Literal
from datetime import date, datetime


# Supported providers 
SUPPORTED_PROVIDERS = {"anthropic", "openai", "gemini"}


# LLM Key schemas

class LLMKeyUpsert(BaseModel):
    """Request body for storing/updating an LLM API key."""
    provider: str
    api_key: str # plaintext — encrypted before storage

    @field_validator("provider")
    @classmethod
    def provider_must_be_supported(cls, v: str) -> str:
        if v not in SUPPORTED_PROVIDERS:
            raise ValueError(f"provider must be one of {SUPPORTED_PROVIDERS}")
        return v

    @field_validator("api_key")
    @classmethod
    def key_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("api_key must not be empty")
        return v


class LLMKeyResponse(BaseModel):
    """What we return to the client — never the key itself."""
    provider: str
    has_key: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LLMKeyListResponse(BaseModel):
    keys: list[LLMKeyResponse]


# LLM chat schemas
class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str

    @field_validator("content")
    @classmethod
    def content_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("content must not be empty")
        return v


class ChatRequest(BaseModel):
    """Request body for LLM assistant chat"""

    messages: list[ChatMessage]
    max_tokens: Optional[int] = 1000
    project_id: Optional[str] = None

    @field_validator("messages")
    @classmethod
    def messages_not_empty(cls, v: list[ChatMessage]) -> list[ChatMessage]:
        if not v:
            raise ValueError("messages must not be empty")
        return v

    @field_validator("max_tokens")
    @classmethod
    def max_tokens_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v <= 0:
            raise ValueError("max_tokens must be > 0")
        return v




# LLM Settings schemas

class LLMSettingsUpdate(BaseModel):
    monthly_token_limit:  Optional[int] = None
    preferred_model:      Optional[str] = None
    max_tokens_per_call:  Optional[int] = None


class LLMSettingsResponse(BaseModel):
    user_id:                str
    monthly_token_limit:    Optional[int]
    tokens_used_this_month: int
    token_reset_date:       date
    preferred_model:        Optional[str]
    max_tokens_per_call:    int
    updated_at:             datetime

    class Config:
        from_attributes = True


# Usage log schemas

class UsageLogResponse(BaseModel):
    id:         str
    operation:  str
    model:      str
    tokens_in:  int
    tokens_out: int
    created_at: datetime

    class Config:
        from_attributes = True

