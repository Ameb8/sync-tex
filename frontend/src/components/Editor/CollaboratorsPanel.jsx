// src/components/Editor/CollaboratorsPanel.jsx
import { useState, useEffect, useMemo } from 'react';
import {
  generateCollaboratorLink,
  fetchCollaboratorLinks,
  fetchCollaborators,
  removeCollaborator,
  revokeCollaboratorLink,
} from '../../api/collaborators';
import './CollaboratorsPanel.css';

const getPersonKeys = (person) => {
  if (!person) return [];

  return [person.user_id, person.id, person.email]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => String(value));
};

const getDisplayName = (person) => person?.name || person?.email || 'Unknown user';

const getAvatarUrl = (person) => (
  person?.avatar_url || person?.avatarUrl || person?.picture || ''
);

const getInitial = (person) => {
  const name = person?.name?.trim();
  const email = person?.email?.trim();

  if (name) return name.charAt(0).toUpperCase();
  if (email) return email.charAt(0).toUpperCase();
  return '?';
};

const renderAvatar = (person, className, presenceColor) => {
  const avatarUrl = getAvatarUrl(person);
  const liveClass = presenceColor ? 'collab-avatar--live' : '';
  const imageClass = avatarUrl ? 'collab-avatar--image' : '';

  return (
    <div
      className={`${className} ${liveClass} ${imageClass}`}
      style={presenceColor ? { '--presence-color': presenceColor } : undefined}
      aria-hidden="true"
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" />
      ) : (
        getInitial(person)
      )}
    </div>
  );
};

