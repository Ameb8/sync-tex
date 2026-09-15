# Frontend Service — System Design Document (`frontend`)

## 1. Executive Summary & Purpose

The **Frontend Service** (`frontend`) is the primary user-facing Single-Page Application (SPA) of the SyncTeX collaborative LaTeX IDE platform. It provides a web-based, VSCode-style interactive workspace that integrates real-time multi-user document collaboration, full project and filesystem management, BYOK (Bring-Your-Own-Key) AI writing assistance, and administrative controls.

### 1.1 Core Responsibilities
- **Authentication & User Onboarding**: Manages user registration, email/password authentication, GitHub and Google OAuth2 authorization flows, token lifecycle in browser storage, and legal document compliance.
- **Project Dashboard & Workspace Management**: Provides listing, filtering, sorting, creation, zip-archive importing, and token-based invite link acceptance for LaTeX projects.
- **Hierarchical File Tree & Asset Management**: Supports nested directories, file creation, deletion, renaming, image preview, and direct-to-object-storage uploads via presigned URLs.
- **Real-Time CRDT Document Collaboration**: Orchestrates per-file Yjs documents and Monaco editor instances via `y-monaco` (`MonacoBinding`), maintaining bidirectional synchronization with `collab-service` over WebSockets.
- **Presence & Live Awareness**: Propagates and renders remote user awareness states, including live cursors, selection highlights with user-specific color palettes, and active editor presence indicators.
- **AI Writing Assistant & LLM Key Management**: Provides chat interfaces with SSE (Server-Sent Events) streaming, automatic LaTeX document context injection, Markdown and syntax-highlighted code rendering, and user-managed provider API key administration.
- **Theme & Appearance Engine**: Implements dynamic theming (Dark, Light, System) via CSS custom properties and DOM dataset synchronization.
- **Performance & Idle Prefetching**: Utilizes route-level lazy loading, `requestIdleCallback` warmup routines, and user intent triggers to optimize resource loading and time-to-interactive.

---

## 2. Architecture and Technology Stack

### 2.1 Technology Stack
- **Framework & UI Library**: React 18.2.0 (`react`, `react-dom`)
- **Build System & Dev Server**: Vite 5.0.0 (`@vitejs/plugin-react`, `vite-plugin-static-copy`)
- **Client-Side Routing**: React Router v7 (`react-router-dom` 7.13.1)
- **Code Editor**: Monaco Editor via `@monaco-editor/react` (4.7.0) with custom Monarch tokenizer and VSCode themes
- **CRDT & Collaborative Engine**:
  - `yjs` (13.6.0): In-memory Conflict-free Replicated Data Type engine
  - `y-monaco` (0.1.6): Bidirectional binding between Yjs `Y.Text` and Monaco models
  - `y-protocols` (1.0.7): Awareness and sync wire protocol encoders/decoders
  - `y-websocket` (1.4.1): WebSocket protocol abstractions
- **Markdown & Code Highlighting**:
  - `react-markdown` (10.1.0): Markdown parsing
  - `remark-gfm` (4.0.1): GitHub Flavored Markdown plugin (tables, strikethrough, autolinks)
  - `react-syntax-highlighter` (16.1.1): Prism-based syntax highlighter (`vscDarkPlus` theme)
- **Icons**: React Icons (`react-icons` 5.6.0)
- **Deployment & Gateway Proxy**: Nginx Alpine container serving compiled static assets and reverse-proxying backend microservices.

