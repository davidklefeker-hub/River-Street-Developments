/**
 * Work Order Loop CLI
 *
 *   node src/workorders/cli.js import <file...>     Breeze export/email → CompanyCam
 *   node src/workorders/cli.js poll                 tagged damage photos → work order requests
 *   node src/workorders/cli.js watch                watch the incoming folder for exports
 *   node src/workorders/cli.js register-webhook <url>
 *   node src/workorders/cli.js doctor               check credentials and configured names
 *
 * Every command accepts --dry-run, which does all the reading and none of the
 * writing. Start there.
 */

import { readdir, rename, mkdir } from 'fs/promises';
import { join, basename, extname } from 'path';
import { config, validateWorkOrderConfig } from '../config.js';
import { SyncState } from './state.js';
import { syncWorkOrdersToCompanyCam } from './inbound.js';
import { pollDamagePhotos } from './outbound.js';
import { getSink, availableSinks } from './sinks/index.js';
import * as breezeCsv from './sources/breeze-csv.js';
import * as breezeEmail from './sources/breeze-email.js';
import {
  listTags,
  listChecklistTemplates,
  listUsers,
  listWebhooks,
  createWebhook,
  companyCamRequest,
} from './companycam-client.js';

const CSV_EXTENSIONS = ['.csv'];
const EMAIL_EXTENSIONS = ['.eml', '.txt', '.html', '.htm'];

/**
 * Parse a file into normalized work orders, choosing the source by extension.
 *
 * @param {string} filePath
 * @returns {Promise<object[]>}
 */
export async function parseSourceFile(filePath) {
  const ext = extname(filePath).toLowerCase();

  if (CSV_EXTENSIONS.includes(ext)) {
    return breezeCsv.parseFile(filePath);
  }

  if (EMAIL_EXTENSIONS.includes(ext)) {
    const workOrder = await breezeEmail.parseFile(filePath);
    return workOrder ? [workOrder] : [];
  }

  throw new Error(`Unsupported file type "${ext}" (expected ${[...CSV_EXTENSIONS, ...EMAIL_EXTENSIONS].join(', ')})`);
}

async function commandImport(files, { dryRun }) {
  validateWorkOrderConfig({ requireSink: false });

  if (files.length === 0) {
    throw new Error('Usage: cli.js import <file...>');
  }

  const state = await new SyncState(config.statePath).load();
  const workOrders = [];

  for (const file of files) {
    const parsed = await parseSourceFile(file);
    console.log(`${basename(file)}: ${parsed.length} work order(s)`);
    workOrders.push(...parsed);
  }

  if (workOrders.length === 0) {
    console.log('Nothing to sync.');
    return;
  }

  console.log(`\nSyncing ${workOrders.length} work order(s) to CompanyCam${dryRun ? ' [dry run]' : ''}...`);
  const result = await syncWorkOrdersToCompanyCam(workOrders, state, { dryRun });

  console.log(
    `\nDone. synced=${result.synced} skipped=${result.skipped} failed=${result.failed} ` +
      `projectsCreated=${result.projectsCreated}`
  );
  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const e of result.errors) console.log(`  ${e.externalId}: ${e.message}`);
    process.exitCode = 1;
  }
}

async function commandPoll({ dryRun }) {
  validateWorkOrderConfig();

  const state = await new SyncState(config.statePath).load();
  const sink = getSink();

  console.log(`Polling CompanyCam for tagged damage photos${dryRun ? ' [dry run]' : ''}...`);
  console.log(`  Trigger tags: ${config.companyCam.damageTags.join(', ')}`);
  console.log(`  Sink: ${sink.name}`);

  const result = await pollDamagePhotos(state, sink, { dryRun });

  console.log(`\nDone. raised=${result.raised} skipped=${result.skipped} failed=${result.failed}`);
  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const e of result.errors) console.log(`  photo ${e.photoId}: ${e.message}`);
    process.exitCode = 1;
  }
}

async function commandWatch({ dryRun }) {
  validateWorkOrderConfig({ requireSink: false });

  const folder = config.watchFolder;
  await mkdir(folder, { recursive: true });
  await mkdir(config.processedFolder, { recursive: true });

  const { default: chokidar } = await import('chokidar');
  const state = await new SyncState(config.statePath).load();

  console.log('='.repeat(60));
  console.log('Yardi Breeze → CompanyCam watcher');
  console.log('='.repeat(60));
  console.log(`Watching: ${folder}`);
  console.log('Drop a Breeze work order export (.csv) or a saved notification');
  console.log('email (.eml/.html/.txt) here and it syncs to CompanyCam.');
  console.log('\nPress Ctrl+C to stop.\n');

  const watcher = chokidar.watch(folder, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
  });

  watcher.on('add', async (filePath) => {
    const ext = extname(filePath).toLowerCase();
    if (![...CSV_EXTENSIONS, ...EMAIL_EXTENSIONS].includes(ext)) return;

    try {
      const workOrders = await parseSourceFile(filePath);
      console.log(`\n${basename(filePath)}: ${workOrders.length} work order(s)`);

      if (workOrders.length > 0) {
        await syncWorkOrdersToCompanyCam(workOrders, state, { dryRun });
      }

      if (!dryRun) await moveToProcessed(filePath);
    } catch (err) {
      console.error(`  Error processing ${basename(filePath)}: ${err.message}`);
      console.error('  File left in place for retry.');
    }
  });

  watcher.on('error', (err) => console.error('Watcher error:', err.message));
  process.on('SIGINT', () => {
    console.log('\nShutting down watcher...');
    watcher.close();
    process.exit(0);
  });
}

