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
export function useCollabSessions({ projectId, getToken }) {
  // Map of fileId -> session object from createCollabSession().
  // Ref (not state) because mutations don't need re-renders.
  const collabSessions = useRef({});

  // fileId statuses: 'connecting' | 'connected' | 'disconnected'
  const [collabStatus, setCollabStatus] = useState({});

  // Track which files have a live Monaco binding to avoid double-binding
  const boundFiles = useRef(new Set());

  const openCollabSession = useCallback((file) => {
    if (collabSessions.current[file.id]) return; // Handle already open

    const token = getToken();
    if (!token) {
      console.error('[collab] no auth token available');
      return;
    }

    const session = createCollabSession({
      fileId: file.id,
      projectId,
      token,
      onStatus: (status) => {
        setCollabStatus((prev) => ({ ...prev, [file.id]: status }));
      },
    });

    collabSessions.current[file.id] = session;
  }, [projectId, getToken]);

  const closeCollabSession = useCallback((fileId) => {
    const session = collabSessions.current[fileId];
    if (!session) return;

    session.destroy();
    boundFiles.current.delete(fileId);
    delete collabSessions.current[fileId];

    setCollabStatus((prev) => {
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
  const bindActiveSession = useCallback((editor, activeTabId, isCollab) => {
    if (!isCollab || !activeTabId) return;

    const session = collabSessions.current[activeTabId];
    if (!session) return;

    if (boundFiles.current.has(activeTabId)) return; // already bound

    console.log('[collab] binding session to editor for', activeTabId);
    session.bindEditor(editor);
    boundFiles.current.add(activeTabId);
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
    openCollabSession,
    closeCollabSession,
    bindActiveSession,
  };
}