### 2.2 Component Hierarchy & Directory Layout
```
frontend/
├── public/
│   └── landing-image.png
├── src/
│   ├── api/                    # Microservice API integration clients
│   │   ├── projects.js         # projects-service project CRUD & import
│   │   ├── editor.js           # Tree, file CRUD, presigned S3 uploads/downloads
│   │   ├── collaborators.js    # Collaborator links, invites, member management
│   │   ├── session.js          # Yjs CRDT session & WebSocket collaboration engine
│   │   └── llm.js              # assistant-service keys, settings, chats & SSE stream
│   ├── components/
│   │   ├── Dashboard/          # Dashboard components (Header, Cards, Modals)
│   │   ├── Editor/             # IDE components (ActivityBar, FileTree, TabBar, EditorPane)
│   │   │   ├── AIPanel/        # ChatSidebar, ChatWindow, MessageList
│   │   │   └── LLMPanel/       # BYOK Provider API key configuration UI
│   │   ├── icons/              # SVG icon definitions (GoogleIcon, etc.)
│   │   └── ProtectedRoute.jsx  # Route guard for authenticated views
│   ├── contexts/
│   │   ├── AuthContext.jsx     # JWT state, authFetch utility, login/signup/OAuth
│   │   └── ThemeContext.jsx    # Theme preference and DOM color-scheme provider
│   ├── hooks/                  # Specialized state management hooks
│   │   ├── useTabManager.js    # Multi-kind tab management (files & chats)
│   │   ├── useFileManager.js   # File tree, dirty state, and S3 file operations
│   │   ├── useCollabSessions.js# Per-file Yjs collaboration sessions lifecycle
│   │   └── useChatManager.js   # Chat history, creation, deletion & message caches
│   ├── monaco/                 # Monaco configuration, Monarch tokenizer, themes
│   │   ├── monarchLatex.js     # Custom LaTeX language lexer and paired delimiters
│   │   ├── setupMonaco.js      # Monaco loader singleton and theme registration
│   │   └── themes/             # Custom dark (monokai) and light (github-light) JSON
│   ├── prefetch/               # Idle and user-intent prefetching utilities
│   │   ├── scheduleIdleWarmup.js # requestIdleCallback scheduler with timeout fallback
│   │   └── warmups.js          # Dynamic import warmers for routes and panels
│   ├── views/                  # Route-level view components
│   │   ├── LandingView.jsx     # Public landing page with feature cards & SEO metadata
│   │   ├── LoginView.jsx       # Tabbed Login/Signup form and OAuth buttons
│   │   ├── OAuthCallback.jsx   # OAuth redirect handler and token extraction
│   │   ├── DashboardView.jsx   # Project workspace dashboard
│   │   ├── EditorView.jsx      # Main collaborative IDE view
│   │   ├── JoinView.jsx        # Invite token handler and project auto-join
│   │   ├── SettingsView.jsx    # User settings and appearance preference
│   │   └── LegalView.jsx       # Privacy Policy and Terms of Service viewer
│   ├── App.jsx                 # Route definitions and context provider wrappers
│   ├── main.jsx                # DOM root initialization
│   ├── index.css               # Global CSS variables, reset, and base typography
│   └── App.css                 # Application-wide shell styling
├── index.html
├── package.json
└── vite.config.js
```

---

## 3. Client Storage & Persistence Architecture

The frontend is a stateless Single-Page Application that relies on browser-level storage and in-memory CRDT data structures rather than an internal client database.

### 3.1 Data Model Overview
<ERD-DIAGRAM>

### 3.2 Client Web Storage (`localStorage`)
The application persists lightweight authentication, navigation, and preference states in the browser's `localStorage`:

| Key | Type | Description | Lifespan |
|---|---|---|---|
| `auth_token` | `string` (JWT) | Access token issued by `users-service`. Injected as `Bearer <token>` in API calls. | Until user logout or 401 token invalidation. |
| `theme_preference` | `'system' \| 'light' \| 'dark'` | User-selected theme mode. Controls dataset attributes and Monaco editor themes. | Permanent across sessions. |
| `oauth_redirect` | `string` (URL path) | Internal redirect path saved before initiating an OAuth2 handshake. | Consumed and removed upon OAuth callback completion. |

### 3.3 In-Memory CRDT & Session State
For open files, the frontend instantiates in-memory data structures:
- **`Y.Doc`**: Independent CRDT document instance allocated per open file.
- **`Y.Text ('content')`**: Shared collaborative text type bound to the Monaco editor model.
- **`Awareness`**: Ephemeral presence instance tracking user identity, client ID, cursor index, selection range, and assigned color.
- **`fileContents` Cache**: In-memory dictionary (`fileId -> string`) maintaining unmodified content for dirty checking and non-collaborative buffers.
- **`unsavedFiles` Set**: In-memory collection of dirty file identifiers awaiting manual S3 persistence.

---

## 4. Detailed Component Design & Runtime Subsystems

### 4.1 Authentication & Authorization Subsystem (`AuthContext`, `ProtectedRoute`)

