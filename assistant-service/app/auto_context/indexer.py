# app/auto_context/indexer.py
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app.core.database import get_async_session
from app.auto_context import crud
from app.auto_context.chunker import chunk_latex
from app.auto_context.embeddings import embed_document
from app.clients.projects_client import get_project_files, fetch_file_text, ProjectFile

logger = logging.getLogger(__name__)

MAX_CONCURRENT_FILES = 5


# ── Single-file indexing ──────────────────────────────────────────────────────


async def index_file(
    project_id: str,
    file: ProjectFile,
    db,
) -> int:
    """
    Index a single file: download → chunk → embed → persist.
    Returns the number of chunks indexed.
    Raises on any failure (caller handles status updates).
    """
    # 1. Download
    if not file.text_url:
        raise ValueError(f"No text URL for file {file.id}")
    text = await fetch_file_text(file.text_url)

    # 2. Chunk
    chunks = chunk_latex(text)
    if not chunks:
        await crud.replace_file_chunks(db, project_id, file.id, [])
        return 0

    # 3. Embed (one batch call per file)
    texts = [c.text for c in chunks]
    embeddings = await embed_document(texts)

    # 4. Persist
    chunk_dicts = [
        {
            "section_path":    [title for _, title in c.hierarchy],
            "section_heading": f"\\{c.hierarchy[-1][0]}{{{c.hierarchy[-1][1]}}}" if c.hierarchy else None,
            "first_line":      next((l for l in c.text.splitlines() if l.strip()), None),
            "last_line":       next((l for l in reversed(c.text.splitlines()) if l.strip()), None),
            "chunk_index":     i,
            "embedding":       embeddings[i],
        }
        for i, c in enumerate(chunks)
    ]
    await crud.replace_file_chunks(db, project_id, file.id, chunk_dicts)

    return len(chunks)


# ── Per-file wrapper with status tracking ────────────────────────────────────


async def _index_file_tracked(
    project_id: str,
    file: ProjectFile,
    sem: asyncio.Semaphore,
) -> None:
    """Wraps index_file with rag_file_index status updates."""
    async with sem:
        async with get_async_session() as db:
            await crud.upsert_file_index(db, project_id, file.id)
            try:
                chunk_count = await index_file(project_id, file, db)
                await crud.set_file_index_status(
                    db, project_id, file.id,
                    status="indexed",
                    chunk_count=chunk_count,
                )
                logger.info("Indexed %s (%d chunks)", file.filename, chunk_count)

            except Exception as exc:
                logger.exception("Failed to index file %s", file.id)
                try:
                    await db.rollback()
                    await crud.set_file_index_status(
                        db, project_id, file.id,
                        status="error",
                        error_message=str(exc),
                    )
                except Exception:
                    logger.exception("Failed to persist error status for file %s", file.id)
                    async with get_async_session() as error_db:
                        await crud.set_file_index_status(
                            error_db,
                            project_id,
                            file.id,
                            status="error",
                            error_message=str(exc),
                        )


# ── Project-level indexing ────────────────────────────────────────────────────


async def index_project(project_id: str, user_id: str) -> None:
    """
    Background task: index all files in a project.
    Gets its own DB session since it runs outside the request lifecycle.
    """
    async with get_async_session() as db:
        await crud.set_index_status(db, project_id, status="indexing")

    try:
        files = await get_project_files(project_id, with_text_urls=True)
        indexable = [f for f in files if f.text_url]

        sem = asyncio.Semaphore(MAX_CONCURRENT_FILES)
        tasks = [
            _index_file_tracked(project_id, f, sem)
            for f in indexable
        ]
        await asyncio.gather(*tasks, return_exceptions=True)
        # return_exceptions=True: file-level failures are isolated to their
        # own tasks and statuses, including rare status-persistence failures.

        async with get_async_session() as db:
            await crud.set_index_status(
                db, project_id,
                status="idle",
                last_indexed_at=datetime.now(timezone.utc),
            )

    except Exception as exc:
        # Only hits project-level failures such as get_project_files itself.
        logger.exception("project-level indexing failure for %s", project_id)
        async with get_async_session() as db:
            await crud.set_index_status(
                db, project_id,
                status="error",
                error_message=str(exc),
            )
