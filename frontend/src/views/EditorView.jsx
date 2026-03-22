import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import FileTree from '../components/Editor/FileTree';
import TabBar from '../components/Editor/TabBar';
import CollaboratorsPanel from '../components/Editor/CollaboratorsPanel';
import { 
  fetchProjectTree, 
  fetchFileContent, 
  saveFileContent,
  createFile, 
  createFolder,
  deleteItem,
  renameItem
} from '../api/editor';
import './EditorView.css';

const EditorView = () => {
  const { projectId } = useParams();
  const [treeData, setTreeData] = useState([]);
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [fileContents, setFileContents] = useState({});
  const [unsavedFiles, setUnsavedFiles] = useState(new Set()); // Track unsaved files
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('info');
  const [isDarkMode, setIsDarkMode] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const editorRef = useRef(null);
  const originalContentsRef = useRef({}); // Store original file contents for comparison

  // Listen for dark mode changes
  useEffect(() => {
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => setIsDarkMode(e.matches);
    darkModeQuery.addEventListener('change', handleChange);
    return () => darkModeQuery.removeEventListener('change', handleChange);
  }, []);

  // Fetch project tree on mount
  useEffect(() => {
    const loadProjectTree = async () => {
      try {
        setLoading(true);
        const data = await fetchProjectTree(projectId);
        setTreeData(data.tree);
      } catch (err) {
        setError(err.message);
        console.error('Failed to load project tree:', err);
      } finally {
        setLoading(false);
      }
    };

    loadProjectTree();
  }, [projectId]);

  // Handle Ctrl+S / Cmd+S save
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeTabId) {
          handleSaveFile();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, fileContents, unsavedFiles]);

  // Handle file selection from tree
  const handleFileSelect = useCallback(async (file) => {
    const existingTab = openTabs.find((tab) => tab.id === file.id);
    
    if (existingTab) {
      setActiveTabId(file.id);
    } else {
      setOpenTabs((prev) => [...prev, file]);
      setActiveTabId(file.id);
    }

    if (!fileContents[file.id]) {
      try {
        const content = await fetchFileContent(file.download_url);
        setFileContents((prev) => ({
          ...prev,
          [file.id]: content,
        }));
        // Store original content for change detection
        originalContentsRef.current[file.id] = content;
      } catch (err) {
        console.error('Failed to load file:', err);
        setError(`Failed to load file: ${err.message}`);
      }
    }
  }, [openTabs, fileContents]);

  // Handle saving the current file
  const handleSaveFile = useCallback(async () => {
    if (!activeTabId || isSaving) return;

    try {
      setIsSaving(true);
      const content = fileContents[activeTabId];
      
      // Call your save API
      await saveFileContent(projectId, activeTabId, content);
      
      // Mark file as saved
      const newUnsavedFiles = new Set(unsavedFiles);
      newUnsavedFiles.delete(activeTabId);
      setUnsavedFiles(newUnsavedFiles);
      
      // Update original content reference
      originalContentsRef.current[activeTabId] = content;
      
      console.log('File saved successfully');
    } catch (err) {
      console.error('Failed to save file:', err);
      setError(`Error saving file: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [activeTabId, fileContents, projectId, isSaving, unsavedFiles]);

  // Handle creating a new file
  const handleCreateFile = useCallback(async (parentFolderId, filename) => {
    try {
      const response = await createFile(projectId, parentFolderId, filename);
      
      // Refresh tree data
      const updatedData = await fetchProjectTree(projectId);
      setTreeData(updatedData.tree);

      // Auto-open the newly created file
      if (response.file) {
        const newFile = response.file;
        setOpenTabs((prev) => [...prev, newFile]);
        setActiveTabId(newFile.id);
        setFileContents((prev) => ({
          ...prev,
          [newFile.id]: '',
        }));
        // New files are unsaved
        setUnsavedFiles((prev) => new Set(prev).add(newFile.id));
        originalContentsRef.current[newFile.id] = '';
      }
    } catch (err) {
      console.error('Failed to create file:', err);
      setError(`Error creating file: ${err.message}`);
    }
  }, [projectId]);

  // Handle creating a new folder
  const handleCreateFolder = useCallback(async (parentFolderId, folderName) => {
    try {
      await createFolder(projectId, parentFolderId, folderName);
      
      // Refresh tree data
      const updatedData = await fetchProjectTree(projectId);
      setTreeData(updatedData.tree);
    } catch (err) {
      console.error('Failed to create folder:', err);
      setError(`Error creating folder: ${err.message}`);
    }
  }, [projectId]);

  // Handle deleting a file or folder
  const handleDeleteItem = useCallback(async (itemId, itemType) => {
    try {
      await deleteItem(projectId, itemId, itemType);
      
      // Refresh tree data
      const updatedData = await fetchProjectTree(projectId);
      setTreeData(updatedData.tree);
      
      // Clean up unsaved tracking
      if (itemType === 'file') {
        const newUnsavedFiles = new Set(unsavedFiles);
        newUnsavedFiles.delete(itemId);
        setUnsavedFiles(newUnsavedFiles);
        delete originalContentsRef.current[itemId];
      }
    } catch (err) {
      console.error('Failed to delete item:', err);
      setError(`Error deleting ${itemType}: ${err.message}`);
    }
  }, [projectId, unsavedFiles]);

  // Handle renaming a file or folder
  const handleRenameItem = useCallback(async (itemId, itemType, newName) => {
    try {
      await renameItem(projectId, itemId, itemType, newName);
      
      // Refresh tree data
      const updatedData = await fetchProjectTree(projectId);
      setTreeData(updatedData.tree);
    } catch (err) {
      console.error('Failed to rename item:', err);
      setError(`Error renaming ${itemType}: ${err.message}`);
    }
  }, [projectId]);

  // Handle tab close
  const handleTabClose = useCallback((tabId) => {
    setOpenTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    
    if (activeTabId === tabId) {
      const remaining = openTabs.filter((tab) => tab.id !== tabId);
      setActiveTabId(remaining.length > 0 ? remaining[0].id : null);
    }

    // Clean up content and unsaved tracking
    const newFileContents = { ...fileContents };
    delete newFileContents[tabId];
    setFileContents(newFileContents);
    
    const newUnsavedFiles = new Set(unsavedFiles);
    newUnsavedFiles.delete(tabId);
    setUnsavedFiles(newUnsavedFiles);
    
    delete originalContentsRef.current[tabId];
  }, [activeTabId, openTabs, fileContents, unsavedFiles]);

  // Handle tab selection
  const handleTabSelect = useCallback((tabId) => {
    setActiveTabId(tabId);
  }, []);

  // Get language based on file type
  const getLanguage = (fileType) => {
    const languageMap = {
      tex: 'latex',
      bib: 'bibtex',
      pdf: 'text',
      txt: 'text',
      md: 'markdown',
      json: 'json',
      xml: 'xml',
      py: 'python',
      js: 'javascript',
      ts: 'typescript',
      html: 'html',
      css: 'css',
    };
    return languageMap[fileType] || 'text';
  };

  const activeTab = openTabs.find((tab) => tab.id === activeTabId);
  const activeContent = activeTab ? fileContents[activeTabId] || '' : '';
  const activeLanguage = activeTab ? getLanguage(activeTab.file_type) : 'text';
  const isActiveFileDirty = activeTabId && unsavedFiles.has(activeTabId);

  const handleEditorChange = useCallback((value) => {
    if (activeTabId) {
      setFileContents((prev) => ({
        ...prev,
        [activeTabId]: value || '',
      }));

      // Mark as unsaved if content differs from original
      const isChanged = value !== originalContentsRef.current[activeTabId];
      const newUnsavedFiles = new Set(unsavedFiles);
      
      if (isChanged) {
        newUnsavedFiles.add(activeTabId);
      } else {
        newUnsavedFiles.delete(activeTabId);
      }
      
      setUnsavedFiles(newUnsavedFiles);
    }
  }, [activeTabId, unsavedFiles]);

  const handleEditorMount = (editor) => {
    editorRef.current = editor;
  };

  if (loading) {
    return (
      <div className="editor-loading">
        <p>Loading project...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="editor-error">
        <p>Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="editor-container">
      {/* File Tree Sidebar */}
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

      {/* Main Editor Area */}
      <div className="editor-main">
        {/* Tab Bar */}
        <TabBar
          tabs={openTabs}
          activeTabId={activeTabId}
          onTabSelect={handleTabSelect}
          onTabClose={handleTabClose}
          unsavedFiles={unsavedFiles}
        />

        {/* Editor Content */}
        <div className="editor-content">
          {activeTab ? (
            <>
              <Editor
                height="100%"
                language={activeLanguage}
                value={activeContent}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                theme={isDarkMode ? 'vs-dark' : 'vs'}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineHeight: 1.6,
                  tabSize: 2,
                  wordWrap: 'on',
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
                }}
              />
              
              {/* Save Status Bar */}
              {isActiveFileDirty && (
                <div className="save-indicator">
                  <span className="unsaved-dot">●</span>
                  <span className="save-hint">Press Ctrl+S to save</span>
                </div>
              )}
              
              {isSaving && (
                <div className="saving-indicator">
                  Saving...
                </div>
              )}
            </>
          ) : (
            <div className="editor-empty">
              <p>Select a file to start editing</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar - Info Panel */}
      <div className="editor-sidebar-right">
        <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
          {/* Sidebar Tab Navigation */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid var(--border-color, #e0e0e0)' }}>
            <button
              onClick={() => setSidebarTab('info')}
              className={`sidebar-tab ${sidebarTab === 'info' ? 'active' : ''}`}
              style={{
                flex: 1,
                padding: '12px 16px',
                border: 'none',
                background: 'transparent',
                color: sidebarTab === 'info' ? 'var(--text-info, #1f80dd)' : 'var(--text-secondary, #666)',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
                borderBottom: sidebarTab === 'info' ? '2px solid var(--text-info, #1f80dd)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Info
            </button>
            <button
              onClick={() => setSidebarTab('collaborators')}
              className={`sidebar-tab ${sidebarTab === 'collaborators' ? 'active' : ''}`}
              style={{
                flex: 1,
                padding: '12px 16px',
                border: 'none',
                background: 'transparent',
                color: sidebarTab === 'collaborators' ? 'var(--text-info, #1f80dd)' : 'var(--text-secondary, #666)',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
                borderBottom: sidebarTab === 'collaborators' ? '2px solid var(--text-info, #1f80dd)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Share
            </button>
          </div>
      
          {/* Info Tab */}
          {sidebarTab === 'info' && (
            <div className="sidebar-content">
              {activeTab ? (
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
                  <div className="info-card">
                    <p className="info-label">Size</p>
                    <p className="info-value">{(activeContent.length / 1024).toFixed(1)} KB</p>
                  </div>
                  <div className="info-card">
                    <p className="info-label">Lines</p>
                    <p className="info-value">{activeContent.split('\n').length}</p>
                  </div>
                  <div className="info-card">
                    <p className="info-label">Save</p>
                    <button
                      onClick={handleSaveFile}
                      disabled={!isActiveFileDirty || isSaving}
                      className="save-button"
                      title="Save file (Ctrl+S)"
                    >
                      {isSaving ? '⏳ Saving...' : '💾 Save'}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}
      
          {/* Collaborators Tab */}
          {sidebarTab === 'collaborators' && <CollaboratorsPanel projectId={projectId} />}
        </div>
      </div>
    </div>
  );
};

export default EditorView;