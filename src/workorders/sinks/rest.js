/**
 * REST Sink — config-driven
 *
 * Posts the work order request to any HTTP endpoint that can create a work
 * order: DoorLoop, Buildium, an automation webhook (Zapier / Make), or an
 * internal service.
 *
 * The field mapping is configuration, not code, because every platform names
 * its work order fields differently and those names change on their schedule,
 * not ours. You supply a JSON template whose values are `{{path}}` references
 * into the normalized request:
 *
 *   {
 *     "Title":       "{{summary}}",
 *     "Description": "{{description}}",
 *     "Priority":    "{{priority}}",
 *     "UnitId":      "{{unit}}",
 *     "Category":    "{{category}}"
 *   }
 *
 * Set WORKORDER_REST_TEMPLATE to a path holding that JSON. With no template the
 * whole normalized request is posted as-is, which is what a Zapier or Make
 * catch hook wants.
 */

import { readFile } from 'fs/promises';
import { config } from '../../config.js';

export const name = 'rest';

let cachedTemplate;

/**
 * @param {object} request - Normalized WorkOrderRequest
 * @returns {Promise<{ reference: string }>}
 */
export async function send(request) {
  const { url, method, authHeader, headers } = config.sinks.rest;

  if (!url) throw new Error('REST sink requires WORKORDER_REST_URL.');

  const payload = await buildPayload(request);

  const response = await fetch(url, {
    method: method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`REST sink ${response.status} from ${url}: ${text}`);
  }

  const reference = extractReference(text);
  console.log(`    Posted to ${url}${reference ? ` (${reference})` : ''}`);
  return { reference };
}

async function buildPayload(request) {
  const templatePath = config.sinks.rest.templatePath;
  if (!templatePath) return request;

  if (cachedTemplate === undefined) {
    cachedTemplate = JSON.parse(await readFile(templatePath, 'utf-8'));
  }

  return renderTemplate(cachedTemplate, request);
}

/**
 * Recursively substitute `{{path}}` placeholders from the request.
 *
 * A string that is exactly one placeholder keeps the resolved value's type
 * (so `"{{photoUrls}}"` yields an array, not its string form); placeholders
 * embedded in longer strings are interpolated as text.
 *
 * @param {any} node
 * @param {object} source
 * @returns {any}
 */
export function renderTemplate(node, source) {
  if (Array.isArray(node)) return node.map((item) => renderTemplate(item, source));

  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, renderTemplate(value, source)])
    );
  }

  if (typeof node !== 'string') return node;

  const whole = node.match(/^\{\{\s*([\w.[\]]+)\s*\}\}$/);
  if (whole) return resolvePath(source, whole[1]);

  return node.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_, path) => {
    const value = resolvePath(source, path);
    return value === undefined || value === null ? '' : String(value);
  });
}

function resolvePath(source, path) {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), source);
}

function extractReference(text) {
  if (!text) return '';
  try {
    const json = JSON.parse(text);
    return String(json.Id ?? json.id ?? json.workOrderId ?? json.number ?? '');
  } catch {
    return '';
  }
}