#### 4.1.1 `AuthContext`
- **State Properties**: `user` (profile object), `loading` (boolean), `error` (string | null), `isAuthenticated` (boolean).
- **Authentication Lifecycle**:
  1. **Initialization (`checkAuth`)**: On mount, retrieves `auth_token` from `localStorage`. If present, calls `GET /auth/me`. If successful, sets `user` state; if the response is 401/error, removes the token and resets state.
  2. **Password Authentication**: `login(email, password)` and `signup(email, password, name)` post credentials to `/auth/login` and `/auth/register`. On success, extracts `token` and user profile, persisting `token` to `localStorage`.
  3. **OAuth2 Flow**: `loginWithGithub(redirectTo)` and `loginWithGoogle(redirectTo)` save the target redirect path in `localStorage['oauth_redirect']` and redirect the browser window to `/auth/github/login` or `/auth/google/login`.
  4. **OAuth Callback Handler (`OAuthCallback`)**: Captures `?token=` or `?error=` from the query parameters, saves the token, invokes `checkAuth()`, and redirects the user to the saved `oauth_redirect` or `/dashboard`.
  5. **Session Termination (`logout`)**: Dispatches a `POST /auth/logout` request, removes `auth_token` from `localStorage`, and purges `user` state.

#### 4.1.2 `authFetch` Transport Utility
`authFetch` is the centralized HTTP wrapper used across all API client modules:
- Automatically injects `Content-Type: application/json` (unless overridden).
- Automatically reads `auth_token` from `localStorage` and appends `Authorization: Bearer <token>`.
- Preserves standard `fetch` options, including `signal` (`AbortSignal`) for request cancellation.

#### 4.1.3 Route Guarding (`ProtectedRoute`)
Wraps private routes (`/dashboard`, `/project/:projectId`, `/settings`). While `loading` is true, displays a centered loading indicator. If `isAuthenticated` is false upon completion, triggers a client-side `<Navigate to="/login" replace />`.

---

### 4.2 Dashboard Subsystem (`DashboardView`)

The dashboard serves as the central hub for managing user projects and workspaces.

#### 4.2.1 Project Listing, Filtering, and Sorting
- **Data Acquisition**: Fetches user projects via `GET /projects/v1/projects` on mount.
- **Filtering Mechanisms**:
  - `all`: All projects accessible to the authenticated user.
  - `my`: Projects owned by the user (`String(project.owner_id) === String(user.id)`).
  - `shared`: Projects where the user is an invited collaborator (`owner_id !== user.id`).
  - `templates`: Projects flagged as reusable templates (`project.isTemplate === true`).
- **Sorting Modes**:
  - `recent` / `modified`: Sorted descending by `created_at` timestamp.
  - `name`: Alphabetical sort by project name.
- **Section Layout**:
  - **Recent Projects Carousel**: Displays the top 6 most recent projects in card format (`ProjectCard`).
  - **All Projects Table**: Renders the complete filtered/sorted project collection (`ProjectListItem`).

#### 4.2.2 Modal Dialogs & Action Handlers
- **New Project Modal (`NewProjectModal`)**: Accepts project name and calls `POST /projects/v1/projects`. Refreshes project list upon creation.
- **Import Project Modal (`ImportModal`)**: Accepts a `.zip` archive containing LaTeX sources, wraps it in `FormData`, and posts to `POST /projects/v1/projects/import` with `Authorization` headers.
- **Join Project Modal (`JoinProjectModal`) & Route (`JoinView`)**:
  - Parses invite tokens from raw strings, full URLs (`https://sync-tex.com/join?token=XYZ`), or path segments (`/join/XYZ`).
  - Submits token via `POST /projects/v1/invites/accept`.
  - On success, redirects directly to `/project/:projectId`; on error, displays user-friendly error banners or toast notifications (`join_error=invalid_or_expired`).

---

### 4.3 IDE & Collaborative Editor Subsystem (`EditorView`)

`EditorView` is the central orchestrator of the editing environment. It manages layout panes, coordinates state across specialized custom hooks, and handles global keyboard shortcuts.

