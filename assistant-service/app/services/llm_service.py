from fastapi import HTTPException, Depends
from sqlalchemy.orm import Session

from app import models
from app.providers import get_client
from app.crypto import decrypt_api_key
from app.auth import get_current_user_id
from app.database import get_db

def get_llm_client(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return get_client_for_user(user_id, db)


def get_client_for_user(user_id: str, db: Session):
    # Fetch key
    key = (
        db.query(models.UserLLMKey)
        .filter(models.UserLLMKey.user_id == user_id)
        .first()
    )
    if not key:
        raise HTTPException(400, "No LLM API key configured")

    # Decrypt
    try:
        api_key = decrypt_api_key(key.encrypted_key)
    except Exception:
        raise HTTPException(500, "Failed to decrypt API key")

    provider = key.provider

    # Fetch settings
    settings = (
        db.query(models.UserLLMSettings)
        .filter(models.UserLLMSettings.user_id == user_id)
        .first()
    )

    # Instantiate client
    client = get_client(
        provider=provider,
        api_key=api_key,
        preferred_model=settings.preferred_model if settings else None,
    )

    return client, settings, provider