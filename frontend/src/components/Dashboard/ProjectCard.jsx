import React from 'react';
import { useNavigate } from 'react-router-dom';
import './ProjectCard.css';

function ProjectCard({ project }) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/project/${project.id}`);
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

  return (
    <div className="project-card" onClick={handleClick}>
      <div className="project-card-icon">
        📄
      </div>
      <div className="project-card-content">
        <h3 className="project-card-title">{project.name}</h3>
        <p className="project-card-modified">
          Modified {formatTimeAgo(project.lastModified)}
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