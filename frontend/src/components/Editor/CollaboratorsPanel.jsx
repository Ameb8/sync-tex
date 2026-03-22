// src/components/Editor/CollaboratorsPanel.jsx
import { useState, useEffect } from 'react';
import {
  generateCollaboratorLink,
  fetchCollaboratorLinks,
  fetchCollaborators,
  removeCollaborator,
  revokeCollaboratorLink,
} from '../../api/collaborators';
import './CollaboratorsPanel.css';

const CollaboratorsPanel = ({ projectId }) => {
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
        setCollaborators(collabData.collaborators || []);
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
      setLinks((prev) => [response.link, ...prev]);
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error('Failed to generate link:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async (link) => {
    const fullLink = `${window.location.origin}/join/${link.token}`;
    try {
      await navigator.clipboard.writeText(fullLink);
      setCopiedLinkId(link.id);
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
        setLinks((prev) => prev.filter((l) => l.id !== linkId));
        setError(null);
      } catch (err) {
        setError(err.message);
        console.error('Failed to revoke link:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleRemoveCollaborator = async (collaboratorId) => {
    if (window.confirm('Remove this collaborator? They will lose access to the project.')) {
      try {
        setLoading(true);
        await removeCollaborator(projectId, collaboratorId);
        setCollaborators((prev) => prev.filter((c) => c.id !== collaboratorId));
        setError(null);
      } catch (err) {
        setError(err.message);
        console.error('Failed to remove collaborator:', err);
      } finally {
        setLoading(false);
      }
    }
  };

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
          Members ({collaborators.length})
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
                <option value="read">Read Only</option>
                <option value="write">Read & Write</option>
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
                {links.map((link) => (
                  <div key={link.id} className="collab-link-item">
                    <div className="collab-link-info">
                      <div className="collab-link-badge">{link.access_level}</div>
                      <div className="collab-link-meta">
                        <p className="collab-link-created">
                          Created {new Date(link.created_at).toLocaleDateString()}
                        </p>
                        <p className="collab-link-count">
                          {link.joined_count || 0} joined
                        </p>
                      </div>
                    </div>
                    <div className="collab-link-actions">
                      <button
                        onClick={() => handleCopyLink(link)}
                        className="collab-btn collab-btn-secondary"
                        title="Copy link to clipboard"
                      >
                        {copiedLinkId === link.id ? '✓ Copied' : 'Copy'}
                      </button>
                      <button
                        onClick={() => handleRevokeLink(link.id)}
                        className="collab-btn collab-btn-danger"
                        title="Revoke this link"
                      >
                        Revoke
                      </button>
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
          <div className="collab-section">
            <h3 className="collab-section-title">Project Members</h3>
            {collaborators.length === 0 ? (
              <p className="collab-empty">No collaborators yet. Share a link to invite people.</p>
            ) : (
              <div className="collab-members-list">
                {collaborators.map((collab) => (
                  <div key={collab.id} className="collab-member-item">
                    <div className="collab-member-avatar">
                      {collab.name?.charAt(0).toUpperCase() || '?'}
                    </div>
                    <div className="collab-member-info">
                      <p className="collab-member-name">{collab.name || collab.email}</p>
                      <p className="collab-member-meta">
                        <span className="collab-member-access">{collab.access_level}</span>
                        <span className="collab-member-joined">
                          Joined {new Date(collab.joined_at).toLocaleDateString()}
                        </span>
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveCollaborator(collab.id)}
                      className="collab-btn collab-btn-danger"
                      title="Remove collaborator"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CollaboratorsPanel;