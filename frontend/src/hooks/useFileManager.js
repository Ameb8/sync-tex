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

const findFile = (nodes, fileId) => {
  for (const directory of nodes) {
    const file = directory.files?.find((candidate) => candidate.id === fileId);
    if (file) return file;
    const nested = findFile(directory.children ?? [], fileId);
    if (nested) return nested;
  }
  return null;
};

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
   * Rejects on failure so inline callers can keep their editor open.
   */
  const handleCreateFile = useCallback(async (parentFolderId, filename) => {
    const response = await createFile(projectId, parentFolderId, filename);
    const refreshed = await refreshTree();
    const returned = response.file ?? response;
    const file = findFile(refreshed.tree, returned?.id) ?? returned;
    if (!file?.id) throw new Error('The server did not return the created file');
    setFileContents((prev) => ({ ...prev, [file.id]: '' }));
    setUnsavedFiles((prev) => new Set(prev).add(file.id));
    originalContentsRef.current[file.id] = '';
    return file;
  }, [projectId, refreshTree]);

  const handleCreateFolder = useCallback(async (parentFolderId, folderName) => {
    const response = await createFolder(projectId, parentFolderId, folderName);
    await refreshTree();
    const folder = response.directory ?? response;
    if (!folder?.id) throw new Error('The server did not return the created folder');
    return folder;
  }, [projectId, refreshTree]);

  const handleDeleteItem = useCallback(async (itemId, itemType) => {
    await deleteItem(projectId, itemId, itemType);
    await refreshTree();
    if (itemType === 'file') clearFileContent(itemId);
    return true;
  }, [projectId, refreshTree, clearFileContent]);

  const handleRenameItem = useCallback(async (itemId, itemType, newName) => {
    const response = await renameItem(projectId, itemId, itemType, newName);
    await refreshTree();
    return response;
  }, [projectId, refreshTree]);

  /**
   * Uploads an image, refreshes the tree, and returns the new file object.
   * Rejects on failure so the explorer can display a real failed operation.
   */
  const handleImageUpload = useCallback(async (parentFolderId, file) => {
    const response = await uploadImageFile(projectId, parentFolderId, file);
    const refreshed = await refreshTree();
    const returned = response.file ?? response;
    const uploaded = findFile(refreshed.tree, returned?.id) ?? returned;
    if (!uploaded?.id) throw new Error('The server did not return the uploaded image');
    setFileContents((prev) => ({ ...prev, [uploaded.id]: uploaded.download_url }));
    return uploaded;
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
