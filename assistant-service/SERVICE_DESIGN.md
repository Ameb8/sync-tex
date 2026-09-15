# System Design Document: Assistant Service (`assistant-service`)

## 1. Executive Overview & Service Purpose

The `assistant-service` is a high-performance, asynchronous microservice within the SyncTeX collaborative LaTeX editing platform. It provides project-scoped AI assistance, natural language interaction, document context assembly, and Retrieval-Augmented Generation (RAG) capabilities to users editing LaTeX documents.

### Key Responsibilities
- **Bring Your Own Key (BYOK) Management**: Securely stores and encrypts third-party LLM API keys on a per-user, per-provider basis.
- **Provider Abstraction & Multi-Turn Chat**: Unified asynchronous interface supporting multiple LLM backends (e.g., Google Gemini, Anthropic, OpenAI) with persistent chat sessions, message histories, and real-time Server-Sent Events (SSE) streaming.
- **Usage Tracking & Token Budgeting**: Enforces user-configured monthly token quotas, automatically resets usage on monthly billing cycles, and logs granular token consumption per operation.
- **LaTeX-Aware Context Resolution**: Intelligent multi-source context assembly including explicit document `@mentions`, open editor buffers, and automated context deduplication.
- **Automated Document Indexing & RAG**: Hierarchical LaTeX structural chunking, vector embedding generation via Voyage AI, persistence in PostgreSQL with `pgvector` HNSW indexes, and similarity retrieval for context-grounded completions.

---

## 2. Architecture & Design Principles

### 2.1 Technology Stack
- **Language & Runtime**: Python 3.12, Uvicorn ASGI server.
- **Web Framework**: FastAPI (fully asynchronous request handling).
- **Persistence & ORM**: PostgreSQL 16 with `pgvector` extension; SQLAlchemy 2.0 (`asyncpg` for runtime queries, `psycopg2` for Alembic migrations).
- **Migration Engine**: Alembic.
- **Cryptographic Engine**: Python Cryptography (`AESGCM` with 256-bit keys and 96-bit random nonces).
- **External AI SDKs**: `google-genai` (Gemini API), `voyageai` (Voyage AI embedding service).
- **Inter-Service Communication**: Asynchronous HTTP client via `httpx`, shared secret internal API headers, JWT Bearer verification.
- **Structured Logging**: `structlog` with JSON output and contextual binding.

### 2.2 Core Design Principles
1. **Zero-Trust Key Storage**: User API keys are encrypted immediately with AES-256-GCM before database insertion. Plaintext keys are never stored, never logged, never returned in API responses, and decrypted in-memory only for the lifetime of an LLM call.
2. **User & Project Multi-Tenant Isolation**: All chat threads, keys, settings, and usage logs are strictly bound to the authenticated user's ID (`sub` claim in JWT). RAG indices and chunks are bound to `project_id`.
3. **Non-Blocking Background Execution**: Compute- and I/O-heavy operations (e.g., project vector indexing) run as background tasks outside the HTTP request lifecycle, using isolated asynchronous database sessions and concurrency limits (`asyncio.Semaphore`).
4. **Resilient Failure Isolation**: Indexing failures in individual project files do not abort the entire indexing job. Per-file states (`pending`, `indexed`, `stale`, `error`) and failure messages are persisted independently.
5. **Context Deduplication & Efficiency**: The context assembly engine prevents redundant file inclusion, optimizing token usage and model attention.

---

## 3. Database Architecture & Schema Design

The service maintains its own dedicated PostgreSQL instance equipped with the `pgvector` extension.

### Database ERD

<ERD-DIAGRAM>

### 3.1 Schema Definitions

#### `user_llm_keys`
Stores encrypted third-party LLM API keys. Composite primary key on `(user_id, provider)` allows users to configure keys for multiple providers.
- `user_id` (`VARCHAR`, PK): User UUID derived from JWT `sub` claim.
- `provider` (`VARCHAR`, PK): Identifier for LLM provider (e.g., `gemini`, `anthropic`, `openai`).
- `encrypted_key` (`BYTEA`, NOT NULL): AES-256-GCM ciphertext containing prepended 12-byte nonce followed by ciphertext bytes.
- `created_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Creation timestamp.
- `updated_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Last update timestamp.

