import { useState, useRef, useCallback } from 'react';
import {
  fetchProjectTree,
  fetchFileContent,
  saveFileContent,
  createFile,
  createFolder,
  deleteItem,
  renameItem,
} from '../api/editor';
import { uploadImageFile } from '../api/editor';

/**
 * Manages file content, unsaved state, tree data, and all file CRUD.
 *
 * Responsibilities:
 *   - treeData (project file tree)
 *   - fileContents map (fileId → string content, or download URL for images)
 *   - unsavedFiles set
 *   - Saving (REST), loading content, CRUD operations
 *
 * Parameters:
 *   projectId       — current project
 *   collabSessions  — ref to the sessions map so saveFile can read Y.Doc content
 *                     for collab files. Kept as a ref to avoid stale closures.
 */
export function useFileManager({ projectId, collabSessions }) {
  const [treeData, setTreeData] = useState([]);
  const [fileContents, setFileContents] = useState({});
  const [unsavedFiles, setUnsavedFiles] = useState(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Tracks the last-saved content per file for dirty detection (non-collab only)
  const originalContentsRef = useRef({});

  // Handle tree refresh
  const refreshTree = useCallback(async () => {
    const data = await fetchProjectTree(projectId);
    setTreeData(data.tree);
    return data;
  }, [projectId]);

  // Content management
  const setFileUrl = useCallback((fileId, url) => {
    setFileContents((prev) => ({ ...prev, [fileId]: url }));
  }, []);

  const loadFileContent = useCallback(async (file) => {
    if (fileContents[file.id]) return; // Already loaded
    const content = await fetchFileContent(file.download_url);
    setFileContents((prev) => ({ ...prev, [file.id]: content }));
    originalContentsRef.current[file.id] = content;
  }, [fileContents]);

  const clearFileContent = useCallback((fileId) => {
    setFileContents((prev) => { const n = { ...prev }; delete n[fileId]; return n; });
    setUnsavedFiles((prev) => { const n = new Set(prev); n.delete(fileId); return n; });
    delete originalContentsRef.current[fileId];
  }, []);

  // Editor change (non-collab)
  const handleEditorChange = useCallback((value, activeTabId) => {
    if (!activeTabId) return;
    // Ignore changes for collab files — Yjs owns those models
    if (collabSessions.current[activeTabId]) return;

    setFileContents((prev) => ({ ...prev, [activeTabId]: value || '' }));
    const changed = value !== originalContentsRef.current[activeTabId];
    setUnsavedFiles((prev) => {
      const next = new Set(prev);
      changed ? next.add(activeTabId) : next.delete(activeTabId);
      return next;
    });
  }, [collabSessions]);

  // Handle save
  const handleSaveFile = useCallback(async (activeTabId) => {
    if (!activeTabId || isSaving) return;
    try {
      setIsSaving(true);

      // Collab files: read from Y.Doc. Non-collab: read from React state.
      const session = collabSessions.current[activeTabId];
      const content = session ? session.getContent() : fileContents[activeTabId];

      await saveFileContent(projectId, activeTabId, content);

      if (!session) {
        setUnsavedFiles((prev) => { const n = new Set(prev); n.delete(activeTabId); return n; });
        originalContentsRef.current[activeTabId] = content;
      }
    } catch (err) {
      setError(`Error saving file: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [fileContents, projectId, isSaving, collabSessions]);

  // File CRUD handlers

  /**
   * Creates a file and returns the new file object so the caller can open a tab.
   * Returns null on failure.
   */
  const handleCreateFile = useCallback(async (parentFolderId, filename) => {
    try {
      const response = await createFile(projectId, parentFolderId, filename);
      await refreshTree();

      if (response.file) {
        const f = response.file;
        setFileContents((prev) => ({ ...prev, [f.id]: '' }));
        setUnsavedFiles((prev) => new Set(prev).add(f.id));
        originalContentsRef.current[f.id] = '';
        return f; // caller opens the tab and collab session
      }
      return null;
    } catch (err) {
      setError(`Error creating file: ${err.message}`);
      return null;
    }
  }, [projectId, refreshTree]);

  const handleCreateFolder = useCallback(async (parentFolderId, folderName) => {
    try {
      await createFolder(projectId, parentFolderId, folderName);
      await refreshTree();
    } catch (err) {
      setError(`Error creating folder: ${err.message}`);
    }
  }, [projectId, refreshTree]);

  const handleDeleteItem = useCallback(async (itemId, itemType) => {
    try {
      await deleteItem(projectId, itemId, itemType);
      await refreshTree();
      if (itemType === 'file') clearFileContent(itemId);
      return true;
    } catch (err) {
      setError(`Error deleting ${itemType}: ${err.message}`);
      return false;
    }
  }, [projectId, refreshTree, clearFileContent]);

  const handleRenameItem = useCallback(async (itemId, itemType, newName) => {
    try {
      await renameItem(projectId, itemId, itemType, newName);
      await refreshTree();
    } catch (err) {
      setError(`Error renaming ${itemType}: ${err.message}`);
    }
  }, [projectId, refreshTree]);

  /**
   * Uploads an image, refreshes the tree, and returns the new file object.
   * Returns null on failure.
   */
  const handleImageUpload = useCallback(async (parentFolderId, file) => {
    try {
      const response = await uploadImageFile(projectId, parentFolderId, file);
      await refreshTree();
      if (response.file) {
        const f = response.file;
        setFileContents((prev) => ({ ...prev, [f.id]: f.download_url }));
        return f; // caller opens the tab
      }
      return null;
    } catch (err) {
      setError(`Error uploading image: ${err.message}`);
      return null;
    }
  }, [projectId, refreshTree]);

  return {
    // State
    treeData,
    fileContents,
    unsavedFiles,
    isSaving,
    error,
    setError,
    // Content
    refreshTree,
    setFileUrl,
    loadFileContent,
    clearFileContent,
    // Handlers
    handleEditorChange,
    handleSaveFile,
    handleCreateFile,
    handleCreateFolder,
    handleDeleteItem,
    handleRenameItem,
    handleImageUpload,
  };
}