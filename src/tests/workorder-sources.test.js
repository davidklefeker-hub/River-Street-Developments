import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, splitCsv } from '../workorders/sources/breeze-csv.js';
import { parseEmail, htmlToText, extractLabeledFields, splitMessage } from '../workorders/sources/breeze-email.js';
import { canonicalField } from '../workorders/sources/field-map.js';
import { renderTemplate } from '../workorders/sinks/rest.js';

describe('splitCsv', () => {
  test('handles quoted commas and embedded newlines', () => {
    const rows = splitCsv('a,b\n"one, two","line1\nline2"\n');
    assert.deepEqual(rows[0], ['a', 'b']);
    assert.deepEqual(rows[1], ['one, two', 'line1\nline2']);
  });

  test('handles escaped quotes', () => {
    const rows = splitCsv('a\n"he said ""hi"""\n');
    assert.equal(rows[1][0], 'he said "hi"');
  });

  test('strips a UTF-8 BOM from the first header', () => {
    const rows = splitCsv('﻿Work Order,Status\n1042,New\n');
    assert.equal(rows[0][0], 'Work Order');
  });

  test('treats CRLF as a single row terminator', () => {
    const rows = splitCsv('a,b\r\n1,2\r\n');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1], ['1', '2']);
  });
});

describe('canonicalField', () => {
  test('resolves spelling variants to one field', () => {
    assert.equal(canonicalField('Work Order #'), 'number');
    assert.equal(canonicalField('WO Number'), 'number');
    assert.equal(canonicalField('work_order_number'), 'number');
  });

  test('returns null for unknown labels', () => {
    assert.equal(canonicalField('Ledger Code'), null);
  });
});

describe('parseCsv', () => {
  const csv = [
    'Work Order #,Property,Unit,Category,Priority,Status,Description,Tenant Name,Phone,Date Created,Assigned To',
    '1042,River Street Apartments,2B,Plumbing,1,New,"Kitchen faucet leaking, water on floor",Dana Reyes,518-555-0134,2026-03-04,Josh',
    '1043,River Street Apartments,3A,Electrical,3,In Progress,Outlet in bedroom dead,Sam Cole,518-555-0199,2026-03-05,Barry',
  ].join('\n');

  test('produces one normalized work order per row', () => {
    const workOrders = parseCsv(csv);
    assert.equal(workOrders.length, 2);
  });

  test('maps columns onto normalized fields', () => {
    const [wo] = parseCsv(csv);
    assert.equal(wo.number, '1042');
    assert.equal(wo.externalId, 'yardi-breeze-csv:1042');
    assert.equal(wo.unit, '2B');
    assert.equal(wo.category, 'Plumbing');
    assert.equal(wo.priority, 'emergency');
    assert.equal(wo.status, 'open');
    assert.equal(wo.tenant.name, 'Dana Reyes');
    assert.equal(wo.tenant.phone, '518-555-0134');
    assert.equal(wo.assignedTo, 'Josh');
    assert.match(wo.description, /water on floor/);
  });

  test('keeps the original row on raw', () => {
    const [wo] = parseCsv(csv);
    assert.equal(wo.raw['Work Order #'], '1042');
  });

  test('skips blank rows', () => {
    assert.equal(parseCsv(`${csv}\n,,,,,,,,,,\n`).length, 2);
  });

  test('returns nothing for a headers-only export', () => {
    assert.deepEqual(parseCsv('Work Order #,Property\n'), []);
  });
});

describe('splitMessage', () => {
  test('separates headers from the body', () => {
    const { headers, body } = splitMessage('Subject: Work Order #1042\nFrom: a@b.c\n\nBody text');
    assert.equal(headers.subject, 'Work Order #1042');
    assert.equal(body, 'Body text');
  });

  test('treats input with no headers as a bare body', () => {
    const { headers, body } = splitMessage('Just the body\n\nmore');
    assert.deepEqual(headers, {});
    assert.match(body, /Just the body/);
  });
});

describe('extractLabeledFields', () => {
  test('reads Label: value lines', () => {
    const pairs = extractLabeledFields('Priority: High\nUnit: 2B');
    assert.deepEqual(pairs, [
      ['Priority', 'High'],
      ['Unit', '2B'],
    ]);
  });

  test('ignores bare urls', () => {
    const pairs = extractLabeledFields('https://app.companycam.com/projects/1');
    assert.deepEqual(pairs, []);
  });
});

