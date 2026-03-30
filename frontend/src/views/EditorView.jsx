import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { loader } from '@monaco-editor/react';
import { activateTextmate, registerLatexLanguage } from '../monaco/textmateHighlighter';

import FileTree from '../components/Editor/FileTree';
import TabBar from '../components/Editor/TabBar';
import CollaboratorsPanel from '../components/Editor/CollaboratorsPanel';
import { createCollabSession } from '../api/session';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchProjectTree,
  fetchFileContent,
  saveFileContent,
  createFile,
  createFolder,
  deleteItem,
  renameItem,
} from '../api/editor';
import './EditorView.css';


// Pre-register latex so Monaco accepts it as a valid language ID
// before any editor instance mounts
loader.init().then(monaco => registerLatexLanguage(monaco));

// Constants
const getLanguage = (fileType) => ({
  tex: 'latex', bib: 'bibtex', pdf: 'text', txt: 'text',
  md: 'markdown', json: 'json', xml: 'xml', py: 'python',
  js: 'javascript', ts: 'typescript', html: 'html', css: 'css',
}[fileType] || 'text');
 
const EditorView = () => {
  const navigate = useNavigate();
  const { projectId }  = useParams();
  const { getToken }   = useAuth(); // pulls JWT for WS auth

  // Project / tree state
  const [treeData, setTreeData]           = useState([]);
  const [isCollab, setIsCollab]           = useState(false);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);

  // Tab state
  const [openTabs, setOpenTabs]           = useState([]);
  const [activeTabId, setActiveTabId]     = useState(null);

  // File content (non-collab files only) 
  // For collab files, content lives in the Y.Doc — we don't track it in React
  // state because MonacoBinding owns the Monaco model and 's  // `value` prop would fight it.
  const [fileContents, setFileContents]   = useState({});
  const [unsavedFiles, setUnsavedFiles]   = useState(new Set());
  const originalContentsRef               = useRef({});

  // Save state 
  const [isSaving, setIsSaving]           = useState(false);

  // Collab sessions 
  // Map of fileId → session object from createCollabSession().
  // Stored in a ref (not state) because mutations don't need re-renders.
  const collabSessions                    = useRef({});
  // Collab connection status per file — drives the UI indicator.
  const [collabStatus, setCollabStatus]   = useState({}); // fileId → 'connecting'|'connected'|'disconnected'

  // Editor ref 
  const editorRef                         = useRef(null);
  const boundFiles                        = useRef(new Set());
  const textmateActivated                 = useRef(false);

  // UI state 
  const [sidebarTab, setSidebarTab]       = useState('info');
  const [isDarkMode, setIsDarkMode]       = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  // Dark mode listener
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setIsDarkMode(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Load project tree
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchProjectTree(projectId);
        setTreeData(data.tree);
        //projects-service sets this when the project has >1 collaborator
        //setIsCollab(data.is_collab ?? false);

        // Temporary always set to collaborative mode
        setIsCollab(true);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [projectId]);


  // For collab files Ctrl+S triggers a manual save (same REST path, but reads
  // from the Y.Doc instead of React state). The server-signal save is the
  // primary path; Ctrl+S is a user-initiated override.
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeTabId) handleSaveFile();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, fileContents, unsavedFiles]);


  // Open collab-service connection
  const openCollabSession = useCallback((file) => {
    if (collabSessions.current[file.id]) return; // already open

    const token = getToken();
    if (!token) {
      console.error('[collab] no auth token available');
      return;
    }

    const session = createCollabSession({
      fileId:    file.id,
      projectId,
      token,
      onStatus: (status) => {
        setCollabStatus((prev) => ({ ...prev, [file.id]: status }));
      },
    });

    collabSessions.current[file.id] = session;
  }, [projectId, getToken]);

  // Close collab-service connection
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

  // Tear down all sessions on unmount
  useEffect(() => {
    return () => {
      Object.keys(collabSessions.current).forEach(closeCollabSession);
    };
  }, [closeCollabSession]);

  // Bind collab session to Monaco when editor mounts / tab changes
  // Called both from handleEditorMount (new mount) and from the activeTabId
  // effect below (tab switch to an already-open collab file).
  const bindActiveSession = useCallback((editor) => {
    console.log('[bind] attempt', { isCollab, activeTabId, hasSession: !!collabSessions.current[activeTabId] });
    if (!isCollab || !activeTabId) return;
    const session = collabSessions.current[activeTabId];
    if (!session) return;
    console.log('[bind] binding session to editor for', activeTabId);
    session.bindEditor(editor);
    // Switch model ownership to Yjs — value prop becomes undefined after this
    boundFiles.current.add(activeTabId);
  }, [isCollab, activeTabId]);

  useEffect(() => {
    if (!activeTabId) return; 
    if (editorRef.current) bindActiveSession(editorRef.current);
  }, [activeTabId, bindActiveSession]);


  // File select handling
  const handleFileSelect = useCallback(async (file) => {
    // Switch to existing tab or open new one
    const existing = openTabs.find((t) => t.id === file.id);
    if (existing) {
      setActiveTabId(file.id);
      return; // Content already loaded
    }

    setOpenTabs((prev) => [...prev, file]);
    setActiveTabId(file.id);

   if (isCollab) {
      // Collab path: session opens WS, server sends initial state as Yjs update.
      openCollabSession(file);
      // Editor may already be mounted from a previous tab — try binding now.
      // If editor isn't mounted yet, handleEditorMount will catch it.
      if (editorRef.current) {
          const session = collabSessions.current[file.id];
          if (session) {
              session.bindEditor(editorRef.current);
              boundFiles.current.add(file.id);
          }
      }
    } else {
      // Non-collab path: fetch content from REST API
      if (!fileContents[file.id]) {
        try {
          const content = await fetchFileContent(file.download_url);
          setFileContents((prev) => ({ ...prev, [file.id]: content }));
          originalContentsRef.current[file.id] = content;
        } catch (err) {
          setError(`Failed to load file: ${err.message}`);
        }
      }
    }
  }, [openTabs, fileContents, isCollab, openCollabSession]);


  // Unified save handler — works for both collab and non-collab files.
  // For collab files this is the manual Ctrl+S / button path.
  // The relay-signal path calls saveFileContent directly via onSave in the session.
  const handleSaveFile = useCallback(async () => {
    if (!activeTabId || isSaving) return;
    try {
      setIsSaving(true);

      let content;
      const session = collabSessions.current[activeTabId];
      if (session) {
        content = session.getContent();
      } else {
        content = fileContents[activeTabId];
      }

      await saveFileContent(projectId, activeTabId, content);

      // Only track unsaved state for non-collab files — for collab files
      // the Y.Doc is always the source of truth and the relay handles saves.
      if (!session) {
        setUnsavedFiles((prev) => {
          const next = new Set(prev);
          next.delete(activeTabId);
          return next;
        });
        originalContentsRef.current[activeTabId] = content;
      }
    } catch (err) {
      setError(`Error saving file: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [activeTabId, fileContents, projectId, isSaving]);

  // Editor mount 
  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    if (!textmateActivated.current) {
      textmateActivated.current = true;
      activateTextmate(monaco).catch(console.warn);
    }

    bindActiveSession(editor);
  }, [bindActiveSession]);

  // Editor change (non-collab only) 
  // For collab files MonacoBinding owns the model — onChange fires but we
  // ignore it to avoid stale React state fighting with Yjs.
  const handleEditorChange = useCallback((value) => {
    if (!activeTabId) return;
    if (collabSessions.current[activeTabId]) return; // Yjs owns this

    setFileContents((prev) => ({ ...prev, [activeTabId]: value || '' }));
    const changed = value !== originalContentsRef.current[activeTabId];
    setUnsavedFiles((prev) => {
      const next = new Set(prev);
      changed ? next.add(activeTabId) : next.delete(activeTabId);
      return next;
    });
  }, [activeTabId]);

  // Tab close
  const handleTabClose = useCallback((tabId) => {
    // Tear down collab session for this tab
    closeCollabSession(tabId);
    boundFiles.current.delete(tabId);

    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
      return remaining;
    });

    setFileContents((prev) => { const n = { ...prev }; delete n[tabId]; return n; });
    setUnsavedFiles((prev) => { const n = new Set(prev); n.delete(tabId); return n; });
    delete originalContentsRef.current[tabId];
  }, [activeTabId, closeCollabSession]);

  // Tab select

  const handleTabSelect = useCallback((tabId) => setActiveTabId(tabId), []);

  // File / folder CRUD
  const handleCreateFile = useCallback(async (parentFolderId, filename) => {
    try {
      const response = await createFile(projectId, parentFolderId, filename);
      const updated = await fetchProjectTree(projectId);
      setTreeData(updated.tree);
      if (response.file) {
        const f = response.file;
        setOpenTabs((prev) => [...prev, f]);
        setActiveTabId(f.id);
        setFileContents((prev) => ({ ...prev, [f.id]: '' }));
        setUnsavedFiles((prev) => new Set(prev).add(f.id));
        originalContentsRef.current[f.id] = '';
        if (isCollab) openCollabSession(f);
      }
    } catch (err) { setError(`Error creating file: ${err.message}`); }
  }, [projectId, isCollab, openCollabSession]);

  const handleCreateFolder = useCallback(async (parentFolderId, folderName) => {
    try {
      await createFolder(projectId, parentFolderId, folderName);
      const updated = await fetchProjectTree(projectId);
      setTreeData(updated.tree);
    } catch (err) { setError(`Error creating folder: ${err.message}`); }
  }, [projectId]);

  const handleDeleteItem = useCallback(async (itemId, itemType) => {
    try {
      await deleteItem(projectId, itemId, itemType);
      const updated = await fetchProjectTree(projectId);
      setTreeData(updated.tree);
      if (itemType === 'file') {
        closeCollabSession(itemId);
        setUnsavedFiles((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
        delete originalContentsRef.current[itemId];
      }
    } catch (err) { setError(`Error deleting ${itemType}: ${err.message}`); }
  }, [projectId, closeCollabSession]);

  const handleRenameItem = useCallback(async (itemId, itemType, newName) => {
    try {
      await renameItem(projectId, itemId, itemType, newName);
      const updated = await fetchProjectTree(projectId);
      setTreeData(updated.tree);
    } catch (err) { setError(`Error renaming ${itemType}: ${err.message}`); }
  }, [projectId]);

  // Derived state 

  const activeTab          = openTabs.find((t) => t.id === activeTabId);
  const isActiveCollab     = activeTabId && !!collabSessions.current[activeTabId];
  const activeCollabStatus = activeTabId ? (collabStatus[activeTabId] ?? null) : null;
  const activeContent      = activeTab && !isActiveCollab ? (fileContents[activeTabId] ?? '') : '';
  const activeLanguage     = activeTab ? getLanguage(activeTab.file_type) : 'text';
  const isActiveFileDirty  = !isActiveCollab && activeTabId && unsavedFiles.has(activeTabId);

  // Render 

  if (loading) return <div className="editor-loading"><p>Loading project...</p></div>;
  if (error)   return <div className="editor-error"><p>Error: {error}</p></div>;

  return (
    <div className="editor-container">

      {/* File tree */}
      <FileTree
        treeData={treeData}
        onFileSelect={handleFileSelect}
        activeFileId={activeTabId}
        onCreateFile={handleCreateFile}
        onCreateFolder={handleCreateFolder}
        onDeleteItem={handleDeleteItem}
        onRenameItem={handleRenameItem}
        onTabClose={handleTabClose}
      />

      {/* Main editor area */}
      <div className="editor-main">
        <TabBar
          tabs={openTabs}
          activeTabId={activeTabId}
          onTabSelect={handleTabSelect}
          onTabClose={handleTabClose}
          unsavedFiles={unsavedFiles}
        />

        <div className="editor-content">
          {activeTab ? (
            <>
              <Editor
                key={activeTabId}
                height="100%"
                language={activeLanguage}
                value={isActiveCollab ? undefined : activeContent}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                theme={isDarkMode ? 'vs-dark' : 'vs'}
                options={{
                  minimap:              { enabled: false },
                  fontSize:             13,
                  lineHeight:           1.6,
                  tabSize:              2,
                  wordWrap:             'on',
                  automaticLayout:      true,
                  scrollBeyondLastLine: false,
                  fontFamily:           "'Menlo', 'Monaco', 'Courier New', monospace",
                }}
              />

              {/* Collab connection status bar */}
              {isActiveCollab && (
                <div className={`collab-indicator collab-${activeCollabStatus}`}>
                  <span className="collab-dot">⬤</span>
                  {activeCollabStatus === 'connected'    && 'Live collaboration'}
                  {activeCollabStatus === 'connecting'   && 'Connecting…'}
                  {activeCollabStatus === 'disconnected' && 'Disconnected — attempting to reconnect'}
                </div>
              )}

              {/* Non-collab unsaved indicator */}
              {isActiveFileDirty && (
                <div className="save-indicator">
                  <span className="unsaved-dot">●</span>
                  <span className="save-hint">Press Ctrl+S to save</span>
                </div>
              )}

              {isSaving && <div className="saving-indicator">Saving…</div>}
            </>
          ) : (
            <div className="editor-empty"><p>Select a file to start editing</p></div>
          )}
        </div>
      </div>

      {/* Right sidebar */}
      <div className="editor-sidebar-right">
        <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>

          {/* Sidebar tab nav */}
          <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border-color, #e0e0e0)' }}>
            {/* Home button */}
            <button
              onClick={() => navigate('/')}
              className="home-button"
              title="Back to dashboard"
            >
              ← Dashboard
            </button>

            {[['info', 'Info'], ['collaborators', 'Share']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSidebarTab(key)}
                className={`sidebar-tab ${sidebarTab === key ? 'active' : ''}`}
                style={{
                  flex: 1, padding: '12px 16px', border: 'none', background: 'transparent',
                  color: sidebarTab === key ? 'var(--text-info, #1f80dd)' : 'var(--text-secondary, #666)',
                  fontSize: '13px', fontWeight: '500', cursor: 'pointer',
                  borderBottom: sidebarTab === key ? '2px solid var(--text-info, #1f80dd)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >{label}</button>
            ))}
          </div>

          {/* Info tab */}
          {sidebarTab === 'info' && (
            <div className="sidebar-content">
              {activeTab && (
                <>
                  <div className="info-card">
                    <p className="info-label">File</p>
                    <p className="info-value">
                      {activeTab.filename}
                      {isActiveFileDirty && <span className="unsaved-indicator">*</span>}
                    </p>
                  </div>
                  <div className="info-card">
                    <p className="info-label">Type</p>
                    <p className="info-value">{activeTab.file_type.toUpperCase()}</p>
                  </div>
                  {isActiveCollab ? (
                    <div className="info-card">
                      <p className="info-label">Mode</p>
                      <p className="info-value" style={{ color: 'var(--text-info, #1f80dd)' }}>
                        Live collaboration
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="info-card">
                        <p className="info-label">Size</p>
                        <p className="info-value">{(activeContent.length / 1024).toFixed(1)} KB</p>
                      </div>
                      <div className="info-card">
                        <p className="info-label">Lines</p>
                        <p className="info-value">{activeContent.split('\n').length}</p>
                      </div>
                    </>
                  )}
                  <div className="info-card">
                    <p className="info-label">Save</p>
                    <button
                      onClick={handleSaveFile}
                      disabled={(!isActiveCollab && !isActiveFileDirty) || isSaving}
                      className="save-button"
                      title="Save file (Ctrl+S)"
                    >
                      {isSaving ? '⏳ Saving…' : '💾 Save'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Collaborators tab */}
          {sidebarTab === 'collaborators' && <CollaboratorsPanel projectId={projectId} />}
        </div>
      </div>
    </div>
  );
};

export default EditorView;