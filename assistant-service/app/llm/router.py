from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import json
import uuid

from app.core.database import get_db
from app.core.auth import get_current_user_id
from .client import get_client_for_user
from .providers import supported_providers
from . import schemas, crud, models

router = APIRouter(tags=["llm"])


@router.put("/keys", response_model=schemas.LLMKeyResponse, status_code=status.HTTP_200_OK)
async def upsert_key(
    body: schemas.LLMKeyUpsert,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Store or replace an API key for the given provider. Idempotent."""
    row = await crud.upsert_llm_key(db, user_id, body.provider, body.api_key)
    return schemas.LLMKeyResponse(
        provider=row.provider,
        has_key=True,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/keys", response_model=schemas.LLMKeyListResponse)
async def list_keys(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List which providers the user has keys for. Never returns the key itself."""
    rows = await crud.get_llm_keys(db, user_id)
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


@router.delete("/keys/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key(
    provider: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Remove a stored API key for the given provider."""
    deleted = await crud.delete_llm_key(db, user_id, provider)
    if not deleted:
        raise HTTPException(404, detail=f"No key found for provider '{provider}'")


@router.get("/settings", response_model=schemas.LLMSettingsResponse)
async def get_settings(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Fetch user LLM settings"""
    row = await crud.get_or_create_settings(db, user_id)
    row = await crud.maybe_reset_token_count(db, row)
    return row


@router.patch("/settings", response_model=schemas.LLMSettingsResponse)
async def update_settings(
    body: schemas.LLMSettingsUpdate,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Update user LLM settiings"""
    return await crud.update_settings(
        db,
        user_id,
        monthly_token_limit=body.monthly_token_limit,
        preferred_model=body.preferred_model,
        max_tokens_per_call=body.max_tokens_per_call,
    )


@router.get("/usage", response_model=list[schemas.UsageLogResponse])
async def get_usage(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Fetch usage data"""
    return await crud.get_usage_logs(db, user_id)


@router.post("/chats", response_model=schemas.ChatSummary)
async def create_chat(
    body: schemas.CreateChatRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Create new chat"""
    chat = models.Chat(
        id=str(uuid.uuid4()),
        user_id=user_id,
        project_id=body.project_id,
        title=body.title,
    )
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return chat


@router.get("/chats", response_model=list[schemas.ChatSummary])
async def list_chats(
    project_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """List user chats"""
    result = await db.execute(
        select(models.Chat)
        .where(models.Chat.user_id == user_id, models.Chat.project_id == project_id)
        .order_by(models.Chat.updated_at.desc())
    )
    return result.scalars().all()


@router.get("/chats/{chat_id}/messages", response_model=list[schemas.ChatMessageResponse])
async def get_chat_history(
    chat_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Fetch full history of given chat"""
    result = await db.execute(
        select(models.Chat).where(
            models.Chat.id == chat_id, models.Chat.user_id == user_id
        )
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")

    # Eagerly load messages
    msg_result = await db.execute(
        select(models.ChatMessage)
        .where(models.ChatMessage.chat_id == chat_id)
        .order_by(models.ChatMessage.created_at)
    )
    return msg_result.scalars().all()


@router.delete("/chats/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete chat and history"""
    result = await db.execute(
        select(models.Chat).where(
            models.Chat.id == chat_id, models.Chat.user_id == user_id
        )
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")
    await db.delete(chat)
    await db.commit()


@router.post("/chat/stream")
async def chat_stream(
    body: schemas.ChatStreamRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Send LLM prompt with reply streamed back to client"""
    result = await db.execute(
        select(models.Chat).where(
            models.Chat.id == body.chat_id, models.Chat.user_id == user_id
        )
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(404, "Chat not found")

    client, settings, provider = await get_client_for_user(user_id, db)

    # Load message history
    msg_result = await db.execute(
        select(models.ChatMessage)
        .where(models.ChatMessage.chat_id == chat.id)
        .order_by(models.ChatMessage.created_at)
    )
    messages = msg_result.scalars().all()

    history = [{"role": msg.role, "content": msg.content} for msg in messages]
    history.append({"role": "user", "content": body.message})

    estimated = sum(len(m["content"]) for m in history) // 4
    try:
        await crud.check_token_budget(db, user_id, estimated)
    except ValueError as e:
        raise HTTPException(429, detail=str(e))

    # Persist user message
    user_msg = models.ChatMessage(
        id=str(uuid.uuid4()),
        chat_id=chat.id,
        role="user",
        content=body.message,
    )
    db.add(user_msg)

    # Auto-title chat on first user message
    if not chat.title and not messages:
        chat.title = body.message[:60]

    await db.commit()

    messages_to_send = history
    if body.system_prompt:
        messages_to_send = [{"role": "system", "content": body.system_prompt}] + history

    async def event_generator():
        full_text = ""
        try:
            async for chunk in client.stream(messages_to_send, max_tokens=body.max_tokens):
                full_text += chunk
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"

            # Persist LLM response
            asst_msg = models.ChatMessage(
                id=str(uuid.uuid4()),
                chat_id=chat.id,
                role="assistant",
                content=full_text,
            )
            db.add(asst_msg)
            chat.updated_at = func.now()

            tokens_out_est = len(full_text) // 4
            await crud.record_token_usage(
                db,
                user_id=user_id,
                project_id=chat.project_id,
                operation="query",
                model=provider,
                tokens_in=estimated,
                tokens_out=tokens_out_est,
            )
            await db.commit()

            yield f"data: {json.dumps({'done': True, 'model': provider, 'usage': {'tokens_in': estimated, 'tokens_out': tokens_out_est}})}\n\n"

        except Exception as e:
            await db.rollback()
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/providers")
async def list_providers():
    """Return which LLM providers this service supports."""
    return {"providers": supported_providers()}