describe('htmlToText', () => {
  test('turns a two-column table row into a labeled field', () => {
    const text = htmlToText('<table><tr><td>Priority</td><td>High</td></tr></table>');
    assert.match(text, /Priority: High/);
  });

  test('decodes entities and drops style blocks', () => {
    const text = htmlToText('<style>p{color:red}</style><p>Smith &amp; Sons</p>');
    assert.equal(text, 'Smith & Sons');
  });
});

describe('parseEmail', () => {
  const plain = [
    'Subject: Work Order #1042 - 12 River St Unit 2B',
    'From: noreply@yardibreeze.com',
    '',
    'A new work order has been created.',
    '',
    'Work Order #: 1042',
    'Property: River Street Apartments',
    'Unit: 2B',
    'Category: Plumbing',
    'Priority: High',
    'Status: New',
    'Tenant: Dana Reyes',
    'Phone: 518-555-0134',
    'Permission to Enter: Yes',
    'Description: Kitchen faucet is leaking steadily under the sink.',
  ].join('\n');

  test('extracts labeled fields from a plain-text notification', () => {
    const wo = parseEmail(plain);
    assert.equal(wo.number, '1042');
    assert.equal(wo.unit, '2B');
    assert.equal(wo.category, 'Plumbing');
    assert.equal(wo.priority, 'high');
    assert.equal(wo.tenant.name, 'Dana Reyes');
    assert.equal(wo.permissionToEnter, true);
    assert.match(wo.description, /leaking steadily/);
  });

  test('falls back to the subject line for the work order number', () => {
    const wo = parseEmail('Subject: Work Order #2001 assigned\n\nPlease see the portal.');
    assert.equal(wo.number, '2001');
  });

  test('summarizes from the description, not the routing subject', () => {
    const wo = parseEmail(plain);
    assert.match(wo.summary, /^Kitchen faucet is leaking/);
  });

  test('uses the subject only when there is no description, minus its prefix', () => {
    const wo = parseEmail('Subject: Work Order #2001 - Unit 4C - Roof leak\n\nSee portal.');
    assert.equal(wo.summary, 'Unit 4C - Roof leak');
  });

  test('preserves line breaks inside a multi-line description', () => {
    const wo = parseEmail(
      'Subject: WO #3003\n\nWork Order #: 3003\n\nTenant reports two problems.\n\nFirst the sink.\nThen the door.'
    );
    assert.match(wo.description, /\n/);
  });

  test('parses an HTML table notification', () => {
    const html = [
      'Subject: Work order 1099',
      'Content-Type: text/html',
      '',
      '<html><body><table>',
      '<tr><td>Work Order #</td><td>1099</td></tr>',
      '<tr><td>Property</td><td>River Street Apartments</td></tr>',
      '<tr><td>Unit</td><td>3A</td></tr>',
      '<tr><td>Priority</td><td>Urgent</td></tr>',
      '<tr><td>Description</td><td>No heat in the bedroom</td></tr>',
      '</table></body></html>',
    ].join('\n');

    const wo = parseEmail(html);
    assert.equal(wo.number, '1099');
    assert.equal(wo.unit, '3A');
    assert.equal(wo.priority, 'emergency');
    assert.match(wo.description, /No heat/);
  });

  test('returns null when there is nothing work-order-shaped', () => {
    assert.equal(parseEmail('Subject: Newsletter\n\nHello there.'), null);
  });
});

describe('renderTemplate', () => {
  const request = {
    summary: 'Broken window',
    priority: 'high',
    unit: '2B',
    photoUrls: ['https://x/1.jpg'],
    address: { city: 'Troy' },
  };

  test('substitutes a whole-string placeholder preserving type', () => {
    assert.deepEqual(renderTemplate({ Photos: '{{photoUrls}}' }, request), {
      Photos: ['https://x/1.jpg'],
    });
  });

  test('interpolates placeholders inside longer strings', () => {
    assert.deepEqual(renderTemplate({ Title: 'Unit {{unit}} — {{summary}}' }, request), {
      Title: 'Unit 2B — Broken window',
    });
  });

  test('resolves dotted and indexed paths', () => {
    assert.deepEqual(renderTemplate({ City: '{{address.city}}', First: '{{photoUrls[0]}}' }, request), {
      City: 'Troy',
      First: 'https://x/1.jpg',
    });
  });

  test('renders missing paths as empty rather than throwing', () => {
    assert.deepEqual(renderTemplate({ X: 'a{{nope.deep}}b' }, request), { X: 'ab' });
  });

  test('recurses through nested objects and arrays', () => {
    const out = renderTemplate({ a: [{ b: '{{unit}}' }] }, request);
    assert.deepEqual(out, { a: [{ b: '2B' }] });
  });
});