#### `user_llm_settings`
User-level LLM preferences, limits, and rolling monthly token consumption.
- `user_id` (`VARCHAR`, PK): User UUID.
- `monthly_token_limit` (`INTEGER`, NULLABLE): Token quota ceiling for the billing cycle. `NULL` indicates unlimited.
- `tokens_used_this_month` (`INTEGER`, DEFAULT `0`, NOT NULL): Cumulative tokens consumed within the current billing cycle.
- `token_reset_date` (`DATE`, NOT NULL, DEFAULT `date_trunc('month', now()) + interval '1 month'`): Date at which `tokens_used_this_month` resets to 0.
- `preferred_model` (`VARCHAR`, NULLABLE): Custom model identifier selected by user.
- `max_tokens_per_call` (`INTEGER`, DEFAULT `50000`, NOT NULL): Maximum token payload permissible per LLM invocation.
- `updated_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Last settings modification timestamp.

#### `llm_usage_log`
Historical audit trail of all LLM invocations and token usage.
- `id` (`VARCHAR`, PK): Log entry UUID.
- `user_id` (`VARCHAR`, NOT NULL, Indexed): User UUID.
- `project_id` (`VARCHAR`, NOT NULL): Associated project UUID.
- `job_id` (`VARCHAR`, NULLABLE): Optional background job reference.
- `operation` (`VARCHAR`, NOT NULL): Operation type (`query`, `ingest`, `lint`).
- `model` (`VARCHAR`, NOT NULL): LLM model identifier used for the request.
- `tokens_in` (`INTEGER`, NOT NULL): Prompt token count.
- `tokens_out` (`INTEGER`, NOT NULL): Completion token count.
- `created_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Timestamp of execution.

#### `chats`
Represents an LLM conversation thread bound to a project and user.
- `id` (`VARCHAR`, PK): Chat thread UUID.
- `user_id` (`VARCHAR`, NOT NULL, Indexed): Creator user UUID.
- `project_id` (`VARCHAR`, NOT NULL, Indexed): SyncTeX project UUID.
- `title` (`VARCHAR`, NULLABLE): Conversation display title (auto-generated from first message if omitted).
- `created_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Thread creation timestamp.
- `updated_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Thread last activity timestamp.

