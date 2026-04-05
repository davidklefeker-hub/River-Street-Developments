/**
 * Folder Watcher (Continuous Mode)
 *
 * Watches the incoming folder for new .txt or .md files dropped from CompanyCam.
 * When a new file appears, it runs the pipeline and moves the file to processed/.
 *
 * Image files (.jpg, .png, etc.) dropped alongside documents are left in place
 * so the pipeline can attach them to Asana tasks. After processing, both the
 * document and any referenced local images are moved to processed/.
 */

import { rename, mkdir, stat } from 'fs/promises';
import { join, basename, dirname, resolve } from 'path';
import chokidar from 'chokidar';
import { config, validateConfig } from './config.js';
import { processDocument } from './pipeline.js';

const DOCUMENT_EXTENSIONS = ['.txt', '.md'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tiff', '.tif'];

async function ensureDirs() {
  await mkdir(config.watchFolder, { recursive: true });
  await mkdir(config.processedFolder, { recursive: true });
}

async function moveToProcessed(filePath) {
  const filename = basename(filePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(config.processedFolder, `${timestamp}_${filename}`);
  try {
    await rename(filePath, dest);
    console.log(`  Moved to: ${dest}`);
  } catch {
    // File may have already been moved or deleted
  }
}

/**
 * After processing a document, move any local images it referenced
 * into the processed folder so they don't linger.
 */
async function moveReferencedImages(parsedTasks, docDir) {
  for (const task of parsedTasks) {
    for (const image of task.images) {
      const isUrl = /^https?:\/\//i.test(image.src);
      if (isUrl) continue;

      const resolvedPath = resolve(docDir, image.src);
      try {
        await stat(resolvedPath);
        await moveToProcessed(resolvedPath);
      } catch {
        // Image file doesn't exist or already moved — skip
      }
    }
  }
}

function isDocumentFile(filePath) {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return DOCUMENT_EXTENSIONS.includes(ext);
}

function isImageFile(filePath) {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

async function handleNewFile(filePath) {
  // Only process document files — images are picked up by the parser
  if (!isDocumentFile(filePath)) {
    if (isImageFile(filePath)) {
      console.log(`  Image detected: ${basename(filePath)} (will attach when referenced by a document)`);
    }
    return;
  }

  // Small delay to ensure the file is fully written
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    const { parseDocument } = await import('./parser.js');
    const { readFile } = await import('fs/promises');

    // Pre-parse to get image references for cleanup later
    const content = await readFile(filePath, 'utf-8');
    const parsed = parseDocument(content, basename(filePath));

    // Run the full pipeline
    await processDocument(filePath);

    // Move the document to processed
    await moveToProcessed(filePath);

    // Move any local images that were referenced
    await moveReferencedImages(parsed.tasks, dirname(filePath));
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
  console.log('');
  console.log('Drop a .txt or .md file to create Asana tasks.');
  console.log('Include images in the same folder and reference them');
  console.log('in your document — they\'ll be attached to parent tasks.');
  console.log('');
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
