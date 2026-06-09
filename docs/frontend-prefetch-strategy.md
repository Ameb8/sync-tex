# Frontend Editor Prefetch Strategy

## Goal

Improve cold-load speed for new visitors while keeping project editing fast after login.

The login page must not download or execute editor-only dependencies. Editor dependencies should be fetched opportunistically after the user is authenticated and using the dashboard. AI/markdown dependencies should be fetched later, after the editor route is interactive or when the user shows intent to use the assistant.

Current production build observation:

```text
dist/assets/index-*.js   ~3.7 MB minified, ~1.05 MB gzip
dist/assets/index-*.css  ~124 KB minified, ~21 KB gzip
```

The large JS bundle is caused mainly by synchronous imports from `frontend/src/App.jsx`, which pull editor, collaboration, Monaco, AI, markdown, and syntax-highlighting code into the initial application chunk.

## Loading Policy

### Initial unauthenticated visit

Required:

- Load React app shell.
- Load router/auth/theme providers.
- Load login view and login CSS.
- Render login form quickly.

Must not load:

- `@monaco-editor/react`
- Monaco workers/editor setup
- `yjs`, `y-monaco`, `y-protocols`
- AI chat components
- `react-markdown`, `remark-gfm`, `react-syntax-highlighter`
- Dashboard/project editor components

### After successful login

Required:

- Navigate to dashboard.
- Make dashboard interactive first.
- Start low-priority editor-route prefetch during idle time.

The prefetch may download editor route chunks, but it should not make the login or dashboard experience slower.

### Dashboard

Required:

- Use idle prefetch for the editor route because editing is the primary product path.
- Optionally prefetch on stronger intent signals, such as hover/focus on a project card or "open project" link.

Must avoid:

- Blocking dashboard rendering on editor prefetch.
- Initializing Monaco at module load if that causes CPU work during dashboard idle time.

### Project editor route

Required:

- Load editor route immediately.
- Load Monaco and Yjs/collab dependencies as part of the editor route.
- Initialize Monaco once, idempotently, when the editor route or editor pane actually needs it.

### AI and markdown

Required:

- Keep AI markdown/syntax highlighting out of login and dashboard bundles.
- Prefer loading AI/markdown after editor route is interactive.
- Immediately load AI/markdown on AI panel hover, focus, or open if not already prefetched.

## Implementation Plan

### 1. Route-split the app

Update `frontend/src/App.jsx` so non-login routes use `React.lazy`.

Recommended initial split:

```jsx
import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import LoginView from './views/LoginView';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

const DashboardView = lazy(() => import('./views/DashboardView'));
const EditorView = lazy(() => import('./views/EditorView'));
const JoinView = lazy(() => import('./views/JoinView'));
const OAuthCallback = lazy(() => import('./views/OAuthCallback'));
const SettingsView = lazy(() => import('./views/SettingsView'));

function RouteFallback() {
  return <div className="route-loading">Loading...</div>;
}
```

Then wrap `Routes` with `Suspense`:

```jsx
<Suspense fallback={<RouteFallback />}>
  <Routes>
    {/* existing routes */}
  </Routes>
</Suspense>
```

Expected outcome:

- `/login` initial JS excludes editor and AI dependencies.
- Vite emits separate JS chunks for editor/dashboard/settings/etc.

### 2. Centralize warmup imports

Create `frontend/src/prefetch/warmups.js`.

Purpose:

- Keep dynamic import paths in one place.
- Make warmup functions reusable from dashboard/editor/activity controls.
- Avoid scattering magic `import()` calls across UI components.

Example:

```js
let editorWarmupPromise = null;
let aiWarmupPromise = null;

export function warmEditorRoute() {
  if (!editorWarmupPromise) {
    editorWarmupPromise = import('../views/EditorView');
  }

  return editorWarmupPromise;
}

export function warmAIPanel() {
  if (!aiWarmupPromise) {
    aiWarmupPromise = Promise.all([
      import('../components/Editor/AIPanel/ChatSidebar'),
      import('../components/Editor/AIPanel/ChatWindow'),
      import('../components/Editor/AIPanel/MessageList'),
    ]);
  }

  return aiWarmupPromise;
}
```

Notes:

