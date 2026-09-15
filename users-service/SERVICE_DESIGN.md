# Users Service — System Design Document

## 1. Overview & Purpose

The `users-service` is the central identity and authentication microservice for the SyncTeX platform. It serves as the primary authentication boundary and single source of truth for user identities across the entire system. 

### Core Responsibilities
- **User Account Management**: Manages user accounts, credential storage, and profile metadata.
- **Credential Authentication**: Secure registration and password verification using SHA-256 pre-hashing and bcrypt.
- **Federated OAuth2 / OpenID Connect**: Seamless third-party authentication via GitHub and Google OAuth2/OIDC, including automated account linking and profile synchronisation.
- **JWT Issuance & Token Verification**: Authoritative issuer of signed JSON Web Tokens (JWT) using HMAC-SHA256 (HS256) consumed platform-wide.
- **Internal Service Identity Resolution**: Authenticated internal REST API providing user batch lookup for peer services (such as `projects-service`).

---

## 2. Architecture & System Context

The `users-service` is implemented in Python using the FastAPI web framework and SQLAlchemy ORM, backed by a dedicated PostgreSQL database instance (`postgres-users`).

### Deployment & Runtime Topology
- **API Gateway (Nginx)**: Directs external client traffic routed through `/auth/*` (as well as `/validate` and `/me`) to `users-service:8001`.
- **Stateless Application Tier**: The FastAPI service runs on Uvicorn inside an isolated Docker container configured with a non-root system user (`appuser:appgroup`).
- **Data Tier**: Isolated PostgreSQL 16 database (`postgres-users`) storing user credentials, OAuth identities, and anti-CSRF state tokens.
- **Distributed Token Validation**: Other backend microservices (`projects-service`, `collab-service`, `assistant-service`) validate incoming JWTs independently using a shared secret (`SECRET_KEY` / `JWT_SECRET`), avoiding round-trip validation bottlenecks for core operations.

---

## 3. Database Design & Persistence

The service owns and manages its dedicated relational database schema via SQLAlchemy.

<ERD-DIAGRAM>

### Table Specifications

#### 1. `users`
Stores core user records, whether registered directly with password credentials or provisioned via federated OAuth.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `INTEGER` | Primary Key, Auto-increment | Unique identifier for the user |
| `email` | `VARCHAR(255)` | Not Null, Unique, Indexed | User email address (case-normalized) |
| `password` | `VARCHAR(255)` | Nullable | Bcrypt hash of SHA-256 password hash; `NULL` for OAuth-only users |
| `name` | `VARCHAR(255)` | Nullable | User display name |
| `created_at` | `TIMESTAMP` | Default UTC `now()` | Account creation timestamp |

- **Relationships**: One-to-many relationship with `oauth_identities` (`cascade="all, delete-orphan"`).

#### 2. `oauth_identities`
Stores federated OAuth2 provider identities associated with a user account. A single user can have multiple third-party providers linked (e.g., both GitHub and Google), but only one identity per provider per user.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `INTEGER` | Primary Key, Auto-increment | Primary key for identity record |
| `user_id` | `INTEGER` | Foreign Key (`users.id` ON DELETE CASCADE), Not Null, Indexed | Associated SyncTeX user ID |
| `provider` | `VARCHAR(50)` | Not Null | OAuth provider identifier (`"github"` or `"google"`) |
| `provider_user_id` | `VARCHAR(255)` | Not Null | Provider's unique user identifier (e.g., GitHub ID or Google `sub`) |
| `email` | `VARCHAR(255)` | Nullable | Email address returned by the OAuth provider |
| `email_verified` | `BOOLEAN` | Not Null, Default `False` | Provider verification status of the email |
| `name` | `VARCHAR(255)` | Nullable | Provider display name / username |
| `created_at` | `TIMESTAMP` | Default UTC `now()` | Identity linkage timestamp |
| `updated_at` | `TIMESTAMP` | Default UTC `now()`, auto-update | Last identity update timestamp |

- **Table Constraints**:
  - `UniqueConstraint("provider", "provider_user_id", name="uq_oauth_identity_provider_user_id")`: Ensures an external OAuth identity cannot be claimed by multiple SyncTeX accounts.
  - `UniqueConstraint("user_id", "provider", name="uq_oauth_identity_user_provider")`: Ensures a SyncTeX account connects at most one identity per external provider.

#### 3. `oauth_states`
Provides distributed, database-backed anti-CSRF state token validation for OAuth2 authorization redirect flows.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `state` | `VARCHAR(128)` | Primary Key | Cryptographically secure random URL-safe state token |
| `created_at` | `TIMESTAMP` | Not Null, Default UTC `now()` | State generation timestamp |
| `expires_at` | `TIMESTAMP` | Not Null | Expiration timestamp (10-minute TTL) |

