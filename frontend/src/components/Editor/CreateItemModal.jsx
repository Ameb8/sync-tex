import { useState, useRef, useEffect } from 'react';
import './CreateItemModal.css';

const CreateItemModal = ({ type, onSubmit, onCancel }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const validateName = (value) => {
    if (!value.trim()) {
      return 'Name cannot be empty';
    }
    if (value.includes('/') || value.includes('\\')) {
      return 'Name cannot contain slashes';
    }
    if (type === 'file' && !value.includes('.')) {
      return 'File must have an extension (e.g., .tex, .bib)';
    }
    return '';
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const validationError = validateName(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    onSubmit(name.trim());
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit(e);
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  const typeLabel = type === 'file' ? 'File' : 'Folder';

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">New {typeLabel}</h3>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="item-name">Name</label>
            <input
              ref={inputRef}
              id="item-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder={type === 'file' ? 'example.tex' : 'folder-name'}
              className={error ? 'error' : ''}
            />
            {error && <p className="error-message">{error}</p>}
          </div>

          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn-submit">
              Create {typeLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateItemModal;