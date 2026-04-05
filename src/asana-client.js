/**
 * Asana API Client
 *
 * Handles all Asana interactions:
 *   - Find or create a project by name
 *   - Create tasks with assignee and followers
 *   - Create subtasks under parent tasks
 */

import { config } from './config.js';

const BASE_URL = 'https://app.asana.com/api/1.0';

/**
 * Make an authenticated request to the Asana API.
 */
async function asanaRequest(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.asana.accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Asana API error ${response.status} on ${path}: ${body}`);
  }

  const json = await response.json();
  return json.data;
}

/**
 * Search for an existing project by name in the workspace,
 * or create a new one if it doesn't exist.
 *
 * @param {string} projectName
 * @returns {Promise<{ gid: string, name: string }>}
 */
export async function findOrCreateProject(projectName) {
  // Search existing projects
  const projects = await asanaRequest(
    `/workspaces/${config.asana.workspaceId}/projects?` +
    new URLSearchParams({ opt_fields: 'name', limit: '100' })
  );

  const existing = projects.find(
    (p) => p.name.toLowerCase() === projectName.toLowerCase()
  );

  if (existing) {
    console.log(`  Found existing Asana project: "${existing.name}" (${existing.gid})`);
    return existing;
  }

  // Create new project
  const newProject = await asanaRequest('/projects', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        name: projectName,
        workspace: config.asana.workspaceId,
        layout: 'list',
        notes: `Auto-created from CompanyCam document on ${new Date().toLocaleDateString()}`,
      },
    }),
  });

  console.log(`  Created new Asana project: "${newProject.name}" (${newProject.gid})`);
  return newProject;
}

/**
 * Create a task in a project with the configured assignee and followers.
 *
 * @param {string} projectGid
 * @param {string} taskName
 * @param {string} [notes='']
 * @returns {Promise<{ gid: string, name: string }>}
 */
export async function createTask(projectGid, taskName, notes = '') {
  const task = await asanaRequest('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        name: taskName,
        notes,
        assignee: config.asana.assigneeGid,
        followers: config.asana.followers,
        projects: [projectGid],
        workspace: config.asana.workspaceId,
      },
    }),
  });

  console.log(`    Created task: "${task.name}" (${task.gid})`);
  return task;
}

/**
 * Create a subtask under a parent task with the configured assignee and followers.
 *
 * @param {string} parentTaskGid
 * @param {string} subtaskName
 * @returns {Promise<{ gid: string, name: string }>}
 */
export async function createSubtask(parentTaskGid, subtaskName) {
  const subtask = await asanaRequest(`/tasks/${parentTaskGid}/subtasks`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        name: subtaskName,
        assignee: config.asana.assigneeGid,
        followers: config.asana.followers,
      },
    }),
  });

  console.log(`      Created subtask: "${subtask.name}"`);
  return subtask;
}