### Database Connection & Pooling
- Uses SQLAlchemy `create_engine` with `pool_pre_ping=True` to eliminate stale connections and `pool_recycle=1800` (30 minutes) to recycle pool connections.
- Sessions are scoped per request via FastAPI dependency injection (`get_db`), ensuring clean commit/rollback boundaries and reliable connection release.

---

## 4. Security & Cryptography

### Password Storage and Hashing
To overcome the 72-byte truncation limitation inherent to bcrypt, `users-service` uses a two-stage hashing pipeline:
1. **Pre-hashing**: The raw plaintext password is first hashed using SHA-256 (`hashlib.sha256(password.encode()).hexdigest()`), producing a fixed 64-character hexadecimal digest.
2. **Bcrypt Hashing**: The 64-character hex string is hashed using `passlib.context.CryptContext` with the `bcrypt` scheme.
3. **Verification**: During login, the candidate plaintext password is fed through SHA-256 and compared against the stored bcrypt hash using `pwd_context.verify()`.

### JWT (JSON Web Token) Architecture
- **Algorithm**: HMAC-SHA256 (`HS256`).
- **Signing Key**: Configured via `SECRET_KEY` (shared across SyncTeX backend services).
- **Token Expiry**: 24 hours (`ACCESS_TOKEN_EXPIRE_HOURS = 24`).
- **Payload Claims**:
  - `user_id` (`INTEGER`): SyncTeX user primary key ID.
  - `email` (`STRING`): User primary email.
  - `exp` (`INTEGER` / UTC Timestamp): Expiration epoch.
- **Cross-Service Consumption**: Backend services (`projects-service`, `collab-service`, `assistant-service`) decode tokens with the shared secret key.

### OAuth State & Anti-CSRF Protection
1. **Creation (`create_oauth_state`)**:
   - Cleans up expired state records (`expires_at <= now()`).
   - Generates 32 bytes of cryptographically secure random data (`secrets.token_urlsafe(32)`).
   - Inserts the state with an expiration window of 10 minutes (`OAUTH_STATE_TTL_MINUTES = 10`).
   - Handles integrity collisions with up to 3 retries.
2. **Consumption (`consume_oauth_state`)**:
   - Atomically queries and deletes unexpired matching state records (`OAuthState.state == state AND OAuthState.expires_at > now()`).
   - Ensures each state token is single-use. If zero rows are deleted, throws HTTP 400 Bad Request ("Invalid state").

### Internal Service Authentication
- The `/auth/internal/users` endpoint is restricted to trusted internal microservice calls.
- Requires the `X-Api-Key` HTTP header.
- Validated against the `USERS_INTERNAL_API_KEY` environment variable using constant-time string comparison (`secrets.compare_digest`) to prevent timing attacks.

---

## 5. Authentication & Operational Flows

### 5.1 Local Email / Password Registration (`POST /auth/register`)
1. Client submits email, password, and optional display name.
2. The service hashes the password via the SHA-256 + bcrypt pipeline.
3. Creates a new `User` record in `postgres-users`.
4. If the email already exists, the database raises an `IntegrityError`, caught by the handler to return HTTP 409 Conflict ("Email already exists").
5. On successful creation, generates a 24-hour JWT token and returns HTTP 200 with `{ token, user_id, email }`.

### 5.2 Local Email / Password Login (`POST /auth/login`)
1. Client submits email and password.
2. The service queries `User` by email.
3. If no user exists, or if `user.password` is null (account created via OAuth without a password), or if password verification fails, returns HTTP 401 Unauthorized ("Invalid email or password").
4. On verification success, mints a JWT token and returns `{ token, user_id, email }`.

### 5.3 GitHub OAuth2 Flow
1. **Initiation (`GET /auth/github/login`)**:
   - Generates and stores anti-CSRF state token in `oauth_states`.
   - Constructs GitHub authorization URL with `client_id`, `redirect_uri` (`{EXTERNAL_URL}/auth/github/callback`), `scope="user:email"`, and `state`.
   - Returns HTTP 307 Redirect to `https://github.com/login/oauth/authorize`.
