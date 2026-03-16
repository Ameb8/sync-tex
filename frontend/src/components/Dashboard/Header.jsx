import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './Header.css';

function Header({ onNewProject, onImport }) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef(null);
  const navigate = useNavigate();
  const { user, logout, isAuthenticated } = useAuth();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setShowProfileMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (!isAuthenticated) {
    return (
      <header className="dashboard-header">
        <div className="header-logo">
          <h1>SyncTeX</h1>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => navigate('/login')}>
            Log In
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="dashboard-header">
      <div className="header-actions">
        <button className="btn btn-primary" onClick={onNewProject}>
          <span className="icon">+</span> New Project
        </button>
        <button className="btn btn-secondary" onClick={onImport}>
          Import
        </button>
      </div>

      <div className="header-profile" ref={profileMenuRef}>
        <button 
          className="profile-button"
          onClick={() => setShowProfileMenu(!showProfileMenu)}
        >
          <span className="profile-avatar">{getInitials(user?.name)}</span>
          <span className="profile-name">{user?.name || user?.email || 'User'}</span>
          <span className="icon-dropdown">▾</span>
        </button>

        {showProfileMenu && (
          <div className="profile-dropdown">
            <div className="profile-dropdown-item profile-info">
              <strong>{user?.name}</strong>
              <span className="profile-email">{user?.email}</span>
            </div>
            <div className="profile-dropdown-divider" />
            <button className="profile-dropdown-item" onClick={() => navigate('/settings')}>
              Settings
            </button>
            <button className="profile-dropdown-item" onClick={() => navigate('/account')}>
              Account
            </button>
            <div className="profile-dropdown-divider" />
            <button className="profile-dropdown-item" onClick={handleLogout}>
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;