#### `chat_messages`
Ordered messages within a conversation thread.
- `id` (`VARCHAR`, PK): Message UUID.
- `chat_id` (`VARCHAR`, NOT NULL, Indexed): Foreign key referencing `chats(id)` ON DELETE CASCADE.
- `role` (`VARCHAR`, NOT NULL): Role identifier (`user`, `assistant`, `system`).
- `content` (`TEXT`, NOT NULL): Message body.
- `created_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Message creation timestamp.

#### `rag_index_state`
Tracks project-level RAG enablement and top-level indexing status.
- `project_id` (`VARCHAR`, PK): SyncTeX project UUID.
- `user_id` (`VARCHAR`, NOT NULL): User who initiated or toggled auto-context.
- `enabled` (`BOOLEAN`, DEFAULT `true`, NOT NULL): Whether RAG auto-context is active.
- `status` (`VARCHAR`, DEFAULT `'idle'`, NOT NULL): State machine value (`idle`, `indexing`, `error`).
- `last_indexed_at` (`TIMESTAMPTZ`, NULLABLE): Timestamp of most recent successful full project index.
- `error_message` (`TEXT`, NULLABLE): Top-level error description if project indexing failed.
- `created_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Creation timestamp.
- `updated_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Last state change timestamp.

#### `rag_file_index`
Per-file indexing status within a project index.
- `id` (`VARCHAR`, PK): File index UUID.
- `project_id` (`VARCHAR`, NOT NULL): Foreign key referencing `rag_index_state(project_id)` ON DELETE CASCADE.
- `file_id` (`VARCHAR`, NOT NULL): File UUID from `projects-service`.
- `status` (`VARCHAR`, DEFAULT `'pending'`, NOT NULL): State machine value (`pending`, `indexed`, `stale`, `error`).
- `indexed_at` (`TIMESTAMPTZ`, NULLABLE): Timestamp when file chunks were generated and embedded.
- `chunk_count` (`INTEGER`, DEFAULT `0`, NOT NULL): Number of chunks generated from this file.
- `error_message` (`TEXT`, NULLABLE): File-specific error log if ingestion failed.
- `created_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Creation timestamp.
- `updated_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Last update timestamp.
- *Constraints / Indexes*: Unique index `uq_rag_file_index_project_file` on `(project_id, file_id)`; index `idx_rag_file_index_project` on `project_id`.

#### `rag_chunks`
Extracted document sections, source code metadata, and vector embeddings.
- `id` (`VARCHAR`, PK): Chunk UUID.
- `project_id` (`VARCHAR`, NOT NULL): Project UUID.
- `file_id` (`VARCHAR`, NOT NULL): File UUID.
- `section_path` (`TEXT[]`, NULLABLE): LaTeX structural breadcrumb hierarchy (e.g., `['Chapter 1', 'Methods', 'Data Analysis']`).
- `section_heading` (`TEXT`, NULLABLE): LaTeX command declaring the chunk (e.g., `\subsection{Data Analysis}`).
- `first_line` (`TEXT`, NULLABLE): First non-empty text line of the chunk for re-syncing.
- `last_line` (`TEXT`, NULLABLE): Last non-empty text line of the chunk for re-syncing.
- `chunk_index` (`INTEGER`, NOT NULL): Ordinal index of the chunk within the source file.
- `embedding` (`VECTOR(1024)`, NULLABLE): 1024-dimensional dense vector generated via Voyage AI (`voyage-4-large`).
- `created_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Creation timestamp.
- *Constraints / Indexes*: Foreign key constraint on `(project_id, file_id)` referencing `rag_file_index(project_id, file_id)` ON DELETE CASCADE; index `idx_rag_chunks_project_file` on `(project_id, file_id)`; HNSW index `idx_rag_chunks_embedding` using `vector_cosine_ops`.

#### `rag_retrieved_chunks`
Immutable inference-time snapshot of chunks retrieved and injected into a specific chat message.
- `id` (`VARCHAR`, PK): Record UUID.
- `message_id` (`VARCHAR`, NOT NULL, Indexed): Foreign key referencing `chat_messages(id)` ON DELETE CASCADE.
- `chunk_id` (`VARCHAR`, NULLABLE): Foreign key referencing `rag_chunks(id)` ON DELETE SET NULL.
- `extracted_text` (`TEXT`, NOT NULL): Exact textual chunk content supplied to the LLM.
- `similarity` (`FLOAT`, NULLABLE): Cosine similarity score calculated during retrieval.
- `visible` (`BOOLEAN`, DEFAULT `false`, NOT NULL): UI toggle flag indicating whether sources panel exposes this chunk to user.
- `created_at` (`TIMESTAMPTZ`, DEFAULT `now()`): Creation timestamp.

---

## 4. Core Functional Modules & Component Details

### 4.1 Authentication & Cryptographic Subsystem (`app/core/`)
- **JWT Verification (`app/core/auth.py`)**: Validates incoming `Authorization: Bearer <token>` headers issued by `users-service`. Decodes the token using HMAC-SHA256 (`JWT_SECRET`) or RS256 (`JWT_PUBLIC_KEY`), extracts the `sub` claim (string user ID), and enforces token expiration.
- **Key Encryption (`app/core/crypto.py`)**: Implements authenticated symmetric encryption using AES-256-GCM. Derives key from `ASSISTANT_ENCRYPTION_KEY` (32 bytes / 64-char hex). Generates a random 12-byte nonce per encryption operation, prepending it to the resulting ciphertext. Decryption splits the 12-byte nonce from the ciphertext payload before deciphering.

