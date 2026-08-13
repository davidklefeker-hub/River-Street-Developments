/**
 * Sink resolver.
 *
 * A sink is whatever actually creates the work order in the PM platform.
 * Swapping platforms means changing WORKORDER_SINK, not changing the pipeline.
 */

import { config } from '../../config.js';
import * as fileSink from './file.js';
import * as emailSink from './email.js';
import * as restSink from './rest.js';

const SINKS = {
  file: fileSink,
  email: emailSink,
  rest: restSink,
};

/**
 * @param {string} [name] - Defaults to WORKORDER_SINK
 * @returns {{ name: string, send: (request: object) => Promise<{ reference?: string }> }}
 */
export function getSink(name = config.sinks.active) {
  const sink = SINKS[name];
  if (!sink) {
    throw new Error(`Unknown sink "${name}". Available: ${Object.keys(SINKS).join(', ')}`);
  }
  return sink;
}

export const availableSinks = Object.keys(SINKS);