```
+-----------------------------------------------------------------------------------------+
| [ActivityBar] | [Collapsible Side Panel]   | [TabBar: Tab 1 | Tab 2 | Chat 1          ] |
|               |                            |------------------------------------------|
| [Files]       | • FileTree Explorer        |                                          |
| [AI Chat]     |   - Folders & Files        | [EditorContent]                          |
| [API Keys]    |   - Context Menus          |   - Monaco Editor Instance (Yjs CRDT)    |
| [Members]     | • or ChatSidebar           |   - or Image Preview Pane                |
|               | • or CollaboratorsPanel    |   - or ChatWindow (AI Assistant)         |
|               |                            |   - or LLMPanel (API Keys Full-View)     |
| [Dashboard]   |                            |                                          |
+-----------------------------------------------------------------------------------------+
```

#### 4.3.1 Workspace Layout Components
- **`ActivityBar`**: A fixed 48px icon strip on the far left. Toggles collapsible side panels (`type: 'sidebar'`) or switches the main editing viewport to full-screen administrative panels (`type: 'main'`, such as `LLMPanel`). Includes a navigation button returning to `/dashboard`.
- **`FileTree`**: Renders hierarchical directory trees. Supports recursive folder expansion, file selection, right-click context menus for creating files/folders, uploading images, renaming items, and triggering confirmation modals for deletions.
- **`TabBar`**: Displays open file and AI chat tabs with active status, dirty markers (`●`), tab-type glyphs (`◇`), and tab-close actions.
- **`EditorPane`**: Hosts the `@monaco-editor/react` instance, image preview containers, connection status banners (`Live collaboration`, `Connecting…`, `Disconnected`), dirty status indicators (`Press Ctrl+S to save`), and read-only locks for viewers.
- **`CollaboratorsPanel`**: Two-tab collaboration panel:
  - **Share Tab**: Generates invite links with selectable roles (`editor` vs `viewer`), displays active links with copy-to-clipboard and revocation controls.
  - **Members Tab**: Lists active project members with role badges and removal controls, alongside a real-time **Currently editing** presence strip showing active peer avatars and awareness colors.

#### 4.3.2 Custom State Management Hooks

##### `useTabManager`
Manages the open-tab list and active tab selection:
- Supports polymorphic tabs: `file` tabs (`file:<fileId>`) and `chat` tabs (`chat:<chatId>`).
- `addTab(item)`: Appends a tab if not already present and sets it as active.
- `handleTabSelect(tabId)`: Switches the active viewport.
- `handleTabClose(tabId)`: Invokes the `onTabClose` cleanup callback, removes the tab, and automatically activates the rightmost adjacent tab.
- `updateTab(tabId, patch)`: Modifies tab metadata (e.g., updating tab titles when a file or chat is renamed).

##### `useFileManager`
Manages filesystem tree structure, file content caching, dirty state, and S3 REST operations:
- `treeData`: Hierarchical project tree fetched via `fetchProjectTree(projectId)`.
- `fileContents`: Key-value cache (`fileId -> string | downloadUrl`).
- `unsavedFiles`: Set of file IDs with local uncommitted edits.
- `handleEditorChange(value, activeTabId)`: For non-collaborative sessions, updates local content state and toggles the dirty flag against `originalContentsRef`. (Ignored in collaborative sessions where Yjs owns document state).
- `handleSaveFile(activeTabId)`: Dispatches a manual save. In collaborative mode, extracts `session.getContent()` from the Yjs doc; in non-collab mode, reads `fileContents`. Obtains a presigned S3 upload URL via `POST /projects/v1/projects/:id/files/:fileId/upload` and performs a binary `PUT` directly to MinIO.
- **CRUD Operations**: Wraps `createFile`, `createFolder`, `deleteItem`, `renameItem`, and `uploadImageFile`, refreshing the project tree upon completion.

##### `useCollabSessions`
Manages real-time Yjs CRDT WebSocket connections and Monaco editor bindings:
- `collabSessions`: Ref mapping `fileId -> session` to prevent stale closure leaks.
- `boundEditors`: Map tracking active Monaco model and session bindings to ensure clean rebinding across tab switches and remounts.
- `collabStatus`: Tracks per-file connection states (`connecting`, `connected`, `disconnected`).
- `liveEditorsByFile`: Tracks active awareness presence lists per file.
- `openCollabSession(file)`: Instantiates a new collaborative session via `createCollabSession`.
- `closeCollabSession(fileId)`: Cleans up WebSocket connections, removes awareness style elements, and destroys Yjs document instances.
- `bindActiveSession(editor, activeTabId, isCollab)`: Binds Monaco to `ytext` via `MonacoBinding`, retrying up to 10 times if the editor model is not yet attached.

