import { authFetch } from '../contexts/AuthContext';

// API endpoint configuration
const API_BASE_URL = '/projects/v1';

const downloadEndpoint = (projectId, target) => {
  const project = encodeURIComponent(projectId);
  if (target.kind === 'file') return `${API_BASE_URL}/projects/${project}/files/${encodeURIComponent(target.id)}/download`;
  if (target.kind === 'directory') return `${API_BASE_URL}/projects/${project}/directories/${encodeURIComponent(target.id)}/download`;
  if (target.kind === 'project') return `${API_BASE_URL}/projects/${project}/download`;
  throw new Error('Unknown download target');
};

const safeFilename = (value) => {
  if (typeof value !== 'string') return '';
  const filename = value.replace(/[\\/\u0000-\u001f\u007f]/g, '').trim().replace(/^\.+$/, '');
  return filename.slice(0, 255);
};

/** Extract a safe filename from an RFC 6266 Content-Disposition header. */
export const filenameFromDisposition = (header, fallback) => {
  let candidate = '';
  const extended = header?.match(/(?:^|;)\s*filename\*\s*=\s*([^;]+)/i)?.[1];
  if (extended) {
    const encoded = extended.trim().replace(/^"|"$/g, '');
    const parts = encoded.match(/^([^']*)'[^']*'(.*)$/);
    if (parts && /^utf-8$/i.test(parts[1])) {
      try { candidate = decodeURIComponent(parts[2]); } catch { /* use fallback below */ }
    }
  }
  if (!candidate) {
    const plain = header?.match(/(?:^|;)\s*filename\s*=\s*(?:"([^\"]*)"|([^;\s]*))/i);
    candidate = plain?.[1] ?? plain?.[2] ?? '';
  }
  return safeFilename(candidate) || safeFilename(fallback) || 'download';
};

const downloadError = async (response) => {
  let message = '';
  try {
    const body = await response.clone().json();
    message = body?.error?.message || body?.error || body?.message || body?.detail || '';
  } catch { /* errors are often empty or non-JSON */ }
  throw new Error(typeof message === 'string' && message.trim()
    ? message.trim()
    : `Could not download this item (${response.status}). Please try again.`);
};

const triggerBrowserDownload = (blob, filename) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  try {
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
};

/**
 * Fetch and save an authenticated file, directory archive, or project archive.
 * The response is deliberately consumed as a Blob: protected endpoints are
 * never navigated to and the bearer token never becomes part of a URL.
 */
export async function downloadProjectTarget(projectId, target, { signal } = {}) {
  const response = await authFetch(downloadEndpoint(projectId, target), { method: 'GET', signal });
  if (!response.ok) await downloadError(response);
  const blob = await response.blob();
  const fallback = target.kind === 'file' ? target.name : `${target.name || 'project'}.zip`;
  const filename = filenameFromDisposition(response.headers.get('Content-Disposition'), fallback);
  triggerBrowserDownload(blob, filename);
  return { filename };
}

export async function fetchProject(projectId) {
  const response = await authFetch(`${API_BASE_URL}/projects/${projectId}`);
  if (!response.ok) {
    throw new Error(`Failed to load project: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch all projects for the current user
 * @returns {Promise<Array>} Array of project objects
 */
export async function fetchProjects() {
  try {
    console.log("Fetching Projects")

    const response = await authFetch(`/projects/v1/projects`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching projects:', error);
    
    // Return mock data for development
    return getMockProjects();
  }
}

/**
 * Mock data for development/testing
 * Remove this when backend is ready
 */
function getMockProjects() {
  return [
    {
      id: '1',
      name: 'Thesis Draft',
      lastModified: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      collaborators: ['user1', 'user2'],
      isOwner: true,
      isTemplate: false
    },
    {
      id: '2',
      name: 'Research Paper v2',
      lastModified: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
      collaborators: [],
      isOwner: true,
      isTemplate: false
    },
    {
      id: '3',
      name: 'Conference Paper',
      lastModified: new Date('2026-03-01').toISOString(),
      collaborators: ['user3'],
      isOwner: true,
      isTemplate: false
    },
    {
      id: '4',
      name: 'Homework Set 5',
      lastModified: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Last week
      collaborators: [],
      isOwner: true,
      isTemplate: false
    },
    {
      id: '5',
      name: 'Lab Report Template',
      lastModified: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      collaborators: [],
      isOwner: true,
      isTemplate: true
    },
    {
      id: '6',
      name: 'Shared Project from Prof',
      lastModified: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      collaborators: ['prof', 'user4'],
      isOwner: false,
      isTemplate: false
    }
  ];
}

/**
 * Create a new project
 * @param {Object} projectData - Project creation data
 * @returns {Promise<Object>} Created project object
 */
export async function createProject(projectData) {
  const response = await authFetch(`${API_BASE_URL}/projects`, {
    method: 'POST',
    body: JSON.stringify(projectData)
  });

  if (!response.ok) {
    throw new Error('Failed to create project');
  }

  return response.json();
}

/**
 * Import a project from a zip file
 * @param {FormData} formData - Form data containing the zip file
 * @returns {Promise<Object>} Imported project object
 */
export async function importProject(formData) {
  // For file uploads, don't set Content-Type - let browser set it with boundary
  const token = localStorage.getItem('auth_token');

  const response = await fetch(`${API_BASE_URL}/projects/import`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error('Failed to import project');
  }

  return response.json();
}
