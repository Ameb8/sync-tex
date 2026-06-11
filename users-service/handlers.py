import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import RedirectResponse
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import OAuthIdentity, OAuthState, User, get_db
from schemas import (
    InternalUserResponse,
    InternalUsersResponse,
    LoginRequest,
    LoginResponse,
    TokenData,
    UserCreate,
    UserResponse,
)
from security import generate_token, hash_password, verify_password, verify_token

router = APIRouter()

OAUTH_STATE_TTL_MINUTES = 10


@dataclass(frozen=True)
class OAuthProfile:
    provider: str
    provider_user_id: str
    email: str
    email_verified: bool
    name: str | None = None


def create_oauth_state(db: Session) -> str:
    now = datetime.utcnow()
    db.query(OAuthState).filter(OAuthState.expires_at <= now).delete(
        synchronize_session=False
    )

    for _ in range(3):
        state = secrets.token_urlsafe(32)
        db.add(
            OAuthState(
                state=state,
                expires_at=now + timedelta(minutes=OAUTH_STATE_TTL_MINUTES),
            )
        )
        try:
            db.commit()
            return state
        except IntegrityError:
            db.rollback()

    raise HTTPException(status_code=500, detail="Failed to create OAuth state")


def consume_oauth_state(db: Session, state: str) -> None:
    now = datetime.utcnow()
    deleted = (
        db.query(OAuthState)
        .filter(
            OAuthState.state == state,
            OAuthState.expires_at > now,
        )
        .delete(synchronize_session=False)
    )
    if deleted != 1:
        db.rollback()
        raise HTTPException(status_code=400, detail="Invalid state")

    db.commit()


def require_query_param(value: str | None, field: str) -> str:
    if value is None:
        raise HTTPException(
            status_code=422,
            detail=[
                {
                    "type": "missing",
                    "loc": ["query", field],
                    "msg": "Field required",
                    "input": None,
                }
            ],
        )
    return value


def redirect_oauth_error(external_url: str, error: str) -> RedirectResponse:
    params = urlencode({"error": error})
    return RedirectResponse(f"{external_url}/oauth/callback?{params}")


def normalize_oauth_email(email: str | None) -> str | None:
    if not email:
        return None
    normalized = email.strip().lower()
    return normalized or None


async def exchange_google_code_for_token(code: str, redirect_uri: str) -> dict:
    google_client_id = os.getenv("GOOGLE_CLIENT_ID")
    google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    google_token_url = os.getenv(
        "GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"
    )

    if not google_client_id or not google_client_secret:
        raise HTTPException(
            status_code=500, detail="Google OAuth configuration is missing"
        )

    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            google_token_url,
            data={
                "code": code,
                "client_id": google_client_id,
                "client_secret": google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
        )

    if token_response.status_code != 200:
        raise HTTPException(
            status_code=400, detail="Failed to exchange authorization code"
        )

    return token_response.json()


def verify_google_id_token(id_token_value: str, audience: str) -> dict:
    request = google_requests.Request()
    return id_token.verify_oauth2_token(id_token_value, request, audience)


async def fetch_google_profile(token_data: dict) -> OAuthProfile:
    google_client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not google_client_id:
        raise HTTPException(
            status_code=500, detail="Google OAuth configuration is missing"
        )

    id_token_value = token_data.get("id_token")
    if not id_token_value:
        raise HTTPException(status_code=400, detail="Invalid Google identity token")

    try:
        claims = verify_google_id_token(id_token_value, google_client_id)
    except Exception as err:
        raise HTTPException(
            status_code=400, detail="Invalid Google identity token"
        ) from err

    email = claims.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Could not get email from Google")

    if claims.get("email_verified") is not True:
        raise HTTPException(status_code=400, detail="Google email is not verified")

    if not claims.get("sub"):
        raise HTTPException(status_code=400, detail="Invalid Google identity token")

    return OAuthProfile(
        provider="google",
        provider_user_id=str(claims["sub"]),
        email=email,
        email_verified=True,
        name=claims.get("name"),
    )


async def exchange_github_code_for_token(code: str, redirect_uri: str) -> dict:
    github_client_id = os.getenv("GITHUB_CLIENT_ID")
    github_client_secret = os.getenv("GITHUB_CLIENT_SECRET")
    github_token_url = os.getenv(
        "GITHUB_TOKEN_URL", "https://github.com/login/oauth/access_token"
    )

    if not github_client_id or not github_client_secret:
        raise HTTPException(
            status_code=500, detail="GitHub OAuth configuration is missing"
        )

    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            github_token_url,
            data={
                "code": code,
                "client_id": github_client_id,
                "client_secret": github_client_secret,
                "redirect_uri": redirect_uri,
            },
            headers={"Accept": "application/json"},
        )

    if token_response.status_code != 200:
        raise HTTPException(
            status_code=400, detail="Failed to exchange authorization code"
        )

    token_data = token_response.json()
    if "error" in token_data:
        raise HTTPException(
            status_code=400, detail=token_data.get("error_description", "OAuth error")
        )

    return token_data


def choose_github_email(github_user: dict, emails: list[dict]) -> str | None:
    email = normalize_oauth_email(github_user.get("email"))
    if email:
        return email

    def email_from(predicate):
        for email_obj in emails:
            if predicate(email_obj):
                return normalize_oauth_email(email_obj.get("email"))
        return None

    return (
        email_from(
            lambda email_obj: email_obj.get("primary") is True
            and email_obj.get("verified") is True
        )
        or email_from(lambda email_obj: email_obj.get("verified") is True)
        or email_from(lambda email_obj: email_obj.get("primary") is True)
        or email_from(lambda email_obj: True)
    )


async def fetch_github_profile(access_token: str) -> OAuthProfile:
    github_user_url = os.getenv("GITHUB_USER_URL", "https://api.github.com/user")
    github_emails_url = os.getenv(
        "GITHUB_EMAILS_URL", "https://api.github.com/user/emails"
    )
    headers = {"Authorization": f"Bearer {access_token}"}

    async with httpx.AsyncClient() as client:
        user_response = await client.get(github_user_url, headers=headers)

    if user_response.status_code != 200:
        raise HTTPException(
            status_code=400, detail="Failed to fetch user info from GitHub"
        )

    github_user = user_response.json()
    emails = []

    if not github_user.get("email"):
        async with httpx.AsyncClient() as client:
            emails_response = await client.get(github_emails_url, headers=headers)

        if emails_response.status_code == 200:
            emails = emails_response.json()

    email = choose_github_email(github_user, emails)
    if not email:
        raise HTTPException(status_code=400, detail="Could not get email from GitHub")

    return OAuthProfile(
        provider="github",
        provider_user_id=str(github_user["id"]),
        email=email,
        email_verified=True,
        name=github_user.get("name") or github_user.get("login"),
    )


def find_or_create_oauth_user(db: Session, profile: OAuthProfile) -> User:
    provider_name = profile.provider.title()
    identity = (
        db.query(OAuthIdentity)
        .filter(
            OAuthIdentity.provider == profile.provider,
            OAuthIdentity.provider_user_id == profile.provider_user_id,
        )
        .first()
    )

    normalized_email = normalize_oauth_email(profile.email)

    if identity:
        identity.email = normalized_email
        identity.email_verified = profile.email_verified
        identity.name = profile.name
        identity.updated_at = datetime.utcnow()
        db.commit()
        return identity.user

    if not normalized_email:
        raise HTTPException(
            status_code=400,
            detail=f"Could not get email from {provider_name}",
        )

    if profile.provider == "google" and profile.email_verified is not True:
        raise HTTPException(status_code=400, detail="Google email is not verified")

    user = db.query(User).filter(User.email == normalized_email).first()
    if not user:
        user = User(email=normalized_email, name=profile.name, password=None)
        db.add(user)
        db.flush()
    elif (
        db.query(OAuthIdentity)
        .filter(
            OAuthIdentity.user_id == user.id,
            OAuthIdentity.provider == profile.provider,
        )
        .first()
    ):
        raise HTTPException(
            status_code=409,
            detail=f"User already has a linked {provider_name} account",
        )

    identity = OAuthIdentity(
        user_id=user.id,
        provider=profile.provider,
        provider_user_id=profile.provider_user_id,
        email=normalized_email,
        email_verified=profile.email_verified,
        name=profile.name,
    )
    db.add(identity)

    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"User already has a linked {provider_name} account",
        ) from err

    return user


# API key dependency
def verify_api_key(x_api_key: str | None = Header(None)):
    expected = os.getenv("USERS_INTERNAL_API_KEY")
    if not expected:
        raise HTTPException(status_code=500, detail="API key not configured")
    if not x_api_key or not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@router.post("/register", response_model=LoginResponse)
async def register(req: UserCreate, db: Session = Depends(get_db)):
    """Register new user with email/password"""
    try:
        # Hash password
        hashed_pw = hash_password(req.password)

        # Create user in DB
        user = User(email=req.email, password=hashed_pw, name=req.name)
        db.add(user)
        db.commit()
        db.refresh(user)

        # Generate JWT
        token = generate_token(user.id, user.email)

        return LoginResponse(token=token, user_id=user.id, email=user.email)

    except IntegrityError as err:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Email already exists"
        ) from err


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: Session = Depends(get_db)):
    """Login with email/password"""
    # Fetch user from DB
    user = db.query(User).filter(User.email == req.email).first()

    if (
        not user
        or not user.password
        or not verify_password(req.password, user.password)
    ):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Generate JWT
    token = generate_token(user.id, user.email)

    return LoginResponse(token=token, user_id=user.id, email=user.email)


@router.get("/github/login")
async def github_login(db: Session = Depends(get_db)):
    """Start GitHub OAuth2 flow"""
    github_client_id = os.getenv("GITHUB_CLIENT_ID")
    redirect_uri = os.getenv("GITHUB_REDIRECT_URI")

    if not github_client_id or not redirect_uri:
        raise HTTPException(
            status_code=500, detail="GitHub OAuth configuration is missing"
        )

    state = create_oauth_state(db)
    params = urlencode(
        {
            "client_id": github_client_id,
            "redirect_uri": redirect_uri,
            "scope": "user:email",
            "state": state,
        }
    )
    github_auth_url = f"https://github.com/login/oauth/authorize?{params}"

    return RedirectResponse(url=github_auth_url)


@router.get("/github/callback")
async def github_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Handle GitHub OAuth2 callback"""
    external_url = os.getenv("EXTERNAL_URL")
    redirect_uri = os.getenv("GITHUB_REDIRECT_URI")

    if not external_url:
        raise HTTPException(
            status_code=500, detail="OAuth URL configuration is missing"
        )

    state = require_query_param(state, "state")

    if error:
        consume_oauth_state(db, state)
        return redirect_oauth_error(
            external_url, error_description or error or "OAuth failed"
        )

    code = require_query_param(code, "code")
    consume_oauth_state(db, state)

    if not redirect_uri:
        raise HTTPException(
            status_code=500, detail="OAuth URL configuration is missing"
        )

    token_data = await exchange_github_code_for_token(code, redirect_uri)
    profile = await fetch_github_profile(token_data["access_token"])
    user = find_or_create_oauth_user(db, profile)

    # Generate JWT
    token = generate_token(user.id, user.email)

    # Redirect back to frontend with jwt
    frontend_url = f"{external_url}/oauth/callback?token={token}"
    return RedirectResponse(frontend_url)


@router.get("/google/login")
async def google_login(db: Session = Depends(get_db)):
    """Start Google OAuth2 flow"""
    google_client_id = os.getenv("GOOGLE_CLIENT_ID")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")

    if not google_client_id or not redirect_uri:
        raise HTTPException(
            status_code=500, detail="Google OAuth configuration is missing"
        )

    state = create_oauth_state(db)
    params = urlencode(
        {
            "client_id": google_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
        }
    )
    google_auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{params}"

    return RedirectResponse(url=google_auth_url)


@router.get("/google/callback")
async def google_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Handle Google OAuth2 callback"""
    external_url = os.getenv("EXTERNAL_URL")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")
    google_client_id = os.getenv("GOOGLE_CLIENT_ID")
    google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

    if not external_url:
        raise HTTPException(
            status_code=500, detail="OAuth URL configuration is missing"
        )

    state = require_query_param(state, "state")

    if error:
        consume_oauth_state(db, state)
        return redirect_oauth_error(
            external_url, error_description or error or "OAuth failed"
        )

    code = require_query_param(code, "code")
    consume_oauth_state(db, state)

    if not redirect_uri:
        raise HTTPException(
            status_code=500, detail="OAuth URL configuration is missing"
        )
    if not google_client_id or not google_client_secret:
        raise HTTPException(
            status_code=500, detail="Google OAuth configuration is missing"
        )

    token_data = await exchange_google_code_for_token(code, redirect_uri)
    profile = await fetch_google_profile(token_data)
    user = find_or_create_oauth_user(db, profile)

    # Generate JWT
    token = generate_token(user.id, user.email)

    # Redirect back to frontend with jwt
    frontend_url = f"{external_url}/oauth/callback?token={token}"
    return RedirectResponse(frontend_url)


@router.get("/validate", response_model=TokenData)
async def validate_token(authorization: str | None = Header(None)):
    """Validate JWT token (for other services)"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")

    # Strip "Bearer " prefix
    token = (
        authorization.replace("Bearer ", "")
        if authorization.startswith("Bearer ")
        else authorization
    )

    # Verify token
    payload = verify_token(token)

    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return TokenData(user_id=payload["user_id"], email=payload["email"])


@router.get("/me", response_model=UserResponse)
async def get_current_user(
    authorization: str | None = Header(None), db: Session = Depends(get_db)
):
    """Get current user info from token"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")

    token = (
        authorization.replace("Bearer ", "")
        if authorization.startswith("Bearer ")
        else authorization
    )
    payload = verify_token(token)

    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Fetch user from DB to ensure they still exist
    user = db.query(User).filter(User.id == payload["user_id"]).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user


@router.get(
    "/internal/users",
    response_model=InternalUsersResponse,
    dependencies=[Depends(verify_api_key)],
)
async def get_users_by_ids(
    user_ids: list[int] = Query(..., description="One or more user IDs"),
    db: Session = Depends(get_db),
):
    """Internal endpoint: fetch users by IDs. Requires X-Api-Key header.
    Usage: /internal/users?user_ids=1&user_ids=2&user_ids=3
    """
    if not user_ids:
        raise HTTPException(status_code=422, detail="At least one user_id is required")

    users = db.query(User).filter(User.id.in_(user_ids)).all()

    found_ids = {u.id for u in users}
    not_found = [uid for uid in user_ids if uid not in found_ids]

    return InternalUsersResponse(
        users=[to_internal_user(u) for u in users],
        not_found=[str(uid) for uid in not_found],
    )


def to_internal_user(u: User) -> InternalUserResponse:
    return InternalUserResponse(
        id=str(u.id),
        email=u.email,
        name=u.name,
    )
