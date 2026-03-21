import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import FileTree from '../components/Editor/FileTree';
import TabBar from '../components/Editor/TabBar';
import { fetchProjectTree, fetchFileContent } from '../api/editor';
import './EditorView.css';

const EditorView = () => {
  const { projectId } = useParams();
  const [treeData, setTreeData] = useState([]);
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [fileContents, setFileContents] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const editorRef = useRef(null);

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

  // Handle file selection from tree
  const handleFileSelect = useCallback(async (file) => {
    // Check if already open
    const existingTab = openTabs.find((tab) => tab.id === file.id);
    
    if (existingTab) {
      setActiveTabId(file.id);
    } else {
      // Add new tab
      setOpenTabs((prev) => [...prev, file]);
      setActiveTabId(file.id);
    }

    // Fetch file content if not cached
    if (!fileContents[file.id]) {
      try {
        const content = await fetchFileContent(file.download_url);
        setFileContents((prev) => ({
          ...prev,
          [file.id]: content,
        }));
      } catch (err) {
        console.error('Failed to load file:', err);
      }
    }
  }, [openTabs, fileContents]);

  // Handle tab close
  const handleTabClose = useCallback((tabId) => {
    setOpenTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    
    if (activeTabId === tabId) {
      const remaining = openTabs.filter((tab) => tab.id !== tabId);
      setActiveTabId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [activeTabId, openTabs]);

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

  const handleEditorChange = useCallback((value) => {
    if (activeTabId) {
      setFileContents((prev) => ({
        ...prev,
        [activeTabId]: value || '',
      }));
    }
  }, [activeTabId]);

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
      />

      {/* Main Editor Area */}
      <div className="editor-main">
        {/* Tab Bar */}
        <TabBar
          tabs={openTabs}
          activeTabId={activeTabId}
          onTabSelect={handleTabSelect}
          onTabClose={handleTabClose}
        />

        {/* Editor Content */}
        <div className="editor-content">
          {activeTab ? (
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
          ) : (
            <div className="editor-empty">
              <p>Select a file to start editing</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar - Info Panel */}
      <div className="editor-sidebar-right">
        <div className="sidebar-header">
          <p>Info</p>
        </div>
        <div className="sidebar-content">
          {activeTab && (
            <>
              <div className="info-card">
                <p className="info-label">File</p>
                <p className="info-value">{activeTab.filename}</p>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default EditorView;