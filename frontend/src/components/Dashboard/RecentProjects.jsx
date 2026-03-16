import React from 'react';
import ProjectCard from './ProjectCard';
import './RecentProjects.css';

function RecentProjects({ projects, loading }) {
  if (loading) {
    return (
      <section className="recent-projects">
        <h2 className="section-title">Recent Projects</h2>
        <div className="projects-grid">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="project-card-skeleton" />
          ))}
        </div>
      </section>
    );
  }

  if (projects.length === 0) {
    return (
      <section className="recent-projects">
        <h2 className="section-title">Recent Projects</h2>
        <div className="empty-state">
          <p>No projects yet. Create your first LaTeX project!</p>
        </div>
      </section>
    );
  }

  return (
    <section className="recent-projects">
      <h2 className="section-title">Recent Projects</h2>
      <div className="projects-grid">
        {projects.map(project => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}

export default RecentProjects;