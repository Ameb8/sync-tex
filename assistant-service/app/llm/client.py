from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models
from .providers import get_client
from app.core.crypto import decrypt_api_key



async def get_client_for_user(
    user_id: str,
    db: AsyncSession,
    provider: str | None = None,
):
    query = select(models.UserLLMKey).where(models.UserLLMKey.user_id == user_id)
    if provider is not None:
        query = query.where(models.UserLLMKey.provider == provider)
    query = query.order_by(models.UserLLMKey.created_at).limit(1)
    result = await db.execute(query)
    key = result.scalar_one_or_none()
    if not key:
        detail = (
            f"No API key configured for provider '{provider}'"
            if provider
            else "No LLM API key configured"
        )
        raise HTTPException(400, detail)

    try:
        api_key = decrypt_api_key(key.encrypted_key)
    except Exception:
        raise HTTPException(500, "Failed to decrypt API key")

    provider = key.provider

    result = await db.execute(
        select(models.UserLLMSettings)
        .where(models.UserLLMSettings.user_id == user_id)
    )
    settings = result.scalar_one_or_none()

    client = get_client(
        provider=provider,
        api_key=api_key,
        preferred_model=settings.preferred_model if settings else None,
        base_url=key.base_url,
    )
    return client, settings, provider