##### `useChatManager`
Manages project AI chat lists, per-chat message caches, and chat creation/deletion:
- Fetches chat sessions via `GET /api/llm/v1/chats?project_id=:projectId`.
- Caches chat message histories (`messagesByChatId`) and loads messages lazily upon chat selection via `getChatMessages(chatId)`.
- Handles chat session creation (`createChat`), deletion (`deleteChat`), and local cache updates during SSE streaming.

---

### 4.4 Real-Time Collaboration & CRDT Protocol (`session.js`)

The `createCollabSession` factory creates and encapsulates a self-contained collaborative editing session for a single file.

#### 4.4.1 Yjs Document & WebSocket Wire Framing
- **Connection URL**: `ws(s)://<host>/ws/<fileId>?projectId=<projectId>&token=<jwt>`
- **Binary Format**: Operates strictly on binary `ArrayBuffer` payloads matching the Yjs wire protocol.

```
Message Types (Leading Byte):
  0x00 (MsgSync)
    ├── 0x01 (SyncStep2): Compact snapshot payload -> Applied via Y.applyUpdate(ydoc, payload, 'remote')
    └── 0x02 (SyncUpdate): Incremental update payload -> Applied via Y.applyUpdate(ydoc, payload, 'remote')
  0x01 (MsgAwareness)
    └── Binary awareness update -> Applied via applyAwarenessUpdate(awareness, payload, 'remote')
```

- **Local Edit Propagation**:
  When Monaco modifications occur, `ydoc.on('update')` intercepts the local update. If `origin !== 'remote'`, it wraps the binary payload in a 2-byte sync header (`[0x00, 0x02, ...payload]`) and transmits it over the WebSocket.
- **Reconnection Logic**:
  If the WebSocket drops unexpectedly, `createCollabSession` updates status to `disconnected` and attempts reconnection every 2000ms up to a maximum of 5 attempts.

#### 4.4.2 Awareness Protocol & Dynamic Selection Highlighting
- **User Color Hashing**: Each user is assigned a deterministic color selected from a 16-color palette based on a hash of their unique user ID (`colorForUserId`).
- **Presence State**: Awareness state is populated with user metadata (`id`, `name`, `email`, `avatar_url`, `color`) and broadcast via `encodeAwarenessUpdate`.
- **Dynamic CSS Injection**:
  To render remote user cursors and selections without DOM overhead, the session creates and manages a dedicated `<style data-sync-tex-awareness="<fileId>">` tag in `document.head`. Remote user selection backgrounds and cursor head borders are dynamically injected:
  ```css
  .yRemoteSelection-<clientId> {
    background-color: rgba(r, g, b, 0.18);
  }
  .yRemoteSelectionHead-<clientId> {
    border-left-color: #color;
    border-left-width: 2px;
    border-left-style: solid;
  }
  ```

---

### 4.5 Monaco Editor Configuration & Syntax Highlighting

#### 4.5.1 Initialization & Themes (`setupMonaco.js`)
Monaco is initialized once via a singleton loader promise (`loader.init()`). The setup registers:
- Custom dark theme (`app-dark` based on Monokai).
- Custom light theme (`app-light` based on GitHub Light).
- Custom Monarch tokenizer for the `latex` language ID.

#### 4.5.2 LaTeX Monarch Tokenizer (`monarchLatex.js`)
Implements lexical tokenization for LaTeX documents:
- **Comments**: Matches `%...` to `comment`.
- **Commands**: Matches `\\[a-zA-Z@]+` to `keyword`.
- **Brackets & Delimiters**: Tokenizes `{`, `}`, `[`, `]`, `(`, `)`.
- **Inline Math Mode**: Enters a dedicated `@math` tokenizer state on `$`, styling math operators (`=`, `+`, `-`, `*`, `/`, `^`, `_`), numbers, and math strings until exiting on the closing `$`.
- **Paired Auto-Closing Delimiters**: Configures auto-closing pairs for `{}`, `[]`, `()`, and `$$`.

---

### 4.6 AI Writing Assistant Subsystem (`assistant-service` Integration)

The AI assistant provides contextual writing assistance directly inside the IDE workspace.

