import { authFetch } from '../contexts/AuthContext';

const API_HOST = import.meta.env.VITE_API_HOST || 'http://localhost:3000';

export const fetchProjectTree = async (projectId) => {
  const response = await authFetch(`/projects/v1/projects/${projectId}/tree`);
  if (!response.ok) {
    throw new Error(`Failed to fetch project tree: ${response.statusText}`);
  }
  return response.json();
};

export const fetchFileContent = async (downloadUrl) => {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }
  return response.text();
};

// # Save file content
export const saveFileContent = async (projectId, fileId, content) => {
  const response = await authFetch(`${API_HOST}/projects/v1/projects/${projectId}/files/${fileId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    throw new Error(`Failed to save file: ${response.statusText}`);
  }
  return response.json();
};