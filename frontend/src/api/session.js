import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';

const SIG_BYTE = 0xFF;

export function createCollabSession({ fileId, projectId, token, onSave, onStatus }) {
  // Create Yjs CRDT document
  const ydoc  = new Y.Doc();
  const ytext = ydoc.getText('content');

  // Build full URL with auth params
  const WS_BASE = import.meta.env.VITE_COLLAB_WS_URL
    || `ws://${window.location.host}/ws`;

  const url = `${WS_BASE}/${fileId}?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`;

  console.log('[collab] connecting to', url);

  const provider = new WebsocketProvider(url, '', ydoc, {
    connect: true,
    // Slow down reconnect attempts so a rejection loop doesn't spam the server.
    WebSocketPolyfill: undefined,
    resyncInterval: -1, // disable periodic resync — not needed without server-side state
  });

  let binding  = null;
  let isSaving = false;

  // Debug: log every status change and close event
  provider.on('status', ({ status }) => {
    console.log(`[collab] ${fileId} status:`, status);
    if (onStatus) onStatus(status);
  });

  // get y-websocket close codes
  const origConnect = provider._connect?.bind(provider)
    || provider.connect?.bind(provider);

  provider.on('connection-close', (event) => {
    console.warn(`[collab] connection closed — code: ${event.code}, reason: "${event.reason}", wasClean: ${event.wasClean}`);
    // Common close codes:
    //   1000 = normal closure
    //   1006 = abnormal (server dropped without close frame — auth rejected before upgrade)
    //   1008 = policy violation (our 403 case, but browsers often show 1006)
    // If code is 1006 repeatedly, the server is rejecting before WS upgrade —
  });

  provider.on('connection-error', (event) => {
    console.error('[collab] connection error:', event);
  });

  // ── Save signal + ACK ───────────────────────────────────────────────────
  function sendACK() {
    const ws = provider.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(new Uint8Array([SIG_BYTE, 0x61, 0x63, 0x6B]));
  }

  async function handleSaveSignal() {
    if (isSaving) { sendACK(); return; }
    isSaving = true;
    try {
      await onSave(ytext.toString());
      sendACK();
    } catch (err) {
      console.error('[collab] save failed, withholding ACK:', err);
    } finally {
      isSaving = false;
    }
  }

  function attachSignalListener(ws) {
    if (!ws) return;
    ws.addEventListener('message', (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      if (bytes[0] !== SIG_BYTE) return;
      const payload = new TextDecoder().decode(bytes.slice(1));
      if (payload === 'save') handleSaveSignal();
    });
  }

  provider.on('status', ({ status }) => {
    if (status === 'connected') attachSignalListener(provider.ws);
  });
  attachSignalListener(provider.ws);

  // Public API
  return {
    ydoc,
    provider,
    ytext,

    bindEditor(monacoEditor) {
      if (binding) { binding.destroy(); binding = null; }
      const model = monacoEditor.getModel();
      if (!model) return;

      // Seed Y.Doc from Monaco model content if Y.Doc is empty.
      // This covers the case where fetchFileContent ran before the WS
      // connected, so the model has content but Y.Doc doesn't yet.
      if (ytext.toString() === '' && model.getValue() !== '') {
        ydoc.transact(() => {
          ytext.insert(0, model.getValue());
        });
      }

      binding = new MonacoBinding(ytext, model, new Set([monacoEditor]), provider.awareness);
    },

    getContent() { return ytext.toString(); },

    destroy() {
      binding?.destroy();
      provider.disconnect();
      provider.destroy();
      ydoc.destroy();
    },
  };
}