import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHmac } from 'crypto';
import { SyncState, workOrderHash } from '../workorders/state.js';
import { toWorkOrder } from '../workorders/model.js';
import { extractPhotoId, verifySignature } from '../workorders/webhook-server.js';
import { config } from '../config.js';

describe('workOrderHash', () => {
  test('is stable for unchanged content', () => {
    const wo = toWorkOrder({ number: '1', summary: 'Leak', status: 'New' });
    assert.equal(workOrderHash(wo), workOrderHash(toWorkOrder({ number: '1', summary: 'Leak', status: 'New' })));
  });

  test('changes when the status changes', () => {
    const open = toWorkOrder({ number: '1', summary: 'Leak', status: 'New' });
    const done = toWorkOrder({ number: '1', summary: 'Leak', status: 'Completed' });
    assert.notEqual(workOrderHash(open), workOrderHash(done));
  });

  test('ignores fields that do not affect the crew', () => {
    const a = toWorkOrder({ number: '1', summary: 'Leak', tenantPhone: '555-0100' });
    const b = toWorkOrder({ number: '1', summary: 'Leak', tenantPhone: '555-0999' });
    assert.equal(workOrderHash(a), workOrderHash(b));
  });
});

describe('SyncState', () => {
  let dir;
  let statePath;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wo-state-'));
    statePath = join(dir, 'nested', 'state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('starts empty when the file does not exist', async () => {
    const state = await new SyncState(statePath).load();
    assert.equal(state.getProjectId('anything'), undefined);
    assert.equal(state.lastPhotoPollAt, 0);
  });

  test('round-trips through disk, creating parent directories', async () => {
    const state = await new SyncState(statePath).load();
    state.setProjectId('12-river-st--2b', '555');
    state.markWorkOrderSynced('breeze:1042', { projectId: '555', contentHash: 'abc' });
    state.markRaisedFromPhoto('999', { sink: 'file', reference: 'r1' });
    state.lastPhotoPollAt = 1_700_000_000;
    await state.save();

    const reloaded = await new SyncState(statePath).load();
    assert.equal(reloaded.getProjectId('12-river-st--2b'), '555');
    assert.ok(reloaded.isWorkOrderSynced('breeze:1042', 'abc'));
    assert.ok(reloaded.hasRaisedFromPhoto('999'));
    assert.equal(reloaded.lastPhotoPollAt, 1_700_000_000);
  });

  test('treats a changed hash as not yet synced', async () => {
    const state = await new SyncState(statePath).load();
    state.markWorkOrderSynced('breeze:1042', { projectId: '555', contentHash: 'abc' });
    assert.ok(state.isWorkOrderSynced('breeze:1042', 'abc'));
    assert.ok(!state.isWorkOrderSynced('breeze:1042', 'xyz'));
  });

  test('leaves no temp file behind after an atomic save', async () => {
    const state = await new SyncState(statePath).load();
    await state.save();
    await assert.rejects(() => readFile(`${statePath}.tmp`, 'utf-8'));
  });
});

describe('extractPhotoId', () => {
  test('reads the common payload envelopes', () => {
    assert.equal(extractPhotoId({ event_type: 'photo.created', payload: { photo: { id: '1' } } }), '1');
    assert.equal(extractPhotoId({ photo: { id: '2' } }), '2');
    assert.equal(extractPhotoId({ data: { photo: { id: '3' } } }), '3');
    assert.equal(extractPhotoId({ event_type: 'photo.tagged', id: '4' }), '4');
    assert.equal(extractPhotoId({ resource_type: 'photo', id: '5' }), '5');
  });

  test('returns null for non-photo events and junk', () => {
    assert.equal(extractPhotoId({ event_type: 'project.created', project: { id: '9' } }), null);
    assert.equal(extractPhotoId(null), null);
    assert.equal(extractPhotoId('nope'), null);
  });
});

describe('verifySignature', () => {
  const body = '{"event_type":"photo.created"}';
  const token = 'shared-secret';
  let original;

  beforeEach(() => {
    original = config.companyCam.webhookToken;
    config.companyCam.webhookToken = token;
  });

  afterEach(() => {
    config.companyCam.webhookToken = original;
  });

  test('accepts a hex digest', () => {
    const signature = createHmac('sha256', token).update(body, 'utf-8').digest('hex');
    assert.ok(verifySignature({ 'x-companycam-signature': signature }, body).ok);
  });

  test('accepts a base64 digest and a sha256= prefix', () => {
    const signature = createHmac('sha256', token).update(body, 'utf-8').digest('base64');
    assert.ok(verifySignature({ 'x-hub-signature-256': `sha256=${signature}` }, body).ok);
  });

  test('rejects a wrong signature', () => {
    assert.ok(!verifySignature({ 'x-companycam-signature': 'deadbeef' }, body).ok);
  });

  test('fails closed when a token is configured but no signature arrives', () => {
    const result = verifySignature({}, body);
    assert.ok(!result.ok);
    assert.match(result.reason, /no signature header/);
  });

  test('rejects a signature computed over a different body', () => {
    const signature = createHmac('sha256', token).update('{"tampered":true}', 'utf-8').digest('hex');
    assert.ok(!verifySignature({ 'x-companycam-signature': signature }, body).ok);
  });

  test('skips verification entirely when no token is configured', () => {
    config.companyCam.webhookToken = '';
    assert.ok(verifySignature({}, body).ok);
  });
});
