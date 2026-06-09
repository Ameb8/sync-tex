import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
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

  // User role
  const [userRole, setUserRole] = useState(null);

  // Activity bar
  const [sidebarPanel, setSidebarPanel] = useState('files'); // Which panel is shown
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mainPanel, setMainPanel] = useState(null); // Show editor when null

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
        const data = await refreshTree();
        setUserRole(data.role);
        setIsCollab(true);
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
    if (newFile) {
      addTab(makeFileTab(newFile));
      if (isCollab) openCollabSession(newFile);
    }
  }, [handleCreateFile, addTab, isCollab, openCollabSession]);

  const handleDeleteItemAndClose = useCallback(async (itemId, itemType) => {
    const ok = await handleDeleteItem(itemId, itemType);
    if (ok && itemType === 'file') {
      handleTabClose(fileTabId(itemId));
      setLastActiveFile((current) => current?.id === itemId ? null : current);
    }
  }, [handleDeleteItem, handleTabClose]);

  const handleImageUploadAndOpen = useCallback(async (parentFolderId, file) => {
    const newFile = await handleImageUpload(parentFolderId, file);
    if (newFile) addTab(makeFileTab(newFile));
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
    <div className="editor-container">

      {/* Far-left icon strip */}
      <ActivityBar
        activeSidebarPanel={sidebarOpen ? sidebarPanel : null}
        activeMainPanel={mainPanel}
        onPanelToggle={handlePanelToggle}
        onPanelIntent={(panelId) => {
          if (panelId === 'ai') warmAssistantPanel();
        }}
      />
      <div
        className="side-panel"
        style={{ display: sidebarOpen && sidebarPanel === 'files' ? 'flex' : 'none' }}
      >
        <FileTree
          treeData={treeData}
          onFileSelect={handleFileSelect}
          activeFileId={activeFileId}
          onCreateFile={handleCreateFileAndOpen}
          onCreateFolder={handleCreateFolder}
          onDeleteItem={handleDeleteItemAndClose}
          onRenameItem={handleRenameItem}
          onTabClose={(fileId) => handleTabClose(fileTabId(fileId))}
          onImageUpload={handleImageUploadAndOpen}
          readOnly={isReadOnly}
        />
      </div>
      <div
        className="side-panel"
        style={{ display: sidebarOpen && sidebarPanel === 'collaborators' ? 'flex' : 'none' }}
      >
        <CollaboratorsPanel projectId={projectId} liveEditors={activeLiveEditors} />
      </div>
      <div
        className="side-panel"
        style={{ display: sidebarOpen && sidebarPanel === 'ai' ? 'flex' : 'none' }}
      >
        <Suspense fallback={<PanelFallback />}>
          <ChatSidebar
            chats={chats}
            loading={chatsLoading}
            activeChatId={activeChatId}
            onSelectChat={handleOpenChatTab}
            onDeleteChat={handleDeleteChat}
            onNewChat={handleCreateChatTab}
          />
        </Suspense>
      </div>

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
