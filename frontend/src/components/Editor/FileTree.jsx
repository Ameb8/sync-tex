// src/components/Editor/FileTree.jsx - Enhanced with delete and rename
import { useState, useRef, useEffect } from 'react';
import './FileTree.css';
import CreateItemModal from './CreateItemModal';
import DeleteConfirmModal from './DeleteConfirmModal';
import RenameModal from './RenameModal';

const FileTree = ({ treeData, onFileSelect, activeFileId, onCreateFile, onCreateFolder, onDeleteItem, onRenameItem, onTabClose }) => {
  const [expanded, setExpanded] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedNodeData, setSelectedNodeData] = useState(null); // Store full node data
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [createType, setCreateType] = useState(null); // 'file' or 'folder'
  const [createParentId, setCreateParentId] = useState(null);
  const contextMenuRef = useRef(null);

  const toggleFolder = (folderId, e) => {
    e.stopPropagation();
    const newExpanded = new Set(expanded);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpanded(newExpanded);
  };

  const getFileIcon = (fileType) => {
    const icons = {
      tex: '◇',
      bib: '●',
      pdf: '▲',
      png: '◆',
      jpg: '◆',
      txt: '≡',
    };
    return icons[fileType] || '◇';
  };

  // Find a node in the tree by ID (recursive)
  const findNodeById = (nodes, id) => {
    for (const node of nodes) {
      if (node.id === id) {
        return { ...node, type: 'folder' };
      }
      if (node.files) {
        const file = node.files.find((f) => f.id === id);
        if (file) {
          return { ...file, type: 'file' };
        }
      }
      if (node.children) {
        const found = findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  // Context menu handler
  const handleContextMenu = (e, nodeId, isFile) => {
    e.preventDefault();
    e.stopPropagation();
    
    setSelectedNodeId(nodeId);
    const nodeData = findNodeById(treeData, nodeId);
    setSelectedNodeData({ ...nodeData, isFile });
    
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isFile,
      nodeId,
    });
  };

  // Close context menu on click elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Handle create file/folder from context menu
  const handleCreateItem = (type) => {
    setCreateType(type);
    setCreateParentId(selectedNodeId);
    setShowCreateModal(true);
    setContextMenu(null);
  };

  // Handle modal submit for creating
  const handleModalSubmit = async (name) => {
    if (createType === 'file') {
      await onCreateFile(createParentId, name);
    } else if (createType === 'folder') {
      await onCreateFolder(createParentId, name);
      // Auto-expand the folder after creation
      const newExpanded = new Set(expanded);
      newExpanded.add(createParentId);
      setExpanded(newExpanded);
    }
    setShowCreateModal(false);
    setCreateType(null);
    setCreateParentId(null);
  };

  // Handle delete
  const handleDelete = async () => {
    if (!selectedNodeData) return;
    
    try {
      await onDeleteItem(selectedNodeId, selectedNodeData.type);
      
      // If deleting a file, close its tab if open
      if (selectedNodeData.type === 'file') {
        onTabClose(selectedNodeId);
      }
      
      setShowDeleteModal(false);
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  // Handle rename submit
  const handleRenameSubmit = async (newName) => {
    if (!selectedNodeData) return;
    
    try {
      await onRenameItem(selectedNodeId, selectedNodeData.type, newName);
      setShowRenameModal(false);
    } catch (err) {
      console.error('Failed to rename:', err);
    }
  };

  const renderTreeNode = (node, level = 0) => {
    const isFolder = node.children && node.children.length > 0;
    const hasFiles = node.files && node.files.length > 0;
    const isExpandable = isFolder || hasFiles;
    const isExpanded = expanded.has(node.id);

    return (
      <div key={node.id}>
        <div
          className="tree-item folder-item"
          style={{ paddingLeft: `${level * 16}px` }}
          onContextMenu={(e) => handleContextMenu(e, node.id, false)}
          onClick={(e) => isExpandable && toggleFolder(node.id, e)}
        >
          <span className="tree-toggle">
            {isExpandable ? (isExpanded ? '▼' : '▶') : ''}
          </span>
          <span className="tree-icon folder-icon">📁</span>
          <span className="tree-label">{node.name}</span>
        </div>

        {isExpanded && (
          <>
            {node.children?.map((child) => renderTreeNode(child, level + 1))}
            {node.files?.map((file) => (
              <div
                key={file.id}
                className={`tree-item file-item ${activeFileId === file.id ? 'active' : ''}`}
                style={{ paddingLeft: `${(level + 1) * 16}px` }}
                onContextMenu={(e) => handleContextMenu(e, file.id, true)}
                onClick={() => onFileSelect(file)}
              >
                <span className="tree-toggle"></span>
                <span className="tree-icon file-icon">{getFileIcon(file.file_type)}</span>
                <span className="tree-label">{file.filename}</span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="file-tree">
      <div className="tree-header">
        <p>Files</p>
      </div>
      <div className="tree-content">
        {treeData.map((node) => renderTreeNode(node))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          {!contextMenu.isFile && (
            <>
              <button
                className="context-menu-item"
                onClick={() => handleCreateItem('file')}
              >
                New File
              </button>
              <button
                className="context-menu-item"
                onClick={() => handleCreateItem('folder')}
              >
                New Folder
              </button>
              <div className="context-menu-divider"></div>
            </>
          )}
          <button 
            className="context-menu-item"
            onClick={() => {
              setShowRenameModal(true);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
          <button 
            className="context-menu-item delete"
            onClick={() => {
              setShowDeleteModal(true);
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {/* Create Item Modal */}
      {showCreateModal && (
        <CreateItemModal
          type={createType}
          onSubmit={handleModalSubmit}
          onCancel={() => {
            setShowCreateModal(false);
            setCreateType(null);
            setCreateParentId(null);
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedNodeData && (
        <DeleteConfirmModal
          itemName={selectedNodeData.filename || selectedNodeData.name}
          itemType={selectedNodeData.type}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}

      {/* Rename Modal */}
      {showRenameModal && selectedNodeData && (
        <RenameModal
          currentName={selectedNodeData.filename || selectedNodeData.name}
          itemType={selectedNodeData.type}
          onSubmit={handleRenameSubmit}
          onCancel={() => setShowRenameModal(false)}
        />
      )}
    </div>
  );
};

export default FileTree;