import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CollaboratorsPanel from './CollaboratorsPanel';

/**
 * RightSidebar
 *
 * The right panel with Info and Share tabs.
 *
 * Owns sidebarTab state internally — EditorView doesn't need to know which
 * tab is active here.
 *
 * Props:
 *   projectId         — for CollaboratorsPanel
 *   activeTab         — current tab object (null if nothing open)
 *   isActiveCollab    — bool
 *   isActiveFileDirty — bool
 *   isSaving          — bool
 *   activeContent     — string (for line count / size on non-collab files)
 *   onSave            — () => void
 */
const RightSidebar = ({
  projectId,
  activeTab,
  isActiveCollab,
  isActiveFileDirty,
  isSaving,
  activeContent,
  onSave,
}) => {
  const navigate = useNavigate();
  const [sidebarTab, setSidebarTab] = useState('info');

  return (
    <div className="editor-sidebar-right">
      <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>

        {/* Tab nav */}
        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border-color, #e0e0e0)' }}>
          <button
            onClick={() => navigate('/projects')}
            className="home-button"
            title="Back to dashboard"
          >
            ← Dashboard
          </button>

          {[['info', 'Info'], ['collaborators', 'Share']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSidebarTab(key)}
              className={`sidebar-tab ${sidebarTab === key ? 'active' : ''}`}
              style={{
                flex: 1, padding: '12px 16px', border: 'none', background: 'transparent',
                color: sidebarTab === key ? 'var(--text-info, #1f80dd)' : 'var(--text-secondary, #666)',
                fontSize: '13px', fontWeight: '500', cursor: 'pointer',
                borderBottom: sidebarTab === key ? '2px solid var(--text-info, #1f80dd)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Info tab */}
        {sidebarTab === 'info' && (
          <div className="sidebar-content">
            {activeTab && (
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
                {isActiveCollab ? (
                  <div className="info-card">
                    <p className="info-label">Mode</p>
                    <p className="info-value" style={{ color: 'var(--text-info, #1f80dd)' }}>
                      Live collaboration
                    </p>
                  </div>
                ) : (
                  <>
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
                <div className="info-card">
                  <p className="info-label">Save</p>
                  <button
                    onClick={onSave}
                    disabled={(!isActiveCollab && !isActiveFileDirty) || isSaving}
                    className="save-button"
                    title="Save file (Ctrl+S)"
                  >
                    {isSaving ? '⏳ Saving…' : '💾 Save'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Collaborators tab */}
        {sidebarTab === 'collaborators' && <CollaboratorsPanel projectId={projectId} />}
      </div>
    </div>
  );
};

export default RightSidebar;
