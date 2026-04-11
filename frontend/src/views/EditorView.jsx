import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { loader } from '@monaco-editor/react';

import { registerLatexLanguage } from '../monaco/monarchLatex';
import darkTheme from '../monaco/themes/monokai.json';
import lightTheme from '../monaco/themes/github-light.json';

import { useAuth } from '../contexts/AuthContext';
import { useCollabSessions } from '../hooks/useCollabSessions';
import { useTabManager } from '../hooks/useTabManager';
import { useFileManager } from '../hooks/useFileManager';

import ActivityBar from '../components/Editor/ActivityBar';
import FileTree from '../components/Editor/FileTree';
import TabBar from '../components/Editor/TabBar';
import EditorPane from '../components/Editor/EditorPane';
import RightSidebar from '../components/Editor/RightSidebar';

import './EditorView.css';

// Monaco setup (runs once at module load)
loader.init().then((monaco) => {
  registerLatexLanguage(monaco);
  monaco.editor.defineTheme('app-dark', darkTheme);
  monaco.editor.defineTheme('app-light', lightTheme);
});

// Constants
const FILE_LANGUAGE_MAP = {
  tex: 'latex', bib: 'bibtex', pdf: 'text', txt: 'text',
  md: 'markdown', json: 'json', xml: 'xml', py: 'python',
  other: 'latex', js: 'javascript', ts: 'typescript', html: 'html', css: 'css',
};
const getLanguage = (fileType) => FILE_LANGUAGE_MAP[fileType] || 'latex';
const IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'image']);
const isImageType = (fileType) => IMAGE_TYPES.has(fileType?.toLowerCase());



/**
 * EditorView — orchestration only.
 *
 * This component's job is to:
 *   1. Own the three hooks (sessions, tabs, files)
 *   2. Derive the handful of "active tab" computed values
 *   3. Wire hooks together at the seams (e.g. tab close triggers session close)
 *   4. Pass results down to layout components as props
 *
 * It should NOT contain business logic. If you find yourself adding
 * non-trivial logic here, it belongs in a hook or a child component.
 */