- Keep promises module-scoped so repeated hovers or route renders do not start duplicate imports.
- If `EditorView` imports AI components synchronously, the AI code may still be included in the editor chunk. Split AI components before expecting `warmAIPanel()` to produce a separate chunk.

### 3. Add idle scheduling helper

Create `frontend/src/prefetch/scheduleIdleWarmup.js`.

Purpose:

- Use `requestIdleCallback` where available.
- Fall back to `setTimeout`.
- Return a cleanup function for React effects.

Example:

```js
export function scheduleIdleWarmup(callback, options = {}) {
  const timeout = options.timeout ?? 3000;
  const fallbackDelay = options.fallbackDelay ?? 1200;

  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, fallbackDelay);
  return () => window.clearTimeout(id);
}
```

### 4. Prefetch editor route from dashboard

Update `frontend/src/views/DashboardView.jsx`.

Add:

```jsx
import { useEffect } from 'react';
import { scheduleIdleWarmup } from '../prefetch/scheduleIdleWarmup';
import { warmEditorRoute } from '../prefetch/warmups';
```

Then:

```jsx
useEffect(() => {
  return scheduleIdleWarmup(() => {
    warmEditorRoute().catch((error) => {
      console.warn('Editor prefetch failed:', error);
    });
  }, {
    timeout: 4000,
    fallbackDelay: 1500,
  });
}, []);
```

Optional stronger intent prefetch:

- On project card hover.
- On project card focus.
- On pointer down before navigation.

Example:

```jsx
function handleProjectIntent() {
  warmEditorRoute().catch(() => {});
}
```

Pass this to project cards as `onMouseEnter`, `onFocus`, or `onPointerDown`.

### 5. Make Monaco initialization explicit and idempotent

Current issue:

- `frontend/src/views/EditorView.jsx` imports `loader` and calls `loader.init()` at module load.
- Once the editor route is prefetched, module-level code executes.
- That can start Monaco initialization while the user is only on the dashboard.

Create `frontend/src/monaco/setupMonaco.js`.

Example:

```js
import { loader } from '@monaco-editor/react';
import { registerLatexLanguage } from './monarchLatex';
import darkTheme from './themes/monokai.json';
import lightTheme from './themes/github-light.json';

let setupPromise = null;

export function setupMonaco() {
  if (!setupPromise) {
    setupPromise = loader.init().then((monaco) => {
      registerLatexLanguage(monaco);
      monaco.editor.defineTheme('app-dark', darkTheme);
      monaco.editor.defineTheme('app-light', lightTheme);
      return monaco;
    });
  }

  return setupPromise;
}
```

Then remove the module-level setup from `EditorView.jsx`.

Use one of these approaches:

- Call `setupMonaco()` in `EditorView` inside `useEffect`.
- Call `setupMonaco()` in `EditorPane` before rendering `<Editor>`.
- Use `beforeMount` or `onMount` behavior if the Monaco React wrapper supports the desired timing.

Recommended pragmatic implementation:

```jsx
useEffect(() => {
  setupMonaco().catch((error) => {
    console.error('Monaco setup failed:', error);
  });
}, []);
```

This initializes Monaco when the editor route actually mounts, not when the editor route is merely imported.

If faster first-file opening is more important than dashboard CPU idleness, add a separate `warmMonaco()` function and call it from dashboard idle time. Keep that as a deliberate product decision.

### 6. Split AI panel from editor route

If `EditorView.jsx` imports AI components synchronously, markdown/syntax-highlighter can remain in the editor chunk.

Change editor AI imports from:

```jsx
import ChatSidebar from '../components/Editor/AIPanel/ChatSidebar';
import ChatWindow from '../components/Editor/AIPanel/ChatWindow';
```

To:

```jsx
import { lazy, Suspense } from 'react';

const ChatSidebar = lazy(() => import('../components/Editor/AIPanel/ChatSidebar'));
const ChatWindow = lazy(() => import('../components/Editor/AIPanel/ChatWindow'));
```

Render those components under local `Suspense` boundaries only when the assistant panel or chat tab is visible.

Example:

```jsx
{sidebarPanel === 'assistant' && (
  <Suspense fallback={<div className="panel-loading">Loading assistant...</div>}>
    <ChatSidebar {...props} />
  </Suspense>
)}
```

Then prefetch AI code after editor mount:

