import React from 'react';
import ProjectListItem from './ProjectListItem';
import './AllProjects.css';

function AllProjects({ projects, loading, filter, onFilterChange, sortBy, onSortChange }) {
  const filters = [
    { id: 'all', label: 'All Projects' },
    { id: 'my', label: 'My Projects' },
    { id: 'shared', label: 'Shared with Me' },
    { id: 'templates', label: 'Templates' }
  ];

  const sortOptions = [
    { id: 'recent', label: 'Recent' },
    { id: 'name', label: 'Name' },
    { id: 'modified', label: 'Modified' }
  ];

  return (
    <section className="all-projects">
      <div className="all-projects-header">
        <div className="filter-tabs">
          {filters.map(f => (
            <button
              key={f.id}
              className={`filter-tab ${filter === f.id ? 'active' : ''}`}
              onClick={() => onFilterChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        
        <div className="sort-dropdown">
          <label htmlFor="sort-select">Sorted by:</label>
          <select 
            id="sort-select"
            value={sortBy} 
            onChange={(e) => onSortChange(e.target.value)}
            className="sort-select"
          >
            {sortOptions.map(option => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="projects-list">
        {loading ? (
          <div className="loading-state">Loading projects...</div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <p>No projects found</p>
          </div>
        ) : (
          <ul className="project-items">
            {projects.map(project => (
              <ProjectListItem key={project.id} project={project} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default AllProjects;