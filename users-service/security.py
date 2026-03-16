from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional
import os
import hashlib
from dotenv import load_dotenv
from passlib.context import CryptContext

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    """Hash plaintext password with bcrypt
    
    Bcrypt has a 72-byte limit, so we hash the password first with SHA256
    to ensure it's always under 72 bytes.
    """
    # Hash with SHA256 first (creates 64-char string, well under 72 bytes)
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    # Then bcrypt hash the SHA256 hash
    return pwd_context.hash(password_hash)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plaintext password against bcrypt hash"""
    # Hash the plaintext password the same way
    password_hash = hashlib.sha256(plain_password.encode()).hexdigest()
    # Compare against stored bcrypt hash
    return pwd_context.verify(password_hash, hashed_password)

def generate_token(user_id: int, email: str) -> str:
    """Generate JWT token"""
    expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {
        "user_id": user_id,
        "email": email,
        "exp": expire
    }
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return token

def verify_token(token: str) -> Optional[dict]:
    """Verify and decode JWT token"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None