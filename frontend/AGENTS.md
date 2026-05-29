# frontend

React + Vite. Monaco Editor with Yjs CRDT collaboration. VSCode-style layout with activity bar and collapsible sidebar panels.

## Stack

- **Editor**: Monaco Editor, `MonacoBinding` (yjs ↔ Monaco)
- **Collaboration**: Yjs, `y-websocket` → `collab-service`
- **Markdown rendering**: `react-markdown`, `remark-gfm`, `react-syntax-highlighter`
- **Auth**: `AuthContext` (JWT stored in localStorage), GitHub OAuth2 redirect flow
- **Routing**: React Router

## Layout

VSCode-style shell:
- **Activity bar** (left strip): icon buttons switch between sidebar panels (Files, Collaborators, Assistant, etc.)
- **Sidebar**: collapsible panel for active activity. Houses file tree, collaborator list, AI chat.
- **Editor area**: Monaco instance per open file. Tab bar for open files.
- **Status bar** (bottom): connection status, compile state.

## Key Patterns

**Editor tabs + MonacoBinding**: Each tab has its own `Y.Text` bound to a Monaco model. On tab switch, old `MonacoBinding` must be destroyed and new one created — failure to do so causes stale binding bugs.

**Auth flow**: `AuthContext` provides `user`, `token`, `login`, `logout`. All API calls use `authFetch` to pass `bearer: token` automatically.

**Collaboration awareness**: Yjs awareness protocol used for presence (cursor positions, user colors). Awareness state set on connect with user identity from JWT.

**AI chat**: Calls `assistant-service` SSE endpoint. `EventSource` reads streamed tokens and appends to message in state. Messages rendered with `react-markdown`.

## Env (Vite)

```
VITE_API_BASE_URL         # nginx gateway external URL
VITE_WS_BASE_URL          # WebSocket URL for collab-service
VITE_GITHUB_CLIENT_ID
```