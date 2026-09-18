from urllib.parse import urlsplit

from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, Literal
from datetime import date, datetime

from .providers import supported_providers


SUPPORTED_PROVIDERS = frozenset(supported_providers())


# LLM Key schemas

class LLMKeyUpsert(BaseModel):
    """Request body for storing/updating an LLM API key."""
    provider: str
    api_key: str # plaintext — encrypted before storage
    base_url: Optional[str] = None

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
        return v.strip()

    @field_validator("base_url")
    @classmethod
    def base_url_must_be_http(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip().rstrip("/")
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("base_url must be an absolute HTTP(S) URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("base_url cannot contain credentials, a query, or a fragment")
        return value

    @model_validator(mode="after")
    def custom_endpoint_requires_base_url(self) -> "LLMKeyUpsert":
        if self.provider == "openai-compatible" and not self.base_url:
            raise ValueError("base_url is required for openai-compatible providers")
        if self.provider != "openai-compatible" and self.base_url is not None:
            raise ValueError("base_url is only supported for openai-compatible providers")
        return self


class LLMKeyResponse(BaseModel):
    """What we return to the client — never the key itself."""
    provider: str
    has_key: bool
    base_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LLMKeyListResponse(BaseModel):
    keys: list[LLMKeyResponse]


# LLM chat schemas

class CreateChatRequest(BaseModel):
    project_id: str
    title: Optional[str] = None


class ChatSummary(BaseModel):
    id: str
    project_id: str
    title: Optional[str]
    created_at: datetime
    updated_at: datetime
    class Config:
        from_attributes = True


class ChatMessageResponse(BaseModel):
    id: str
    chat_id: str
    role: str
    content: str
    created_at: datetime
    class Config:
        from_attributes = True


class ChatStreamRequest(BaseModel):
    chat_id: str
    message: str 
    max_tokens: Optional[int] = 1000
    system_prompt: Optional[str] = None
    provider: Optional[str] = None

    @field_validator("provider")
    @classmethod
    def provider_must_be_available(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in SUPPORTED_PROVIDERS:
            raise ValueError(f"provider must be one of {sorted(SUPPORTED_PROVIDERS)}")
        return value


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
