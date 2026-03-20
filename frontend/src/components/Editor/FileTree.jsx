import { useState } from 'react';
import './FileTree.css';

const FileTree = ({ treeData, onFileSelect, activeFileId }) => {
  const [expanded, setExpanded] = useState(new Set());

  const toggleFolder = (folderId) => {
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

  const renderTreeNode = (node, level = 0) => {
    const isFolder = node.children && node.children.length > 0;
    const hasFiles = node.files && node.files.length > 0;
    const isExpandable = isFolder || hasFiles;
    const isExpanded = expanded.has(node.id);

    return (
      <div key={node.id}>
        <div
          className="tree-item"
          style={{ paddingLeft: `${level * 16}px` }}
          onClick={() => isExpandable && toggleFolder(node.id)}
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
    </div>
  );
};

export default FileTree;