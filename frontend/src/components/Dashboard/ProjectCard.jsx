import React from 'react';
import { useNavigate } from 'react-router-dom';
import './ProjectCard.css';

function ProjectCard({ project, onProjectIntent }) {
  const navigate = useNavigate();

  const handleClick = () => {
    onProjectIntent?.();
    navigate(`/project/${project.id}`);
  };

  const getRoleBadge = (role) => {
    const roleConfig = {
      owner: { label: 'Owner', className: 'role-badge--owner' },
      editor: { label: 'Editor', className: 'role-badge--editor' },
      reader: { label: 'Reader', className: 'role-badge--reader' },
    };
    return roleConfig[role] ?? { label: role, className: '' };
  };

  const formatTimeAgo = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const collaboratorCount = project.collaborators?.length || 0;
  const { label, className } = getRoleBadge(project.role);

  return (
    <div
      className="project-card"
      onClick={handleClick}
      onMouseEnter={onProjectIntent}
      onFocus={onProjectIntent}
      onPointerDown={onProjectIntent}
      tabIndex={0}
      role="button"
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick();
        }
      }}
    >
      <div className="project-card-icon">
        📄
      </div>
      <div className="project-card-content">
        <h3 className="project-card-title">{project.name}</h3>
        <span className={`role-badge ${className}`}>{label}</span>
        <p className="project-card-modified">
          Created {formatTimeAgo(project.created_at)}
        </p>
        {collaboratorCount > 0 && (
          <div className="project-card-collaborators">
            <span className="collaborator-icon">👤</span>
            {collaboratorCount > 1 && (
              <span className="collaborator-icon">👤</span>
            )}
            <span className="collaborator-count">
              ({collaboratorCount} collab{collaboratorCount > 1 ? 's' : ''})
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProjectCard;
