import React, { useState, useRef, useEffect } from 'react';
import './Header.css';

function Header({ onNewProject, onImport }) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef(null);

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
          <span className="profile-avatar">A</span>
          <span className="profile-name">Profile</span>
          <span className="icon-dropdown">▾</span>
        </button>

        {showProfileMenu && (
          <div className="profile-dropdown">
            <div className="profile-dropdown-item">
              <strong>alex@university.edu</strong>
            </div>
            <div className="profile-dropdown-divider" />
            <button className="profile-dropdown-item">Settings</button>
            <button className="profile-dropdown-item">Account</button>
            <div className="profile-dropdown-divider" />
            <button className="profile-dropdown-item">Sign Out</button>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;