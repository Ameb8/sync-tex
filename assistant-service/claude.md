# assistant-service + postgres-assistant

Python/FastAPI. Provides AI chat assistant scoped to a LaTeX project. BYOK (bring-your-own-key) model — users supply their own LLM API keys, stored encrypted at rest.

## DB

PostgreSQL instance `postgres-assistant`. Migrations via Alembic/SQLAlchemy. Stores encrypted API keys, conversation history.

Schema highlights:
- `api_keys`: user_id, provider, encrypted_key, iv, tag (AES-256-GCM fields)
- `conversations`: id, project_id, user_id, created_at
- `messages`: id, conversation_id, role (user|assistant), content, created_at

## Key Design

**BYOK key storage**: API keys encrypted with AES-256-GCM before DB write. Encryption key derived from `SECRET_KEY` env var. Never stored in plaintext.

**Provider abstraction**: `BaseProvider` interface with `stream(messages) -> AsyncIterator[str]`. Implemented: `GeminiProvider`. Extensible to `AnthropicProvider`, `OpenAIProvider` without API changes.

**Context assembly**: Before calling the LLM, service fetches relevant file text from `file-data-service` (gRPC `ExportText`). Smart selection: prioritize files recently edited or referenced in conversation. Assembled context injected as system prompt.

**Streaming**: Responses streamed to client via SSE (`text/event-stream`). Each chunk is a `data: <token>\n\n` frame. Final frame is `data: [DONE]\n\n`.

## Endpoints

| Method | Path                              | Description                  |
|--------|-----------------------------------|------------------------------|
| GET    | /health                           | Health check                 |
| GET    | /keys                             | List stored API keys         |
| PUT    | /keys                             | Upsert API key               |
| DELETE | /keys/{provider}                  | Delete API key               |
| GET    | /settings                         | Get user settings            |
| PATCH  | /settings                         | Update user settings         |
| GET    | /usage                            | Get recent usage logs        |
| POST   | /chats                            | Create chat                  |
| GET    | /chats                            | List chats (by project_id)   |
| GET    | /chats/{chat_id}/messages         | Get chat history             |
| DELETE | /chats/{chat_id}                  | Delete chat                  |
| POST   | /chat/stream                      | Stream chat response (SSE)   |
| GET    | /providers                        | List supported providers     |

## Env

```
DATABASE_URL
SECRET_KEY              # used to derive AES encryption key
FILE_DATA_SERVICE_ADDR  # gRPC
JWT_SECRET
```