```jsx
useEffect(() => {
  return scheduleIdleWarmup(() => {
    warmAIPanel().catch((error) => {
      console.warn('AI panel prefetch failed:', error);
    });
  }, {
    timeout: 5000,
    fallbackDelay: 2500,
  });
}, []);
```

Also trigger `warmAIPanel()` when the user hovers/focuses the assistant activity button.

### 7. Optional: Rollup manual chunks

Only add this after route splitting is working. Manual chunks improve caching and chunk naming, but they do not replace lazy imports.

Update `frontend/vite.config.js`:

```js
build: {
  outDir: 'dist',
  emptyOutDir: true,
  rollupOptions: {
    output: {
      manualChunks(id) {
        if (!id.includes('node_modules')) return;

        if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
          return 'vendor-monaco';
        }

        if (
          id.includes('/yjs/') ||
          id.includes('/y-monaco/') ||
          id.includes('/y-protocols/') ||
          id.includes('/y-websocket/')
        ) {
          return 'vendor-yjs';
        }

        if (
          id.includes('/react-markdown/') ||
          id.includes('/remark-gfm/') ||
          id.includes('/react-syntax-highlighter/')
        ) {
          return 'vendor-markdown';
        }

        if (
          id.includes('/react/') ||
          id.includes('/react-dom/') ||
          id.includes('/react-router-dom/')
        ) {
          return 'vendor-react';
        }
      },
    },
  },
}
```

Validate chunking after this. Do not force too many small chunks; each chunk adds request overhead.

## Verification

Run:

```bash
cd frontend
npm run build
```

Expected build changes:

- Initial `index-*.js` should shrink significantly.
- Editor route should appear as one or more separate chunks.
- Monaco/Yjs should not be part of the login path.
- AI/markdown should not be part of the login path.

Recommended additional tooling:

```bash
cd frontend
npm install --save-dev rollup-plugin-visualizer
```

Then add a temporary analyzer plugin:

```js
import { visualizer } from 'rollup-plugin-visualizer';

plugins: [
  react(),
  visualizer({
    filename: 'dist/stats.html',
    gzipSize: true,
    brotliSize: true,
  }),
],
```

Do not commit analyzer output unless it is intentionally part of the project docs.

## Browser Testing

Test with Chrome DevTools:

1. Open an incognito window.
2. Open DevTools Network tab.
3. Enable "Disable cache".
4. Use throttling such as "Fast 3G" or "Slow 4G".
5. Visit `/login`.
6. Confirm no Monaco/Yjs/markdown chunks are downloaded.
7. Log in and land on dashboard.
8. Confirm editor chunks are fetched after idle time or project-card intent.
9. Open a project.
10. Confirm editor is usable and does not re-download prefetched chunks.
11. Open or hover the AI panel.
12. Confirm AI/markdown chunks load only at that stage.

Useful metrics:

- First Contentful Paint on `/login`.
- Largest Contentful Paint on `/login`.
- Time to Interactive on `/login`.
- JS transferred before login form becomes interactive.
- Time from project click to editor visible.
- Time from first AI panel open to first usable AI UI.

## Acceptance Criteria

Required:

- `/login` loads without Monaco, Yjs, AI, markdown, or syntax-highlighter chunks.
- Dashboard prefetch starts only after dashboard is interactive or on clear user intent.
- Editor route works if prefetch did not complete.
- Monaco setup is idempotent and does not run at module import time.
- AI/markdown code is not required for editor shell render.
- Production build completes without warnings that indicate accidental circular lazy imports.

Preferred:

- Initial login JS gzip size is under 250 KB.
- Editor route click feels fast after dashboard idle prefetch.
- AI panel first-open delay is hidden by editor-idle prefetch or hover intent.

## Non-Goals

- Do not server-render the React app as part of this change.
- Do not replace Monaco.
- Do not remove markdown rendering.
- Do not change auth behavior.
- Do not prefetch large editor assets before the login form is interactive.

## Rollback Plan

If lazy loading introduces regressions:

1. Revert route-level lazy imports first.
2. Keep `setupMonaco()` idempotent if it is stable; that change is independently useful.
3. Reintroduce AI synchronous imports only if lazy AI boundaries are the source of the bug.
4. Leave nginx caching/compression unchanged.

