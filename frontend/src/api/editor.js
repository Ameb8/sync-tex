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
  // Fetch presigned url for direct upload
  const response = await authFetch(
    `/projects/v1/projects/${projectId}/files/${fileId}/upload`,
    { method: 'PUT' }
  );

  if (!response.ok) { // Error fetching upload url
    throw new Error(`Failed to save file: ${response.statusText}`);
  }

  const url = response.upload_url;

  response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream', 
    },
    body: content,
  });

  return response.json();
};