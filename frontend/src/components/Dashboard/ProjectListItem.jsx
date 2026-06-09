import React from 'react';
import { useNavigate } from 'react-router-dom';
import './ProjectListItem.css';

function ProjectListItem({ project, onProjectIntent }) {
  const navigate = useNavigate();

  const handleClick = () => {
    onProjectIntent?.();
    navigate(`/project/${project.id}`);
  };

  const getRoleBadge = (role) => {
    const roleConfig = {
      owner:  { label: 'Owner',  className: 'role-badge--owner' },
      editor: { label: 'Editor', className: 'role-badge--editor' },
      reader: { label: 'Reader', className: 'role-badge--reader' },
    };
    return roleConfig[role] ?? { label: role, className: '' };
  };

  const { label, className } = getRoleBadge(project.role)

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString(undefined, options);
  };

  return (
    <li
      className="project-list-item"
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
      <div className="project-list-icon">📄</div>
      <div className="project-list-content">
        <span className="project-list-name">{project.name}</span>
        <span className={`role-badge ${className}`}>{label}</span>
        <span className="project-list-separator">-</span>
        <span className="project-list-date">{formatDate(project.created_at)}</span>
      </div>
    </li>
  );
}

export default ProjectListItem;