2. **Callback (`GET /auth/github/callback`)**:
   - Validates presence of `state` query parameter and consumes it from the database.
   - If callback contains an `error` from GitHub, consumes state and redirects to `{EXTERNAL_URL}/oauth/callback?error={error_description}`.
   - Exchanges authorization `code` for an access token via POST to `https://github.com/login/oauth/access_token`.
   - Fetches GitHub profile (`https://api.github.com/user`) and email accounts (`https://api.github.com/user/emails`).
   - Resolves the primary, verified email address.
   - Executes `find_or_create_oauth_user`:
     - If `OAuthIdentity(github, provider_user_id)` exists: updates metadata and retrieves existing linked user.
     - If identity does not exist but `User(email)` exists: checks for existing GitHub linkage (409 Conflict if already linked) or links new `OAuthIdentity` to existing user account.
     - If neither exists: creates new `User` (with `password=None`) and associates new `OAuthIdentity`.
   - Mints JWT token for the user.
   - Redirects frontend to `{EXTERNAL_URL}/oauth/callback?token={token}`.

### 5.4 Google OAuth2 / OpenID Connect Flow
1. **Initiation (`GET /auth/google/login`)**:
   - Generates anti-CSRF state token in `oauth_states`.
   - Builds Google authorization URL targeting `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri` (`{EXTERNAL_URL}/auth/google/callback`), `response_type=code`, `scope="openid email profile"`, and `state`.
   - Returns HTTP 307 Redirect to Google consent screen.
2. **Callback (`GET /auth/google/callback`)**:
   - Validates and consumes the `state` token.
   - Handles error parameters by redirecting to frontend with error details.
   - Exchanges `code` with Google token endpoint (`https://oauth2.googleapis.com/token`) to receive `id_token` and `access_token`.
   - Cryptographically verifies the `id_token` using Google's public keys via `google.oauth2.id_token.verify_oauth2_token` with `GOOGLE_CLIENT_ID` as audience.
   - Validates that `claims["email_verified"] == True` and extracts `sub`, `email`, and `name`.
   - Executes `find_or_create_oauth_user` account resolution and linking.
   - Mints JWT token and redirects frontend to `{EXTERNAL_URL}/oauth/callback?token={token}`.

### 5.5 Token Validation (`GET /auth/validate`)
1. Client or internal service passes `Authorization: Bearer <token>`.
2. Extracts and verifies signature and expiration of JWT using `SECRET_KEY`.
3. Returns validated `{ user_id, email }` on success, or HTTP 401 Unauthorized if invalid/expired.

### 5.6 Current User Inspection (`GET /auth/me`)
1. Extracts JWT from `Authorization` header and decodes token payload.
2. Queries database `User` table with `user_id` to ensure user account currently exists.
3. Returns `{ id, email, name, created_at }` or HTTP 404 Not Found.

### 5.7 Batch User Resolution (`GET /auth/internal/users`)
1. Protected endpoint for peer services; validates `X-Api-Key` header.
2. Accepts list of integer query parameters (e.g. `/auth/internal/users?user_ids=1&user_ids=2`).
3. Queries database for matching `User` records in bulk (`User.id.in_(user_ids)`).
4. Returns JSON containing found user profiles (`id`, `email`, `name`) and list of `not_found` string IDs.

---

## 6. API Interface Reference

Base route prefix: `/auth` (all routes mounted under `/auth` in `main.py`).

| Method | Path | Auth / Headers | Request Body / Query Params | Response | Description |
|---|---|---|---|---|---|
| `GET` | `/health` | None | None | `200 {"status": "ok"}` | Service health probe |
| `POST` | `/auth/register` | None | `{ "email": string, "password": string, "name"?: string }` | `200 {"token": str, "user_id": int, "email": str}` | Create local user account & return JWT |
| `POST` | `/auth/login` | None | `{ "email": string, "password": string }` | `200 {"token": str, "user_id": int, "email": str}` | Authenticate local user & return JWT |
| `GET` | `/auth/github/login` | None | None | `307 Redirect` to GitHub | Start GitHub OAuth2 authentication |
| `GET` | `/auth/github/callback` | None | Query: `code`, `state`, `error?`, `error_description?` | `307 Redirect` to `{EXTERNAL_URL}/oauth/callback` | Complete GitHub OAuth2 flow |
| `GET` | `/auth/google/login` | None | None | `307 Redirect` to Google | Start Google OAuth2 authentication |
| `GET` | `/auth/google/callback` | None | Query: `code`, `state`, `error?`, `error_description?` | `307 Redirect` to `{EXTERNAL_URL}/oauth/callback` | Complete Google OAuth2 flow |
| `GET` | `/auth/validate` | `Authorization: Bearer <token>` | None | `200 {"user_id": int, "email": str}` | Verify JWT signature and expiration |
| `GET` | `/auth/me` | `Authorization: Bearer <token>` | None | `200 {"id": int, "email": str, "name": str, "created_at": datetime}` | Fetch authenticated user profile |
| `GET` | `/auth/internal/users` | `X-Api-Key: <key>` | Query: `user_ids: list[int]` | `200 {"users": [...], "not_found": [...]}` | Batch fetch user identity records |

