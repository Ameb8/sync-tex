from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models
from .providers import get_client
from app.core.crypto import decrypt_api_key



async def get_client_for_user(user_id: str, db: AsyncSession):
    result = await db.execute(
        select(models.UserLLMKey)
        .where(models.UserLLMKey.user_id == user_id)
        .limit(1)
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(400, "No LLM API key configured")

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
    )
    return client, settings, provider 