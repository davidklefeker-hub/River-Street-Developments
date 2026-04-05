/**
 * Asana API Client
 *
 * Handles all Asana interactions:
 *   - Find or create a project by name
 *   - Create tasks with assignee and followers
 *   - Create subtasks under parent tasks
 *   - Attach images (local files or URLs) to tasks
 */

import { readFile } from 'fs/promises';
import { basename } from 'path';
import { config } from './config.js';

const BASE_URL = 'https://app.asana.com/api/1.0';

/**
 * Make an authenticated JSON request to the Asana API.
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

/**
 * Attach an image to a task.
 *
 * Supports two modes:
 *   - URL: passes the URL to Asana to fetch externally
 *   - Local file: reads the file and uploads via multipart form data
 *
 * @param {string} taskGid - The task to attach the image to
 * @param {string} src - URL or local file path
 * @param {string} [alt=''] - Optional name/description for the attachment
 * @param {string} [docDir=''] - Base directory to resolve relative file paths
 */
export async function attachImageToTask(taskGid, src, alt = '', docDir = '') {
  const isUrl = /^https?:\/\//i.test(src);

  if (isUrl) {
    await attachUrlToTask(taskGid, src, alt);
  } else {
    await attachFileToTask(taskGid, src, alt, docDir);
  }
}

/**
 * Attach an image via external URL.
 */
async function attachUrlToTask(taskGid, url, name) {
  const attachmentName = name || filenameFromUrl(url);

  const response = await fetch(`${BASE_URL}/tasks/${taskGid}/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.asana.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        resource_subtype: 'external',
        url: url,
        name: attachmentName,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Asana attachment error ${response.status}: ${body}`);
  }

  console.log(`      Attached image (URL): ${attachmentName}`);
}

/**
 * Attach a local image file via multipart upload.
 */
async function attachFileToTask(taskGid, filePath, name, docDir) {
  const { resolve } = await import('path');
  const { stat } = await import('fs/promises');

  // Resolve relative paths against the document's directory
  const resolvedPath = resolve(docDir || '.', filePath);

  // Check the file exists
  try {
    await stat(resolvedPath);
  } catch {
    console.warn(`      Skipping missing image: ${resolvedPath}`);
    return;
  }

  const fileData = await readFile(resolvedPath);
  const fileName = name || basename(resolvedPath);

  // Build multipart form
  const blob = new Blob([fileData], { type: guessMimeType(resolvedPath) });
  const formData = new FormData();
  formData.append('file', blob, fileName);

  const response = await fetch(`${BASE_URL}/tasks/${taskGid}/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.asana.accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Asana file upload error ${response.status}: ${body}`);
  }

  console.log(`      Attached image (file): ${fileName}`);
}

function filenameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return basename(pathname) || 'image';
  } catch {
    return 'image';
  }
}

function guessMimeType(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  const types = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
  };
  return types[ext] || 'application/octet-stream';
}
