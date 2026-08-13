/**
 * Sync State Store
 *
 * A JSON file on disk that remembers what has already been synced, so reruns
 * are idempotent: work orders don't get posted to CompanyCam twice, and a
 * damage photo doesn't raise the same work order request on every poll.
 *
 * Deliberately a flat file, not a database — this pipeline is single-process
 * and the state is small. Writes are atomic (write temp, then rename).
 */

import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { createHash } from 'crypto';

const EMPTY_STATE = {
  version: 1,
  // locationKey -> CompanyCam project id
  projects: {},
  // work order externalId -> { projectId, contentHash, syncedAt }
  workOrders: {},
  // CompanyCam photo id -> { requestedAt, sink, reference }
  raisedFromPhotos: {},
  // Unix seconds — high-water mark for the damage-photo poller
  lastPhotoPollAt: 0,
};

export class SyncState {
  /**
   * @param {string} filePath
   */
  constructor(filePath) {
    this.filePath = filePath;
    this.data = structuredClone(EMPTY_STATE);
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      this.data = { ...structuredClone(EMPTY_STATE), ...JSON.parse(raw) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // First run — keep the empty state.
    }
    return this;
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, JSON.stringify(this.data, null, 2), 'utf-8');
    await rename(temp, this.filePath);
  }

  /** @returns {string|undefined} */
  getProjectId(locationKey) {
    return this.data.projects[locationKey];
  }

  setProjectId(locationKey, projectId) {
    this.data.projects[locationKey] = String(projectId);
  }

  /**
   * Has this exact work order content already been synced?
   * A changed hash means the work order was updated in the PM platform and
   * should be re-posted as a fresh comment.
   */
  isWorkOrderSynced(externalId, contentHash) {
    const entry = this.data.workOrders[externalId];
    return Boolean(entry && entry.contentHash === contentHash);
  }

  markWorkOrderSynced(externalId, { projectId, contentHash }) {
    this.data.workOrders[externalId] = {
      projectId: String(projectId),
      contentHash,
      syncedAt: new Date().toISOString(),
    };
  }

  hasRaisedFromPhoto(photoId) {
    return Boolean(this.data.raisedFromPhotos[String(photoId)]);
  }

  markRaisedFromPhoto(photoId, { sink, reference }) {
    this.data.raisedFromPhotos[String(photoId)] = {
      requestedAt: new Date().toISOString(),
      sink,
      reference: reference ?? null,
    };
  }

  get lastPhotoPollAt() {
    return this.data.lastPhotoPollAt || 0;
  }

  set lastPhotoPollAt(unixSeconds) {
    this.data.lastPhotoPollAt = Math.floor(unixSeconds);
  }
}

/**
 * Stable hash of the fields that matter for "has this changed?".
 *
 * @param {object} workOrder
 * @returns {string}
 */
export function workOrderHash(workOrder) {
  const significant = {
    status: workOrder.status,
    priority: workOrder.priority,
    category: workOrder.category,
    summary: workOrder.summary,
    description: workOrder.description,
    assignedTo: workOrder.assignedTo,
    dueAt: workOrder.dueAt,
  };
  return createHash('sha256').update(JSON.stringify(significant)).digest('hex').slice(0, 16);
}