---

## 7. Service Interactions & Cross-Cutting Concerns

### Service Interaction Topology

The service functions as the identity core within the polyglot microservice stack:


1. **Nginx API Gateway**:
   - Routes public endpoints `/auth/*`, `/validate`, and `/me` to `users_backend` (`users-service:8001`).
   - Forwards real client connection headers (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`).
2. **Projects Service (`projects-service`)**:
   - Independently decodes user JWTs for project operations.
   - When listing project collaborators or resolving project owner details, calls `GET /auth/internal/users?user_ids=...` via its internal client with header `X-Api-Key: USERS_INTERNAL_API_KEY` to hydrate user metadata (`name`, `email`).
   - Degrades gracefully if `users-service` is unreachable, returning blank names/emails rather than failing project queries.
3. **Collab Service (`collab-service`)**:
   - Validates user JWT tokens provided in WebSocket query parameters (`?token=<jwt>`) using the shared `JWT_SECRET`.
4. **Assistant Service (`assistant-service`)**:
   - Validates user JWT bearer tokens on all `/api/llm/v1/*` routes using shared `JWT_SECRET` and `HS256`.
5. **Frontend Application**:
   - Communicates with `/auth/register` and `/auth/login` for credential authentication.
   - Navigates the browser to `/auth/github/login` or `/auth/google/login` for federated login.
   - Captures the returned JWT from the `/oauth/callback?token=...` URL parameter and stores it in browser `localStorage`.
   - Attaches `Authorization: Bearer <token>` on all API requests.

---

## 8. Configuration & Environment Variables

| Variable Name | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://postgres:password@localhost/users_service` | PostgreSQL connection string |
| `SECRET_KEY` | Yes | `"your-secret-key-change-this-in-production"` | HMAC secret for signing and verifying JWTs |
| `EXTERNAL_URL` | Yes | None (e.g. `http://localhost`) | External base URL of SyncTeX, used for OAuth callback redirects |
| `FRONTEND_URL` | No | `http://localhost` | Origin URL allowed in CORS middleware |
| `GITHUB_CLIENT_ID` | Conditional | None | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | Conditional | None | GitHub OAuth App Client Secret |
| `GITHUB_REDIRECT_URI` | Conditional | None | GitHub OAuth redirect URI (e.g. `{EXTERNAL_URL}/auth/github/callback`) |
| `GITHUB_TOKEN_URL` | No | `https://github.com/login/oauth/access_token` | GitHub OAuth token endpoint |
| `GITHUB_USER_URL` | No | `https://api.github.com/user` | GitHub profile API endpoint |
| `GITHUB_EMAILS_URL` | No | `https://api.github.com/user/emails` | GitHub emails API endpoint |
| `GOOGLE_CLIENT_ID` | Conditional | None | Google Cloud OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Conditional | None | Google Cloud OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Conditional | None | Google OAuth redirect URI (e.g. `{EXTERNAL_URL}/auth/google/callback`) |
| `GOOGLE_TOKEN_URL` | No | `https://oauth2.googleapis.com/token` | Google OAuth token endpoint |
| `USERS_INTERNAL_API_KEY` | Yes | None | Secret key required for `/auth/internal/users` |
| `PORT` | No | `8001` | Service listening port |

---

## 9. Error Handling & Operational Resilience

- **Global Exception Handler**: Catches uncaught exceptions in `main.py`, writes full stack traces to container standard output for log aggregation, and responds with structured HTTP 500 JSON (`{"detail": "<error_message>"}`).
- **Database Integrity Handlers**: Distinct handling for unique constraint violations:
  - Duplicate registration email: HTTP 409 Conflict ("Email already exists").
  - Conflicting OAuth identity linking: HTTP 409 Conflict ("User already has a linked {Provider} account").
  - State token collisions: Automatic rollback and retry loop up to 3 times.
- **OAuth Error Handling**: Graceful fallback when an OAuth provider returns an error (e.g., user cancellation on the consent screen); consumes state and redirects user back to the web UI with standard error parameters (`/oauth/callback?error=...`).
- **Container Health Check**: Dockerfile defines a native Python healthcheck hitting `/health` on port 8001 every 15 seconds (`urllib.request.urlopen`), ensuring container orchestration and Nginx upstream readiness.
- **Graceful Degradation for Downstream Services**: Downstream services cache user tokens or gracefully omit hydrated names/emails if `users-service` experiences brief downtime.
