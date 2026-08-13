/**
 * Outbound Sync — CompanyCam → Property Management Platform
 *
 * Closes the loop. A cleaner or tech in the field photographs damage and
 * applies a trigger tag (default: "Damage"). That photo becomes a normalized
 * WorkOrderRequest and is handed to a sink, which is what actually creates the
 * work order in the PM platform.
 *
 * The trigger is read by polling `GET /photos?tag_ids[]=…&start_date=…` rather
 * than relying solely on webhooks: polling has a durable high-water mark in the
 * state file, so a missed or replayed webhook can't drop or duplicate a repair.
 * The webhook receiver (webhook-server.js) runs the same code path for
 * low-latency delivery.
 */

import { config } from '../config.js';
import {
  getProject,
  getPhoto,
  listPhotos,
  resolveTagIds,
  addProjectLabels,
} from './companycam-client.js';
import { toWorkOrderRequest } from './model.js';

/**
 * Raise a work order request from a single photo id.
 *
 * Both entry points funnel through here — the poller and the webhook receiver —
 * so a photo delivered twice (webhook plus the next poll) is only ever acted on
 * once, and both paths apply the same tag filter.
 *
 * @param {string} photoId
 * @param {import('./state.js').SyncState} state
 * @param {{ send: (request: object) => Promise<{ reference?: string }>, name: string }} sink
 * @returns {Promise<{ status: 'raised'|'skipped'|'not-tagged', reference?: string }>}
 */
export async function raiseFromPhotoId(photoId, state, sink) {
  const id = String(photoId);

  if (state.hasRaisedFromPhoto(id)) {
    return { status: 'skipped' };
  }

  // Re-fetch rather than trusting the delivered payload: tags may have been
  // added after the event fired, and the payload is not authenticated data.
  const photo = await getPhoto(id);

  const triggers = new Set(config.companyCam.damageTags.map((t) => t.toLowerCase()));
  const photoTags = (photo.tags || []).map((t) =>
    String(t.display_value ?? t.value ?? t).trim().toLowerCase()
  );

  if (!photoTags.some((tag) => triggers.has(tag))) {
    return { status: 'not-tagged' };
  }

  const request = await buildRequestFromPhoto(photo);
  const outcome = await sink.send(request);

  state.markRaisedFromPhoto(id, { sink: sink.name, reference: outcome?.reference });
  await state.save();

  if (config.companyCam.requestRaisedLabel && photo.project_id) {
    await addProjectLabels(String(photo.project_id), [config.companyCam.requestRaisedLabel]).catch(
      (err) => console.warn(`    Could not label project: ${err.message}`)
    );
  }

  return { status: 'raised', reference: outcome?.reference };
}

/**
 * Poll CompanyCam for newly tagged damage photos and raise a work order
 * request for each one.
 *
 * @param {import('./state.js').SyncState} state
 * @param {{ send: (request: object) => Promise<{ reference?: string }>, name: string }} sink
 * @param {{ dryRun?: boolean, lookbackSeconds?: number }} [options]
 * @returns {Promise<{ raised: number, skipped: number, failed: number, errors: Array<{ photoId: string, message: string }> }>}
 */
export async function pollDamagePhotos(state, sink, options = {}) {
  const { dryRun = false, lookbackSeconds = 0 } = options;
  const result = { raised: 0, skipped: 0, failed: 0, errors: [] };

  const { ids: tagIds, missing } = await resolveTagIds(config.companyCam.damageTags);
  if (missing.length > 0) {
    console.warn(
      `  These trigger tags don't exist in CompanyCam yet: ${missing.join(', ')}. ` +
        'Create them in CompanyCam (or on a photo) so crews can apply them.'
    );
  }
  if (tagIds.length === 0) {
    console.warn('  No trigger tags resolved — nothing to poll.');
    return result;
  }

  // Re-scan a little before the high-water mark: photos are filtered by
  // capture time, and a phone that was offline can upload a photo captured
  // earlier than the last poll.
  const since = state.lastPhotoPollAt
    ? Math.max(0, state.lastPhotoPollAt - (lookbackSeconds || config.polling.lookbackSeconds))
    : Math.floor(Date.now() / 1000) - config.polling.initialLookbackSeconds;

  const pollStartedAt = Math.floor(Date.now() / 1000);
  const photos = await collectPhotos({ tagIds, startDate: since });

  console.log(`  Found ${photos.length} tagged photo(s) since ${new Date(since * 1000).toISOString()}`);

  const projectCache = new Map();

  for (const photo of photos) {
    const photoId = String(photo.id);

    if (state.hasRaisedFromPhoto(photoId)) {
      result.skipped++;
      continue;
    }

    try {
      const request = await buildRequestFromPhoto(photo, projectCache);

      if (dryRun) {
        console.log(`  [dry-run] Would raise work order from photo ${photoId}:`);
        console.log(`    ${request.summary} @ ${request.property}${request.unit ? ` Unit ${request.unit}` : ''}`);
        result.raised++;
        continue;
      }

      const outcome = await sink.send(request);
      state.markRaisedFromPhoto(photoId, { sink: sink.name, reference: outcome?.reference });
      result.raised++;

      console.log(`  Raised work order request from photo ${photoId} via ${sink.name}`);

      // Mark the project so the field team can see the request was picked up.
      if (config.companyCam.requestRaisedLabel && photo.project_id) {
        await addProjectLabels(String(photo.project_id), [config.companyCam.requestRaisedLabel]).catch(
          (err) => console.warn(`    Could not label project: ${err.message}`)
        );
      }
    } catch (err) {
      result.failed++;
      result.errors.push({ photoId, message: err.message });
      console.error(`  Failed to raise work order from photo ${photoId}: ${err.message}`);
    }
  }

  if (!dryRun) {
    // Only advance the high-water mark if nothing failed, so failures get
    // retried on the next poll instead of being silently skipped.
    if (result.failed === 0) state.lastPhotoPollAt = pollStartedAt;
    await state.save();
  }

  return result;
}