### 4.2 LLM BYOK & Chat Management (`app/llm/`)
- **Key & Settings CRUD (`app/llm/crud.py`)**: Provides operations for storing encrypted keys, retrieving masked key status (`has_key: True`), updating model preferences, checking token budgets against limits, and logging usage.
- **Provider Registry (`app/llm/providers/`)**:
  - `LLMClient` (Abstract Base Class): Enforces asynchronous `chat()` and `stream()` methods.
  - `GeminiClient`: Implements Google GenAI SDK (`google-genai`), mapping generic message structures `[{"role": "user"|"assistant"|"system", "content": "..."}]` into Gemini `types.Content` with role normalization (`assistant` -> `model`) and separate `system_instruction` injection.
  - `get_client()`: Resolves provider key, instantiates provider client with user-selected or default model (`gemini-2.5-flash-lite`).
- **Streaming Pipeline (`POST /chat/stream`)**:
  1. Authenticates user and fetches chat session.
  2. Resolves and decrypts user provider API key.
  3. Loads historical conversation messages from `chat_messages`.
  4. Estimates input token count (`character_count // 4`) and verifies monthly budget limits.
  5. Inserts user message into `chat_messages`.
  6. Auto-generates chat title from first 60 characters if unassigned.
  7. Initiates asynchronous stream from LLM provider.
  8. Yields Server-Sent Events (`data: {"chunk": "..."}`) chunk by chunk.
  9. On completion, writes assistant response to `chat_messages`, records token usage in `llm_usage_log`, increments `tokens_used_this_month`, and yields `data: {"done": true, ...}` event.

### 4.3 Context Assembly & Resolution Subsystem (`app/context/`)
- **Mention Resolution (`app/context/resolvers/mentions.py`)**: Detects `@<filepath>` tokens in incoming user prompts via regular expression `r"@([\w./\-]+)"`. Fetches presigned download URLs from `projects-service` and retrieves file contents over HTTP.
- **Context Tracker (`app/context/tracker.py`)**: Maintains a registry of files already included in the prompt context (by `file_id` and normalized relative path). If an entire file has been included as full text (e.g., via `@mention` or active editor tab), any subsequent file-chunk candidates for that same file are discarded to prevent token redundancy.
- **Context Assembler (`app/context/assembler.py`)**: Orchestrates candidate gathering across inline editor buffers, `@mention` extractions, and semantic RAG search results, converting resolved chunks into a formatted system prompt with Markdown code fences.

### 4.4 Automated Context & RAG Pipeline (`app/auto_context/`)
- **LaTeX Structural Chunker (`app/auto_context/chunker.py`)**:
  - Strips LaTeX comments (`%...`).
  - Scans for LaTeX structural commands in hierarchical order: `part` (level 0), `chapter` (level 1), `section` (level 2), `subsection` (level 3), `subsubsection` (level 4), `paragraph` (level 5), `subparagraph` (level 6).
  - Maintains breadcrumb hierarchy stack (e.g., `["chapter", "Introduction"], ["section", "Prior Work"]`), replacing lower-level nodes when higher or equal level headings are encountered.
  - Emits `Chunk` objects containing raw LaTeX text, 1-indexed start/end line boundaries, and hierarchical breadcrumb paths.
- **Embeddings Client (`app/auto_context/embeddings.py`)**: Interfaces with Voyage AI (`voyage-4-large`) generating 1024-dimensional float vectors. Supports distinct input types: `input_type="document"` for batch chunk indexing and `input_type="query"` for user prompt embeddings at query time.
- **Background Project Indexer (`app/auto_context/indexer.py`)**:
  - Invoked upon toggling auto-context via `PATCH /projects/{project_id}/auto-context`.
  - Sets project status in `rag_index_state` to `indexing`.
  - Queries `projects-service` for all project files and their presigned text URLs.
  - Spawns concurrent per-file indexing tasks governed by `asyncio.Semaphore(MAX_CONCURRENT_FILES)` (default concurrency: 5).
  - Each file worker: downloads text -> chunks via `chunk_latex` -> generates Voyage vector embeddings in batches -> replaces existing chunks atomically in `rag_chunks` -> updates `rag_file_index` to `indexed` or `error`.
  - On task completion, updates project state to `idle` with `last_indexed_at` timestamp.
- **Vector Similarity Search (`app/auto_context/crud.py:similarity_search`)**: Executes cosine distance similarity searches using pgvector operator `<=>` against `rag_chunks`, filtering by `project_id` and optional excluded file IDs, ordered by cosine distance with `limit = top_k`.

