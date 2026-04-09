from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session

from . import models, schemas, crud
from .database import get_db, engine
from .auth import get_current_user_id
from .services.llm_service import get_llm_client


app = FastAPI(title="SyncTeX Assistant Service")


# Health check
@app.get("/health")
def health():
    return {"status": "ok"}


# Upload user LLM key
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


# List user's LLM providers
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


# Delete user LLM keys
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


# Get LLM settings
@app.get("/settings", response_model=schemas.LLMSettingsResponse)
def get_settings(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    row = crud.get_or_create_settings(db, user_id)
    row = crud.maybe_reset_token_count(db, row)
    return row


# Update LLM settings
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


# Non-streaming LLM chat
@app.post("/chat")
async def chat(
    body: schemas.ChatRequest,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    ctx = Depends(get_llm_client),
):
    """
    Single-turn chat. Returns the full response once complete.
    Use /chat/stream for streaming.
    """
    client, settings, provider = get_llm_client(user_id, db)
 
    estimated = sum(len(m.content) for m in body.messages) // 4
    try:
        crud.check_token_budget(db, user_id, estimated)
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
 
    messages = [m.model_dump() for m in body.messages]
    response = await client.chat(messages, max_tokens=body.max_tokens)
 
    crud.record_token_usage(
        db,
        user_id=user_id,
        project_id=body.project_id or "",
        operation="query",
        model=response.model,
        tokens_in=response.tokens_in,
        tokens_out=response.tokens_out,
    )
 
    return {
        "text": response.text,
        "model": response.model,
        "usage": {
            "tokens_in": response.tokens_in,
            "tokens_out": response.tokens_out,
        },
    }


# Streaming LLM chat
@app.post("/chat/stream")
async def chat_stream(
    body: schemas.ChatRequest,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """
    Streaming chat via SSE.
    Each event:  data: {"chunk": "..."}\n\n
    Final event: data: {"done": true, "model": "...", "usage": {...}}\n\n
    Error event: data: {"error": "..."}\n\n
    """
    client, settings, provider = get_llm_client(user_id, db)
 
    estimated = sum(len(m.content) for m in body.messages) // 4
    try:
        crud.check_token_budget(db, user_id, estimated)
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
 
    messages = [m.model_dump() for m in body.messages]
 
    async def event_generator():
        full_text = ""
        try:
            async for chunk in client.stream(messages, max_tokens=body.max_tokens):
                full_text += chunk
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
 
            # Estimate mid-stream token count
            tokens_out_est = len(full_text) // 4
            crud.record_token_usage(
                db,
                user_id=user_id,
                project_id=body.project_id or "",
                operation="query",
                model=provider,
                tokens_in=estimated,
                tokens_out=tokens_out_est,
            )
 
            yield f"data: {json.dumps({'done': True, 'model': provider, 'usage': {'tokens_in': estimated, 'tokens_out': tokens_out_est}})}\n\n"
 
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
 
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # tells nginx not to buffer SSE
        },
    )
 

# Get list of supported LLM providers
@app.get("/providers")
def list_providers():
    """Return which LLM providers this service supports."""
    return {"providers": supported_providers()}

