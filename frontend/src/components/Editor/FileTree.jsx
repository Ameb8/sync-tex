import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FiAlertCircle, FiBookOpen, FiChevronRight, FiCopy, FiDownload, FiEdit2,
  FiFile, FiFilePlus, FiFileText, FiFolder, FiFolderPlus, FiImage, FiLoader,
  FiMoreHorizontal, FiMoon, FiSun, FiTrash2, FiUpload,
} from 'react-icons/fi';

import { useTheme } from '../../contexts/ThemeContext';
import DeleteConfirmModal from './DeleteConfirmModal';
import './FileTree.css';

const EMPTY_INDEX = {
  nodesById: new Map(), parentById: new Map(), childrenByDirectory: new Map(), roots: [],
};

function indexTree(treeData) {
  if (!treeData.length) return EMPTY_INDEX;
  const nodesById = new Map();
  const parentById = new Map();
  const childrenByDirectory = new Map();
  const roots = [];

  const visitDirectory = (directory, parentId = null) => {
    nodesById.set(directory.id, { ...directory, type: 'folder', label: directory.name });
    parentById.set(directory.id, parentId);
    if (parentId === null) roots.push(directory.id);
    const children = [];
    for (const child of directory.children ?? []) {
      children.push(child.id);
      visitDirectory(child, directory.id);
    }
    for (const file of directory.files ?? []) {
      children.push(file.id);
      nodesById.set(file.id, { ...file, type: 'file', label: file.filename });
      parentById.set(file.id, directory.id);
    }
    childrenByDirectory.set(directory.id, children);
  };

  treeData.forEach((root) => visitDirectory(root));
  return { nodesById, parentById, childrenByDirectory, roots };
}

function filePresentation(file) {
  const name = file.filename?.toLowerCase() ?? '';
  const type = file.file_type?.toLowerCase() ?? '';
  if (type === 'image' || /\.(png|jpe?g|gif|svg|webp|bmp)$/.test(name)) return { label: 'Image', Icon: FiImage };
  if (type === 'pdf' || name.endsWith('.pdf')) return { label: 'PDF document', Icon: FiFileText };
  if (type === 'bib' || name.endsWith('.bib')) return { label: 'Bibliography', Icon: FiBookOpen };
  if (type === 'tex' || name.endsWith('.tex')) return { label: 'LaTeX source', Icon: FiFileText };
  if (type === 'txt' || type === 'text' || name.endsWith('.txt')) return { label: 'Plain text', Icon: FiFileText };
  return { label: 'File', Icon: FiFile };
}

const messageFrom = (error, fallback) => error instanceof Error && error.message ? error.message : fallback;

