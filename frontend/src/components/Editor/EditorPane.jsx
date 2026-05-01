import Editor from '@monaco-editor/react';

/**
 * EditorPane
 *
 * Renders either:
 *   - A Monaco editor (for text/collab files)
 *   - An image preview (for image files)
 *
 * Also renders the collab connection indicator and the non-collab unsaved
 * indicator as overlays — they're logically part of the editor surface.
 *
 * This component is deliberately thin: it owns NO state and holds NO refs.
 * All refs (editorRef, etc.) live in EditorView and are passed via onMount.
 *
 * Props:
 *   activeTab         — current tab object (null if nothing open)
 *   isActiveImage     — bool: show image preview instead of editor
 *   isActiveCollab    — bool: Yjs owns the model, don't pass value
 *   activeContent     — string content for non-collab files ('' for collab)
 *   activeLanguage    — Monaco language ID
 *   isDarkMode        — bool
 *   activeCollabStatus — 'connecting' | 'connected' | 'disconnected' | null
 *   isActiveFileDirty — bool: unsaved non-collab changes exist
 *   isSaving          — bool
 *   imageUrl          — string: presigned URL for image preview
 *   onMount           — (editor, monaco) => void
 *   onChange          — (value) => void
 */
const EditorPane = ({
  activeTab,
  isActiveImage,
  isActiveCollab,
  activeContent,
  activeLanguage,
  isDarkMode,
  activeCollabStatus,
  isActiveFileDirty,
  isSaving,
  imageUrl,
  onMount,
  onChange,
  readOnly,
}) => {
  if (!activeTab) {
    return (
      <div className="editor-empty">
        <p>Select a file to start editing</p>
      </div>
    );
  }

  return (
    <>
      {isActiveImage ? (
        <div className="image-preview-container">
          <img
            src={imageUrl}
            alt={activeTab.filename}
            className="image-preview"
          />
          <div className="image-filename">{activeTab.filename}</div>
        </div>
      ) : (
        <Editor
          key={activeTab.id}
          height="100%"
          language={activeLanguage}
          value={isActiveCollab ? undefined : activeContent}
          onChange={onChange}
          onMount={onMount}
          theme={isDarkMode ? 'app-dark' : 'app-light'}
          options={{
            minimap:              { enabled: false },
            fontSize:             13,
            lineHeight:           1.6,
            tabSize:              2,
            wordWrap:             'on',
            automaticLayout:      true,
            scrollBeyondLastLine: false,
            fontFamily:           "'Menlo', 'Monaco', 'Courier New', monospace",
            readOnly:             !!readOnly,
          }}
        />
      )}

      {/* Collab connection status bar */}
      {isActiveCollab && (
        <div className={`collab-indicator collab-${activeCollabStatus}`}>
          <span className="collab-dot">⬤</span>
          {activeCollabStatus === 'connected'    && 'Live collaboration'}
          {activeCollabStatus === 'connecting'   && 'Connecting…'}
          {activeCollabStatus === 'disconnected' && 'Disconnected — attempting to reconnect'}
        </div>
      )}

      {/* Non-collab unsaved indicator */}
      {isActiveFileDirty && (
        <div className="save-indicator">
          <span className="unsaved-dot">●</span>
          <span className="save-hint">Press Ctrl+S to save</span>
        </div>
      )}

      {isSaving && <div className="saving-indicator">Saving…</div>}
    </>
  );
};

export default EditorPane;
