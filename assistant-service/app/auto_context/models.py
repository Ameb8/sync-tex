from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    ForeignKeyConstraint, Index, Integer, String, Text, func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship

from app.core.database import Base


class RagIndexState(Base):
    """Per-project RAG enable/disable state and indexing status."""
    __tablename__ = "rag_index_state"

    project_id      = Column(String, primary_key=True)
    user_id         = Column(String, nullable=False)        # who enabled it
    enabled         = Column(Boolean, nullable=False, default=True)
    status          = Column(String, nullable=False, default="idle")  # idle|indexing|error
    last_indexed_at = Column(DateTime(timezone=True), nullable=True)
    error_message   = Column(Text, nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(),
                             onupdate=func.now(), nullable=False)

    file_indices = relationship("RagFileIndex", back_populates="index_state",
                                cascade="all, delete-orphan")


class RagFileIndex(Base):
    """Per-file indexing state within a project."""
    __tablename__ = "rag_file_index"

    id          = Column(String, primary_key=True)          # UUID
    project_id  = Column(String, ForeignKey("rag_index_state.project_id", ondelete="CASCADE"),
                         nullable=False)
    file_id     = Column(String, nullable=False)
    status      = Column(String, nullable=False, default="pending")  # pending|indexed|stale|error
    indexed_at  = Column(DateTime(timezone=True), nullable=True)
    chunk_count = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(),
                         onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_rag_file_index_project", "project_id"),
        # enforces one entry per file per project
        Index("uq_rag_file_index_project_file", "project_id", "file_id", unique=True),
    )

    index_state = relationship("RagIndexState", back_populates="file_indices")
    chunks      = relationship("RagChunk", back_populates="file_index",
                               cascade="all, delete-orphan")


class RagChunk(Base):
    """
    A single embedded chunk from a LaTeX file.
    section_path, section_heading, first_line, last_line are stored so
    a stale embedding can be re-extracted from a live document without
    re-embedding the whole file.
    """
    __tablename__ = "rag_chunks"

    id          = Column(String, primary_key=True)          # UUID
    project_id  = Column(String, nullable=False)
    file_id     = Column(String, nullable=False)

    # Location metadata — used for re-extraction when embedding is stale
    section_path    = Column(ARRAY(Text), nullable=True)    # ['Chapter 1', 'Intro', 'Prior Work']
    section_heading = Column(Text, nullable=True)           # '\subsubsection{Prior Work}'
    first_line      = Column(Text, nullable=True)
    last_line       = Column(Text, nullable=True)
    chunk_index     = Column(Integer, nullable=False)       # ordinal within file

    embedding   = Column(Vector(1024), nullable=True)       # Voyage AI dims; null until indexed

    created_at  = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "file_id"],
            ["rag_file_index.project_id", "rag_file_index.file_id"],
            ondelete="CASCADE",
        ),
        Index("idx_rag_chunks_project_file", "project_id", "file_id"),
        # HNSW index is created in the migration, not here — SQLAlchemy
        # doesn't have native syntax for `USING hnsw (embedding vector_cosine_ops)`
    )

    file_index = relationship(
        "RagFileIndex",
        back_populates="chunks",
        foreign_keys=[project_id, file_id],
        primaryjoin="and_(RagChunk.project_id == RagFileIndex.project_id, "
                    "RagChunk.file_id == RagFileIndex.file_id)",
    )


class RagRetrievedChunk(Base):
    """
    Snapshot of what was actually sent to the LLM for a given message.
    Stored separately from the chunk so re-extraction/re-embedding doesn't
    alter what was used at inference time. Optionally surfaced in the UI.
    """
    __tablename__ = "rag_retrieved_chunks"

    id             = Column(String, primary_key=True)       # UUID
    message_id     = Column(String, ForeignKey("chat_messages.id", ondelete="CASCADE"),
                            nullable=False)
    chunk_id       = Column(String, ForeignKey("rag_chunks.id", ondelete="SET NULL"),
                            nullable=True)                  # nullable: chunk may be deleted

    extracted_text = Column(Text, nullable=False)           # what was actually sent
    similarity     = Column(Float, nullable=True)           # cosine score from retrieval
    visible        = Column(Boolean, nullable=False, default=False)  # user toggled in UI

    created_at     = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("idx_rag_retrieved_chunks_message", "message_id"),
    )

    message = relationship("ChatMessage")
    chunk   = relationship("RagChunk")