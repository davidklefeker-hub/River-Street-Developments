/**
 * Inbound Sync — Property Management Platform → CompanyCam
 *
 * Takes normalized work orders and lands them on the right CompanyCam project,
 * one project per property/unit. A work order becomes:
 *
 *   - labels on the project      (WO number, category, priority, status, source)
 *   - a comment with full detail (the crew's read-in-the-field record)
 *   - a notepad line             (what's currently open at this unit)
 *   - optionally a checklist     (instantiated from a template matched by category)
 *
 * Re-running is safe: the state store skips work orders whose content hasn't
 * changed, and a changed work order posts a fresh comment rather than a duplicate.
 */

import { config } from '../config.js';
import {
  listProjects,
  createProject,
  getProject,
  addProjectLabels,
  addProjectComment,
  updateProjectNotepad,
  listChecklistTemplates,
  listProjectChecklists,
  createProjectChecklist,
} from './companycam-client.js';
import { locationKey, projectNameFor } from './model.js';
import { workOrderHash } from './state.js';

const NOTEPAD_MARKER = '— Open work orders (synced) —';

/**
 * Sync a batch of work orders into CompanyCam.
 *
 * @param {object[]} workOrders - Normalized work orders
 * @param {import('./state.js').SyncState} state
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<{ synced: number, skipped: number, failed: number, projectsCreated: number, errors: Array<{ externalId: string, message: string }> }>}
 */
export async function syncWorkOrdersToCompanyCam(workOrders, state, options = {}) {
  const { dryRun = false } = options;
  const result = { synced: 0, skipped: 0, failed: 0, projectsCreated: 0, errors: [] };

  const templates = config.companyCam.checklistTemplatesByCategory
    ? await loadChecklistTemplates()
    : new Map();

  for (const workOrder of workOrders) {
    const hash = workOrderHash(workOrder);
    const id = workOrder.externalId || workOrder.number;

    if (!id) {
      result.failed++;
      result.errors.push({ externalId: '(missing)', message: 'Work order has no external id or number' });
      continue;
    }

    if (state.isWorkOrderSynced(id, hash)) {
      result.skipped++;
      continue;
    }

    try {
      const { project, created } = await resolveProject(workOrder, state, dryRun);
      if (created) result.projectsCreated++;

      if (dryRun) {
        console.log(`  [dry-run] WO ${id} → project "${project.name}" (${project.id})`);
        console.log(indent(formatWorkOrderComment(workOrder), 4));
        result.synced++;
        continue;
      }

      await addProjectLabels(project.id, labelsFor(workOrder));
      await addProjectComment(project.id, formatWorkOrderComment(workOrder));
      await syncNotepad(project.id, workOrder);

      const templateId = templates.get(workOrder.category.toLowerCase());
      if (templateId) {
        await attachChecklistOnce(project.id, templateId);
      }

      state.setProjectId(locationKey(workOrder), project.id);
      state.markWorkOrderSynced(id, { projectId: project.id, contentHash: hash });
      result.synced++;

      console.log(`  WO ${id} → "${project.name}" (${project.id})`);
    } catch (err) {
      result.failed++;
      result.errors.push({ externalId: id, message: err.message });
      console.error(`  Failed to sync WO ${id}: ${err.message}`);
    }
  }

  if (!dryRun) await state.save();
  return result;
}

/**
 * Find the CompanyCam project for a work order's location, or create it.
 *
 * Resolution order: cached project id → address search → create.
 *
 * @returns {Promise<{ project: { id: string, name: string }, created: boolean }>}
 */
export async function resolveProject(workOrder, state, dryRun = false) {
  const key = locationKey(workOrder);
  const name = projectNameFor(workOrder);

  const cachedId = state.getProjectId(key);
  if (cachedId) {
    try {
      const project = await getProject(cachedId);
      if (project && project.status !== 'deleted') {
        return { project: { id: String(project.id), name: project.name || name }, created: false };
      }
    } catch {
      // Cached project is gone — fall through and re-resolve.
    }
  }

  const searchTerm = workOrder.address?.street_address_1 || workOrder.property || name;
  const candidates = await listProjects({ query: searchTerm, status: 'active' });
  const match = candidates.find((p) => locationKey(projectToWorkOrderShape(p)) === key);

  if (match) {
    state.setProjectId(key, match.id);
    return { project: { id: String(match.id), name: match.name || name }, created: false };
  }

  if (dryRun) {
    return { project: { id: '(would-create)', name }, created: true };
  }

  const created = await createProject({
    name,
    address: addressForProject(workOrder),
    primaryContact: workOrder.tenant?.name
      ? { name: workOrder.tenant.name, email: workOrder.tenant.email, phone_number: workOrder.tenant.phone }
      : undefined,
  });

  state.setProjectId(key, created.id);
  console.log(`  Created CompanyCam project: "${created.name}" (${created.id})`);
  return { project: { id: String(created.id), name: created.name || name }, created: true };
}

/**
 * Labels make work orders findable in CompanyCam's project list. Keep them
 * short and prefixed so they group together in the label picker.
 *
 * @param {object} workOrder
 * @returns {string[]}
 */