---

## 5. Inter-Service Interactions & Integrations

The `assistant-service` interacts with surrounding platform services and external APIs as follows:

### 5.1 Nginx API Gateway
- **Ingress Routing**: Nginx proxies `/api/llm/v1/*` to `http://assistant-service:8000/`.
- **SSE Stream Configuration**: Nginx disables proxy buffering (`proxy_buffering off; proxy_cache off;`) and sets `proxy_read_timeout 120s;` so that SSE tokens stream to the client with minimum latency.
- **Rate Limiting**: Protected by Nginx rate-limiting zone `api_limit` (burst=30 nodelay).

### 5.2 Users Service (`users-service`)
- **Authentication Handshake**: `assistant-service` verifies incoming JWT tokens signed with `JWT_SECRET` (HS256) by `users-service`. It extracts the `sub` claim as the authoritative user ID.

### 5.3 Projects Service (`projects-service`)
- **Project File Listing & Download URLs**: During project RAG indexing, `assistant-service` calls `GET /projects/internal/v1/project/{project_id}/download?type=text` using the internal API key (`PROJECTS_INTERNAL_API_KEY`). `projects-service` returns file metadata and presigned MinIO text URLs.
- **Mention Resolution**: When `@filepath` is referenced in chat, `assistant-service` requests a presigned file download URL from `GET /projects/{project_id}/files/download-url?path={path}` forwarding the user's JWT.

### 5.4 Object Storage (MinIO)
- **Text Retrieval**: `assistant-service` uses presigned URLs generated by `projects-service` to download extracted text or raw LaTeX files directly from MinIO via HTTP. `assistant-service` holds no direct MinIO credentials, maintaining separation of concerns.

### 5.5 External AI APIs
- **Google GenAI API**: Used for chat completion and response streaming (`gemini-2.5-flash-lite`) utilizing decrypted user-supplied API keys.
- **Voyage AI API**: Used for dense text embeddings (`voyage-4-large`, 1024 dimensions) using the platform-wide `VOYAGE_API_KEY`.

---

## 6. API Specification & Endpoints

All endpoints are hosted behind the gateway prefix `/api/llm/v1/` and require a valid Bearer token unless otherwise noted.

### 6.1 System Health
- **`GET /health`**
  - **Auth**: None
  - **Response (200 OK)**: `{"status": "ok"}`

### 6.2 Provider Key Management
- **`PUT /keys`**
  - **Description**: Stores or updates an encrypted LLM API key for a specified provider.
  - **Request Body**:
    ```json
    {
      "provider": "gemini",
      "api_key": "AIzaSy..."
    }
    ```
  - **Response (200 OK)**:
    ```json
    {
      "provider": "gemini",
      "has_key": true,
      "created_at": "2026-09-01T12:00:00Z",
      "updated_at": "2026-09-01T12:00:00Z"
    }
    ```
- **`GET /keys`**
  - **Description**: Lists all providers configured with active keys for the user.
  - **Response (200 OK)**:
    ```json
    {
      "keys": [
        {
          "provider": "gemini",
          "has_key": true,
          "created_at": "2026-09-01T12:00:00Z",
          "updated_at": "2026-09-01T12:00:00Z"
        }
      ]
    }
    ```
- **`DELETE /keys/{provider}`**
  - **Description**: Removes the stored key for the specified provider.
  - **Response (204 No Content)**

### 6.3 User LLM Settings & Usage
- **`GET /settings`**
  - **Description**: Returns user LLM settings, preferred models, and monthly token quota metrics.
  - **Response (200 OK)**:
    ```json
    {
      "user_id": "usr_12345",
      "monthly_token_limit": 500000,
      "tokens_used_this_month": 12450,
      "token_reset_date": "2026-10-01",
      "preferred_model": "gemini-2.5-flash-lite",
      "max_tokens_per_call": 50000,
      "updated_at": "2026-09-01T12:00:00Z"
    }
    ```