#### 4.6.1 BYOK Provider Key Management (`LLMPanel`)
- Supports multiple LLM providers: **Anthropic**, **OpenAI**, **Google Gemini**, **Mistral**, **Cohere**.
- Fetches supported providers via `GET /api/llm/v1/providers` (public).
- Fetches active key statuses via `GET /api/llm/v1/keys`.
- Upserts encrypted keys via `PUT /api/llm/v1/keys` (`{ provider, api_key }`).
- Deletes keys via `DELETE /api/llm/v1/keys/:provider`.
- Keys are masked in the UI and never returned in plain text by the backend.

#### 4.6.2 Chat Session & SSE Streaming (`ChatWindow`, `MessageList`, `llm.js`)
- **System Prompt Construction**: Dynamically builds a contextual prompt embedding the name of the file currently open in the editor.
- **Server-Sent Events (SSE) Stream Handling**:
  `streamChat` sends a `POST /api/llm/v1/chat/stream` request containing `chat_id`, `message`, `system_prompt`, and `max_tokens`. It reads the streaming body using a `ReadableStreamDefaultReader` and `TextDecoder`:
  - Parses incoming `data: {"chunk": "..."}` lines and updates the stream buffer.
  - Parses `data: {"done": true}` to finalize the assistant response and auto-generate chat titles on first turn.
  - Parses `data: {"error": "..."}` to display inline error banners.
  - Returns an `AbortController` allowing the user to abort generation mid-stream.
- **Rich Message Rendering**:
  - Assistant bubbles parse Markdown via `ReactMarkdown` and `remark-gfm`.
  - LaTeX, Python, JSON, and generic code blocks are highlighted using `react-syntax-highlighter` (Prism `vscDarkPlus`).
  - Supports Markdown headings, lists, blockquotes, links, and tables.
  - Smooth auto-scrolling pinned to the message bottom during active token generation.

---

### 4.7 Theme Subsystem (`ThemeContext`, `SettingsView`)

- **Supported Preferences**: `system`, `light`, `dark` (stored in `localStorage['theme_preference']`).
- **System Theme Matching**: Uses `window.matchMedia('(prefers-color-scheme: dark)')` to dynamically resolve the active theme when set to `system`.
- **DOM Injection**: Sets `document.documentElement.dataset.theme = resolvedTheme` and `document.documentElement.style.colorScheme = resolvedTheme`.
- **CSS Custom Properties**: All UI components, sidebars, borders, active states, and editor backgrounds bind to global CSS variables (`--bg-primary`, `--bg-secondary`, `--text-primary`, `--accent-color`, etc.), enabling seamless theme transitions without page reloads.

---

### 4.8 Prefetching & Performance Optimizations

To ensure instant UI transitions on low-power devices and network latency, the application implements multi-tier prefetching:

- **Idle Route Prefetching (`scheduleIdleWarmup.js`)**: Wraps browser `requestIdleCallback` (with a `setTimeout` fallback).
  - On `DashboardView` mount, schedules a background prefetch of `EditorView`.
  - On `EditorView` mount, schedules a background prefetch of the AI panel modules (`ChatSidebar`, `ChatWindow`, `MessageList`).
- **User Intent Warmup**:
  - Hovering, focusing, or pointer-down interactions on dashboard project cards triggers `warmEditorRoute()`.
  - Hovering or focusing the AI Assistant icon on the `ActivityBar` triggers `warmAIPanel()`.

---

## 5. Microservice Interactions & API Contracts

The frontend interacts with backend services through the Nginx API gateway. All REST requests (except public endpoints) include the user's JWT in the `Authorization: Bearer <token>` header.

