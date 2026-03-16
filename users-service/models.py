from sqlalchemy import Column, Integer, String, DateTime, create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password = Column(String(255), nullable=True)  # NULL for OAuth users
    oauth_provider = Column(String(50), nullable=True)  # "google", "github", etc.
    oauth_id = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

# Database setup
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:password@localhost/users_service"
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