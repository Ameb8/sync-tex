import uuid
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from . import models
from .crypto import encrypt_api_key, decrypt_api_key   # noqa: F401 (decrypt exported for worker use)


# LLM Keys

def upsert_llm_key(db: Session, user_id: str, provider: str, plaintext_key: str) -> models.UserLLMKey:
    """Store or replace an API key for a given user+provider. Encrypts before writing."""
    encrypted = encrypt_api_key(plaintext_key)
    row = db.query(models.UserLLMKey).filter_by(user_id=user_id, provider=provider).first()
    if row:
        row.encrypted_key = encrypted
        row.updated_at    = datetime.utcnow()
    else:
        row = models.UserLLMKey(
            user_id=user_id,
            provider=provider,
            encrypted_key=encrypted,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_llm_keys(db: Session, user_id: str) -> list[models.UserLLMKey]:
    return db.query(models.UserLLMKey).filter_by(user_id=user_id).all()


def get_llm_key(db: Session, user_id: str, provider: str) -> models.UserLLMKey | None:
    return db.query(models.UserLLMKey).filter_by(user_id=user_id, provider=provider).first()


def delete_llm_key(db: Session, user_id: str, provider: str) -> bool:
    row = get_llm_key(db, user_id, provider)
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


# LLM Settings
def _next_month() -> date:
    today = date.today()
    # First day of next month
    if today.month == 12:
        return date(today.year + 1, 1, 1)
    return date(today.year, today.month + 1, 1)


def get_or_create_settings(db: Session, user_id: str) -> models.UserLLMSettings:
    row = db.query(models.UserLLMSettings).filter_by(user_id=user_id).first()
    if not row:
        row = models.UserLLMSettings(
            user_id=user_id,
            token_reset_date=_next_month(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def update_settings(db: Session, user_id: str, **kwargs) -> models.UserLLMSettings:
    row = get_or_create_settings(db, user_id)
    for k, v in kwargs.items():
        if v is not None and hasattr(row, k):
            setattr(row, k, v)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def maybe_reset_token_count(db: Session, settings: models.UserLLMSettings) -> models.UserLLMSettings:
    """Reset monthly counter if reset date has passed."""
    if date.today() >= settings.token_reset_date:
        settings.tokens_used_this_month = 0
        settings.token_reset_date       = _next_month()
        db.commit()
        db.refresh(settings)
    return settings


def check_token_budget(db: Session, user_id: str, estimated_tokens: int) -> None:
    """Raises ValueError if the user would exceed their monthly token limit."""
    settings = get_or_create_settings(db, user_id)
    settings = maybe_reset_token_count(db, settings)
    if settings.monthly_token_limit is None:
        return  # no limit set
    if settings.tokens_used_this_month + estimated_tokens > settings.monthly_token_limit:
        remaining = settings.monthly_token_limit - settings.tokens_used_this_month
        raise ValueError(
            f"Token budget exceeded. Remaining this month: {remaining:,} tokens."
        )


def record_token_usage(
    db: Session,
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

    # Update running total on settings
    settings = get_or_create_settings(db, user_id)
    settings = maybe_reset_token_count(db, settings)
    settings.tokens_used_this_month += tokens_in + tokens_out
    db.commit()
    db.refresh(log)
    return log


def get_usage_logs(
    db: Session,
    user_id: str,
    limit: int = 50,
) -> list[models.LLMUsageLog]:
    return (
        db.query(models.LLMUsageLog)
        .filter_by(user_id=user_id)
        .order_by(models.LLMUsageLog.created_at.desc())
        .limit(limit)
        .all()
    )