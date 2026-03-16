import React, { useState, useRef } from 'react';
import './Modal.css';

function ImportModal({ onClose, onProjectImported }) {
  const [importing, setImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!selectedFile) {
      alert('Please select a file to import');
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      // TODO: Replace with actual API call
      const response = await fetch('/api/projects/import', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        onProjectImported();
      } else {
        throw new Error('Failed to import project');
      }
    } catch (error) {
      console.error('Error importing project:', error);
      alert('Failed to import project. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import Project</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label htmlFor="file-input">Select .zip file</label>
            <input
              id="file-input"
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              className="form-input"
            />
            {selectedFile && (
              <p className="file-selected">Selected: {selectedFile.name}</p>
            )}
          </div>

          <div className="import-info">
            <p>Upload a .zip file containing your LaTeX project files.</p>
            <p className="text-muted">Supported files: .tex, .bib, .cls, .sty, images</p>
          </div>

          <div className="modal-footer">
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={onClose}
              disabled={importing}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={importing}
            >
              {importing ? 'Importing...' : 'Import Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ImportModal;