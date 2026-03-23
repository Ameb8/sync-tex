// src/api/collaborators.js
import { authFetch } from '../contexts/AuthContext';

const API_HOST = import.meta.env.VITE_API_HOST || 'http://localhost:3000';

// Generate a new collaborator link
export const generateCollaboratorLink = async (projectId, accessLevel) => {
  const response = await authFetch(
    `/projects/v1/projects/${projectId}/invites`,
    { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: accessLevel }), // 'editor` or `viewer`
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to generate link: ${response.statusText}`);
  }

  return response.json();
};

// Get all collaborator links for a project
export const fetchCollaboratorLinks = async (projectId) => {
  const response = await authFetch(
    `/projects/v1/projects/${projectId}/collaborators/links`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch links: ${response.statusText}`);
  }

  return response.json();
};

// Get all active collaborators (members)
export const fetchCollaborators = async (projectId) => {
  const response = await authFetch(
    `/projects/v1/projects/${projectId}/collaborators`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch collaborators: ${response.statusText}`);
  }

  return response.json();
};

// Remove a collaborator from the project
export const removeCollaborator = async (projectId, collaboratorId) => {
  const response = await authFetch(
    `/projects/v1/projects/${projectId}/collaborators/${collaboratorId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    throw new Error(`Failed to remove collaborator: ${response.statusText}`);
  }

  return response.json();
};

// Revoke a specific collaborator link
export const revokeCollaboratorLink = async (projectId, linkId) => {
  const response = await authFetch(
    `/projects/v1/projects/${projectId}/collaborators/links/${linkId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    throw new Error(`Failed to revoke link: ${response.statusText}`);
  }

  return response.json();
};

export const acceptCollaboratorLink = async (token) => {
  const response = await authFetch('/projects/v1/invites/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to join project`);
  }

  return response.json();
};