const EditorView = () => {
  const { projectId } = useParams();
  const { getToken } = useAuth();

  // Project/loading state 
  const [isCollab, setIsCollab] = useState(false);
  const [loading, setLoading] = useState(true);

  // Dark mode
  const [isDarkMode, setIsDarkMode] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setIsDarkMode(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Activity bar
  const [sidebarPanel, setSidebarPanel] = useState('files'); // Which panel is shown
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mainPanel, setMainPanel] = useState(null); // Show editor when null

  // Toggle/switch sidebar panels
    const handlePanelToggle = useCallback((panelId, type) => {
    if (type === 'sidebar') {
      setSidebarOpen((open) => {
        if (sidebarPanel === panelId) return !open; // Toggle if same panel
        return true; // Open if different panel
      });
      setSidebarPanel(panelId);
    } else if (type === 'main') { // Return to editor clicking active main panel
      setMainPanel((current) => current === panelId ? null : panelId);
    }
  }, [sidebarPanel]);

  // Editor ref so bindActiveSession can receive it
  const editorRef = useRef(null);

  // Hooks
  const {
    collabSessions,
    collabStatus,
    openCollabSession,
    closeCollabSession,
    bindActiveSession,
  } = useCollabSessions({ projectId, getToken });

  // useFileManager is declared first so clearFileContent is available
  const {
    treeData,
    fileContents,
    unsavedFiles,
    isSaving,
    error,
    setError,
    refreshTree,
    setFileUrl,
    loadFileContent,
    clearFileContent,
    handleEditorChange,
    handleSaveFile,
    handleCreateFile,
    handleCreateFolder,
    handleDeleteItem,
    handleRenameItem,
    handleImageUpload,
  } = useFileManager({ projectId, collabSessions });

  // Tab close: tear down session and clear cached content.
  // Defined after fileManager so clearFileContent exists.
  const handleTabCloseWithCleanup = useCallback((tabId) => {
    closeCollabSession(tabId);
    clearFileContent(tabId);
  }, [closeCollabSession, clearFileContent]);

  const {
    openTabs,
    activeTabId,
    activeTab,
    addTab,
    handleTabSelect,
    handleTabClose,
  } = useTabManager({ onTabClose: handleTabCloseWithCleanup });

  // Handle initial load 
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        await refreshTree();
        setIsCollab(true);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [projectId]);

  // Handle save
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeTabId) handleSaveFile(activeTabId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, handleSaveFile]);

  // Handle file select
  const handleFileSelect = useCallback(async (file) => {
    // Already open — just switch
    if (openTabs.find((t) => t.id === file.id)) {
      handleTabSelect(file.id);
      return;
    }

    addTab(file);

    if (isImageType(file.file_type)) {
      setFileUrl(file.id, file.download_url);
      return;
    }

    if (isCollab) {
      openCollabSession(file);
    } else {
      try {
        await loadFileContent(file);
      } catch (err) {
        setError(`Failed to load file: ${err.message}`);
      }
    }
  }, [openTabs, isCollab, addTab, handleTabSelect, setFileUrl, openCollabSession, loadFileContent, setError]);

  // Handle editor mount 
  const handleEditorMount = useCallback((editor) => {
    editorRef.current = editor;
    bindActiveSession(editor, activeTabId, isCollab);
  }, [bindActiveSession, activeTabId, isCollab]);

  // Re-bind when switching to a tab whose session is already open
  useEffect(() => {
    if (editorRef.current) {
      bindActiveSession(editorRef.current, activeTabId, isCollab);
    }
  }, [activeTabId, bindActiveSession, isCollab]);

  // File CRUD handlers
  const handleCreateFileAndOpen = useCallback(async (parentFolderId, filename) => {
    const newFile = await handleCreateFile(parentFolderId, filename);
    if (newFile) {
      addTab(newFile);
      if (isCollab) openCollabSession(newFile);
    }
  }, [handleCreateFile, addTab, isCollab, openCollabSession]);

  const handleDeleteItemAndClose = useCallback(async (itemId, itemType) => {
    const ok = await handleDeleteItem(itemId, itemType);
    if (ok && itemType === 'file') handleTabClose(itemId);
  }, [handleDeleteItem, handleTabClose]);

  const handleImageUploadAndOpen = useCallback(async (parentFolderId, file) => {
    const newFile = await handleImageUpload(parentFolderId, file);
    if (newFile) addTab(newFile);
  }, [handleImageUpload, addTab]);

  // Derived state

  const isActiveImage      = activeTab ? isImageType(activeTab.file_type) : false;
  const isActiveCollab     = !!activeTabId && !isActiveImage && !!collabSessions.current[activeTabId];
  const activeCollabStatus = activeTabId ? (collabStatus[activeTabId] ?? null) : null;
  const activeContent      = (!isActiveCollab && activeTabId) ? (fileContents[activeTabId] ?? '') : '';
  const activeLanguage     = activeTab ? getLanguage(activeTab.file_type) : 'latex';
  const isActiveFileDirty  = !isActiveCollab && !!activeTabId && unsavedFiles.has(activeTabId);
  const imageUrl           = isActiveImage ? fileContents[activeTabId] : null;

  // Handle loading/error states
  if (loading) return <div className="editor-loading"><p>Loading project…</p></div>;
  if (error)   return <div className="editor-error"><p>Error: {error}</p></div>;

  return (
    <div className="editor-container">

      {/* Far-left icon strip */}
      <ActivityBar
        activeSidebarPanel={sidebarOpen ? sidebarPanel : null}
        activeMainPanel={mainPanel}
        onPanelToggle={handlePanelToggle}
      />
      <div
        className="side-panel"
        style={{ display: sidebarOpen && sidebarPanel === 'files' ? 'flex' : 'none' }}
      >
        <FileTree
          treeData={treeData}
          onFileSelect={handleFileSelect}
          activeFileId={activeTabId}
          onCreateFile={handleCreateFileAndOpen}
          onCreateFolder={handleCreateFolder}
          onDeleteItem={handleDeleteItemAndClose}
          onRenameItem={handleRenameItem}
          onTabClose={handleTabClose}
          onImageUpload={handleImageUploadAndOpen}
        />
      </div>

      {/* Main editor column — or a full-area main panel if one is active */}
      <div className="editor-main">
        {mainPanel ? (
          /*
            Main panel slot — renders instead of the editor, filling the full
            space between the activity bar and the right sidebar.
            To add a new main panel: add a branch here + entry in ActivityBar PANELS.
 
            Example:
            mainPanel === 'ai' && <AIAssistantPanel projectId={projectId} activeTab={activeTab} />
          */
          <div className="main-panel-content">
            {/* {mainPanel === 'ai' && <AIAssistantPanel projectId={projectId} activeTab={activeTab} />} */}
            <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>
              No panel registered for: {mainPanel}
            </div>
          </div>
        ) : (
          <>
            <TabBar
              tabs={openTabs}
              activeTabId={activeTabId}
              onTabSelect={handleTabSelect}
              onTabClose={handleTabClose}
              unsavedFiles={unsavedFiles}
            />
            <div className="editor-content">
              <EditorPane
                activeTab={activeTab}
                isActiveImage={isActiveImage}
                isActiveCollab={isActiveCollab}
                activeContent={activeContent}
                activeLanguage={activeLanguage}
                isDarkMode={isDarkMode}
                activeCollabStatus={activeCollabStatus}
                isActiveFileDirty={isActiveFileDirty}
                isSaving={isSaving}
                imageUrl={imageUrl}
                onMount={handleEditorMount}
                onChange={(value) => handleEditorChange(value, activeTabId)}
              />
            </div>
          </>
        )}
      </div>

      {/* Right sidebar */}
      <RightSidebar
        projectId={projectId}
        activeTab={activeTab}
        isActiveCollab={isActiveCollab}
        isActiveFileDirty={isActiveFileDirty}
        isSaving={isSaving}
        activeContent={activeContent}
        onSave={() => handleSaveFile(activeTabId)}
      />

    </div>
  );
};

export default EditorView;