async function commandRegisterWebhook(args, { dryRun }) {
  validateWorkOrderConfig({ requireSink: false });

  const url = args[0];
  if (!url) throw new Error('Usage: cli.js register-webhook <https://your-host/webhook>');
  if (!url.startsWith('https://')) {
    throw new Error('Webhook URL must be https.');
  }

  const scopes = ['photo.created', 'photo.updated', 'photo.tagged'];
  const existing = await listWebhooks();
  const already = existing.find((w) => w.url === url);

  if (already) {
    console.log(`Webhook already registered (${already.id}) with scopes: ${(already.scopes || []).join(', ')}`);
    return;
  }

  if (dryRun) {
    console.log(`[dry run] Would register ${url} for scopes: ${scopes.join(', ')}`);
    return;
  }

  const webhook = await createWebhook({
    url,
    scopes,
    token: config.companyCam.webhookToken || undefined,
  });

  console.log(`Registered webhook ${webhook.id} → ${webhook.url}`);
  console.log(`Scopes: ${(webhook.scopes || scopes).join(', ')}`);
  if (!config.companyCam.webhookToken) {
    console.log('\nSet COMPANYCAM_WEBHOOK_TOKEN and re-register to enable signature verification.');
  }
}

/**
 * Check that credentials work and that every name referenced in configuration
 * actually exists in CompanyCam. Most setup failures are a tag or template that
 * was never created, and they otherwise surface as silence.
 */
async function commandDoctor() {
  validateWorkOrderConfig({ requireSink: false });

  console.log('CompanyCam');
  console.log('-'.repeat(60));

  const me = await companyCamRequest('/users/current');
  console.log(`  Authenticated as: ${me?.email_address || me?.first_name || 'unknown'}`);

  const company = await companyCamRequest('/company');
  console.log(`  Company: ${company?.name || 'unknown'} (${company?.id || '?'})`);

  const tags = await listTags();
  const tagValues = new Set(tags.map((t) => String(t.value ?? t.display_value ?? '').toLowerCase()));

  console.log('\nTrigger tags');
  console.log('-'.repeat(60));
  for (const tag of config.companyCam.damageTags) {
    const present = tagValues.has(tag.toLowerCase());
    console.log(`  ${present ? 'OK     ' : 'MISSING'} ${tag}`);
  }

  console.log('\nCategory tags');
  console.log('-'.repeat(60));
  for (const tag of Object.keys(config.companyCam.categoryTags)) {
    const present = tagValues.has(tag.toLowerCase());
    console.log(`  ${present ? 'OK     ' : 'missing'} ${tag} → ${config.companyCam.categoryTags[tag]}`);
  }

  if (config.companyCam.checklistTemplatesByCategory) {
    console.log('\nChecklist templates');
    console.log('-'.repeat(60));
    const templates = await listChecklistTemplates();
    const names = new Set(templates.map((t) => String(t.name || '').toLowerCase()));
    for (const [category, templateName] of Object.entries(config.companyCam.checklistTemplatesByCategory)) {
      const present = names.has(String(templateName).toLowerCase());
      console.log(`  ${present ? 'OK     ' : 'MISSING'} ${category} → ${templateName}`);
    }
  }

  console.log('\nWebhooks');
  console.log('-'.repeat(60));
  const webhooks = await listWebhooks();
  if (webhooks.length === 0) {
    console.log('  none registered (polling only)');
  }
  for (const webhook of webhooks) {
    console.log(`  ${webhook.enabled ? 'enabled ' : 'disabled'} ${webhook.url} [${(webhook.scopes || []).join(', ')}]`);
  }

  console.log('\nSink');
  console.log('-'.repeat(60));
  console.log(`  Active: ${config.sinks.active} (available: ${availableSinks.join(', ')})`);
  try {
    validateWorkOrderConfig();
    console.log('  Configuration OK');
  } catch (err) {
    console.log(`  NOT READY: ${err.message}`);
  }

  const users = await listUsers();
  console.log(`\n${users.length} CompanyCam user(s) in the company.`);
}

async function moveToProcessed(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(config.processedFolder, `${stamp}_${basename(filePath)}`);
  await rename(filePath, dest).catch(() => {});
  console.log(`  Moved to: ${dest}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const args = argv.filter((a) => a !== '--dry-run');
  const [command, ...rest] = args;

  switch (command) {
    case 'import':
      return commandImport(rest, { dryRun });
    case 'poll':
      return commandPoll({ dryRun });
    case 'watch':
      return commandWatch({ dryRun });
    case 'register-webhook':
      return commandRegisterWebhook(rest, { dryRun });
    case 'doctor':
      return commandDoctor();
    default:
      console.log(
        [
          'Usage: node src/workorders/cli.js <command> [--dry-run]',
          '',
          '  import <file...>          Sync a Breeze CSV export or notification email to CompanyCam',
          '  poll                      Raise work order requests from tagged damage photos',
          '  watch                     Watch the incoming folder for Breeze exports',
          '  register-webhook <url>    Register a CompanyCam webhook for photo events',
          '  doctor                    Verify credentials, tags, templates and sink config',
        ].join('\n')
      );
      process.exitCode = command ? 1 : 0;
  }
}

// Only the watcher and webhook receiver are long-running; everything else exits.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exitCode = 1;
  });
}

export { commandImport, commandPoll, commandDoctor };
