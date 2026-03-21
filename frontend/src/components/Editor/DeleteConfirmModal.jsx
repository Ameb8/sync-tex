// src/components/Editor/DeleteConfirmModal.jsx
import { useRef, useEffect } from 'react';
import './DeleteConfirmModal.css';

const DeleteConfirmModal = ({ itemName, itemType, onConfirm, onCancel }) => {
  const confirmButtonRef = useRef(null);

  useEffect(() => {
    // Focus the cancel button (safer default)
    confirmButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel} onKeyDown={handleKeyDown}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <p className="modal-title">Delete {itemType}</p>
        </div>
        
        <div className="modal-body">
          <p className="delete-message">
            Are you sure you want to delete <strong>{itemName}</strong>? This action cannot be undone.
          </p>
        </div>

        <div className="form-actions">
          <button 
            className="btn-cancel" 
            onClick={onCancel}
            ref={confirmButtonRef}
          >
            Cancel
          </button>
          <button 
            className="btn-delete"
            onClick={onConfirm}
          >
            Delete {itemType === 'file' ? 'File' : 'Folder'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmModal;