# users-service + postgres-users

Python/FastAPI. Auth boundary for the entire system. Issues JWTs consumed by all other services.

## DB

PostgreSQL instance `postgres-users`. Migrations via Alembic. Stores users, hashed passwords, OAuth identities.

## Auth

- Password login: bcrypt hash, returns signed JWT.
- GitHub OAuth2: exchange code → fetch GitHub user → upsert identity → return JWT.
- JWT payload: `sub` (string, user UUID), `exp`, `email`. **`sub` is always a string** — other services must not cast it to int.

## Key Endpoints

| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/register` | Create user |
| POST | `/auth/login` | Returns JWT |
| GET | `/auth/github` | Redirect to GitHub OAuth |
| GET | `/auth/github/callback` | OAuth callback, returns JWT |
| GET | `/users/me` | Requires Bearer JWT |

## Env

```
SECRET_KEY           # JWT signing secret (HS256)
DATABASE_URL         # postgres-users connection string
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_REDIRECT_URI
```