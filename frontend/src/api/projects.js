import { authFetch } from '../contexts/AuthContext';

// API endpoint configuration
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

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