export function labelsFor(workOrder) {
  const labels = [];
  if (workOrder.number) labels.push(`WO ${workOrder.number}`);
  if (workOrder.category) labels.push(workOrder.category);
  if (workOrder.priority === 'emergency' || workOrder.priority === 'high') {
    labels.push(`Priority: ${titleCase(workOrder.priority)}`);
  }
  if (workOrder.status && workOrder.status !== 'open') {
    labels.push(`Status: ${titleCase(workOrder.status.replace(/_/g, ' '))}`);
  }
  if (workOrder.unit) labels.push(`Unit ${workOrder.unit}`);
  return labels;
}

/**
 * Render a work order as the comment body a tech reads on their phone.
 * Plain text — CompanyCam comments don't render markdown.
 *
 * @param {object} workOrder
 * @returns {string}
 */
export function formatWorkOrderComment(workOrder) {
  const lines = [];
  const header = workOrder.number ? `WORK ORDER #${workOrder.number}` : 'WORK ORDER';
  lines.push(header);
  if (workOrder.summary) lines.push(workOrder.summary);
  lines.push('');

  const field = (label, value) => {
    if (value) lines.push(`${label}: ${value}`);
  };

  field('Priority', titleCase(workOrder.priority));
  field('Status', titleCase(workOrder.status.replace(/_/g, ' ')));
  field('Category', workOrder.category);
  field('Unit', workOrder.unit);
  field('Assigned to', workOrder.assignedTo);
  field('Requested', formatDate(workOrder.requestedAt));
  field('Due', formatDate(workOrder.dueAt));

  if (workOrder.permissionToEnter !== null) {
    lines.push(`Permission to enter: ${workOrder.permissionToEnter ? 'Yes' : 'No'}`);
  }

  const contact = [workOrder.tenant?.name, workOrder.tenant?.phone].filter(Boolean).join(' · ');
  if (contact) lines.push(`Tenant: ${contact}`);

  if (workOrder.description && workOrder.description !== workOrder.summary) {
    lines.push('');
    lines.push('Details:');
    lines.push(workOrder.description);
  }

  if (workOrder.photoUrls.length > 0) {
    lines.push('');
    lines.push('Photos from the request:');
    for (const url of workOrder.photoUrls) lines.push(`  ${url}`);
  }

  lines.push('');
  lines.push(`[synced from ${workOrder.source}]`);

  return lines.join('\n');
}

/**
 * Keep a running "what's open here" block at the bottom of the project notepad.
 * The notepad is a single replaceable field, so we read, rewrite our block,
 * and leave anything above it untouched.
 */
async function syncNotepad(projectId, workOrder) {
  const project = await getProject(projectId);
  const existing = project?.notepad || '';

  const [preamble] = existing.split(NOTEPAD_MARKER);
  const previousBlock = existing.includes(NOTEPAD_MARKER)
    ? existing.slice(existing.indexOf(NOTEPAD_MARKER) + NOTEPAD_MARKER.length).trim()
    : '';

  const entries = previousBlock ? previousBlock.split('\n').filter(Boolean) : [];
  const entryPrefix = workOrder.number ? `WO ${workOrder.number}:` : `${workOrder.summary}:`;
  const withoutThisOne = entries.filter((line) => !line.startsWith(entryPrefix));

  const isClosed = workOrder.status === 'completed' || workOrder.status === 'cancelled';
  if (!isClosed) {
    withoutThisOne.push(
      `${entryPrefix} ${workOrder.summary || workOrder.category} (${titleCase(workOrder.priority)})`
    );
  }

  const notepad = [preamble.trim(), NOTEPAD_MARKER, ...withoutThisOne].filter(Boolean).join('\n').trim();
  await updateProjectNotepad(projectId, notepad);
}

/**
 * Attach a checklist template unless one with the same template is already on
 * the project.
 */
async function attachChecklistOnce(projectId, templateId) {
  const existing = await listProjectChecklists(projectId);
  const already = existing.some(
    (c) => String(c.checklist_template_id ?? c.template_id ?? '') === String(templateId)
  );
  if (already) return;

  await createProjectChecklist(projectId, templateId);
}

/**
 * Build a category → template id map from the configured category → template
 * *name* mapping, resolving names against the company's templates.
 *
 * @returns {Promise<Map<string, string>>}
 */
async function loadChecklistTemplates() {
  const mapping = config.companyCam.checklistTemplatesByCategory;
  const templates = await listChecklistTemplates();
  const byName = new Map(templates.map((t) => [String(t.name || '').toLowerCase(), String(t.id)]));

  const resolved = new Map();
  for (const [category, templateName] of Object.entries(mapping)) {
    const id = byName.get(String(templateName).toLowerCase());
    if (id) {
      resolved.set(category.toLowerCase(), id);
    } else {
      console.warn(`  No CompanyCam checklist template named "${templateName}" (category "${category}")`);
    }
  }
  return resolved;
}

/**
 * Adapt a CompanyCam project into just enough of a work order shape for
 * locationKey() to compare it against an incoming work order.
 */
function projectToWorkOrderShape(project) {
  return {
    property: project.name || '',
    unit: unitFromProject(project),
    address: project.address || {},
  };
}

function unitFromProject(project) {
  const fromAddress = project.address?.street_address_2 || '';
  if (fromAddress) return fromAddress;
  const fromName = String(project.name || '').match(/\bunit\s+(\S+)/i);
  return fromName ? fromName[1] : '';
}

function addressForProject(workOrder) {
  const address = { ...workOrder.address };
  if (!address.street_address_2 && workOrder.unit) {
    address.street_address_2 = `Unit ${workOrder.unit}`;
  }
  return address;
}

function titleCase(value) {
  return String(value || '')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US');
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}