const FileTree = ({
  projectName = 'Project', treeData, onFileSelect, activeFileId, onCreateFile,
  onCreateFolder, onDeleteItem, onRenameItem, onImageUpload, readOnly,
}) => {
  const { resolvedTheme, setThemePreference } = useTheme();
  const treeIndex = useMemo(() => indexTree(treeData), [treeData]);
  const previousIndexRef = useRef(treeIndex);
  const imageInputRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const menuInvokerRef = useRef(null);
  const rowRefs = useRef(new Map());
  const toastTimerRef = useRef(null);
  const [currentDirectoryId, setCurrentDirectoryId] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [focusedNodeId, setFocusedNodeId] = useState(null);
  const [edit, setEdit] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePending, setDeletePending] = useState(false);
  const [operation, setOperation] = useState(null);
  const [toast, setToast] = useState(null);

  const rootId = treeIndex.roots[0] ?? null;
  const currentDirectory = treeIndex.nodesById.get(currentDirectoryId) ?? null;
  const visibleIds = treeIndex.childrenByDirectory.get(currentDirectoryId) ?? [];
  const visibleKey = visibleIds.join('|');
  const visibleNodes = visibleIds.map((id) => treeIndex.nodesById.get(id)).filter(Boolean);

  const announce = useCallback((message, kind = 'success') => {
    window.clearTimeout(toastTimerRef.current);
    setToast({ message, kind });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  useEffect(() => {
    setCurrentDirectoryId((current) => {
      if (current && treeIndex.nodesById.get(current)?.type === 'folder') return current;
      let ancestor = current;
      const previous = previousIndexRef.current;
      while (ancestor) {
        ancestor = previous.parentById.get(ancestor) ?? null;
        if (ancestor && treeIndex.nodesById.get(ancestor)?.type === 'folder') return ancestor;
      }
      return rootId;
    });
    previousIndexRef.current = treeIndex;
  }, [rootId, treeIndex]);

  useEffect(() => {
    const visible = new Set(visibleIds);
    setSelectedNodeId((selected) => visible.has(selected) ? selected : null);
    setFocusedNodeId((focused) => visible.has(focused) ? focused : (visibleIds[0] ?? null));
  }, [currentDirectoryId, visibleKey]);

  useEffect(() => {
    if (readOnly) setEdit(null);
  }, [readOnly]);

  useLayoutEffect(() => {
    if (!edit || !inputRef.current) return;
    const input = inputRef.current;
    input.focus();
    if (edit.kind === 'rename') {
      const dot = edit.type === 'file' ? edit.value.lastIndexOf('.') : -1;
      input.setSelectionRange(0, dot > 0 ? dot : edit.value.length);
    }
  }, [edit?.kind, edit?.nodeId]);

  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(contextMenu.x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(contextMenu.y, window.innerHeight - rect.height - 8));
    if (left !== contextMenu.left || top !== contextMenu.top) {
      setContextMenu((current) => current ? { ...current, left, top } : current);
      return;
    }
    menuRef.current.querySelector('button:not(:disabled)')?.focus();
  }, [contextMenu]);

  const closeMenu = useCallback((restoreFocus = true) => {
    setContextMenu(null);
    if (restoreFocus) requestAnimationFrame(() => menuInvokerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) closeMenu();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeMenu, contextMenu]);

  const openDirectory = useCallback((directoryId) => {
    const firstChild = treeIndex.childrenByDirectory.get(directoryId)?.[0] ?? null;
    setCurrentDirectoryId(directoryId);
    setSelectedNodeId(firstChild);
    setFocusedNodeId(firstChild);
    setEdit(null);
    closeMenu(false);
    requestAnimationFrame(() => rowRefs.current.get(firstChild)?.focus());
  }, [closeMenu, treeIndex.childrenByDirectory]);

  const breadcrumbs = useMemo(() => {
    const result = [];
    let id = currentDirectoryId;
    while (id) {
      const node = treeIndex.nodesById.get(id);
      if (!node) break;
      result.unshift(node);
      id = treeIndex.parentById.get(id) ?? null;
    }
    return result;
  }, [currentDirectoryId, treeIndex]);

  const relativePath = useCallback((nodeId) => {
    const parts = [];
    let id = nodeId;
    while (id) {
      const node = treeIndex.nodesById.get(id);
      if (!node) break;
      parts.unshift(node.label);
      id = treeIndex.parentById.get(id) ?? null;
    }
    return parts.join('/');
  }, [treeIndex]);

  const beginCreate = (type) => {
    if (readOnly || edit?.pending || !currentDirectoryId) return;
    closeMenu(false);
    setEdit({ kind: 'create', type, value: '', pending: false, error: '', retry: false });
  };

  const beginRename = (node) => {
    if (readOnly || edit?.pending || !node) return;
    closeMenu(false);
    setSelectedNodeId(node.id);
    setFocusedNodeId(node.id);
    setEdit({ kind: 'rename', type: node.type, nodeId: node.id, value: node.label, pending: false, error: '', retry: false });
  };

  const validateName = (value) => {
    const name = value.trim();
    if (!name) return 'A name is required';
    return visibleNodes.some((node) => node.id !== edit?.nodeId && node.label.trim().toLocaleLowerCase() === name.toLocaleLowerCase())
      ? 'That name already exists here' : '';
  };

  const commitEdit = async () => {
    if (!edit || edit.pending) return;
    const name = edit.value.trim();
    const validationError = validateName(name);
    if (validationError) {
      setEdit((current) => ({ ...current, error: validationError, retry: false }));
      return;
    }
    setEdit((current) => ({ ...current, value: name, pending: true, error: '', retry: false }));
    try {
      let saved;
      if (edit.kind === 'create') {
        saved = edit.type === 'file'
          ? await onCreateFile(currentDirectoryId, name)
          : await onCreateFolder(currentDirectoryId, name);
      } else {
        saved = await onRenameItem(edit.nodeId, edit.type, name);
      }
      const savedId = edit.kind === 'rename' ? edit.nodeId : saved?.id;
      setSelectedNodeId(savedId ?? null);
      setFocusedNodeId(savedId ?? null);
      setEdit(null);
      announce(`Saved ${name}`);
      requestAnimationFrame(() => rowRefs.current.get(savedId)?.focus());
    } catch (error) {
      setEdit((current) => current ? {
        ...current, pending: false, error: messageFrom(error, `Could not save ${name}`), retry: true,
      } : current);
    }
  };

  const handleEditKeyDown = (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEdit();
    } else if (event.key === 'Escape' && !edit?.pending) {
      event.preventDefault();
      setEdit(null);
      requestAnimationFrame(() => rowRefs.current.get(edit?.nodeId ?? focusedNodeId)?.focus());
    }
  };

  const selectNode = (node, openFile = true) => {
    setSelectedNodeId(node.id);
    setFocusedNodeId(node.id);
    if (openFile && node.type === 'file') onFileSelect(node);
  };

  const openRowMenu = (event, node) => {
    event.preventDefault();
    event.stopPropagation();
    if (edit?.pending) return;
    selectNode(node, false);
    menuInvokerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerMenu = event.type === 'contextmenu';
    const x = pointerMenu ? event.clientX : rect.right - 224;
    const y = pointerMenu ? event.clientY : rect.bottom + 5;
    setContextMenu({ kind: 'row', nodeId: node.id, x, y, left: x, top: y });
  };

  const openOptionsMenu = (event) => {
    event.stopPropagation();
    menuInvokerRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.right - 224;
    const y = rect.bottom + 5;
    setContextMenu({ kind: 'options', x, y, left: x, top: y });
  };

  const copyPath = async (nodeId) => {
    const path = relativePath(nodeId);
    closeMenu();
    try {
      await navigator.clipboard.writeText(path);
      announce(`Copied ${path}`);
    } catch {
      announce('Could not copy the relative path', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deletePending || readOnly) return;
    setDeletePending(true);
    try {
      await onDeleteItem(deleteTarget.id, deleteTarget.type);
      announce(`Deleted ${deleteTarget.label}`);
      setDeleteTarget(null);
    } catch (error) {
      announce(messageFrom(error, `Could not delete ${deleteTarget.label}`), 'error');
    } finally {
      setDeletePending(false);
    }
  };

  const uploadImage = useCallback(async (file, targetDirectoryId = currentDirectoryId) => {
    if (!file || !targetDirectoryId || readOnly) return;
    setOperation({ file, directoryId: targetDirectoryId, name: file.name, status: 'pending', error: '' });
    try {
      const uploaded = await onImageUpload(targetDirectoryId, file);
      setOperation(null);
      setSelectedNodeId(uploaded.id);
      setFocusedNodeId(uploaded.id);
      announce(`Saved ${file.name}`);
    } catch (error) {
      const message = messageFrom(error, 'Upload failed');
      setOperation({ file, directoryId: targetDirectoryId, name: file.name, status: 'error', error: message });
      announce(`Upload failed: ${message}`, 'error');
    }
  }, [announce, currentDirectoryId, onImageUpload, readOnly]);

  const handleListKeyDown = (event) => {
    if (edit || contextMenu || !visibleIds.length) return;
    const currentIndex = Math.max(0, visibleIds.indexOf(focusedNodeId));
    let nextIndex = null;
    if (event.key === 'ArrowDown') nextIndex = Math.min(visibleIds.length - 1, currentIndex + 1);
    if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = visibleIds.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      const id = visibleIds[nextIndex];
      setFocusedNodeId(id);
      setSelectedNodeId(id);
      requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
    } else if (event.key === 'Enter') {
      const node = treeIndex.nodesById.get(focusedNodeId);
      if (!node) return;
      event.preventDefault();
      node.type === 'folder' ? openDirectory(node.id) : selectNode(node);
    }
  };

  const handleMenuKeyDown = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...menuRef.current.querySelectorAll('button:not(:disabled)')];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  const menuNode = contextMenu?.nodeId ? treeIndex.nodesById.get(contextMenu.nodeId) : null;
  const count = visibleNodes.length;

  return (
    <section className="file-browser" aria-label="Files">
      <header className="file-browser__header">
        <div className="file-browser__title-row">
          <h1 title={projectName}>{projectName}</h1>
          <button className="file-browser__round-button" type="button"
            onClick={() => setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}>
            {resolvedTheme === 'dark' ? <FiSun aria-hidden="true" /> : <FiMoon aria-hidden="true" />}
          </button>
          <button className="file-browser__round-button" type="button" onClick={openOptionsMenu}
            aria-label="Explorer options" title="Explorer options" aria-haspopup="menu"
            aria-expanded={contextMenu?.kind === 'options'}>
            <FiMoreHorizontal aria-hidden="true" />
          </button>
        </div>
        <div className="file-browser__mode"><strong>{readOnly ? 'View only' : 'Editing'}</strong>{' · '}{readOnly ? 'Changes disabled' : 'Folder-focused browser'}</div>
      </header>

      <div className="file-browser__toolbar">
        <button type="button" className="file-browser__tool file-browser__tool--primary" onClick={() => beginCreate('file')} disabled={readOnly || edit?.pending}><FiFilePlus aria-hidden="true" /> New File</button>
        <button type="button" className="file-browser__tool" onClick={() => beginCreate('folder')} disabled={readOnly || edit?.pending}><FiFolderPlus aria-hidden="true" /> New Folder</button>
        <button type="button" className="file-browser__round-button" onClick={() => imageInputRef.current?.click()}
          disabled={readOnly || edit?.pending || operation?.status === 'pending'} aria-label="Upload image" title="Upload image"><FiUpload aria-hidden="true" /></button>
        <input ref={imageInputRef} className="file-browser__file-input" type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" tabIndex={-1}
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; uploadImage(file); }} />
      </div>

      <nav className="file-browser__breadcrumbs" aria-label="Current folder">
        {breadcrumbs.map((crumb, index) => <span key={crumb.id} className="file-browser__crumb">
          <button type="button" onClick={() => openDirectory(crumb.id)} aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined} title={crumb.name}>{crumb.name}</button>
          {index < breadcrumbs.length - 1 && <FiChevronRight aria-hidden="true" />}
        </span>)}
      </nav>
      <div className="file-browser__caption">{count} {count === 1 ? 'item' : 'items'} in {currentDirectory?.name ?? 'Project'}</div>

      <div className="file-browser__items" role="listbox" aria-label={`Files in ${currentDirectory?.name ?? 'current folder'}`} onKeyDown={handleListKeyDown}>
        {visibleNodes.map((node) => {
          const isFolder = node.type === 'folder';
          const presentation = isFolder ? { Icon: FiFolder } : filePresentation(node);
          const Icon = presentation.Icon;
          const isRenaming = edit?.kind === 'rename' && edit.nodeId === node.id;
          const errorId = `file-browser-error-${node.id}`;
          const childCount = treeIndex.childrenByDirectory.get(node.id)?.length ?? 0;
          return <div key={node.id}
            ref={(element) => element ? rowRefs.current.set(node.id, element) : rowRefs.current.delete(node.id)}
            className={`file-browser__item${isFolder ? ' file-browser__item--folder' : ''}${selectedNodeId === node.id ? ' is-selected' : ''}${focusedNodeId === node.id ? ' is-focused' : ''}${activeFileId === node.id ? ' is-active' : ''}`}
            role="option" aria-selected={selectedNodeId === node.id} tabIndex={focusedNodeId === node.id ? 0 : -1}
            onFocus={() => setFocusedNodeId(node.id)}
            onClick={(event) => { if (!event.target.closest('button,input')) selectNode(node); }}
            onDoubleClick={(event) => { if (isFolder && !event.target.closest('button,input')) openDirectory(node.id); }}
            onContextMenu={(event) => openRowMenu(event, node)}>
            <span className="file-browser__glyph" aria-hidden="true"><Icon /></span>
            <span className="file-browser__metadata">
              {isRenaming ? <input ref={inputRef} className="file-browser__inline-input" value={edit.value} readOnly={edit.pending} aria-busy={edit.pending}
                aria-label={`Rename ${node.label}`} aria-invalid={!!edit.error} aria-describedby={edit.error ? errorId : undefined}
                onChange={(event) => setEdit((current) => ({ ...current, value: event.target.value, error: '', retry: false }))}
                onKeyDown={handleEditKeyDown} onBlur={() => { if (!edit?.pending) setEdit(null); }} />
                : <><span className="file-browser__name" title={node.label}>{node.label}</span>
                  <span className="file-browser__subtext">{isFolder ? (childCount ? 'Folder · open to browse' : 'Empty folder') : presentation.label}</span></>}
            </span>
            <button type="button" className="file-browser__dots" onClick={(event) => openRowMenu(event, node)}
              aria-label={`Actions for ${node.label}`} title={`Actions for ${node.label}`} aria-haspopup="menu" disabled={edit?.pending}><FiMoreHorizontal aria-hidden="true" /></button>
            {isRenaming && edit.error && <span className="file-browser__inline-error" id={errorId} role="alert">{edit.error}{edit.retry ? ' — edit and press Enter to retry' : ''}</span>}
          </div>;
        })}

        {edit?.kind === 'create' && <div className={`file-browser__item file-browser__item--editing${edit.type === 'folder' ? ' file-browser__item--folder' : ''}`}>
          <span className="file-browser__glyph" aria-hidden="true">{edit.type === 'folder' ? <FiFolder /> : <FiFileText />}</span>
          <span className="file-browser__metadata"><input ref={inputRef} className="file-browser__inline-input" value={edit.value}
            placeholder={edit.type === 'folder' ? 'folder-name' : 'chapter.tex'} readOnly={edit.pending} aria-busy={edit.pending}
            aria-label={`New ${edit.type} name`} aria-invalid={!!edit.error} aria-describedby={edit.error ? 'file-browser-create-error' : undefined}
            onChange={(event) => setEdit((current) => ({ ...current, value: event.target.value, error: '', retry: false }))}
            onKeyDown={handleEditKeyDown} onBlur={() => { if (!edit?.pending) setEdit(null); }} /></span>
          {edit.pending && <FiLoader className="file-browser__spinner" aria-label="Saving" />}
          {edit.error && <span className="file-browser__inline-error" id="file-browser-create-error" role="alert">{edit.error}{edit.retry ? ' — edit and press Enter to retry' : ''}</span>}
        </div>}

        {!visibleNodes.length && edit?.kind !== 'create' && <div className="file-browser__empty"><strong>This folder is empty</strong>Create a file here or return with the breadcrumb.</div>}
      </div>

      {operation && <section className="file-browser__operations" aria-label="Recent file operations">
        <div className="file-browser__operations-heading">Operations <span>Current session</span></div>
        <div className={`file-browser__operation${operation.status === 'error' ? ' is-error' : ''}`}>
          {operation.status === 'pending' ? <FiLoader className="file-browser__spinner" aria-hidden="true" /> : <FiAlertCircle aria-hidden="true" />}
          <span title={operation.name}>{operation.name}</span>
          {operation.status === 'pending' ? <span>Uploading…</span> : <button type="button" onClick={() => uploadImage(operation.file, operation.directoryId)} disabled={readOnly}>Retry</button>}
          {operation.status === 'error' && <small>{operation.error}</small>}
        </div>
      </section>}

      {contextMenu && <div ref={menuRef} className="file-browser__menu" role="menu"
        style={{ left: contextMenu.left, top: contextMenu.top }} onKeyDown={handleMenuKeyDown}>
        {contextMenu.kind === 'options' ? <>
          <div className="file-browser__menu-note">{readOnly ? 'View only' : 'Editing'}</div>
          <button type="button" role="menuitem" onClick={() => rootId && openDirectory(rootId)} disabled={!rootId || currentDirectoryId === rootId}><FiFolder aria-hidden="true" /> Return to project root</button>
        </> : menuNode ? <>
          {menuNode.type === 'folder' && <><button type="button" role="menuitem" onClick={() => openDirectory(menuNode.id)}><FiFolder aria-hidden="true" /> Open folder</button><div className="file-browser__menu-separator" role="separator" /></>}
          <button type="button" role="menuitem" onClick={() => beginRename(menuNode)} disabled={readOnly} title={readOnly ? 'Unavailable in view-only mode' : undefined}><FiEdit2 aria-hidden="true" /> Rename</button>
          <button type="button" role="menuitem" disabled title="Duplicate unavailable"><FiCopy aria-hidden="true" /> Duplicate <small>Unavailable</small></button>
          <button type="button" role="menuitem" onClick={() => copyPath(menuNode.id)}><FiCopy aria-hidden="true" /> Copy relative path</button>
          <button type="button" role="menuitem" disabled title="Download unavailable"><FiDownload aria-hidden="true" /> Download <small>Unavailable</small></button>
          <div className="file-browser__menu-separator" role="separator" />
          <button type="button" role="menuitem" className="file-browser__menu-delete" disabled={readOnly}
            title={readOnly ? 'Unavailable in view-only mode' : undefined}
            onClick={() => { closeMenu(false); setDeleteTarget(menuNode); }}><FiTrash2 aria-hidden="true" /> Delete</button>
        </> : null}
      </div>}

      {deleteTarget && <DeleteConfirmModal itemName={deleteTarget.label} itemType={deleteTarget.type}
        onConfirm={confirmDelete} onCancel={() => { if (!deletePending) setDeleteTarget(null); }} />}
      {toast && <div className={`file-browser__toast is-${toast.kind}`} role="status">{toast.message}</div>}
    </section>
  );
};

export default FileTree;
