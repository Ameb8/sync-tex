// One collab session per open collaborative tab.
// Owns the Y.Doc, WebsocketProvider, MonacoBinding, and the
// save-signal/ACK protocol with the relay server.
//
// Lifecycle:
//   create  → on file tab open  (if project.is_collab)
//   bind    → after Monaco editor mounts / tab becomes active
//   destroy → on tab close or component unmount

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';

const SIG_BYTE = 0xFF;
const WS_BASE  = import.meta.env.VITE_COLLAB_WS_URL || '/ws';

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * createCollabSession
 *
 * @param {object} opts
 * @param {string}   opts.fileId     — doc ID sent in the WS path  /ws/<fileId>
 * @param {string}   opts.projectId  — passed as ?projectId= for server auth
 * @param {string}   opts.token      — JWT, passed as ?token= (y-websocket can't set headers)
 * @param {Function} opts.onSave     — (content: string) => Promise<void>
 *                                     Called when the relay nominates us to save.
 *                                     Should call saveFileContent() from api/editor.js.
 * @param {Function} [opts.onStatus] — (status: 'connecting'|'connected'|'disconnected') => void
 *                                     Optional; drives UI indicator in EditorView.
 */
export function createCollabSession({ fileId, projectId, token, onSave, onStatus }) {
  const ydoc  = new Y.Doc();
  const ytext = ydoc.getText('content');

  // Token as query param — y-websocket cannot set request headers.
  // The relay reads ?token= for auth before upgrading the connection.
  const url = `${WS_BASE}/${fileId}?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`;


  const provider = new WebsocketProvider(url, fileId, ydoc, {
    connect: true,
  });

  let binding    = null;
  let isSaving   = false;

  // ── Status forwarding ───────────────────────────────────────────────────
  if (onStatus) {
    provider.on('status', ({ status }) => onStatus(status));
  }

  // ── Save signal + ACK ───────────────────────────────────────────────────
  //
  // The relay sends [0xFF, 's','a','v','e'] to nominate this client as saver.
  // We respond with [0xFF, 'a','c','k'] after the REST save completes.
  //
  // On save failure we do NOT send the ACK — the relay will time out and
  // retry with the next eligible client.
  //
  // If we receive a second signal while already saving (relay retry during a
  // slow upload) we send a provisional ACK immediately so the relay doesn't
  // also nominate someone else, causing a double-write.

  function sendACK() {
    const ws = provider.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // [0xFF, 'a', 'c', 'k']
    ws.send(new Uint8Array([SIG_BYTE, 0x61, 0x63, 0x6B]));
  }

  async function handleSaveSignal() {
    if (isSaving) {
      // Already in progress — send provisional ACK to suppress relay retry
      sendACK();
      return;
    }
    isSaving = true;
    try {
      await onSave(ytext.toString());
      sendACK();
    } catch (err) {
      console.error('[collab] save failed, withholding ACK so relay retries:', err);
      // Deliberately no ACK — relay will nominate another client
    } finally {
      isSaving = false;
    }
  }

  function attachSignalListener(ws) {
    if (!ws) return;
    ws.addEventListener('message', (event) => {
      // y-websocket delivers messages as ArrayBuffer
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      // 0xFF is our relay signal byte — never produced by the Yjs protocol
      if (bytes[0] !== SIG_BYTE) return;
      const payload = new TextDecoder().decode(bytes.slice(1));
      if (payload === 'save') handleSaveSignal();
    });
  }

  // Attach on initial connection and re-attach after every reconnect
  // y-websocket creates a fresh WebSocket instance on reconnect.
  provider.on('status', ({ status }) => {
    if (status === 'connected') attachSignalListener(provider.ws);
  });
  // Also try immediately in case we're already connected
  attachSignalListener(provider.ws);

  
  // Public API
  return {
    ydoc,
    provider,
    ytext,

    /**
     * bindEditor — call after Monaco mounts or when switching to this tab.
     *
     * IMPORTANT: when a collab session is active, do NOT pass `value` to the
     * <Editor> component. MonacoBinding owns the model content; React's
     * controlled `value` prop will fight it and cause cursor jumps / doubled
     * edits. Pass `value={undefined}` for collab files.
     */
    bindEditor(monacoEditor) {
      if (binding) {
        binding.destroy();
        binding = null;
      }
      const model = monacoEditor.getModel();
      if (!model) return;
      binding = new MonacoBinding(
        ytext,
        model,
        new Set([monacoEditor]),
        provider.awareness,  // syncs remote cursors
      );
    },

    /** Current document content from Yjs — use for manual saves. */
    getContent() {
      return ytext.toString();
    },

    /** Tear down everything. Call on tab close or component unmount. */
    destroy() {
      binding?.destroy();
      provider.disconnect();
      provider.destroy();
      ydoc.destroy();
    },
  };
}

