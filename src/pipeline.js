/**
 * Pipeline Orchestrator
 *
 * Takes a raw document file, parses it, and pushes structured tasks to Asana.
 */

import { readFile } from 'fs/promises';
import { basename } from 'path';
import { parseDocument } from './parser.js';
import { findOrCreateProject, createTask, createSubtask } from './asana-client.js';

/**
 * Process a single document file end-to-end.
 *
 * @param {string} filePath - Path to the document file
 * @returns {Promise<{ projectName: string, tasksCreated: number, subtasksCreated: number }>}
 */
export async function processDocument(filePath) {
  console.log(`\nProcessing: ${filePath}`);

  // 1. Read the document
  const content = await readFile(filePath, 'utf-8');
  const filename = basename(filePath);

  // 2. Parse into structured tasks
  const parsed = parseDocument(content, filename);
  console.log(`  Project: "${parsed.projectName}"`);
  console.log(`  Tasks found: ${parsed.tasks.length}`);

  if (parsed.tasks.length === 0) {
    console.log('  No tasks found in document — skipping.');
    return { projectName: parsed.projectName, tasksCreated: 0, subtasksCreated: 0 };
  }

  // 3. Find or create the Asana project
  const project = await findOrCreateProject(parsed.projectName);

  // 4. Create tasks and subtasks
  let tasksCreated = 0;
  let subtasksCreated = 0;

  for (const taskDef of parsed.tasks) {
    const notes = parsed.notes && tasksCreated === 0
      ? `Project Notes:\n${parsed.notes}`
      : '';

    const task = await createTask(project.gid, taskDef.name, notes);
    tasksCreated++;

    for (const subtaskName of taskDef.subtasks) {
      await createSubtask(task.gid, subtaskName);
      subtasksCreated++;
    }
  }

  console.log(`\n  Done! Created ${tasksCreated} tasks and ${subtasksCreated} subtasks in "${parsed.projectName}".`);

  return { projectName: parsed.projectName, tasksCreated, subtasksCreated };
}
