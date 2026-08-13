/**
 * Source — Yardi Breeze work order report export (CSV)
 *
 * Run the work order report in Breeze, export it, drop the file in the watched
 * folder. Each row becomes a normalized work order.
 *
 * Column names are resolved through the shared synonym map, so the same parser
 * handles the work order report, the maintenance report, and a hand-built
 * sheet, as long as the headers are recognizable.
 */

import { readFile } from 'fs/promises';
import { toWorkOrder } from '../model.js';
import { canonicalField, fieldsToWorkOrderInput } from './field-map.js';

export const name = 'yardi-breeze-csv';

/**
 * Parse a Breeze CSV export into normalized work orders.
 *
 * @param {string} filePath
 * @returns {Promise<object[]>}
 */
export async function parseFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return parseCsv(content);
}

/**
 * @param {string} content - Raw CSV text
 * @returns {object[]} Normalized work orders
 */
export function parseCsv(content) {
  const rows = splitCsv(content);
  if (rows.length < 2) return [];

  const headers = rows[0];
  const mapped = headers.map(canonicalField);

  const workOrders = [];

  for (const row of rows.slice(1)) {
    // Skip blank rows and report footers ("Total: 14 work orders")
    if (row.every((cell) => !cell.trim())) continue;

    const fields = {};
    const raw = {};

    row.forEach((cell, index) => {
      const value = cell.trim();
      const header = headers[index];
      if (header) raw[header] = value;

      const field = mapped[index];
      if (field && value && !fields[field]) fields[field] = value;
    });

    if (!fields.number && !fields.summary && !fields.description) continue;

    workOrders.push(toWorkOrder(fieldsToWorkOrderInput(fields, { source: name, raw })));
  }

  return workOrders;
}

/**
 * Minimal RFC 4180 CSV reader: handles quoted fields, escaped quotes ("")
 * and newlines inside quotes. Breeze exports quote any field containing a
 * comma, and descriptions routinely contain both commas and line breaks.
 *
 * @param {string} content
 * @returns {string[][]}
 */
export function splitCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  // Strip a UTF-8 BOM — Breeze exports include one and it corrupts the first header.
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Consume \r\n as a single terminator
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
