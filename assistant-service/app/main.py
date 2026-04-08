from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session

from . import models, schemas, crud
from .database import get_db, engine
from .auth import get_current_user_id


app = FastAPI(title="SyncTeX Assistant Service")


# Health
@app.get("/health")
def health():
    return {"status": "ok"}


# LLM API Key management
@app.put("/keys", response_model=schemas.LLMKeyResponse, status_code=status.HTTP_200_OK)
def upsert_key(
    body: schemas.LLMKeyUpsert,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Store or replace an API key for the given provider. Idempotent."""
    row = crud.upsert_llm_key(db, user_id, body.provider, body.api_key)
    return schemas.LLMKeyResponse(
        provider=row.provider,
        has_key=True,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@app.get("/keys", response_model=schemas.LLMKeyListResponse)
def list_keys(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """List which providers the user has keys for. Never returns the key itself."""
    rows = crud.get_llm_keys(db, user_id)
    return schemas.LLMKeyListResponse(
        keys=[
            schemas.LLMKeyResponse(
                provider=r.provider,
                has_key=True,
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
            for r in rows
        ]
    )


@app.delete("/keys/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key(
    provider: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Remove a stored API key for the given provider."""
    deleted = crud.delete_llm_key(db, user_id, provider)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"No key found for provider '{provider}'")


# LLM Settings
@app.get("/settings", response_model=schemas.LLMSettingsResponse)
def get_settings(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    row = crud.get_or_create_settings(db, user_id)
    row = crud.maybe_reset_token_count(db, row)
    return row


@app.patch("/settings", response_model=schemas.LLMSettingsResponse)
def update_settings(
    body: schemas.LLMSettingsUpdate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    row = crud.update_settings(
        db,
        user_id,
        monthly_token_limit=body.monthly_token_limit,
        preferred_model=body.preferred_model,
        max_tokens_per_call=body.max_tokens_per_call,
    )
    return row


# Usage log
@app.get("/usage", response_model=list[schemas.UsageLogResponse])
def get_usage(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Return the 50 most recent LLM calls for this user."""
    return crud.get_usage_logs(db, user_id)