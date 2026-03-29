import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Header from '../components/Dashboard/Header';
import RecentProjects from '../components/Dashboard/RecentProjects';
import AllProjects from '../components/Dashboard/AllProjects';
import NewProjectModal from '../components/Dashboard/NewProjectModal';
import ImportModal from '../components/Dashboard/ImportModal';
import JoinProjectModal from '../components/Dashboard/JoinProjectModal';
import { fetchProjects } from '../api/projects';
import './DashboardView.css';

function DashboardView() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all', 'my', 'shared', 'templates'
  const [sortBy, setSortBy] = useState('recent'); // 'recent', 'name', 'modified'
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [joinError, setJoinError] = useState(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    const err = searchParams.get('join_error');
    if (err) {
      setJoinError(
        err === 'missing_token' ? 'Invalid invite link.' : 'Invite link is invalid or has expired.'
      );
      navigate('/', { replace: true }); // clear query param
    }
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewProject = () => {
    setShowNewProjectModal(true);
  };

  const handleImport = () => {
    setShowImportModal(true);
  };

  const handleJoin = () => {
    setShowJoinModal(true);
  };


  const handleProjectCreated = () => {
    setShowNewProjectModal(false);
    loadProjects(); // Refresh the project list
  };

  const handleProjectImported = () => {
    setShowImportModal(false);
    loadProjects(); // Refresh the project list
  };

  // Filter projects based on current filter
  const filteredProjects = projects.filter(project => {
    if (filter === 'all') return true;
    if (filter === 'my') return project.isOwner;
    if (filter === 'shared') return !project.isOwner && project.collaborators?.length > 0;
    if (filter === 'templates') return project.isTemplate;
    return true;
  });

  // Sort projects
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    if (sortBy === 'recent') {
      return new Date(b.created_at) - new Date(a.created_at);
    }
    if (sortBy === 'name') {
      return a.name.localeCompare(b.name);
    }
    if (sortBy === 'modified') {
      return new Date(b.created_at) - new Date(a.created_at);
    }
    return 0;
  });

  // Recent projects (first 6 sorted by most recent)
  const recentProjects = sortedProjects.slice(0, 6);

  return (
    <div className="dashboard-view">
      {joinError && (
        <div className="join-error-toast" onClick={() => setJoinError(null)}>
          ⚠️ {joinError}
        </div>
      )}
      <Header 
        onNewProject={handleNewProject}
        onImport={handleImport}
        onJoin={handleJoin}
      />
      
      <div className="dashboard-content">
        <RecentProjects 
          projects={recentProjects}
          loading={loading}
        />
        
        <AllProjects 
          projects={sortedProjects}
          loading={loading}
          filter={filter}
          onFilterChange={setFilter}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />
      </div>

      {showNewProjectModal && (
        <NewProjectModal 
          onClose={() => setShowNewProjectModal(false)}
          onProjectCreated={handleProjectCreated}
        />
      )}

      {showImportModal && (
        <ImportModal 
          onClose={() => setShowImportModal(false)}
          onProjectImported={handleProjectImported}
        />
      )}

      {showJoinModal && (
        <JoinProjectModal 
          onClose={() => setShowJoinModal(false)}
        />
      )}
    </div>
  );
}

export default DashboardView;