import { authFetch } from '../contexts/AuthContext';

const API_HOST = import.meta.env.VITE_API_HOST || 'http://localhost:3000';

export const fetchProjectTree = async (projectId) => {
  const response = await authFetch(`/projects/v1/projects/${projectId}/tree`);
  if (!response.ok) {
    throw new Error(`Failed to fetch project tree: ${response.statusText}`);
  }
  return response.json();
};



// Get file content
export const fetchFileContent = async (projectId, fileId, content) => {
  // Fetch presigned url for direct upload
  const response = await authFetch(
    `/projects/v1/projects/${projectId}/files/${fileId}`,
    { method: 'GET' }
  );

  if (!response.ok) { // Error fetching upload url
    throw new Error(`Failed to save file: ${response.statusText}`);
  }

  const url = response.upload_url;

  const downloadRsponse = await fetch(response.download_url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/octet-stream', 
    },
    body: content,
  });

  return downloadResponse.json();
};



// Save file content
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
  console.log(`Upload URL:\t${url}`)

  const uploadResponse = await fetch(response.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream', 
    },
    body: content,
  });

  return uploadResponse.json();
};



// Create a new file in a folder
export const createFile = async (projectId, parentFolderId, filename) => {
  const response = await authFetch(`/projects/v1/projects/${projectId}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      directory_id: parentFolderId,
      filename: filename,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create file: ${response.statusText}`);
  }
  return response.json();
};


// Create a new folder
export const createFolder = async (projectId, parentFolderId, folderName) => {
  const response = await authFetch(`/projects/v1/projects/${projectId}/directories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parent_id: parentFolderId,
      name: folderName,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create folder: ${response.statusText}`);
  }
  return response.json();
};


// Delete a file or folder
export const deleteItem = async (projectId, itemId, itemType) => {
  const endpoint = itemType === 'file' ? 'files' : 'directories';
  const response = await authFetch(`/projects/v1/projects/${projectId}/${endpoint}/${itemId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete ${itemType}: ${response.statusText}`);
  }
  return response.json();
};

// Rename a file or folder
export const renameItem = async (projectId, itemId, itemType, newName) => {
  const endpoint = itemType === 'file' ? 'files' : 'directories';
  let body = JSON.stringify({name: newName})
  if (itemType === `file`)
    body = JSON.stringify({ filename: newName })
  const response = await authFetch(`/projects/v1/projects/${projectId}/${endpoint}/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body,
  });
  if (!response.ok) {
    throw new Error(`Failed to rename ${itemType}: ${response.statusText}`);
  }
  return response.json();
};


