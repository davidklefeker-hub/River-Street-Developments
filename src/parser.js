/**
 * CompanyCam Document Parser
 *
 * Parses a CompanyCam project document into structured tasks and subtasks.
 *
 * Expected document format (flexible — supports multiple styles):
 *
 *   Project: 123 Main Street - Kitchen Renovation
 *
 *   ## Demolition
 *   - Remove existing cabinets
 *   - Remove countertops
 *   ![](photos/demo-before.jpg)
 *   https://app.companycam.com/photos/abc123.jpg
 *
 *   ## Electrical
 *   - Run new circuits for island
 *   - Install recessed lighting (12 cans)
 *   ![Panel location](photos/panel.png)
 *
 *   ## Notes
 *   Budget is $45,000. Target completion: 6 weeks.
 *
 * The parser extracts:
 *   - Project name from the first "Project:" line or the filename
 *   - Sections (## headings) become parent tasks
 *   - Bullet items under sections become subtasks
 *   - Image references (markdown images, URLs, local paths) per section → attached to parent task
 *   - A "Notes" section is attached as a description, not tasks
 */

const NOTES_SECTIONS = ['notes', 'note', 'comments', 'comment', 'budget', 'timeline'];

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tiff', '.tif'];

// Matches markdown image syntax: ![alt](path/url)
const MD_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

// Matches a bare URL pointing to an image
const URL_IMAGE_RE = /^(https?:\/\/\S+)$/i;

// Matches a local file path to an image (e.g. photos/demo.jpg, ./img/pic.png)
const LOCAL_IMAGE_RE = /^([./\\]?[\w./\\-]+\.(?:jpg|jpeg|png|gif|webp|heic|heif|bmp|tiff|tif))\s*$/i;

/**
 * Parse a CompanyCam document string into a structured project with tasks.
 *
 * @param {string} content - Raw document text
 * @param {string} filename - Original filename (fallback for project name)
 * @returns {{ projectName: string, notes: string, tasks: Array<{ name: string, subtasks: string[], images: Array<{ src: string, alt: string }> }> }}
 */
export function parseDocument(content, filename = 'Untitled Project') {
  const lines = content.split('\n');

  let projectName = deriveProjectName(lines, filename);
  const sections = extractSections(lines);

  const tasks = [];
  let notes = '';

  for (const section of sections) {
    if (isNotesSection(section.heading)) {
      notes += (notes ? '\n\n' : '') + section.items.join('\n');
    } else {
      tasks.push({
        name: section.heading,
        subtasks: section.items.filter((item) => item.trim().length > 0),
        images: section.images || [],
      });
    }
  }

  // If no sections were found, treat each line as a standalone task
  if (tasks.length === 0 && notes === '') {
    const standaloneItems = lines
      .map((l) => l.replace(/^[-*•]\s*/, '').trim())
      .filter((l) => l.length > 0 && !isProjectLine(l) && !parseImageRef(l));

    for (const item of standaloneItems) {
      tasks.push({ name: item, subtasks: [], images: [] });
    }
  }

  return { projectName, notes, tasks };
}

function deriveProjectName(lines, filename) {
  for (const line of lines) {
    if (isProjectLine(line)) {
      return line.replace(/^(project|job|site|address)\s*[:：]\s*/i, '').trim();
    }
  }

  // Fall back to the first heading
  for (const line of lines) {
    const headingMatch = line.match(/^#\s+(.+)/);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
  }

  // Fall back to filename without extension
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
}

function isProjectLine(line) {
  return /^(project|job|site|address)\s*[:：]/i.test(line.trim());
}

function isNotesSection(heading) {
  return NOTES_SECTIONS.includes(heading.toLowerCase().trim());
}

/**
 * Check if a line is an image reference.
 * Returns { src, alt } if it is, null otherwise.
 */
function parseImageRef(line) {
  const trimmed = line.trim();

  // Markdown image: ![alt](src)
  const mdMatch = trimmed.match(MD_IMAGE_RE);
  if (mdMatch) {
    return { alt: mdMatch[1] || '', src: mdMatch[2] };
  }

  // Bare URL to an image
  const urlMatch = trimmed.match(URL_IMAGE_RE);
  if (urlMatch) {
    const url = urlMatch[1];
    const hasImageExt = IMAGE_EXTENSIONS.some((ext) => url.toLowerCase().includes(ext));
    const isCompanyCam = url.includes('companycam.com');
    if (hasImageExt || isCompanyCam) {
      return { alt: '', src: url };
    }
  }

  // Local file path to an image
  const localMatch = trimmed.match(LOCAL_IMAGE_RE);
  if (localMatch) {
    return { alt: '', src: localMatch[1] };
  }

  return null;
}

/**
 * Extract sections from document lines.
 * A section starts with a heading (## or **Bold** on its own line)
 * and contains bullet items below it.
 */
function extractSections(lines) {
  const sections = [];
  let currentSection = null;

  for (const line of lines) {
    const heading = parseHeading(line);

    if (heading) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = { heading, items: [], images: [] };
      continue;
    }

    if (currentSection) {
      // Check for image reference first
      const imageRef = parseImageRef(line);
      if (imageRef) {
        currentSection.images.push(imageRef);
        continue;
      }

      const item = parseBulletItem(line);
      if (item) {
        currentSection.items.push(item);
      } else if (line.trim().length > 0 && !isProjectLine(line)) {
        // Non-bullet, non-empty line inside a section — treat as a note/description line
        currentSection.items.push(line.trim());
      }
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Parse a line as a heading. Supports:
 *   ## Heading
 *   **Heading**
 *   Heading:  (single word or short phrase ending with colon, all caps or title case)
 */
function parseHeading(line) {
  const trimmed = line.trim();

  // Markdown ## heading
  const mdMatch = trimmed.match(/^#{1,3}\s+(.+)/);
  if (mdMatch) return mdMatch[1].replace(/[#*]/g, '').trim();

  // **Bold heading** on its own line
  const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/);
  if (boldMatch) return boldMatch[1].trim();

  // ALL CAPS heading (at least 3 chars, no bullets)
  if (
    trimmed.length >= 3 &&
    trimmed === trimmed.toUpperCase() &&
    /^[A-Z\s&/()-]+:?$/.test(trimmed)
  ) {
    return trimmed.replace(/:$/, '').trim();
  }

  return null;
}

/**
 * Parse a bullet item. Supports:  - item, * item, • item, numbered: 1. item, 1) item
 */
function parseBulletItem(line) {
  const trimmed = line.trim();
  const match = trimmed.match(/^(?:[-*•]|\d+[.)]\s)\s*(.+)/);
  return match ? match[1].trim() : null;
}

export { parseImageRef as _parseImageRef };
