/**
 * One-off document processor (CLI usage).
 *
 * Usage: node src/process-document.js <path-to-document>
 */

import { validateConfig } from './config.js';
import { processDocument } from './pipeline.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node src/process-document.js <path-to-document.txt>');
  process.exit(1);
}

validateConfig();

try {
  const result = await processDocument(filePath);
  console.log('\nSummary:', JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(1);
}