- **`PATCH /settings`**
  - **Description**: Updates user token limit, preferred model, or maximum tokens per call.
  - **Request Body**:
    ```json
    {
      "monthly_token_limit": 1000000,
      "preferred_model": "gemini-2.5-flash-lite",
      "max_tokens_per_call": 60000
    }
    ```
  - **Response (200 OK)**: Updated settings object.
- **`GET /usage`**
  - **Description**: Retrieves recent token usage audit logs (up to 50 most recent entries).
  - **Response (200 OK)**: List of `UsageLogResponse` items.
- **`GET /providers`**
  - **Description**: Returns list of supported LLM provider keys.
  - **Response (200 OK)**: `{"providers": ["gemini"]}`

### 6.4 Chat Management & Streaming
- **`POST /chats`**
  - **Description**: Creates a new conversation thread.
  - **Request Body**:
    ```json
    {
      "project_id": "proj_abc123",
      "title": "LaTeX formatting help"
    }
    ```
  - **Response (200 OK)**: `ChatSummary` object.
- **`GET /chats?project_id={project_id}`**
  - **Description**: Lists all chat threads owned by the user in a specific project.
  - **Response (200 OK)**: Array of `ChatSummary` objects.
- **`GET /chats/{chat_id}/messages`**
  - **Description**: Returns full message history for a specific chat.
  - **Response (200 OK)**: Array of `ChatMessageResponse` objects ordered by creation timestamp.
- **`DELETE /chats/{chat_id}`**
  - **Description**: Deletes a conversation thread and all cascaded messages.
  - **Response (204 No Content)**
- **`POST /chat/stream`**
  - **Description**: Submits a user prompt, validates quota, invokes the LLM, and streams back the assistant's reply via Server-Sent Events.
  - **Request Body**:
    ```json
    {
      "chat_id": "chat_xyz",
      "message": "Can you format this equation in LaTeX? @sections/math.tex",
      "max_tokens": 1000,
      "system_prompt": "You are a helpful LaTeX assistant."
    }
    ```
  - **Response Header**: `Content-Type: text/event-stream; charset=utf-8`
  - **Event Protocol**:
    - Chunk payload: `data: {"chunk": "Here is the "}\n\n`
    - Completion payload: `data: {"done": true, "model": "gemini", "usage": {"tokens_in": 120, "tokens_out": 45}}\n\n`
    - Error payload: `data: {"error": "Token budget exceeded..."}\n\n`

### 6.5 Auto-Context & RAG
- **`PATCH /projects/{project_id}/auto-context`**
  - **Description**: Enables or disables RAG auto-context for a project. When enabled from an idle state, enqueues an asynchronous background indexing job.
  - **Request Body**:
    ```json
    {
      "enabled": true
    }
    ```
  - **Response (200 OK)**: `RagIndexState` representation.

---

## 7. Execution Flows & Data Lifecycle

### 7.1 Chat Prompt Execution Flow
1. **Client Request**: Frontend sends `POST /chat/stream` with `chat_id`, user prompt, and optional parameters.
2. **Authentication**: `get_current_user_id` extracts `sub` user UUID from JWT.
3. **Session Verification**: Query fetches `Chat` matching `chat_id` and `user_id`.
4. **Key Decryption**: Active API key for the user is retrieved from `user_llm_keys` and decrypted via AES-256-GCM.
5. **History Loading**: All existing messages in `chat_messages` for `chat_id` are loaded.
6. **Token Budget Verification**:
   - Prompt tokens estimated via character heuristic (`total_chars // 4`).
   - Settings retrieved from `user_llm_settings`; token reset verified against current calendar date.
   - If projected usage exceeds `monthly_token_limit`, raises HTTP 429.
7. **User Message Persistence**: User message record is written to `chat_messages`. If the chat has no title, the first 60 characters of the prompt are assigned as the title.
8. **LLM Provider Streaming**:
   - `GeminiClient` formats messages into `types.Content` structures.
   - As chunks arrive from Google GenAI SDK, they are streamed immediately as SSE events.
9. **Finalization & Accounting**:
   - Assistant's full response is committed to `chat_messages`.
   - Completion tokens calculated (`output_chars // 4`).
   - `LLMUsageLog` record is inserted.
   - `user_llm_settings.tokens_used_this_month` is incremented.
   - Final `{"done": true, ...}` event is dispatched to client.

