/**
 * Folder Watcher
 *
 * Watches the incoming folder for new .txt or .md files dropped from CompanyCam.
 * When a new file appears, it runs the pipeline and moves the file to processed/.
 */

import { rename, mkdir } from 'fs/promises';
import { join, basename } from 'path';
import chokidar from 'chokidar';
import { config, validateConfig } from './config.js';
import { processDocument } from './pipeline.js';

const SUPPORTED_EXTENSIONS = ['.txt', '.md'];

async function ensureDirs() {
  await mkdir(config.watchFolder, { recursive: true });
  await mkdir(config.processedFolder, { recursive: true });
}

async function moveToProcessed(filePath) {
  const filename = basename(filePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(config.processedFolder, `${timestamp}_${filename}`);
  await rename(filePath, dest);
  console.log(`  Moved to: ${dest}`);
}

async function handleNewFile(filePath) {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return;
  }

  // Small delay to ensure the file is fully written
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    await processDocument(filePath);
    await moveToProcessed(filePath);
  } catch (err) {
    console.error(`  Error processing ${filePath}:`, err.message);
    console.error('  File left in place for retry.');
  }
}

async function startWatcher() {
  validateConfig();
  await ensureDirs();

  console.log('='.repeat(60));
  console.log('CompanyCam → Asana Pipeline');
  console.log('River Street Developments');
  console.log('='.repeat(60));
  console.log(`Watching: ${config.watchFolder}`);
  console.log(`Processed files go to: ${config.processedFolder}`);
  console.log('Drop a .txt or .md file to create Asana tasks.');
  console.log('Press Ctrl+C to stop.\n');

  const watcher = chokidar.watch(config.watchFolder, {
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 200,
    },
  });

  watcher.on('add', handleNewFile);
  watcher.on('error', (err) => console.error('Watcher error:', err));

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down watcher...');
    watcher.close();
    process.exit(0);
  });
}

startWatcher();
