import os
from datetime import datetime

from dotenv import load_dotenv
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker

load_dotenv()

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password = Column(String(255), nullable=True)  # NULL for OAuth users
    name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    oauth_identities = relationship(
        "OAuthIdentity",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class OAuthIdentity(Base):
    __tablename__ = "oauth_identities"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider = Column(String(50), nullable=False)
    provider_user_id = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    email_verified = Column(Boolean, nullable=False, default=False)
    name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="oauth_identities")

    __table_args__ = (
        UniqueConstraint(
            "provider",
            "provider_user_id",
            name="uq_oauth_identity_provider_user_id",
        ),
        UniqueConstraint(
            "user_id",
            "provider",
            name="uq_oauth_identity_user_provider",
        ),
    )


class OAuthState(Base):
    __tablename__ = "oauth_states"

    state = Column(String(128), primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)


# Database setup
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:password@localhost/users_service"
)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """Dependency for FastAPI to inject DB session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Create tables on startup
Base.metadata.create_all(bind=engine)