### 7.2 Project RAG Indexing Flow
1. **Trigger**: User enables auto-context via `PATCH /projects/{project_id}/auto-context`.
2. **State Transition**: `rag_index_state` is updated to `status='indexing'`.
3. **Background Worker Dispatch**: `BackgroundTasks` enqueues `index_project(project_id, user_id)`.
4. **File Discovery**: Worker calls `projects-service` internal API (`/projects/internal/v1/project/{id}/download?type=text`) to obtain all project files with presigned text URLs.
5. **Concurrent Ingestion**:
   - A semaphore limits concurrency to 5 simultaneous files.
   - For each file:
     - Worker sets `rag_file_index` to `pending`.
     - Worker downloads plain text from presigned MinIO URL.
     - `chunk_latex()` parses LaTeX structure, strips comments, builds hierarchy breadcrumbs, and segments the document at section boundaries.
     - `embed_document()` calls Voyage AI (`voyage-4-large`) to generate 1024-dimension float vectors for all chunks.
     - `replace_file_chunks()` deletes prior chunks for that file and writes new rows to `rag_chunks`.
     - Worker sets `rag_file_index` to `status='indexed'`, recording `chunk_count` and `indexed_at`.
     - If a file encounters an exception, that file's state is recorded as `status='error'` with its error message, while sibling file processing continues.
6. **Job Completion**: Worker sets `rag_index_state` to `status='idle'` and stamps `last_indexed_at`.

---

## 8. Deployment, Configuration & Operations

### 8.1 Docker Containerization
- **Multi-stage Build**: Builds Python dependencies in a `python:3.12-bookworm` builder stage, copying the compiled virtualenv to a lightweight `python:3.12-slim-bookworm` runtime image.
- **Security**: Runs under an unprivileged user (`appuser`, `appgroup`).
- **Healthcheck**: Periodically polls `http://127.0.0.1:8000/health`.

### 8.2 Environment Configuration

| Variable Name | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql+asyncpg://...` | Async PostgreSQL connection string for runtime queries |
| `DATABASE_SYNC_URL` | Yes | `postgresql://...` | Sync PostgreSQL connection string used by Alembic migrations |
| `ASSISTANT_ENCRYPTION_KEY` | Yes | None | 64-character hex string (32 bytes) for AES-256-GCM key encryption |
| `JWT_SECRET` | Yes (if HS256) | None | Shared HMAC secret for verifying user tokens |
| `JWT_ALGORITHM` | No | `HS256` | JWT signing algorithm (`HS256` or `RS256`) |
| `JWT_PUBLIC_KEY` | Yes (if RS256) | None | PEM-encoded RS256 public key |
| `VOYAGE_API_KEY` | Yes | None | API key for Voyage AI text embeddings |
| `PROJECTS_SERVICE_URL` | Yes | `http://projects-service:8003` | Base internal URL for `projects-service` |
| `PROJECTS_INTERNAL_API_KEY` | Yes | None | Shared internal API key for accessing project files |
| `LOG_LEVEL` | No | `INFO` | Logging verbosity (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `PORT` | No | `8000` | Application HTTP listen port |

---

## 9. Security & Error Handling Matrix

| Scenario | HTTP Status / Handling | Mechanism |
|---|---|---|
| Invalid or expired JWT | `401 Unauthorized` | Handled by `get_current_user_id` in `app/core/auth.py` |
| Missing user LLM key | `400 Bad Request` | Raised when user attempts streaming chat without saving a key |
| Key decryption failure | `500 Internal Server Error` | AES-GCM tag mismatch or corrupt encryption key |
| Monthly token limit exceeded | `429 Too Many Requests` | Checked prior to LLM call against `user_llm_settings` |
| Chat not found / unauthorized | `404 Not Found` | Chat lookup queries filter strictly by `chat_id` AND `user_id` |
| Project file download failure | File marked `status='error'` | Error isolated to `rag_file_index`; job completes for remaining files |
| LLM provider stream error | SSE error event dispatched | Emits `data: {"error": "..."}\n\n`; rolls back pending assistant message |
