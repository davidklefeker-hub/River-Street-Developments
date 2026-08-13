/**
 * File Sink
 *
 * Writes each work order request to an outbox folder as both JSON (machine
 * readable) and a plain-text brief (paste-ready).
 *
 * This is the sink to use while you're still on a PM platform with no write
 * API: the automation does everything up to the point a human has to key the
 * work order in, and the brief is formatted so that's a copy-paste, not a
 * re-typing job. It's also the safest sink for testing the loop end to end.
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from '../../config.js';
import { formatRequestBrief } from './format.js';

export const name = 'file';

/**
 * @param {object} request - Normalized WorkOrderRequest
 * @returns {Promise<{ reference: string }>}
 */
export async function send(request) {
  const dir = config.sinks.file.outboxFolder;
  await mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `wo-request_${stamp}_photo-${request.originId || 'unknown'}`;

  const jsonPath = join(dir, `${base}.json`);
  const textPath = join(dir, `${base}.txt`);

  await writeFile(jsonPath, JSON.stringify(request, null, 2), 'utf-8');
  await writeFile(textPath, formatRequestBrief(request), 'utf-8');

  console.log(`    Wrote ${textPath}`);
  return { reference: base };
}
