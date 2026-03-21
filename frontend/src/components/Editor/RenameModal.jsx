// src/components/Editor/RenameModal.jsx
import { useState, useRef, useEffect } from 'react';
import './RenameModal.css';

const RenameModal = ({ currentName, itemType, onSubmit, onCancel }) => {
  const [newName, setNewName] = useState(currentName);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      // Select all text for easy replacement
      inputRef.current.select();
    }
  }, []);

  const validateName = (value) => {
    if (!value.trim()) {
      return 'Name cannot be empty';
    }
    if (value.includes('/') || value.includes('\\')) {
      return 'Name cannot contain slashes';
    }
    if (itemType === 'file' && !value.includes('.')) {
      return 'File must have an extension (e.g., .tex, .bib)';
    }
    if (value === currentName) {
      return 'New name must be different from current name';
    }
    return '';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validationError = validateName(newName);
    if (validationError) {
      setError(validationError);
      return;
    }
    onSubmit(newName.trim());
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Rename {itemType}</h3>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="rename-name">New name</label>
            <input
              ref={inputRef}
              id="rename-name"
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder={itemType === 'file' ? 'example.tex' : 'folder-name'}
              className={error ? 'error' : ''}
            />
            {error && <p className="error-message">{error}</p>}
          </div>

          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-submit">
              Rename
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RenameModal;