/**
 * Turn a CompanyCam photo into a normalized WorkOrderRequest.
 *
 * @param {object} photo - A CompanyCam Photo object
 * @param {Map<string, object>} [projectCache]
 * @returns {Promise<object>}
 */
export async function buildRequestFromPhoto(photo, projectCache = new Map()) {
  const projectId = String(photo.project_id ?? '');
  let project = projectCache.get(projectId);

  if (!project && projectId) {
    project = await getProject(projectId);
    projectCache.set(projectId, project);
  }

  const tagValues = (photo.tags || [])
    .map((t) => String(t.display_value ?? t.value ?? t).trim())
    .filter(Boolean);

  const description = String(photo.description || '').trim();
  const capturedAt = photo.captured_at ? new Date(photo.captured_at * 1000).toISOString() : '';

  return toWorkOrderRequest({
    origin: 'companycam',
    originId: String(photo.id),
    summary: buildSummary(description, tagValues, project),
    description: buildDescription(description, tagValues, photo, project),
    category: categoryFromTags(tagValues),
    priority: priorityFromTags(tagValues),
    property: project?.name || '',
    unit: unitFromProject(project),
    address: project?.address || {},
    reportedBy: photo.creator_name || '',
    reportedAt: capturedAt,
    photoUrls: photoUrls(photo),
    projectUrl: project?.project_url || '',
    tags: tagValues,
    raw: { photo, project },
  });
}

/**
 * Page through tagged photos. CompanyCam caps per_page at 100.
 */
async function collectPhotos({ tagIds, startDate }) {
  const all = [];
  for (let page = 1; page <= config.polling.maxPages; page++) {
    const batch = await listPhotos({ tagIds, startDate, perPage: 100, page });
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  // Oldest first, so state advances in a sensible order.
  return all.sort((a, b) => (a.captured_at ?? 0) - (b.captured_at ?? 0));
}

function buildSummary(description, tags, project) {
  if (description) return description.split('\n')[0].slice(0, 120);

  const category = categoryFromTags(tags);
  const where = project?.name ? ` at ${project.name}` : '';
  return category ? `${category} repair needed${where}` : `Damage reported${where}`;
}

function buildDescription(description, tags, photo, project) {
  const lines = [];

  if (description) {
    lines.push(description);
  } else {
    lines.push('Damage photographed in the field. No written description was added to the photo.');
  }

  lines.push('');
  if (photo.creator_name) lines.push(`Reported by: ${photo.creator_name}`);
  if (photo.captured_at) {
    lines.push(`Captured: ${new Date(photo.captured_at * 1000).toLocaleString('en-US')}`);
  }
  if (tags.length > 0) lines.push(`Tags: ${tags.join(', ')}`);

  const urls = photoUrls(photo);
  if (urls.length > 0) {
    lines.push('');
    lines.push('Photo:');
    for (const url of urls) lines.push(`  ${url}`);
  }

  if (project?.project_url) {
    lines.push('');
    lines.push(`CompanyCam project: ${project.project_url}`);
  }

  return lines.join('\n');
}

/**
 * Pick the best available image URL from a photo's variants.
 *
 * @param {object} photo
 * @returns {string[]}
 */
function photoUrls(photo) {
  const uris = Array.isArray(photo.uris) ? photo.uris : [];
  const preferred = ['original', 'web', 'thumbnail'];

  for (const type of preferred) {
    const match = uris.find((u) => u.type === type && u.url);
    if (match) return [match.url];
  }

  return uris.filter((u) => u.url).map((u) => u.url).slice(0, 1);
}

/**
 * Map trigger tags onto a work order category using the configured mapping.
 * Falls back to the first tag that isn't a trigger or priority word.
 */
function categoryFromTags(tags) {
  const mapping = config.companyCam.categoryTags;
  for (const tag of tags) {
    const mapped = mapping[tag.toLowerCase()];
    if (mapped) return mapped;
  }

  const reserved = new Set([
    ...config.companyCam.damageTags.map((t) => t.toLowerCase()),
    ...Object.keys(config.companyCam.priorityTags),
  ]);
  const fallback = tags.find((t) => !reserved.has(t.toLowerCase()));
  return fallback || '';
}

function priorityFromTags(tags) {
  const mapping = config.companyCam.priorityTags;
  for (const tag of tags) {
    const mapped = mapping[tag.toLowerCase()];
    if (mapped) return mapped;
  }
  return config.companyCam.defaultRequestPriority;
}

function unitFromProject(project) {
  if (!project) return '';
  const fromAddress = project.address?.street_address_2 || '';
  if (fromAddress) return String(fromAddress).replace(/^(unit|apt|suite|ste)\s*/i, '');
  const fromName = String(project.name || '').match(/\bunit\s+(\S+)/i);
  return fromName ? fromName[1] : '';
}
