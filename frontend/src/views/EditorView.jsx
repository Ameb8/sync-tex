import { lazy, Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useCollabSessions } from '../hooks/useCollabSessions';
import { useTabManager } from '../hooks/useTabManager';
import { useFileManager } from '../hooks/useFileManager';
import { useChatManager } from '../hooks/useChatManager';
import { setupMonaco } from '../monaco/setupMonaco';
import { scheduleIdleWarmup } from '../prefetch/scheduleIdleWarmup';
import { warmAIPanel } from '../prefetch/warmups';
import { fetchProject } from '../api/projects';

import ActivityBar from '../components/Editor/ActivityBar';
import FileTree from '../components/Editor/FileTree';
import TabBar from '../components/Editor/TabBar';
import EditorPane from '../components/Editor/EditorPane';
import RightSidebar from '../components/Editor/RightSidebar';
import LLMPanel from '../components/Editor/LLMPanel/LLMPanel';
import CollaboratorsPanel from '../components/Editor/CollaboratorsPanel';

import './EditorView.css';

const ChatSidebar = lazy(() => import('../components/Editor/AIPanel/ChatSidebar'));
const ChatWindow = lazy(() => import('../components/Editor/AIPanel/ChatWindow'));

function PanelFallback() {
  return <div className="panel-loading">Loading...</div>;
}

// Constants
const FILE_LANGUAGE_MAP = {
  tex: 'latex', bib: 'bibtex', pdf: 'text', txt: 'text',
  md: 'markdown', json: 'json', xml: 'xml', py: 'python',
  other: 'latex', js: 'javascript', ts: 'typescript', html: 'html', css: 'css',
};
const getLanguage = (fileType) => FILE_LANGUAGE_MAP[fileType] || 'latex';
const IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'image']);
const isImageType = (fileType) => IMAGE_TYPES.has(fileType?.toLowerCase());

const fileTabId = (fileId) => `file:${fileId}`;
const chatTabId = (chatId) => `chat:${chatId}`;
const SIDEBAR_MIN = 260;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 350;
const clampSidebarWidth = (width) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));

const resourceIdFromTabId = (tabId, prefix) => (
  typeof tabId === 'string' && tabId.startsWith(prefix)
    ? tabId.slice(prefix.length)
    : null
);

const makeFileTab = (file) => ({
  ...file,
  id: fileTabId(file.id),
  kind: 'file',
  resourceId: file.id,
  title: file.filename,
  file,
});

const makeChatTab = (chat) => ({
  id: chatTabId(chat.id),
  kind: 'chat',
  resourceId: chat.id,
  title: chat.title || 'Untitled chat',
  chat,
});



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
  const { getToken, user } = useAuth();
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === 'dark';

  // Project/loading state 
  const [isCollab, setIsCollab] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState('Project');

  // User role
  const [userRole, setUserRole] = useState(null);

  // Activity bar
  const [sidebarPanel, setSidebarPanel] = useState('files'); // Which panel is shown
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mainPanel, setMainPanel] = useState(null); // Show editor when null
  const sidebarRef = useRef(null);
  const resizePointerRef = useRef(null);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);

  useEffect(() => {
    try {
      const stored = Number.parseInt(localStorage.getItem(`editor-sidebar-width:${projectId}`), 10);
      setSidebarWidth(Number.isFinite(stored) ? clampSidebarWidth(stored) : SIDEBAR_DEFAULT);
    } catch {
      setSidebarWidth(SIDEBAR_DEFAULT);
    }
  }, [projectId]);

  const updateSidebarWidth = useCallback((width) => {
    const next = clampSidebarWidth(width);
    setSidebarWidth(next);
    try {
      localStorage.setItem(`editor-sidebar-width:${projectId}`, String(next));
    } catch {
      // The browser may deny storage in hardened/private contexts.
    }
  }, [projectId]);

  useEffect(() => {
    setupMonaco().catch((error) => {
      console.error('Monaco setup failed:', error);
    });
  }, []);

  useEffect(() => {
    if (loading) return undefined;

    return scheduleIdleWarmup(() => {
      warmAIPanel().catch((error) => {
        console.warn('AI panel prefetch failed:', error);
      });
    }, {
      timeout: 5000,
      fallbackDelay: 2500,
    });
  }, [loading]);

  const warmAssistantPanel = useCallback(() => {
    warmAIPanel().catch(() => {});
  }, []);

  // Toggle/switch sidebar panels
  const handlePanelToggle = useCallback((panelId, type) => {
    if (panelId === 'ai') {
      warmAssistantPanel();
    }

    if (type === 'sidebar') {
      setMainPanel(null);
      setSidebarOpen((open) => {
        if (sidebarPanel === panelId) return !open; // Toggle if same panel
        return true; // Open if different panel
      });
      setSidebarPanel(panelId);
    } else if (type === 'main') { // Return to editor clicking active main panel
      setMainPanel((current) => current === panelId ? null : panelId);
    }
  }, [sidebarPanel, warmAssistantPanel]);

  // Hooks
  const {
    collabSessions,
    collabStatus,
    liveEditorsByFile,
    openCollabSession,
    closeCollabSession,
    bindActiveSession,
  } = useCollabSessions({ projectId, getToken, user });

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
    const fileId = resourceIdFromTabId(tabId, 'file:');
    if (!fileId) return;

    closeCollabSession(fileId);
    clearFileContent(fileId);
  }, [closeCollabSession, clearFileContent]);

  const {
    openTabs,
    activeTabId,
    activeTab,
    addTab,
    updateTab,
    handleTabSelect,
    handleTabClose,
  } = useTabManager({ onTabClose: handleTabCloseWithCleanup });

  const {
    chats,
    chatsLoading,
    messagesByChatId,
    messagesLoadingByChatId,
    ensureChatMessages,
    createNewChat,
    removeChat,
    updateChatTitle,
    updateChatMessages,
  } = useChatManager({ projectId });

  const activeFileTab = activeTab?.kind === 'file' ? activeTab : null;
  const activeChatTab = activeTab?.kind === 'chat' ? activeTab : null;
  const activeFile = activeFileTab?.file ?? null;
  const activeFileId = activeFile?.id ?? null;
  const activeChatId = activeChatTab?.resourceId ?? null;
  const [lastActiveFile, setLastActiveFile] = useState(null);

  // Handle initial load 
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setProjectName('Project');
        const [data, project] = await Promise.all([refreshTree(), fetchProject(projectId)]);
        setProjectName(project.name || 'Project');
        setUserRole(data.role);
        setIsCollab(Boolean(data.is_collab));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [projectId]);

  useEffect(() => {
    if (activeFile) setLastActiveFile(activeFile);
  }, [activeFile]);

  useEffect(() => {
    if (activeChatId) ensureChatMessages(activeChatId);
  }, [activeChatId, ensureChatMessages]);

  const isReadOnly = userRole === 'viewer';

  // Handle save
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeFileId) handleSaveFile(activeFileId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeFileId, handleSaveFile]);

  // Handle file select
  const handleFileSelect = useCallback(async (file) => {
    const tabId = fileTabId(file.id);

    // Already open — just switch
    if (openTabs.find((t) => t.id === tabId)) {
      handleTabSelect(tabId);
      return;
    }

    addTab(makeFileTab(file));

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

  const handleOpenChatTab = useCallback((chatId) => {
    warmAssistantPanel();

    const chat = chats.find((item) => item.id === chatId);
    if (!chat) return;

    const tabId = chatTabId(chat.id);
    if (openTabs.find((tab) => tab.id === tabId)) {
      handleTabSelect(tabId);
    } else {
      addTab(makeChatTab(chat));
    }

    ensureChatMessages(chat.id);
  }, [addTab, chats, ensureChatMessages, handleTabSelect, openTabs, warmAssistantPanel]);

  const handleCreateChatTab = useCallback(async () => {
    warmAssistantPanel();

    try {
      const chat = await createNewChat();
      addTab(makeChatTab(chat));
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }, [addTab, createNewChat, warmAssistantPanel]);

  const handleDeleteChat = useCallback(async (chatId) => {
    try {
      await removeChat(chatId);
      handleTabClose(chatTabId(chatId));
    } catch (err) {
      console.error('Failed to delete chat:', err);
    }
  }, [handleTabClose, removeChat]);

  const handleChatTitleUpdate = useCallback((chatId, title) => {
    const nextTitle = title || 'Untitled chat';
    updateChatTitle(chatId, nextTitle);
    updateTab(chatTabId(chatId), { title: nextTitle });
  }, [updateChatTitle, updateTab]);

  const handleActiveChatMessagesUpdate = useCallback((updater) => {
    if (!activeChatId) return;
    updateChatMessages(activeChatId, updater);
  }, [activeChatId, updateChatMessages]);

  // Handle editor mount 
  const handleEditorMount = useCallback((editor) => {
    bindActiveSession(editor, activeFileId, isCollab);
  }, [bindActiveSession, activeFileId, isCollab]);

  // File CRUD handlers
  const handleCreateFileAndOpen = useCallback(async (parentFolderId, filename) => {
    const newFile = await handleCreateFile(parentFolderId, filename);
    addTab(makeFileTab(newFile));
    if (isCollab) openCollabSession(newFile);
    return newFile;
  }, [handleCreateFile, addTab, isCollab, openCollabSession]);

  const handleDeleteItemAndClose = useCallback(async (itemId, itemType) => {
    await handleDeleteItem(itemId, itemType);
    if (itemType === 'file') {
      handleTabClose(fileTabId(itemId));
      setLastActiveFile((current) => current?.id === itemId ? null : current);
    }
    return true;
  }, [handleDeleteItem, handleTabClose]);

  const handleRenameItemAndUpdateTab = useCallback(async (itemId, itemType, newName) => {
    const updated = await handleRenameItem(itemId, itemType, newName);
    if (itemType === 'file') {
      const existingFile = openTabs.find((tab) => tab.id === fileTabId(itemId))?.file ?? {};
      updateTab(fileTabId(itemId), {
        title: newName,
        filename: newName,
        file: { ...existingFile, ...(updated || {}), id: itemId, filename: newName },
      });
      setLastActiveFile((current) => current?.id === itemId ? { ...current, ...(updated || {}), filename: newName } : current);
    }
    return updated;
  }, [handleRenameItem, openTabs, updateTab]);

  const handleImageUploadAndOpen = useCallback(async (parentFolderId, file) => {
    const newFile = await handleImageUpload(parentFolderId, file);
    addTab(makeFileTab(newFile));
    return newFile;
  }, [handleImageUpload, addTab]);

  // Derived state

  const activeChat         = activeChatId ? (chats.find((chat) => chat.id === activeChatId) ?? activeChatTab?.chat ?? null) : null;
  const activeMessages     = activeChatId ? (messagesByChatId[activeChatId] ?? []) : [];
  const messagesLoading    = activeChatId ? !!messagesLoadingByChatId[activeChatId] : false;
  const isActiveImage      = activeFile ? isImageType(activeFile.file_type) : false;
  const isActiveCollab     = !!activeFileId && !isActiveImage && !!collabSessions.current[activeFileId];
  const activeCollabStatus = activeFileId ? (collabStatus[activeFileId] ?? null) : null;
  const activeContent      = (!isActiveCollab && activeFileId) ? (fileContents[activeFileId] ?? '') : '';
  const activeLanguage     = activeFile ? getLanguage(activeFile.file_type) : 'latex';
  const isActiveFileDirty  = !isActiveCollab && !!activeFileId && unsavedFiles.has(activeFileId);
  const imageUrl           = isActiveImage ? fileContents[activeFileId] : null;
  const activeLiveEditors  =
    activeFileId && activeCollabStatus === 'connected'
      ? (liveEditorsByFile[activeFileId] || []).filter((editor) => !editor.isLocal)
      : [];

  // Handle loading/error states
  if (loading) return <div className="editor-loading"><p>Loading project…</p></div>;
  if (error)   return <div className="editor-error"><p>Error: {error}</p></div>;

  return (
    <div className={`editor-container${sidebarOpen && sidebarPanel === 'files' ? ' files-panel-open' : ''}`}>

      {/* Far-left icon strip */}
      <ActivityBar
        activeSidebarPanel={sidebarOpen ? sidebarPanel : null}
        activeMainPanel={mainPanel}
        onPanelToggle={handlePanelToggle}
        onPanelIntent={(panelId) => {
          if (panelId === 'ai') warmAssistantPanel();
        }}
      />
      {sidebarOpen && (
        <aside ref={sidebarRef} className="side-panel" style={{ width: sidebarWidth }} aria-label="Active side panel">
          {sidebarPanel === 'files' && <FileTree
            projectName={projectName}
            treeData={treeData}
            onFileSelect={handleFileSelect}
            activeFileId={activeFileId}
            onCreateFile={handleCreateFileAndOpen}
            onCreateFolder={handleCreateFolder}
            onDeleteItem={handleDeleteItemAndClose}
            onRenameItem={handleRenameItemAndUpdateTab}
            onImageUpload={handleImageUploadAndOpen}
            readOnly={isReadOnly}
          />}
          {sidebarPanel === 'collaborators' && <CollaboratorsPanel projectId={projectId} liveEditors={activeLiveEditors} />}
          {sidebarPanel === 'ai' && <Suspense fallback={<PanelFallback />}>
            <ChatSidebar chats={chats} loading={chatsLoading} activeChatId={activeChatId}
              onSelectChat={handleOpenChatTab} onDeleteChat={handleDeleteChat} onNewChat={handleCreateChatTab} />
          </Suspense>}
          <div
            className={`sidebar-resize-handle${isResizing ? ' is-resizing' : ''}`}
            role="separator"
            tabIndex={0}
            aria-label="Resize side panel"
            aria-orientation="vertical"
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            aria-valuenow={sidebarWidth}
            onPointerDown={(event) => {
              resizePointerRef.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              setIsResizing(true);
            }}
            onPointerMove={(event) => {
              if (resizePointerRef.current !== event.pointerId || !sidebarRef.current) return;
              updateSidebarWidth(event.clientX - sidebarRef.current.getBoundingClientRect().left);
            }}
            onPointerUp={(event) => {
              if (resizePointerRef.current !== event.pointerId) return;
              resizePointerRef.current = null;
              setIsResizing(false);
            }}
            onPointerCancel={() => {
              resizePointerRef.current = null;
              setIsResizing(false);
            }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              updateSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 14 : -14));
            }}
          />
        </aside>
      )}

      {/* Main editor column — or a full-area non-chat main panel if one is active */}
      <div className="editor-main">
        {mainPanel === 'llm' ? (
          <LLMPanel />
        ) : mainPanel ? (
          <div className="main-panel-content">
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
              {activeChatTab ? (
                <Suspense fallback={<PanelFallback />}>
                  <ChatWindow
                    projectId={projectId}
                    contextFile={lastActiveFile}
                    chat={activeChat}
                    messages={activeMessages}
                    messagesLoading={messagesLoading}
                    onNewChat={handleCreateChatTab}
                    onMessagesUpdate={handleActiveChatMessagesUpdate}
                    onChatTitleUpdate={handleChatTitleUpdate}
                  />
                </Suspense>
              ) : (
                <EditorPane
                  activeTab={activeFile}
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
                  onChange={(value) => handleEditorChange(value, activeFileId)}
                  readOnly={isReadOnly}
                />
              )}
            </div>
          </>
        )} 
      </div>

      {/* Right sidebar */}
      {/*
      <RightSidebar
        projectId={projectId}
        activeTab={activeTab}
        isActiveCollab={isActiveCollab}
        isActiveFileDirty={isActiveFileDirty}
        isSaving={isSaving}
        activeContent={activeContent}
        onSave={() => handleSaveFile(activeTabId)}
      />
      */}
    </div>
  );
};

export default EditorView;
