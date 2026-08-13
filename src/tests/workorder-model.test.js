import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toWorkOrder,
  toWorkOrderRequest,
  normalizePriority,
  normalizeStatus,
  parseAddressLine,
  locationKey,
  projectNameFor,
} from '../workorders/model.js';

describe('normalizePriority', () => {
  test('maps Breeze numeric priorities', () => {
    assert.equal(normalizePriority('1'), 'emergency');
    assert.equal(normalizePriority('4'), 'low');
  });

  test('maps word aliases case-insensitively', () => {
    assert.equal(normalizePriority('URGENT'), 'emergency');
    assert.equal(normalizePriority('Routine'), 'low');
    assert.equal(normalizePriority('Normal'), 'medium');
  });

  test('defaults unknown values to medium', () => {
    assert.equal(normalizePriority('whenever'), 'medium');
    assert.equal(normalizePriority(''), 'medium');
    assert.equal(normalizePriority(undefined), 'medium');
  });
});

describe('normalizeStatus', () => {
  test('collapses platform spellings onto canonical statuses', () => {
    assert.equal(normalizeStatus('New'), 'open');
    assert.equal(normalizeStatus('In Progress'), 'in_progress');
    assert.equal(normalizeStatus('Closed'), 'completed');
    assert.equal(normalizeStatus('Canceled'), 'cancelled');
  });
});

describe('parseAddressLine', () => {
  test('splits street, city, state and zip', () => {
    const parsed = parseAddressLine('12 River St, Troy, NY 12180');
    assert.equal(parsed.street_address_1, '12 River St');
    assert.equal(parsed.city, 'Troy');
    assert.equal(parsed.state, 'NY');
    assert.equal(parsed.postal_code, '12180');
  });

  test('picks up a unit designator in the middle', () => {
    const parsed = parseAddressLine('12 River St, Unit 2B, Troy, NY 12180');
    assert.equal(parsed.street_address_1, '12 River St');
    assert.equal(parsed.street_address_2, 'Unit 2B');
    assert.equal(parsed.city, 'Troy');
  });

  test('handles a bare street address', () => {
    assert.deepEqual(parseAddressLine('12 River St'), { street_address_1: '12 River St' });
  });
});

describe('locationKey', () => {
  test('is stable across street-suffix and unit spellings', () => {
    const a = toWorkOrder({ address: '12 River Street, Troy, NY', unit: 'Unit 2B' });
    const b = toWorkOrder({ address: '12 River St, Troy, NY', unit: '2b' });
    assert.equal(locationKey(a), locationKey(b));
  });

  test('separates different units at the same building', () => {
    const a = toWorkOrder({ address: '12 River St', unit: '2B' });
    const b = toWorkOrder({ address: '12 River St', unit: '3A' });
    assert.notEqual(locationKey(a), locationKey(b));
  });

  test('falls back to the property name when there is no address', () => {
    const wo = toWorkOrder({ property: 'River Street Apartments' });
    assert.equal(locationKey(wo), 'river-st-apartments');
  });
});

describe('projectNameFor', () => {
  test('includes the unit when present', () => {
    const wo = toWorkOrder({ address: '12 River St, Troy, NY', unit: '2B' });
    assert.equal(projectNameFor(wo), '12 River St — Unit 2B');
  });

  test('uses the street address alone when there is no unit', () => {
    const wo = toWorkOrder({ address: '12 River St, Troy, NY' });
    assert.equal(projectNameFor(wo), '12 River St');
  });
});

describe('toWorkOrder', () => {
  test('derives a summary from the description when none is given', () => {
    const wo = toWorkOrder({ description: 'Kitchen faucet dripping\nSecond line of detail' });
    assert.equal(wo.summary, 'Kitchen faucet dripping');
  });

  test('normalizes permission to enter into a tri-state', () => {
    assert.equal(toWorkOrder({ permissionToEnter: 'Yes' }).permissionToEnter, true);
    assert.equal(toWorkOrder({ permissionToEnter: 'No' }).permissionToEnter, false);
    assert.equal(toWorkOrder({}).permissionToEnter, null);
  });

  test('coerces dates to ISO and drops unparseable ones', () => {
    assert.equal(toWorkOrder({ requestedAt: '2026-03-04' }).requestedAt, '2026-03-04T00:00:00.000Z');
    assert.equal(toWorkOrder({ requestedAt: 'not a date' }).requestedAt, '');
  });

  test('always produces a full address object', () => {
    const wo = toWorkOrder({});
    assert.equal(wo.address.street_address_1, '');
    assert.equal(wo.address.country, 'US');
  });
});

describe('toWorkOrderRequest', () => {
  test('stamps reportedAt when the source has no timestamp', () => {
    const request = toWorkOrderRequest({ summary: 'Broken window' });
    assert.ok(Date.parse(request.reportedAt) > 0);
  });

  test('keeps photo urls and tags as arrays', () => {
    const request = toWorkOrderRequest({ photoUrls: ['https://x/1.jpg', ''], tags: ['Damage'] });
    assert.deepEqual(request.photoUrls, ['https://x/1.jpg']);
    assert.deepEqual(request.tags, ['Damage']);
  });
});
