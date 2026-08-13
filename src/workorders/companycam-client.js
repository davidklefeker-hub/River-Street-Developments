/**
 * CompanyCam Core API (v2) Client
 *
 * Written against CompanyCam's published OpenAPI spec:
 * https://github.com/CompanyCam/openapi-spec
 *
 * Auth is a bearer token. Several write endpoints accept an optional
 * `X-CompanyCam-User` header naming the user credited as the creator — we set
 * it when configured so automated comments/photos aren't attributed to a
 * nameless integration.
 */

import { config } from '../config.js';

const BASE_URL = 'https://api.companycam.com/v2';

/**
 * Make an authenticated request to the CompanyCam API.
 *
 * @param {string} path - Path below /v2, e.g. "/projects"
 * @param {{ method?: string, body?: object, query?: object, actAsUser?: string }} [options]
 * @returns {Promise<any>} Parsed JSON body, or null for 204 responses
 */
export async function companyCamRequest(path, options = {}) {
  const { method = 'GET', body, query, actAsUser } = options;

  let url = `${BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      // Array params are repeated with [] suffix, per the spec's array query params
      if (Array.isArray(value)) {
        for (const item of value) params.append(`${key}[]`, String(item));
      } else {
        params.append(key, String(value));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = {
    Authorization: `Bearer ${config.companyCam.accessToken}`,
    Accept: 'application/json',
  };
  if (body) headers['Content-Type'] = 'application/json';

  const creator = actAsUser ?? config.companyCam.actAsUserEmail;
  if (creator) headers['X-CompanyCam-User'] = creator;

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CompanyCam API ${response.status} on ${method} ${path}: ${text}`);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Search projects. The `query` param filters by project name or address line 1.
 *
 * @param {{ query?: string, status?: string, perPage?: number, page?: number, modifiedSince?: string }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listProjects(opts = {}) {
  return (
    (await companyCamRequest('/projects', {
      query: {
        query: opts.query,
        status: opts.status ?? 'active',
        per_page: opts.perPage ?? 50,
        page: opts.page,
        modified_since: opts.modifiedSince,
      },
    })) || []
  );
}

/**
 * Create a project.
 *
 * @param {{ name: string, address?: object, coordinates?: object, primaryContact?: object }} input
 * @returns {Promise<object>}
 */
export async function createProject(input) {
  const body = { name: input.name };
  if (input.address && hasAnyValue(input.address)) body.address = input.address;
  if (input.coordinates) body.coordinates = input.coordinates;
  if (input.primaryContact?.name) body.primary_contact = input.primaryContact;

  return companyCamRequest('/projects', { method: 'POST', body });
}

/**
 * Add labels to a project. Labels are free-form strings and are how we make
 * work orders findable inside CompanyCam (WO number, category, priority).
 *
 * @param {string} projectId
 * @param {string[]} labels
 * @returns {Promise<object[]>}
 */
export async function addProjectLabels(projectId, labels) {
  const values = labels.map((l) => String(l).trim()).filter(Boolean);
  if (values.length === 0) return [];

  return companyCamRequest(`/projects/${projectId}/labels`, {
    method: 'POST',
    body: { project: { labels: values } },
  });
}

/**
 * List a project's existing labels.
 *
 * @param {string} projectId
 * @returns {Promise<object[]>}
 */
export async function listProjectLabels(projectId) {
  return (await companyCamRequest(`/projects/${projectId}/labels`, { query: { per_page: 100 } })) || [];
}

/**
 * Post a comment on a project. This is where the full work order detail lands.
 *
 * @param {string} projectId
 * @param {string} content
 * @returns {Promise<object>}
 */
export async function addProjectComment(projectId, content) {
  return companyCamRequest(`/projects/${projectId}/comments`, {
    method: 'POST',
    body: { comment: { content } },
  });
}

/**
 * List a project's comments — used to avoid posting the same work order twice
 * when no local state file is available.
 *
 * @param {string} projectId
 * @returns {Promise<object[]>}
 */
export async function listProjectComments(projectId) {
  return (await companyCamRequest(`/projects/${projectId}/comments`, { query: { per_page: 100 } })) || [];
}

/**
 * Replace the project notepad. The notepad is a single field, so callers that
 * want to append must read the project first and pass the merged text.
 *
 * @param {string} projectId
 * @param {string} notepad
 * @returns {Promise<object>}
 */
export async function updateProjectNotepad(projectId, notepad) {
  return companyCamRequest(`/projects/${projectId}/notepad`, {
    method: 'PUT',
    body: { notepad },
  });
}

/**
 * Retrieve a single project.
 *
 * @param {string} projectId
 * @returns {Promise<object>}
 */
export async function getProject(projectId) {
  return companyCamRequest(`/projects/${projectId}`);
}

/**
 * Upload a document to a project. Contents are base64-encoded (30 MB limit).
 *
 * @param {string} projectId
 * @param {string} name - Filename, e.g. "WO-1042.txt"
 * @param {Buffer|string} contents
 * @returns {Promise<object>}
 */
export async function addProjectDocument(projectId, name, contents) {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(String(contents), 'utf-8');

  return companyCamRequest(`/projects/${projectId}/documents`, {
    method: 'POST',
    body: { document: { name, attachment: buffer.toString('base64') } },
  });
}

/**
 * Add a photo to a project from a URL.
 *
 * @param {string} projectId
 * @param {{ uri: string, capturedAt?: number, description?: string, tags?: string[], coordinates?: object }} photo
 * @returns {Promise<object>}
 */
export async function addProjectPhoto(projectId, photo) {
  const body = {
    photo: {
      uri: photo.uri,
      captured_at: photo.capturedAt ?? Math.floor(Date.now() / 1000),
    },
  };
  if (photo.description) body.photo.description = photo.description;
  if (photo.tags?.length) body.photo.tags = photo.tags;
  if (photo.coordinates) body.photo.coordinates = photo.coordinates;

  return companyCamRequest(`/projects/${projectId}/photos`, { method: 'POST', body });
}

/**
 * List photos across the company, newest activity first.
 *
 * Filtering by `tagIds` + `startDate` is the polling trigger for the
 * field → work order direction: "every photo tagged DAMAGE since we last looked".
 *
 * @param {{ tagIds?: string[], startDate?: number, endDate?: number, projectIds?: string[], perPage?: number, page?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listPhotos(opts = {}) {
  return (
    (await companyCamRequest('/photos', {
      query: {
        tag_ids: opts.tagIds,
        start_date: opts.startDate,
        end_date: opts.endDate,
        project_ids: opts.projectIds,
        per_page: Math.min(opts.perPage ?? 100, 100),
        page: opts.page,
      },
    })) || []
  );
}

/**
 * Retrieve a single photo. Webhook payloads are re-verified through this so we
 * act on the API's version of a photo rather than a payload we can't trust.
 *
 * @param {string} photoId
 * @returns {Promise<object>}
 */
export async function getPhoto(photoId) {
  return companyCamRequest(`/photos/${photoId}`);
}

/**
 * List every tag defined for the company.
 *
 * @returns {Promise<object[]>}
 */
export async function listTags() {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await companyCamRequest('/tags', { query: { per_page: 100, page } });
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/**
 * Resolve tag display values (e.g. ["Damage", "Repair Needed"]) to tag IDs.
 * Matching is case-insensitive against the tag's `value` and `display_value`.
 *
 * @param {string[]} displayValues
 * @returns {Promise<{ ids: string[], missing: string[] }>}
 */
export async function resolveTagIds(displayValues) {
  const wanted = displayValues.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return { ids: [], missing: [] };

  const tags = await listTags();
  const ids = [];
  const found = new Set();

  for (const tag of tags) {
    const value = String(tag.value ?? tag.display_value ?? '').toLowerCase();
    if (wanted.includes(value)) {
      ids.push(String(tag.id));
      found.add(value);
    }
  }

  return { ids, missing: wanted.filter((w) => !found.has(w)) };
}

/**
 * List checklist templates defined for the company.
 *
 * @returns {Promise<object[]>}
 */
export async function listChecklistTemplates() {
  return (await companyCamRequest('/templates/checklists')) || [];
}

/**
 * Attach a checklist to a project from a template.
 *
 * Note: the API can only instantiate checklists from templates that already
 * exist in CompanyCam — it cannot create ad-hoc checklist items.
 *
 * @param {string} projectId
 * @param {string} templateId
 * @returns {Promise<object>}
 */
export async function createProjectChecklist(projectId, templateId) {
  return companyCamRequest(`/projects/${projectId}/checklists`, {
    method: 'POST',
    body: { checklist_template_id: String(templateId) },
  });
}

/**
 * List checklists already attached to a project.
 *
 * @param {string} projectId
 * @returns {Promise<object[]>}
 */
export async function listProjectChecklists(projectId) {
  return (await companyCamRequest(`/projects/${projectId}/checklists`)) || [];
}

/**
 * Assign a CompanyCam user to a project so it shows in their project list.
 *
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function assignUserToProject(projectId, userId) {
  return companyCamRequest(`/projects/${projectId}/assigned_users/${userId}`, { method: 'PUT' });
}

/**
 * List company users.
 *
 * @returns {Promise<object[]>}
 */
export async function listUsers() {
  return (await companyCamRequest('/users', { query: { per_page: 100 } })) || [];
}

/**
 * Register a webhook.
 *
 * @param {{ url: string, scopes: string[], token?: string, enabled?: boolean }} input
 * @returns {Promise<object>}
 */
export async function createWebhook(input) {
  return companyCamRequest('/webhooks', {
    method: 'POST',
    body: {
      url: input.url,
      scopes: input.scopes,
      token: input.token,
      enabled: input.enabled ?? true,
    },
  });
}

/**
 * List registered webhooks.
 *
 * @returns {Promise<object[]>}
 */
export async function listWebhooks() {
  return (await companyCamRequest('/webhooks', { query: { per_page: 100 } })) || [];
}

function hasAnyValue(obj) {
  return Object.values(obj).some((v) => v !== null && v !== undefined && String(v).trim() !== '');
}