const CollaboratorsPanel = ({ projectId, liveEditors = [] }) => {
  const [activeTab, setActiveTab] = useState('share');
  const [links, setLinks] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedAccessLevel, setSelectedAccessLevel] = useState('read');
  const [copiedLinkId, setCopiedLinkId] = useState(null);

  // Load data when panel mounts or tab changes
  useEffect(() => {
    loadData();
  }, [projectId, activeTab]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      if (activeTab === 'share') {
        const linksData = await fetchCollaboratorLinks(projectId);
        setLinks(linksData.links || []);
      } else if (activeTab === 'members') {
        const collabData = await fetchCollaborators(projectId);
        // API returns an array directly
        setCollaborators(Array.isArray(collabData) ? collabData : (collabData.collaborators || []));
      }
    } catch (err) {
      setError(err.message);
      console.error('Failed to load collaborators data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateLink = async () => {
    try {
      setLoading(true);
      const response = await generateCollaboratorLink(projectId, selectedAccessLevel);
      setLinks((prev) => [response, ...prev]);
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error('Failed to generate link:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async (item) => {
    try {
      await navigator.clipboard.writeText(item.link);
      setCopiedLinkId(item.id);
      setTimeout(() => setCopiedLinkId(null), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleRevokeLink = async (linkId) => {
    if (window.confirm('Revoke this link? Anyone with it will no longer be able to join.')) {
      try {
        setLoading(true);
        await revokeCollaboratorLink(projectId, linkId);
        setLinks((prev) => prev.filter((l) => l.invite_id !== linkId));
        setError(null);
      } catch (err) {
        setError(err.message);
        console.error('Failed to revoke link:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRemoveCollaborator = async (userId) => {
    if (window.confirm('Remove this collaborator? They will lose access to the project.')) {
      try {
        setLoading(true);
        await removeCollaborator(projectId, userId);
        // API uses user_id, not id
        setCollaborators((prev) => prev.filter((c) => c.user_id !== userId));
        setError(null);
      } catch (err) {
        setError(err.message);
        console.error('Failed to remove collaborator:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  const collaboratorsByKey = useMemo(() => {
    const next = new Map();

    collaborators.forEach((collab) => {
      getPersonKeys(collab).forEach((key) => next.set(key, collab));
    });

    return next;
  }, [collaborators]);

  const liveEditorRows = useMemo(() => {
    const rowsByUser = new Map();

    liveEditors.forEach((editor) => {
      const awarenessUser = editor.user;
      const userKeys = getPersonKeys(awarenessUser);
      const primaryKey = userKeys[0] || String(editor.clientId);
      if (rowsByUser.has(primaryKey)) return;

      const matchingCollaborator = userKeys
        .map((key) => collaboratorsByKey.get(key))
        .find(Boolean);

      rowsByUser.set(primaryKey, {
        ...matchingCollaborator,
        ...awarenessUser,
        user_id: matchingCollaborator?.user_id || awarenessUser?.id || primaryKey,
        name: awarenessUser?.name || matchingCollaborator?.name,
        email: awarenessUser?.email || matchingCollaborator?.email,
        avatar_url: awarenessUser?.avatar_url || matchingCollaborator?.avatar_url,
        color: awarenessUser?.color,
      });
    });

    return Array.from(rowsByUser.values()).sort((a, b) => (
      getDisplayName(a).localeCompare(getDisplayName(b))
    ));
  }, [collaboratorsByKey, liveEditors]);

  const liveEditorsByKey = useMemo(() => {
    const next = new Map();

    liveEditorRows.forEach((editor) => {
      getPersonKeys(editor).forEach((key) => next.set(key, editor));
    });

    return next;
  }, [liveEditorRows]);

  const getLiveEditorForCollaborator = (collab) => (
    getPersonKeys(collab)
      .map((key) => liveEditorsByKey.get(key))
      .find(Boolean)
  );

  return (
    <div className="collaborators-panel">
      {/* Tab Navigation */}
      <div className="collab-tabs">
        <button
          className={`collab-tab ${activeTab === 'share' ? 'active' : ''}`}
          onClick={() => setActiveTab('share')}
        >
          Share
        </button>
        <button
          className={`collab-tab ${activeTab === 'members' ? 'active' : ''}`}
          onClick={() => setActiveTab('members')}
        >
          Members{collaborators.length > 0 ? ` (${collaborators.length})` : ''}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="collab-error">
          <p>{error}</p>
        </div>
      )}

      {/* Share Tab */}
      {activeTab === 'share' && (
        <div className="collab-tab-content">
          <div className="collab-section">
            <h3 className="collab-section-title">Generate Share Link</h3>
            <p className="collab-section-desc">
              Anyone with the link can join this project with the selected access level.
            </p>

            <div className="collab-form-group">
              <label htmlFor="access-level" className="collab-label">
                Access Level
              </label>
              <select
                id="access-level"
                className="collab-select"
                value={selectedAccessLevel}
                onChange={(e) => setSelectedAccessLevel(e.target.value)}
                disabled={loading}
              >
                <option value="viewer">Read Only</option>
                <option value="editor">Read & Write</option>
              </select>
            </div>

            <button
              onClick={handleGenerateLink}
              disabled={loading}
              className="collab-btn collab-btn-primary"
            >
              {loading ? 'Generating...' : 'Generate Link'}
            </button>
          </div>

          {/* Links List */}
          <div className="collab-section">
            <h3 className="collab-section-title">Active Links</h3>
            {links.length === 0 ? (
              <p className="collab-empty">No active links. Generate one to get started.</p>
            ) : (
              <div className="collab-links-list">
                {links.map((item) => (
                  <div key={item.invite_id} className="collab-link-item">
                    <div className="collab-link-row-top">
                      <div className="collab-link-badge">{item.role}</div>
                      <div className="collab-link-actions">
                        <button
                          onClick={() => handleCopyLink(item)}
                          className="collab-btn collab-btn-secondary"
                          title="Copy link to clipboard"
                        >
                          {copiedLinkId === item.id ? '✓ Copied' : 'Copy'}
                        </button>
                        <button
                          onClick={() => handleRevokeLink(item.invite_id)}
                          className="collab-btn collab-btn-danger"
                          title="Revoke this link"
                        >
                          Revoke
                        </button>
                      </div>
                    </div>
                    <div className="collab-link-row-bottom">
                      <p className="collab-link-url">{item.link}</p>
                      <p className="collab-link-meta-line">
                        Created {new Date(item.created_at).toLocaleDateString()}
                        {' · '}
                        {item.joined_count || 0} joined
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="collab-tab-content">
          <div className="collab-section collab-live-section">
            <h3 className="collab-section-title">Currently editing</h3>
            {liveEditorRows.length === 0 ? (
              <p className="collab-empty collab-empty-compact">No other editors connected.</p>
            ) : (
              <div className="collab-live-list">
                {liveEditorRows.map((editor) => (
                  <div
                    key={editor.user_id || editor.id || editor.email}
                    className="collab-live-editor"
                    style={editor.color ? { '--presence-color': editor.color } : undefined}
                    title={getDisplayName(editor)}
                  >
                    {renderAvatar(editor, 'collab-live-avatar', editor.color)}
                    <p className="collab-live-name">{getDisplayName(editor)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="collab-section">
            <h3 className="collab-section-title">Project Members</h3>
            {loading ? (
              <p className="collab-empty">Loading...</p>
            ) : collaborators.length === 0 ? (
              <p className="collab-empty">No collaborators yet. Share a link to invite people.</p>
            ) : (
              <div className="collab-members-list">
                {collaborators.map((collab) => {
                  const liveEditor = getLiveEditorForCollaborator(collab);
                  const avatarSource = liveEditor ? {
                    ...collab,
                    avatar_url: collab.avatar_url || liveEditor.avatar_url,
                    avatarUrl: collab.avatarUrl || liveEditor.avatarUrl,
                    picture: collab.picture || liveEditor.picture,
                  } : collab;

                  return (
                    <div key={collab.user_id} className="collab-member-item">
                      {renderAvatar(avatarSource, 'collab-member-avatar', liveEditor?.color)}
                      <div className="collab-member-info">
                        {/* Name on top, email below */}
                        <p className="collab-member-name">{getDisplayName(collab)}</p>
                        {collab.name && (
                          <p className="collab-member-email">{collab.email}</p>
                        )}
                        <p className="collab-member-meta">
                          {/* role from API: "editor" | "viewer" */}
                          <span className={`collab-member-access collab-member-access--${collab.role}`}>
                            {collab.role}
                          </span>
                          <span className="collab-member-joined">
                            {new Date(collab.invited_at).toLocaleDateString()}
                          </span>
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemoveCollaborator(collab.user_id)}
                        className="collab-btn collab-btn-danger collab-btn-remove"
                        title="Remove collaborator"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CollaboratorsPanel;
