from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_context.models import (
    RagChunk,
    RagFileIndex,
    RagIndexState,
    RagRetrievedChunk,
)


# ── RagIndexState ─────────────────────────────────────────────────────────────


async def upsert_index_state(
    db: AsyncSession,
    project_id: str,
    user_id: str,
    enabled: bool,
) -> RagIndexState:
    """
    Create or update the RAG index state for a project.
    On re-enable, resets status to 'idle' and clears any error message.
    """
    stmt = (
        pg_insert(RagIndexState)
        .values(
            project_id=project_id,
            user_id=user_id,
            enabled=enabled,
            status="idle",
            error_message=None,
        )
        .on_conflict_do_update(
            index_elements=["project_id"],
            set_={
                "enabled": enabled,
                "status": "idle",
                "error_message": None,
                "updated_at": datetime.now(timezone.utc),
            },
        )
        .returning(RagIndexState)
    )
    result = await db.execute(stmt)
    await db.commit()
    return result.scalar_one()


async def get_index_state(
    db: AsyncSession,
    project_id: str,
) -> Optional[RagIndexState]:
    result = await db.execute(
        select(RagIndexState).where(RagIndexState.project_id == project_id)
    )
    return result.scalar_one_or_none()


async def set_index_status(
    db: AsyncSession,
    project_id: str,
    status: str,                        # "idle" | "indexing" | "error"
    error_message: Optional[str] = None,
    last_indexed_at: Optional[datetime] = None,
) -> None:
    state = await get_index_state(db, project_id)
    if state is None:
        return
    state.status = status
    state.error_message = error_message
    if last_indexed_at is not None:
        state.last_indexed_at = last_indexed_at
    await db.commit()


# ── RagFileIndex ──────────────────────────────────────────────────────────────


async def upsert_file_index(
    db: AsyncSession,
    project_id: str,
    file_id: str,
) -> RagFileIndex:
    """
    Create or reset a file index entry to 'pending'.
    Called at the start of indexing a file so status is accurate
    even if a previous run left it in an error state.
    """
    stmt = (
        pg_insert(RagFileIndex)
        .values(
            id=str(uuid.uuid4()),
            project_id=project_id,
            file_id=file_id,
            status="pending",
            chunk_count=0,
            error_message=None,
        )
        .on_conflict_do_update(
            index_elements=["project_id", "file_id"],
            set_={
                "status": "pending",
                "chunk_count": 0,
                "error_message": None,
                "updated_at": datetime.now(timezone.utc),
            },
        )
        .returning(RagFileIndex)
    )
    result = await db.execute(stmt)
    await db.commit()
    return result.scalar_one()


async def get_file_indices(
    db: AsyncSession,
    project_id: str,
) -> list[RagFileIndex]:
    result = await db.execute(
        select(RagFileIndex).where(RagFileIndex.project_id == project_id)
    )
    return list(result.scalars().all())


async def set_file_index_status(
    db: AsyncSession,
    project_id: str,
    file_id: str,
    status: str,                        # "pending" | "indexed" | "stale" | "error"
    chunk_count: Optional[int] = None,
    error_message: Optional[str] = None,
) -> None:
    result = await db.execute(
        select(RagFileIndex).where(
            RagFileIndex.project_id == project_id,
            RagFileIndex.file_id == file_id,
        )
    )
    file_index = result.scalar_one_or_none()
    if file_index is None:
        return
    file_index.status = status
    file_index.error_message = error_message
    if chunk_count is not None:
        file_index.chunk_count = chunk_count
    if status == "indexed":
        file_index.indexed_at = datetime.now(timezone.utc)
    await db.commit()


# ── RagChunk ──────────────────────────────────────────────────────────────────


async def replace_file_chunks(
    db: AsyncSession,
    project_id: str,
    file_id: str,
    chunks: list[dict],
) -> list[RagChunk]:
    """
    Delete all existing chunks for a file and insert fresh ones atomically.
    Each dict in `chunks` should have:
        section_path, section_heading, first_line, last_line,
        chunk_index, embedding
    Returns the newly inserted RagChunk rows.
    """
    await db.execute(
        delete(RagChunk).where(
            RagChunk.project_id == project_id,
            RagChunk.file_id == file_id,
        )
    )

    new_chunks = [
        RagChunk(
            id=str(uuid.uuid4()),
            project_id=project_id,
            file_id=file_id,
            section_path=c.get("section_path"),
            section_heading=c.get("section_heading"),
            first_line=c.get("first_line"),
            last_line=c.get("last_line"),
            chunk_index=c["chunk_index"],
            embedding=c["embedding"],
        )
        for c in chunks
    ]
    db.add_all(new_chunks)
    await db.commit()
    return new_chunks


async def similarity_search(
    db: AsyncSession,
    project_id: str,
    query_embedding: list[float],
    top_k: int = 10,
    exclude_file_ids: Optional[list[str]] = None,
) -> list[tuple[RagChunk, float]]:
    """
    Return the top-k most similar chunks for a project, ordered by cosine similarity.
    Optionally exclude files that are actively being edited or already attached.
    Returns list of (chunk, similarity_score) tuples.
    """
    distance_col = RagChunk.embedding.cosine_distance(query_embedding).label("distance")

    stmt = (
        select(RagChunk, distance_col)
        .where(RagChunk.project_id == project_id)
        .where(RagChunk.embedding.is_not(None))
    )

    if exclude_file_ids:
        stmt = stmt.where(RagChunk.file_id.not_in(exclude_file_ids))

    stmt = stmt.order_by(distance_col).limit(top_k)

    result = await db.execute(stmt)
    rows = result.all()

    # Convert cosine distance to similarity (distance = 1 - similarity)
    return [(chunk, 1.0 - distance) for chunk, distance in rows]


# ── RagRetrievedChunk ─────────────────────────────────────────────────────────


async def save_retrieved_chunks(
    db: AsyncSession,
    message_id: str,
    retrieved: list[dict],
) -> list[RagRetrievedChunk]:
    """
    Persist the chunks actually sent to the LLM for a message.
    Each dict should have: chunk_id (optional), extracted_text, similarity (optional).
    """
    rows = [
        RagRetrievedChunk(
            id=str(uuid.uuid4()),
            message_id=message_id,
            chunk_id=r.get("chunk_id"),
            extracted_text=r["extracted_text"],
            similarity=r.get("similarity"),
            visible=False,
        )
        for r in retrieved
    ]
    db.add_all(rows)
    await db.commit()
    return rows


async def get_retrieved_chunks_for_message(
    db: AsyncSession,
    message_id: str,
) -> list[RagRetrievedChunk]:
    result = await db.execute(
        select(RagRetrievedChunk)
        .where(RagRetrievedChunk.message_id == message_id)
        .order_by(RagRetrievedChunk.created_at)
    )
    return list(result.scalars().all())


async def set_chunk_visibility(
    db: AsyncSession,
    retrieved_chunk_id: str,
    visible: bool,
) -> Optional[RagRetrievedChunk]:
    """Toggle whether a retrieved chunk is shown in the UI sources panel."""
    result = await db.execute(
        select(RagRetrievedChunk).where(RagRetrievedChunk.id == retrieved_chunk_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        return None
    row.visible = visible
    await db.commit()
    return row