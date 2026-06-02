import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';



function getWsBase() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

// How long to wait before attempting a reconnect after a dropped connection.
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

const AWARENESS_COLORS = [
  '#1f80dd',
  '#0f9f6e',
  '#c2410c',
  '#7c3aed',
  '#be123c',
  '#047857',
  '#b45309',
  '#2563eb',
];

function colorForUserId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return AWARENESS_COLORS[Math.abs(hash) % AWARENESS_COLORS.length];
}

function normalizeAwarenessUser(input) {
  const source = input ?? {};
  const rawId = source.id ?? source.user_id ?? source.sub ?? 'local-user';
  const id = String(rawId);
  const email = typeof source.email === 'string' ? source.email : '';
  const rawName = source.name || source.display_name || source.username || email || 'Local User';

  return {
    id,
    name: String(rawName),
    email,
    color: typeof source.color === 'string' ? source.color : colorForUserId(id),
  };
}

/**
 * Create a collaborative editing session for one file.
 *
 * @param {object} opts
 * @param {string}   opts.fileId    - Used as the doc_id path parameter
 * @param {string}   opts.projectId - Unused by the WS server but kept for
 *                                    potential future auth/routing use
 * @param {string}   opts.token     - JWT passed as a query param for auth
 * @param {function} opts.onStatus  - Called with 'connecting'|'connected'|'disconnected'
 * @param {object=}  opts.user      - Optional authenticated user metadata
 * @param {object=}  opts.localUser - Optional explicit awareness user metadata
 *
 * @returns {{ bindEditor, getContent, destroy }}
 */
export function createCollabSession({ fileId, projectId, token, onStatus, user = null, localUser = null }) {
  // Each file gets its own Y.Doc — they must not be shared across files.
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  const awareness = new Awareness(ydoc);
  const awarenessUser = normalizeAwarenessUser(localUser ?? user);
  awareness.setLocalStateField('user', awarenessUser);

  let ws = null;
  let binding = null;        // MonacoBinding instance, set in bindEditor()
  let destroyed = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;

  function sendAwarenessUpdate(clientIds) {
    if (!ws || ws.readyState !== WebSocket.OPEN || clientIds.length === 0) {
      return;
    }

    const update = encodeAwarenessUpdate(awareness, clientIds);
    const msg = new Uint8Array(1 + update.length);
    msg[0] = 1; // MsgAwareness
    msg.set(update, 1);
    ws.send(msg);
  }

  // Connect (or reconnect) to the collab-service WebSocket.
  function connect() {
    if (destroyed) return;

    onStatus('connecting');
    const url = `${getWsBase()}/ws/${fileId}?projectId=${projectId}&token=${encodeURIComponent(token)}`;
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer'; // Yjs works with ArrayBuffer, not Blob

    ws.onopen = () => {
      reconnectAttempts = 0;
      onStatus('connected');
      sendAwarenessUpdate([awareness.clientID]);
      // No handshake needed — the server sends the current document state
      // as a Yjs binary update immediately on connect. We just wait for it.
    };

    ws.onmessage = (event) => {
      const msg = new Uint8Array(event.data);

      if (msg.length < 1) return;

      const outerType = msg[0];

      console.log(`[collab:${fileId}] raw msg — length=${msg.length} outer=${outerType} second=${msg[1]}`);

      if (outerType === 0) {
        // MsgSync — check inner type
        if (msg.length < 2) return;
        const innerType = msg[1];
        const payload = msg.slice(2);

        if (innerType === 1) {
          // SyncStep2 — this is the compact snapshot, strip envelope and apply
          console.log(`[collab:${fileId}] applying SyncStep2 snapshot (${payload.length} bytes)`);
          Y.applyUpdate(ydoc, payload, 'remote');
        } else if (innerType === 2) {
          // SyncUpdate — incremental update, payload only
          console.log(`[collab:${fileId}] applying update (${payload.length} bytes)`);
          Y.applyUpdate(ydoc, payload, 'remote');
        }
      } else if (outerType === 1) {
        if (msg.length < 2) return;
        applyAwarenessUpdate(awareness, msg.slice(1), 'remote');
      }
    };

    ws.onclose = () => {
      onStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error(`[collab:${fileId}] WebSocket error`, err);
      // onclose fires right after onerror, which handles reconnect.
    };
  }

  function scheduleReconnect() {
    if (destroyed) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(`[collab:${fileId}] Max reconnect attempts reached`);
      return;
    }
    reconnectAttempts++;
    console.log(`[collab:${fileId}] reconnect attempt ${reconnectAttempts}`);
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  }

  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin === 'remote') return;
    sendAwarenessUpdate(added.concat(updated, removed));
  });

  // Observe local Y.Doc changes and forward them to the server.
  // This fires whenever the local user edits (via MonacoBinding) or when
  // a remote update is applied — but Y.js marks remote-origin updates with
  // a transaction origin so we can skip re-broadcasting them.
  ydoc.on('update', (update, origin) => {
    console.log('[update] origin:', origin, 'readyState:', ws?.readyState);
    if (origin === 'remote') {
      console.log('[update] skipping remote origin');
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[update observer] WebSocket not open — update dropped');
      return;
    }
    
    // Collab-service expects Yjs wire format: [MsgSync=0x00, SyncUpdate=0x02, ...payload]
    // Raw Y.Doc update bytes alone won't parse correctly on the server.
    const msg = new Uint8Array(2 + update.length);
    msg[0] = 0;  // MsgSync
    msg[1] = 2;  // SyncUpdate
    msg.set(update, 2);
    console.log('[update] SENDING to server, bytes:', msg.length, 'first bytes:', msg[0], msg[1]);
    ws.send(msg);
  });


  ytext.observe(() => {
    console.log('YTEXT CHANGE');
  });

  /**
   * Attach MonacoBinding to a Monaco editor instance.
   * Call this from the editor's onMount callback.
   * Safe to call multiple times — rebinds if the editor is remounted.
   */
  function bindEditor(editor) {
    // Tear down any previous binding (e.g. editor remount after tab switch).
    if (binding) {
      binding.destroy();
      binding = null;
    }

    const model = editor.getModel();
    if (!model) {
      console.warn(`[collab:${fileId}] Editor has no model yet`);
      return false;
    }

    console.log('Binding to model', model.id);

    // MonacoBinding keeps the Monaco model in sync with ytext bidirectionally.
    // It replaces the model's content with the current Y.Doc state on attach,
    // so whatever the server sent us on connect is immediately reflected.
    console.log('[collab] creating MonacoBinding for', fileId);
    binding = new MonacoBinding(ytext, model, new Set([editor]), awareness);
    return true;
    editor.onDidChangeModelContent(() => {
      console.log('MONACO CHANGE DETECTED');
    });
  }

  /**
   * Return the current plain-text content of the document.
   * Reads directly from the Y.Doc, not from the Monaco model.
   */
  function getContent() {
    return ytext.toString();
  }

  /**
   * Tear down the session — close WebSocket, destroy Yjs doc and binding.
   * Called on tab close and component unmount.
   */
  function destroy() {
    if (destroyed) return;
    if (ws && ws.readyState === WebSocket.OPEN && awareness.getLocalState() !== null) {
      awareness.setLocalState(null);
    }

    destroyed = true;
    clearTimeout(reconnectTimer);
    if (binding) { binding.destroy(); binding = null; }
    if (ws) { ws.close(); ws = null; }
    awareness.destroy();
    ydoc.destroy();
  }

  // Kick off the initial connection.
  connect();

  return { bindEditor, getContent, destroy };
}
