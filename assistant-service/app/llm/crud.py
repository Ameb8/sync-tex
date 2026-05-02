import uuid
from datetime import date, datetime
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from . import models
from app.core.crypto import encrypt_api_key, decrypt_api_key   # noqa: F401 (decrypt exported for worker use)


# LLM Keys

async def upsert_llm_key(
    db: AsyncSession, user_id: str, provider: str, plaintext_key: str
) -> models.UserLLMKey:
    encrypted = encrypt_api_key(plaintext_key)
    result = await db.execute(
        select(models.UserLLMKey).filter_by(user_id=user_id, provider=provider)
    )
    row = result.scalar_one_or_none()
    if row:
        row.encrypted_key = encrypted
        row.updated_at = datetime.utcnow()
    else:
        row = models.UserLLMKey(user_id=user_id, provider=provider, encrypted_key=encrypted)
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def get_llm_keys(db: AsyncSession, user_id: str) -> list[models.UserLLMKey]:
    result = await db.execute(
        select(models.UserLLMKey).filter_by(user_id=user_id)
    )
    return result.scalars().all()

async def get_llm_key(db: AsyncSession, user_id: str, provider: str) -> models.UserLLMKey | None:
    result = await db.execute(
        select(models.UserLLMKey).filter_by(user_id=user_id, provider=provider)
    )
    return result.scalar_one_or_none()

async def delete_llm_key(db: AsyncSession, user_id: str, provider: str) -> bool:
    row = await get_llm_key(db, user_id, provider)
    if not row:
        return False
    await db.delete(row)
    await db.commit()
    return True


# LLM Settings
def _next_month() -> date:
    today = date.today()
    # First day of next month
    if today.month == 12:
        return date(today.year + 1, 1, 1)
    return date(today.year, today.month + 1, 1)


async def get_or_create_settings(db: AsyncSession, user_id: str) -> models.UserLLMSettings:
    result = await db.execute(
        select(models.UserLLMSettings).filter_by(user_id=user_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        row = models.UserLLMSettings(user_id=user_id, token_reset_date=_next_month())
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row



async def update_settings(db: AsyncSession, user_id: str, **kwargs) -> models.UserLLMSettings:
    row = await get_or_create_settings(db, user_id)
    for k, v in kwargs.items():
        if v is not None and hasattr(row, k):
            setattr(row, k, v)
    row.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(row)
    return row


async def maybe_reset_token_count(
    db: AsyncSession, settings: models.UserLLMSettings
) -> models.UserLLMSettings:
    """Reset monthly counter if reset date has passed."""
    if date.today() >= settings.token_reset_date:
        settings.tokens_used_this_month = 0
        settings.token_reset_date = _next_month()
        await db.commit()
        await db.refresh(settings)
    return settings


async def check_token_budget(db: AsyncSession, user_id: str, estimated_tokens: int) -> None:
    """Raises ValueError if the user would exceed their monthly token limit."""
    settings = await get_or_create_settings(db, user_id)
    settings = await maybe_reset_token_count(db, settings)
    if settings.monthly_token_limit is None:
        return
    if settings.tokens_used_this_month + estimated_tokens > settings.monthly_token_limit:
        remaining = settings.monthly_token_limit - settings.tokens_used_this_month
        raise ValueError(f"Token budget exceeded. Remaining this month: {remaining:,} tokens.")



async def record_token_usage(
    db: AsyncSession,
    user_id: str,
    project_id: str,
    operation: str,
    model: str,
    tokens_in: int,
    tokens_out: int,
    job_id: str | None = None,
) -> models.LLMUsageLog:
    log = models.LLMUsageLog(
        id=str(uuid.uuid4()),
        user_id=user_id,
        project_id=project_id,
        job_id=job_id,
        operation=operation,
        model=model,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
    )
    db.add(log)
    settings = await get_or_create_settings(db, user_id)
    settings = await maybe_reset_token_count(db, settings)
    settings.tokens_used_this_month += tokens_in + tokens_out
    await db.commit()
    await db.refresh(log)
    return log

async def get_usage_logs(
    db: AsyncSession, user_id: str, limit: int = 50
) -> list[models.LLMUsageLog]:
    result = await db.execute(
        select(models.LLMUsageLog)
        .filter_by(user_id=user_id)
        .order_by(models.LLMUsageLog.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()