| Microservice | Gateway Path | Protocol / Method | Description |
|---|---|---|---|
| `users-service` | `/auth/register` | `POST` | User registration |
| `users-service` | `/auth/login` | `POST` | Password login, returns JWT token |
| `users-service` | `/auth/me` | `GET` | Validates JWT token and fetches current user profile |
| `users-service` | `/auth/logout` | `POST` | Server-side session invalidation |
| `users-service` | `/auth/:provider/login` | Browser Navigation | Redirects to GitHub/Google OAuth authorization |
| `projects-service` | `/projects/v1/projects` | `GET` | Lists projects for the authenticated user |
| `projects-service` | `/projects/v1/projects` | `POST` | Creates a new project |
| `projects-service` | `/projects/v1/projects/import` | `POST` (Multipart) | Imports a project from an uploaded zip file |
| `projects-service` | `/projects/v1/projects/:id/tree` | `GET` | Fetches directory tree and file metadata |
| `projects-service` | `/projects/v1/projects/:id/files` | `POST` | Registers a new file and returns presigned upload URL |
| `projects-service` | `/projects/v1/projects/:id/directories` | `POST` | Creates a new directory |
| `projects-service` | `/projects/v1/projects/:id/files/:fileId` | `PATCH`, `DELETE` | Renames or deletes a file |
| `projects-service` | `/projects/v1/projects/:id/directories/:dirId` | `PATCH`, `DELETE` | Renames or deletes a directory |
| `projects-service` | `/projects/v1/projects/:id/files/:fileId/upload` | `POST` | Obtains a presigned S3 URL for file saving |
| `projects-service` | `/projects/v1/projects/:id/invites` | `POST` | Generates a token-based project invite link |
| `projects-service` | `/projects/v1/projects/:id/collaborators/links` | `GET` | Lists active project invite links |
| `projects-service` | `/projects/v1/projects/:id/collaborators/links/:linkId` | `DELETE` | Revokes an invite link |
| `projects-service` | `/projects/v1/projects/:id/collaborators` | `GET` | Lists active project collaborators |
| `projects-service` | `/projects/v1/projects/:id/collaborators/:userId` | `DELETE` | Removes a collaborator from the project |
| `projects-service` | `/projects/v1/invites/accept` | `POST` | Validates invite token and adds user to project |
| `collab-service` | `/ws/:fileId` | `WebSocket` (Binary) | Real-time Yjs CRDT synchronization and awareness |
| `assistant-service` | `/api/llm/v1/providers` | `GET` | Lists supported LLM providers (public) |
| `assistant-service` | `/api/llm/v1/keys` | `GET`, `PUT` | Lists configured keys or upserts provider API key |
| `assistant-service` | `/api/llm/v1/keys/:provider` | `DELETE` | Deletes a provider API key |
| `assistant-service` | `/api/llm/v1/settings` | `GET`, `PATCH` | Retrieves or updates default LLM settings |
| `assistant-service` | `/api/llm/v1/usage` | `GET` | Fetches token usage statistics |
| `assistant-service` | `/api/llm/v1/chats` | `GET`, `POST` | Lists project chats or creates a new chat |
| `assistant-service` | `/api/llm/v1/chats/:chatId` | `DELETE` | Deletes a chat session |
| `assistant-service` | `/api/llm/v1/chats/:chatId/messages` | `GET` | Retrieves chat message history |
| `assistant-service` | `/api/llm/v1/chat/stream` | `POST` (SSE) | Streams LLM completions via Server-Sent Events |
| MinIO (S3 API) | Direct presigned URL | `GET` | Direct download of text file contents or image assets |
| MinIO (S3 API) | Direct presigned URL | `PUT` | Direct binary upload of saved text files or raw images |

---

## 6. Security, Resilience & Access Control

### 6.1 Role-Based UI Gating (RBAC)
When loading a project in `EditorView`, the backend returns the user's project role (`owner`, `editor`, or `viewer`):
- **Viewer Role**:
  - Monaco editor is set to `readOnly: true`.
  - Context menu file/folder creation, item deletion, item renaming, and image uploading are disabled.
  - Manual save shortcuts (`Ctrl+S` / `Cmd+S`) are prevented.
  - `collab-service` rejects mutation frames from viewer connections while maintaining read sync and presence.

### 6.2 Token Security & Expiration
- Access tokens are stored in browser `localStorage`.
- Unauthenticated or expired requests (HTTP 401) encountered during `checkAuth()` automatically flush stored tokens and redirect to `/login`.
- Query parameter tokens from OAuth handshakes or invite links are sanitized from URL query strings immediately after extraction to prevent token leakage in browser history or referrer headers.

### 6.3 External Content & Link Isolation
- All external links rendered via Markdown in `MessageList` or `LegalView` enforce `target="_blank"` and `rel="noopener noreferrer"` attributes.
- Image previews are loaded via isolated S3 presigned URLs without rendering untrusted external image scripts.
