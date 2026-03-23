import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { acceptCollaboratorLink } from '../../api/collaborators';
import './JoinProjectModal.css';

const JoinProjectModal = ({ onClose }) => {
  const [inviteLink, setInviteLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const extractTokenFromLink = (link) => {
    // Handle various link formats:
    // Full URL: http://localhost:3000/join/token123
    // Partial: /join/token123
    // Just token: token123
    const urlMatch = link.match(/\/join\/([a-zA-Z0-9_-]+)$/);
    if (urlMatch) return urlMatch[1];
    
    const lastSegment = link.split('/').pop();
    if (lastSegment && lastSegment.length > 10) return lastSegment;
    
    return link;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!inviteLink.trim()) {
      setError('Please enter an invite link or token');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = extractTokenFromLink(inviteLink.trim());
      const response = await acceptCollaboratorLink(token);

      if (response.project_id) {
        onClose();
        navigate(`/project/${response.project_id}`);
      } else {
        setError('Invalid response from server');
      }
    } catch (err) {
      setError(err.message || 'Failed to join project. Check your link and try again.');
      console.error('Failed to join project:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content join-project-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Join Project</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="join-project-form">
          <p className="join-project-description">
            Enter the invite link you received to join a shared project.
          </p>

          <div className="form-group">
            <label htmlFor="invite-link" className="form-label">
              Invite Link or Token
            </label>
            <input
              id="invite-link"
              type="text"
              className="form-input"
              placeholder="e.g., http://localhost:3000/join/abc123xyz"
              value={inviteLink}
              onChange={(e) => setInviteLink(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <p className="form-hint">
              Paste the full link you received or just the token
            </p>
          </div>

          {error && (
            <div className="error-message">
              <span className="error-icon">⚠</span>
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !inviteLink.trim()}
            >
              {loading ? 'Joining...' : 'Join Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JoinProjectModal;