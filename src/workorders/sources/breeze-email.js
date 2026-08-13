/**
 * Source — Yardi Breeze work order notification email
 *
 * Breeze emails a notification when a work order is created or assigned. This
 * parses that email into a normalized work order.
 *
 * Yardi doesn't publish the notification's markup and it varies by account
 * configuration, so this is deliberately a tolerant "labeled field" parser
 * rather than a template match. It reads three shapes:
 *
 *   Label: value              (plain text and HTML paragraphs)
 *   <td>Label</td><td>value</td>   (HTML table rows — Breeze's usual layout)
 *   "Work Order #1042"        (identifiers in the subject line)
 *
 * Anything it can't classify is preserved on `raw`, and unparsed body text
 * becomes the description so no detail is dropped on the floor.
 */

import { readFile } from 'fs/promises';
import { toWorkOrder } from '../model.js';
import { canonicalField, fieldsToWorkOrderInput } from './field-map.js';

export const name = 'yardi-breeze-email';

/**
 * Parse a saved .eml or .txt notification into a normalized work order.
 *
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
export async function parseFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return parseEmail(content);
}

/**
 * @param {string} raw - Full message (headers + body) or just the body
 * @param {{ subject?: string }} [meta] - Subject, when read from a mail API rather than a file
 * @returns {object|null} Normalized work order, or null if nothing usable was found
 */
export function parseEmail(raw, meta = {}) {
  const { headers, body } = splitMessage(raw);
  const subject = meta.subject || headers.subject || '';
  const text = looksLikeHtml(body) ? htmlToText(body) : decodeQuotedPrintable(body);

  const fields = {};
  const rawFields = {};

  for (const [label, value] of extractLabeledFields(text)) {
    rawFields[label] = value;
    const field = canonicalField(label);
    if (field && value && !fields[field]) fields[field] = value;
  }

  // Subject lines like "Work Order #1042 - 12 River St Unit 2B - Plumbing"
  if (!fields.number) {
    const fromSubject = subject.match(/(?:work\s*order|wo)\s*#?\s*(\d+)/i);
    if (fromSubject) fields.number = fromSubject[1];
  }
  if (!fields.number) {
    const fromBody = text.match(/(?:work\s*order|wo)\s*#\s*(\d+)/i);
    if (fromBody) fields.number = fromBody[1];
  }

  // If no Description label was found, fall back to the longest paragraph that
  // isn't a labeled field — Breeze sometimes puts the tenant's words on their own.
  if (!fields.description) {
    fields.description = unlabeledBodyText(text);
  }

  // Only fall back to the subject when there's no description to summarize.
  // Breeze subjects are routing metadata ("Work Order #1042 - Building - Unit
  // 2B - Plumbing"), which makes a worse summary than the tenant's own words.
  if (!fields.summary && !fields.description && subject) {
    fields.summary = stripSubjectPrefix(subject);
  }

  if (!fields.number && !fields.property && !fields.description) return null;

  return toWorkOrder(
    fieldsToWorkOrderInput(fields, { source: name, raw: { subject, fields: rawFields } })
  );
}

/**
 * Split RFC 822 headers from the body. Input that has no headers is treated as
 * a bare body.
 *
 * @param {string} raw
 * @returns {{ headers: Record<string, string>, body: string }}
 */
export function splitMessage(raw) {
  const text = String(raw).replace(/\r\n/g, '\n');
  const separator = text.indexOf('\n\n');

  if (separator === -1 || !/^[A-Za-z-]+:/.test(text)) {
    return { headers: {}, body: text };
  }

  const headerBlock = text.slice(0, separator);
  const body = text.slice(separator + 2);
  const headers = {};

  // Unfold continuation lines before splitting on the first colon
  for (const line of headerBlock.replace(/\n[ \t]+/g, ' ').split('\n')) {
    const match = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (match) headers[match[1].toLowerCase()] = decodeMimeWords(match[2].trim());
  }

  return { headers, body };
}

/**
 * Pull `Label: value` pairs out of text, one per line.
 *
 * @param {string} text
 * @returns {Array<[string, string]>}
 */
export function extractLabeledFields(text) {
  const pairs = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 400) continue;

    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9 #/_'-]{1,40}?)\s*[:：]\s*(.*)$/);
    if (!match) continue;

    const [, label, value] = match;
    if (!value.trim()) continue;

    // "http://..." and times like "9:30 AM" aren't labeled fields
    if (/^https?$/i.test(label.trim())) continue;

    pairs.push([label.trim(), value.trim()]);
  }

  return pairs;
}

/** Drop "Re:"/"Fwd:" and a leading "Work Order #1042 - " routing prefix. */
function stripSubjectPrefix(subject) {
  return subject
    .replace(/^((re|fwd):\s*)+/i, '')
    .replace(/^(work\s*order|wo)\s*#?\s*\d+\s*[-–—:]\s*/i, '')
    .trim();
}

const BOILERPLATE = /^(this (message|email)|do not reply|please do not reply|you are receiving|unsubscribe|©|copyright|confidential|sent from|log in to)/i;

/**
 * Everything in the body that isn't a labeled field or footer boilerplate.
 *
 * Used as the description when the notification has no Description label. All
 * qualifying paragraphs are kept, in order — a tenant's report is often several
 * short paragraphs, and picking only the longest would throw the rest away.
 *
 * @param {string} text
 * @returns {string}
 */
export function unlabeledBodyText(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 20)
    .filter((p) => !/^[A-Za-z][A-Za-z0-9 #/_'-]{1,40}\s*[:：]/.test(p))
    .filter((p) => !BOILERPLATE.test(p))
    .join('\n\n');
}

function looksLikeHtml(body) {
  return /<(html|body|table|div|p|br)\b/i.test(body);
}

/**
 * Flatten HTML into label/value lines.
 *
 * Breeze lays notifications out as two-column tables, so a `</td><td>` boundary
 * becomes a colon — that turns `<td>Priority</td><td>High</td>` into
 * `Priority: High`, which the line parser already understands.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  return decodeEntities(
    decodeQuotedPrintable(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ': ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Decode quoted-printable, the transfer encoding Breeze's HTML mail uses.
 * Leaves plain text untouched.
 */
function decodeQuotedPrintable(text) {
  if (!/=(?:[0-9A-F]{2}|\n)/.test(text)) return text;

  return text
    .replace(/=\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Decode the handful of entities that show up in these notifications. */
function decodeEntities(text) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    '#39': "'",
    mdash: '—',
    ndash: '–',
  };

  return text
    .replace(/&(#\d+|[a-z]+);/gi, (match, entity) => {
      const key = entity.toLowerCase();
      if (named[key] !== undefined) return named[key];
      if (key.startsWith('#')) return String.fromCharCode(Number(key.slice(1)));
      return match;
    });
}

/** Decode RFC 2047 encoded-words in subject headers. */
function decodeMimeWords(value) {
  return value.replace(/=\?[^?]+\?([BQ])\?([^?]*)\?=/gi, (_, encoding, payload) => {
    if (encoding.toUpperCase() === 'B') return Buffer.from(payload, 'base64').toString('utf-8');
    return payload.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  });
}
