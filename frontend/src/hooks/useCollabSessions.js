import { useRef, useState, useCallback, useEffect } from 'react';
import { createCollabSession } from '../api/session';



/**
 * Manages collab-service WebSocket sessions for open files.
 *
 * Responsibilities:
 *   - Opening/closing sessions per file
 *   - Binding a session to a Monaco editor instance
 *   - Tracking per-file connection status for UI indicators
 */
export function useCollabSessions({ projectId, getToken, user = null }) {
  // Map of fileId -> session object from createCollabSession().
  // Ref (not state) because mutations don't need re-renders.
  const collabSessions = useRef({});

  // Track which *session instance* is bound, not just the file ID.
  // This ensures a new session (after close+reopen) always triggers bindEditor.
  const boundSessions = useRef(new Map()); // fileId -> session object

  // fileId statuses: 'connecting' | 'connected' | 'disconnected'
  const [collabStatus, setCollabStatus] = useState({});

  // fileId -> awareness users for currently open collaborative sessions
  const [liveEditorsByFile, setLiveEditorsByFile] = useState({});

  // Track which files have a live Monaco binding to avoid double-binding
  const boundFiles = useRef(new Set());

  const openCollabSession = useCallback((file) => {
    //if (collabSessions.current[file.id]) return; // Handle already open
    if (collabSessions.current[file.id]) {
      console.warn('[collab] session already exists for', file.id, '— skipping open');
      return;
    }

    const token = getToken();
    if (!token) {
      console.error('[collab] no auth token available');
      return;
    }

    const session = createCollabSession({
      fileId: file.id,
      projectId,
      token,
      user,
      onStatus: (status) => {
        setCollabStatus((prev) => ({ ...prev, [file.id]: status }));
        if (status !== 'connected') {
          setLiveEditorsByFile((prev) => ({ ...prev, [file.id]: [] }));
          return;
        }

        const users = collabSessions.current[file.id]?.getAwarenessUsers?.() || [];
        setLiveEditorsByFile((prev) => ({ ...prev, [file.id]: users }));
      },
      onAwarenessChange: (users) => {
        setLiveEditorsByFile((prev) => ({ ...prev, [file.id]: users }));
      },
    });

    collabSessions.current[file.id] = session;
  }, [projectId, getToken, user]);

  const closeCollabSession = useCallback((fileId) => {
    const session = collabSessions.current[fileId];
    if (!session) return;

    session.destroy();
    boundSessions.current.delete(fileId);
    //boundFiles.current.delete(fileId);
    delete collabSessions.current[fileId];

    setCollabStatus((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });

    setLiveEditorsByFile((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  }, []);

  /**
   * Bind the active file's session to a Monaco editor instance.
   * Safe to call on every editor mount and every tab switch
   * it's a no-op if already bound or if there's no session.
   */
const bindActiveSession = useCallback((editor, activeTabId, isCollab, _attempt = 0) => {
  if (!isCollab || !activeTabId) return;

  const session = collabSessions.current[activeTabId];
  if (!session) return;

  // Skip only if this exact session instance is already bound
  if (boundSessions.current.get(activeTabId) === session) return;

  const ok = session.bindEditor(editor);
  if (ok) {
    console.log('[collab] bound session to editor for', activeTabId);
    boundSessions.current.set(activeTabId, session);
  } else if (_attempt < 10) {
    // Model not ready yet — retry, but only if this session is still active
    setTimeout(() => {
      if (collabSessions.current[activeTabId] === session) {
        bindActiveSession(editor, activeTabId, isCollab, _attempt + 1);
      }
    }, 50);
  } else {
    console.error('[collab] bindEditor failed after 10 attempts for', activeTabId);
  }
}, []);


  // Tear down all sessions on unmount
  useEffect(() => {
    return () => {
      Object.keys(collabSessions.current).forEach(closeCollabSession);
    };
  }, [closeCollabSession]);

  return {
    collabSessions,   // ref — read .current[fileId] to get a session
    collabStatus,     // state — fileId to status string
    liveEditorsByFile,
    openCollabSession,
    closeCollabSession,
    bindActiveSession,
  };
}
