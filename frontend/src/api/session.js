import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';



function getWsBase() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

// How long to wait before attempting a reconnect after a dropped connection.
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Create a collaborative editing session for one file.
 *
 * @param {object} opts
 * @param {string}   opts.fileId    - Used as the doc_id path parameter
 * @param {string}   opts.projectId - Unused by the WS server but kept for
 *                                    potential future auth/routing use
 * @param {string}   opts.token     - JWT passed as a query param for auth
 * @param {function} opts.onStatus  - Called with 'connecting'|'connected'|'disconnected'
 *
 * @returns {{ bindEditor, getContent, destroy }}
 */
export function createCollabSession({ fileId, projectId, token, onStatus }) {
  // Each file gets its own Y.Doc — they must not be shared across files.
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');

  let ws = null;
  let binding = null;        // MonacoBinding instance, set in bindEditor()
  let destroyed = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;

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
      // No handshake needed — the server sends the current document state
      // as a Yjs binary update immediately on connect. We just wait for it.
    };

    ws.onmessage = (event) => {
      const msg = new Uint8Array(event.data);

      if (msg.length < 1) return;

      const outerType = msg[0];

      if (outerType === 0) {
        // MsgSync — check inner type
        if (msg.length < 2) return;
        const innerType = msg[1];
        const payload = msg.slice(2);

        if (innerType === 1) {
          // SyncStep2 — this is the compact snapshot, strip envelope and apply
          console.log(`[collab:${fileId}] applying snapshot (${payload.length} bytes)`);
          Y.applyUpdate(ydoc, payload, 'remote');
        } else if (innerType === 2) {
          // SyncUpdate — incremental update, payload only
          console.log(`[collab:${fileId}] applying update (${payload.length} bytes)`);
          Y.applyUpdate(ydoc, payload, 'remote');
        }
        // SyncStep1 (innerType === 0) — server would never send this to us, ignore

      } else {
        // No envelope — raw update payload (existing update log entries)
        console.log(`[collab:${fileId}] applying raw payload (${msg.length} bytes)`);
        Y.applyUpdate(ydoc, msg, 'remote');
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
      return;
    }

    console.log('Binding to model', model.id);

    // MonacoBinding keeps the Monaco model in sync with ytext bidirectionally.
    // It replaces the model's content with the current Y.Doc state on attach,
    // so whatever the server sent us on connect is immediately reflected.
    console.log('[collab] creating MonacoBinding for', fileId);
    binding = new MonacoBinding(ytext, model, new Set([editor]), null);

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
    destroyed = true;
    clearTimeout(reconnectTimer);
    if (binding) { binding.destroy(); binding = null; }
    if (ws) { ws.close(); ws = null; }
    ydoc.destroy();
  }

  // Kick off the initial connection.
  connect();

  return { bindEditor, getContent, destroy };
}