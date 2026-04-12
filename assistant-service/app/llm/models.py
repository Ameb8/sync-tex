from sqlalchemy import Column, String, Integer, LargeBinary, Date, DateTime, func, text
from app.core.database import Base


class UserLLMKey(Base):
    __tablename__ = "user_llm_keys"

    # user_id is the PK — one key per provider per user
    # We use a composite PK so users can have keys for multiple providers
    user_id  = Column(String, primary_key=True)       # UUID from JWT, stored as string
    provider = Column(String, primary_key=True)       # 'anthropic' | 'openai' | 'gemini'

    encrypted_key = Column(LargeBinary, nullable=False)  # AES-GCM encrypted bytes

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)


class UserLLMSettings(Base):
    __tablename__ = "user_llm_settings"

    user_id = Column(String, primary_key=True)

    # Token budget — null means no limit
    monthly_token_limit     = Column(Integer, nullable=True)
    tokens_used_this_month  = Column(Integer, nullable=False, default=0)
    token_reset_date = Column(
        Date,
        nullable=False,
        server_default=text("date_trunc('month', now()) + interval '1 month'")
    )

    # Model preferences — null means assistant-service picks a sensible default
    preferred_model    = Column(String, nullable=True)

    # Chunking — how many tokens to send per LLM call max
    max_tokens_per_call = Column(Integer, nullable=False, default=50000)

    updated_at = Column(DateTime(timezone=True), server_default=func.now(),
                        onupdate=func.now(), nullable=False)


class LLMUsageLog(Base):
    __tablename__ = "llm_usage_log"

    id         = Column(String, primary_key=True)   # UUID generated in Python
    user_id    = Column(String, nullable=False, index=True)
    project_id = Column(String, nullable=False)
    job_id     = Column(String, nullable=True)       # null for query operations
    operation  = Column(String, nullable=False)      # 'ingest' | 'query' | 'lint'
    model      = Column(String, nullable=False)
    tokens_in  = Column(Integer, nullable=False)
    tokens_out = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)