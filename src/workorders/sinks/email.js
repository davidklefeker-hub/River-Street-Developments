/**
 * Email Sink
 *
 * Sends the work order request to a mailbox over SMTP.
 *
 * Use this when the PM platform has no write API (Yardi Breeze today): the
 * request lands in the maintenance coordinator's inbox already formatted, with
 * the photo linked, so creating the work order is a paste rather than a
 * transcription. If your platform *does* accept email-to-work-order intake,
 * point SMTP_TO at that intake address and the loop closes without a human.
 */

import nodemailer from 'nodemailer';
import { config } from '../../config.js';
import { formatRequestBrief, formatRequestSubject } from './format.js';

export const name = 'email';

let transport;

function getTransport() {
  if (transport) return transport;

  const { host, port, secure, user, pass } = config.sinks.email.smtp;
  if (!host) {
    throw new Error('Email sink requires SMTP_HOST (and usually SMTP_USER / SMTP_PASS).');
  }

  transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });

  return transport;
}

/**
 * @param {object} request - Normalized WorkOrderRequest
 * @returns {Promise<{ reference: string }>}
 */
export async function send(request) {
  const { from, to, cc } = config.sinks.email;

  if (!to) throw new Error('Email sink requires WORKORDER_EMAIL_TO.');

  const body = formatRequestBrief(request);
  const info = await getTransport().sendMail({
    from: from || to,
    to,
    cc: cc || undefined,
    subject: formatRequestSubject(request),
    text: body,
    html: toHtml(body, request),
  });

  console.log(`    Emailed ${to} (${info.messageId})`);
  return { reference: info.messageId };
}

/**
 * A minimal HTML rendering — monospace body so the brief keeps its alignment,
 * plus the photo inlined so the coordinator can triage without clicking.
 */
function toHtml(body, request) {
  const escaped = body.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const images = request.photoUrls
    .map((url) => `<p><img src="${url}" alt="Reported damage" style="max-width:520px;height:auto;"></p>`)
    .join('\n');

  return `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;">
<pre style="white-space:pre-wrap;margin:0;">${escaped}</pre>
${images}
</div>`;
}
