/**
 * CompanyCam Webhook Receiver
 *
 * Low-latency delivery for the field → work order direction: CompanyCam POSTs
 * here the moment a photo is created or tagged, instead of waiting for the next
 * poll.
 *
 * Run this *alongside* the poller, not instead of it. The receiver only ever
 * extracts a photo id from the payload and re-fetches the photo from the API,
 * and both paths share the same state file, so a delivery that is missed,
 * duplicated or arrives before the crew finishes tagging is still picked up
 * correctly by the poller. That also means this endpoint doesn't depend on
 * CompanyCam's payload shape beyond finding an id somewhere in it.
 *
 * Register the endpoint with:  npm run wo:webhook:register -- https://your-host/webhook
 */

import { createServer } from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { config, validateWorkOrderConfig } from '../config.js';
import { SyncState } from './state.js';
import { raiseFromPhotoId } from './outbound.js';
import { getSink } from './sinks/index.js';

const SIGNATURE_HEADERS = [
  'x-companycam-signature',
  'x-companycam-hmac-sha256',
  'x-hub-signature-256',
  'x-signature',
];

/**
 * Verify the payload signature against the webhook's shared token.
 *
 * CompanyCam documents the webhook `token` as "a string used to hash the
 * webhook body for verification" but does not publish the header name or
 * digest encoding, so we accept the common spellings and both hex and base64.
 * If a token is configured and no recognized signature header arrives, the
 * request is rejected — failing closed is the right default for an endpoint
 * that creates work orders.
 *
 * @param {import('http').IncomingHttpHeaders} headers
 * @param {string} body
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifySignature(headers, body) {
  const token = config.companyCam.webhookToken;
  if (!token) return { ok: true };

  const header = SIGNATURE_HEADERS.map((name) => headers[name]).find(Boolean);
  if (!header) return { ok: false, reason: 'no signature header' };

  const provided = Buffer.from(String(header).replace(/^sha256=/i, '').trim());

  // Hmac objects are single-use, so each encoding needs its own instance.
  const matched = ['hex', 'base64'].some((encoding) => {
    const expected = Buffer.from(createHmac('sha256', token).update(body, 'utf-8').digest(encoding));
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  });

  return matched ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

/**
 * Find a photo id anywhere in a webhook payload.
 *
 * Written against the shape rather than a fixed path, because the payload
 * envelope isn't part of CompanyCam's published spec.
 *
 * @param {object} payload
 * @returns {string|null}
 */
export function extractPhotoId(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const direct =
    payload.photo?.id ??
    payload.payload?.photo?.id ??
    payload.data?.photo?.id ??
    payload.resource?.id;

  if (direct) return String(direct);

  const type = String(payload.resource_type ?? payload.object_type ?? '').toLowerCase();
  if (type === 'photo' && payload.id) return String(payload.id);

  const eventType = String(payload.event_type ?? payload.event ?? '').toLowerCase();
  if (eventType.startsWith('photo.') && payload.id) return String(payload.id);

  return null;
}

async function handleRequest(req, res, state, sink) {
  if (req.method !== 'POST') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      res.writeHead(413).end('Payload Too Large');
      return;
    }
  }

  const verification = verifySignature(req.headers, body);
  if (!verification.ok) {
    console.warn(`  Rejected webhook: ${verification.reason}`);
    res.writeHead(401).end('Unauthorized');
    return;
  }

  // Acknowledge before doing the work — CompanyCam shouldn't wait on our sink,
  // and the poller is the safety net if the processing below fails.
  res.writeHead(200).end('OK');

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    console.warn('  Webhook payload was not JSON — ignoring.');
    return;
  }

  const eventType = payload.event_type ?? payload.event ?? 'unknown';
  const photoId = extractPhotoId(payload);

  if (!photoId) {
    console.log(`  Webhook "${eventType}" carried no photo id — ignoring.`);
    return;
  }

  try {
    const outcome = await raiseFromPhotoId(photoId, state, sink);
    if (outcome.status === 'raised') {
      console.log(`  Raised work order request from photo ${photoId} via ${sink.name}`);
    } else {
      console.log(`  Photo ${photoId}: ${outcome.status}`);
    }
  } catch (err) {
    console.error(`  Failed handling photo ${photoId}: ${err.message}`);
  }
}

export async function startWebhookServer() {
  validateWorkOrderConfig();

  const state = await new SyncState(config.statePath).load();
  const sink = getSink();
  const port = config.companyCam.webhookPort;

  const server = createServer((req, res) => {
    handleRequest(req, res, state, sink).catch((err) => {
      console.error('  Webhook handler error:', err.message);
      if (!res.headersSent) res.writeHead(500).end('Internal Server Error');
    });
  });

  server.listen(port, () => {
    console.log('='.repeat(60));
    console.log('CompanyCam webhook receiver');
    console.log('='.repeat(60));
    console.log(`Listening on port ${port}`);
    console.log(`Sink: ${sink.name}`);
    console.log(`Trigger tags: ${config.companyCam.damageTags.join(', ')}`);
    if (!config.companyCam.webhookToken) {
      console.log('');
      console.log('WARNING: COMPANYCAM_WEBHOOK_TOKEN is not set — payloads are unverified.');
    }
    console.log('');
    console.log('Keep the poller running too (npm run wo:poll) — it is the safety net.');
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down webhook receiver...');
    server.close(() => process.exit(0));
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWebhookServer();
}
