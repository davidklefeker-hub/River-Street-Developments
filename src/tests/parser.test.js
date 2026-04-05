import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, _parseImageRef } from '../parser.js';

describe('parseDocument', () => {
  it('extracts project name from "Project:" line', () => {
    const doc = 'Project: 123 Main St - Renovation\n\n## Demo\n- Remove walls';
    const result = parseDocument(doc);
    assert.equal(result.projectName, '123 Main St - Renovation');
  });

  it('extracts sections as tasks with subtasks', () => {
    const doc = `Project: Test Job

## Demolition
- Remove cabinets
- Remove flooring

## Electrical
- Run new circuits
- Install lighting`;

    const result = parseDocument(doc);
    assert.equal(result.tasks.length, 2);
    assert.equal(result.tasks[0].name, 'Demolition');
    assert.deepEqual(result.tasks[0].subtasks, ['Remove cabinets', 'Remove flooring']);
    assert.equal(result.tasks[1].name, 'Electrical');
    assert.deepEqual(result.tasks[1].subtasks, ['Run new circuits', 'Install lighting']);
  });

  it('separates Notes section from tasks', () => {
    const doc = `Project: Test

## Framing
- Build walls

## Notes
Budget is $10,000.`;

    const result = parseDocument(doc);
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].name, 'Framing');
    assert.ok(result.notes.includes('Budget is $10,000'));
  });

  it('handles bold headings', () => {
    const doc = `Project: Bold Test

**Plumbing**
- Fix pipes

**Electrical**
- Wire outlets`;

    const result = parseDocument(doc);
    assert.equal(result.tasks.length, 2);
    assert.equal(result.tasks[0].name, 'Plumbing');
    assert.equal(result.tasks[1].name, 'Electrical');
  });

  it('handles ALL CAPS headings', () => {
    const doc = `Project: Caps Test

DEMOLITION
- Tear down walls

FRAMING
- Build walls`;

    const result = parseDocument(doc);
    assert.equal(result.tasks.length, 2);
    assert.equal(result.tasks[0].name, 'DEMOLITION');
  });

  it('falls back to filename for project name', () => {
    const doc = '## Tasks\n- Do something';
    const result = parseDocument(doc, 'my-cool-project.txt');
    assert.equal(result.projectName, 'my cool project');
  });

  it('handles flat bullet list with no sections', () => {
    const doc = `- Task one
- Task two
- Task three`;

    const result = parseDocument(doc);
    assert.equal(result.tasks.length, 3);
    assert.equal(result.tasks[0].name, 'Task one');
    assert.deepEqual(result.tasks[0].subtasks, []);
  });

  it('handles numbered lists', () => {
    const doc = `Project: Numbered

## Phase 1
1. First thing
2. Second thing
3. Third thing`;

    const result = parseDocument(doc);
    assert.equal(result.tasks[0].subtasks.length, 3);
    assert.equal(result.tasks[0].subtasks[0], 'First thing');
  });

  it('handles the full sample document', () => {
    const doc = `Project: 742 Evergreen Terrace - Kitchen & Bath Remodel

## Demolition
- Remove existing kitchen cabinets and countertops
- Demo bathroom tile and fixtures

## Electrical
- Run 20A dedicated circuit for island

## Notes
Budget is $85,000.`;

    const result = parseDocument(doc);
    assert.equal(result.projectName, '742 Evergreen Terrace - Kitchen & Bath Remodel');
    assert.equal(result.tasks.length, 2);
    assert.equal(result.tasks[0].subtasks.length, 2);
    assert.equal(result.tasks[1].subtasks.length, 1);
    assert.ok(result.notes.includes('$85,000'));
  });
});

describe('image parsing', () => {
  it('extracts markdown image references from sections', () => {
    const doc = `Project: Image Test

## Demolition
- Remove cabinets
![Before photo](photos/before.jpg)
![](photos/overview.png)`;

    const result = parseDocument(doc);
    assert.equal(result.tasks[0].images.length, 2);
    assert.equal(result.tasks[0].images[0].src, 'photos/before.jpg');
    assert.equal(result.tasks[0].images[0].alt, 'Before photo');
    assert.equal(result.tasks[0].images[1].src, 'photos/overview.png');
    assert.equal(result.tasks[0].images[1].alt, '');
  });

  it('extracts URL image references', () => {
    const doc = `Project: URL Test

## Electrical
- Wire outlets
https://app.companycam.com/photos/abc123.jpg`;

    const result = parseDocument(doc);
    assert.equal(result.tasks[0].images.length, 1);
    assert.equal(result.tasks[0].images[0].src, 'https://app.companycam.com/photos/abc123.jpg');
  });

  it('extracts CompanyCam URLs without image extension', () => {
    const doc = `Project: CompanyCam Test

## Plumbing
- Fix pipes
https://app.companycam.com/photos/12345`;

    const result = parseDocument(doc);
    assert.equal(result.tasks[0].images.length, 1);
    assert.equal(result.tasks[0].images[0].src, 'https://app.companycam.com/photos/12345');
  });

  it('extracts local file path image references', () => {
    const doc = `Project: Local Test

## Framing
- Build walls
photos/framing-layout.png`;

    const result = parseDocument(doc);
    assert.equal(result.tasks[0].images.length, 1);
    assert.equal(result.tasks[0].images[0].src, 'photos/framing-layout.png');
  });

  it('does not treat images as subtasks', () => {
    const doc = `Project: Mixed Test

## Demo
- Remove walls
- Haul debris
![Photo](demo.jpg)
photos/another.png`;

    const result = parseDocument(doc);
    assert.equal(result.tasks[0].subtasks.length, 2);
    assert.equal(result.tasks[0].images.length, 2);
  });

  it('associates images with correct parent sections', () => {
    const doc = `Project: Multi Section

## Demolition
- Remove cabinets
![Demo photo](demo.jpg)

## Electrical
- Run circuits
![Panel](panel.jpg)
![Wiring](wiring.png)`;

    const result = parseDocument(doc);
    assert.equal(result.tasks[0].images.length, 1);
    assert.equal(result.tasks[0].images[0].src, 'demo.jpg');
    assert.equal(result.tasks[1].images.length, 2);
    assert.equal(result.tasks[1].images[0].src, 'panel.jpg');
    assert.equal(result.tasks[1].images[1].src, 'wiring.png');
  });

  it('returns empty images array when no images in section', () => {
    const doc = `Project: No Images

## Framing
- Build walls`;

    const result = parseDocument(doc);
    assert.deepEqual(result.tasks[0].images, []);
  });
});

describe('_parseImageRef', () => {
  it('parses markdown image syntax', () => {
    const ref = _parseImageRef('![Alt text](path/to/image.jpg)');
    assert.deepEqual(ref, { alt: 'Alt text', src: 'path/to/image.jpg' });
  });

  it('parses bare image URL', () => {
    const ref = _parseImageRef('https://example.com/photo.png');
    assert.deepEqual(ref, { alt: '', src: 'https://example.com/photo.png' });
  });

  it('parses local file path', () => {
    const ref = _parseImageRef('photos/demo.jpg');
    assert.deepEqual(ref, { alt: '', src: 'photos/demo.jpg' });
  });

  it('returns null for non-image lines', () => {
    assert.equal(_parseImageRef('- Remove cabinets'), null);
    assert.equal(_parseImageRef('Just some text'), null);
    assert.equal(_parseImageRef('## Heading'), null);
  });
});
