from fastapi import APIRouter, HTTPException, Depends, Header, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import Optional
import httpx
import secrets
import os
from dotenv import load_dotenv

from models import User, get_db
from schemas import LoginRequest, LoginResponse, UserResponse, UserCreate, TokenData
from security import hash_password, verify_password, generate_token, verify_token

load_dotenv()

router = APIRouter()

# OAuth2 state storage (use Redis in production)
oauth_states = set()


@router.post("/register", response_model=LoginResponse)
async def register(req: UserCreate, db: Session = Depends(get_db)):
    """Register new user with email/password"""
    try:
        # Hash password
        hashed_pw = hash_password(req.password)
        
        # Create user in DB
        user = User(email=req.email, password=hashed_pw)
        db.add(user)
        db.commit()
        db.refresh(user)
        
        # Generate JWT
        token = generate_token(user.id, user.email)
        
        return LoginResponse(token=token, user_id=user.id, email=user.email)
    
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already exists")

@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: Session = Depends(get_db)):
    """Login with email/password"""
    # Fetch user from DB
    user = db.query(User).filter(User.email == req.email).first()
    
    if not user or not user.password or not verify_password(req.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Generate JWT
    token = generate_token(user.id, user.email)
    
    return LoginResponse(token=token, user_id=user.id, email=user.email)



@router.get("/auth/github/login")
async def github_login():
    """Start GitHub OAuth2 flow"""
    state = secrets.token_urlsafe(32)
    oauth_states.add(state)
    
    github_client_id = os.getenv("GITHUB_CLIENT_ID")
    redirect_uri = os.getenv("GITHUB_REDIRECT_URI", "http://localhost:8001/auth/github/callback")
    
    github_auth_url = (
        f"https://github.com/login/oauth/authorize?"
        f"client_id={github_client_id}&"
        f"redirect_uri={redirect_uri}&"
        f"scope=user:email&"
        f"state={state}"
    )
    
    # In production, store state in Redis with expiry
    return {"auth_url": github_auth_url}

@router.get("/auth/github/callback")
async def github_callback(code: str, state: str, db: Session = Depends(get_db)):
    """Handle GitHub OAuth2 callback"""
    if state not in oauth_states:
        raise HTTPException(status_code=400, detail="Invalid state")
    
    oauth_states.discard(state)
    
    github_client_id = os.getenv("GITHUB_CLIENT_ID")
    github_client_secret = os.getenv("GITHUB_CLIENT_SECRET")
    redirect_uri = os.getenv("GITHUB_REDIRECT_URI", "http://localhost:8001/auth/github/callback")
    
    # Exchange code for GitHub access token
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            "https://github.com/login/oauth/access_token",
            data={
                "code": code,
                "client_id": github_client_id,
                "client_secret": github_client_secret,
                "redirect_uri": redirect_uri,
            },
            headers={"Accept": "application/json"}
        )
    
    if token_response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange authorization code")
    
    token_data = token_response.json()
    if "error" in token_data:
        raise HTTPException(status_code=400, detail=token_data.get("error_description", "OAuth error"))
    
    access_token = token_data["access_token"]
    
    # Get user info from GitHub
    async with httpx.AsyncClient() as client:
        user_response = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}"}
        )
    
    if user_response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to fetch user info from GitHub")
    
    github_user = user_response.json()
    github_id = str(github_user["id"])
    
    # GitHub may not always return email in user endpoint, need to fetch from emails endpoint
    email = github_user.get("email")
    if not email:
        async with httpx.AsyncClient() as client:
            emails_response = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}"}
            )
        
        if emails_response.status_code == 200:
            emails = emails_response.json()
            # Get primary email
            for email_obj in emails:
                if email_obj.get("primary"):
                    email = email_obj["email"]
                    break
            # Fallback to first email if no primary
            if not email and emails:
                email = emails[0]["email"]
    
    if not email:
        raise HTTPException(status_code=400, detail="Could not get email from GitHub")
    
    # Find or create user
    user = db.query(User).filter(User.email == email).first()
    
    if not user:
        # Create new OAuth user
        user = User(email=email, oauth_provider="github", oauth_id=github_id)
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        # Update existing user with OAuth info if not already set
        if not user.oauth_id:
            user.oauth_id = github_id
            user.oauth_provider = "github"
            db.commit()
    
    # Generate JWT
    token = generate_token(user.id, user.email)
    
    # Return token (frontend will handle storage)
    return {"token": token, "user_id": user.id, "email": user.email}



@router.get("/validate", response_model=TokenData)
async def validate_token(authorization: Optional[str] = Header(None)):
    """Validate JWT token (for other services)"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    
    # Strip "Bearer " prefix
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    
    # Verify token
    payload = verify_token(token)
    
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    return TokenData(user_id=payload["user_id"], email=payload["email"])

@router.get("/me", response_model=UserResponse)
async def get_current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    """Get current user info from token"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    payload = verify_token(token)
    
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    # Fetch user from DB to ensure they still exist
    user = db.query(User).filter(User.id == payload["user_id"]).first()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return user