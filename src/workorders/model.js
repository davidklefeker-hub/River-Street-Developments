/**
 * Normalized Work Order Model
 *
 * Every property-management platform describes a work order differently.
 * Sources (Breeze email, Breeze CSV export, a PM REST API) all normalize into
 * the shapes below, and everything downstream — CompanyCam sync, sinks, state —
 * only ever sees these.
 *
 * Two shapes:
 *   WorkOrder        — a work order that already exists in the PM platform.
 *                      Flows PM → CompanyCam.
 *   WorkOrderRequest — a request to create a work order, raised from the field.
 *                      Flows CompanyCam → PM.
 */

export const PRIORITIES = ['low', 'medium', 'high', 'emergency'];
export const STATUSES = ['open', 'assigned', 'in_progress', 'on_hold', 'completed', 'cancelled'];

// Numeric priorities are how Breeze exports the field. 1 is the most urgent
// level in a default configuration, but priority levels are user-definable —
// check yours against the work order screen and adjust these four lines if the
// scale differs.
const PRIORITY_ALIASES = {
  '1': 'emergency',
  '2': 'high',
  '3': 'medium',
  '4': 'low',
  urgent: 'emergency',
  emergency: 'emergency',
  critical: 'emergency',
  high: 'high',
  medium: 'medium',
  normal: 'medium',
  standard: 'medium',
  routine: 'low',
  low: 'low',
};

const STATUS_ALIASES = {
  new: 'open',
  open: 'open',
  submitted: 'open',
  call: 'open',
  assigned: 'assigned',
  scheduled: 'assigned',
  'in progress': 'in_progress',
  in_progress: 'in_progress',
  started: 'in_progress',
  'on hold': 'on_hold',
  on_hold: 'on_hold',
  pending: 'on_hold',
  waiting: 'on_hold',
  complete: 'completed',
  completed: 'completed',
  closed: 'completed',
  done: 'completed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  void: 'cancelled',
};

/**
 * Build a normalized WorkOrder from loosely-shaped source fields.
 *
 * @param {object} fields
 * @returns {{
 *   source: string,
 *   externalId: string,
 *   number: string,
 *   status: string,
 *   priority: string,
 *   category: string,
 *   summary: string,
 *   description: string,
 *   property: string,
 *   unit: string,
 *   address: object,
 *   tenant: { name: string, phone: string, email: string },
 *   assignedTo: string,
 *   requestedAt: string,
 *   dueAt: string,
 *   permissionToEnter: boolean|null,
 *   photoUrls: string[],
 *   raw: object,
 * }}
 */
export function toWorkOrder(fields = {}) {
  const number = String(fields.number ?? fields.workOrderNumber ?? '').trim();
  const property = clean(fields.property);
  const unit = clean(fields.unit);

  return {
    source: fields.source || 'unknown',
    externalId: String(fields.externalId ?? number ?? '').trim(),
    number,
    status: normalizeStatus(fields.status),
    priority: normalizePriority(fields.priority),
    category: clean(fields.category),
    summary: clean(fields.summary) || firstLine(cleanMultiline(fields.description), 120),
    description: cleanMultiline(fields.description),
    property,
    unit,
    address: normalizeAddress(fields.address),
    tenant: {
      name: clean(fields.tenant?.name ?? fields.tenantName),
      phone: clean(fields.tenant?.phone ?? fields.tenantPhone),
      email: clean(fields.tenant?.email ?? fields.tenantEmail),
    },
    assignedTo: clean(fields.assignedTo ?? fields.assignedVendor ?? fields.technician),
    requestedAt: toIso(fields.requestedAt ?? fields.createdAt),
    dueAt: toIso(fields.dueAt ?? fields.scheduledFor),
    permissionToEnter: toBoolOrNull(fields.permissionToEnter),
    photoUrls: Array.isArray(fields.photoUrls) ? fields.photoUrls.filter(Boolean) : [],
    raw: fields.raw ?? {},
  };
}

/**
 * Build a normalized WorkOrderRequest — a field-raised request to create a
 * work order in the PM platform.
 *
 * @param {object} fields
 * @returns {object}
 */
export function toWorkOrderRequest(fields = {}) {
  return {
    origin: fields.origin || 'companycam',
    originId: String(fields.originId ?? '').trim(),
    summary: clean(fields.summary) || firstLine(cleanMultiline(fields.description), 120),
    description: cleanMultiline(fields.description),
    category: clean(fields.category),
    priority: normalizePriority(fields.priority),
    property: clean(fields.property),
    unit: clean(fields.unit),
    address: normalizeAddress(fields.address),
    reportedBy: clean(fields.reportedBy),
    reportedAt: toIso(fields.reportedAt) || new Date().toISOString(),
    photoUrls: Array.isArray(fields.photoUrls) ? fields.photoUrls.filter(Boolean) : [],
    projectUrl: clean(fields.projectUrl),
    tags: Array.isArray(fields.tags) ? fields.tags.filter(Boolean) : [],
    raw: fields.raw ?? {},
  };
}

export function normalizePriority(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return PRIORITY_ALIASES[key] || 'medium';
}

export function normalizeStatus(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return STATUS_ALIASES[key] || 'open';
}

/**
 * Coerce an address into the CompanyCam Address shape.
 * Accepts either an object or a single-line string.
 */
export function normalizeAddress(input) {
  const empty = {
    street_address_1: '',
    street_address_2: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'US',
  };

  if (!input) return empty;

  if (typeof input === 'string') {
    return { ...empty, ...parseAddressLine(input) };
  }

  return {
    street_address_1: clean(input.street_address_1 ?? input.street ?? input.line1),
    street_address_2: clean(input.street_address_2 ?? input.line2),
    city: clean(input.city),
    state: clean(input.state),
    postal_code: clean(input.postal_code ?? input.zip ?? input.postalCode),
    country: clean(input.country) || 'US',
  };
}

/**
 * Best-effort parse of a one-line address: "123 River St, Unit 2B, Troy, NY 12180".
 */
export function parseAddressLine(line) {
  const parts = String(line)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return {};

  const result = { street_address_1: parts[0] };

  // Trailing "STATE 12345" or "STATE"
  const last = parts[parts.length - 1] || '';
  const stateZip = last.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (stateZip) {
    result.state = stateZip[1].toUpperCase();
    result.postal_code = stateZip[2];
    if (parts.length >= 3) result.city = parts[parts.length - 2];
  } else if (parts.length >= 2) {
    result.city = parts[parts.length - 1];
  }

  // A middle part that looks like a unit designator
  const middle = parts.slice(1, -1);
  const unitPart = middle.find((p) => /^(unit|apt|apartment|suite|ste|#)\b/i.test(p));
  if (unitPart) result.street_address_2 = unitPart;

  return result;
}

/**
 * Stable key identifying the physical place a work order belongs to.
 *
 * This is what makes "project per property/unit" idempotent: two work orders
 * for the same unit must produce the same key regardless of how the source
 * spelled the address.
 *
 * @param {{ property?: string, unit?: string, address?: object }} wo
 * @returns {string} e.g. "123-river-st--2b"
 */
export function locationKey(wo) {
  const street = slug(wo.address?.street_address_1 || wo.property || '');
  const unit = slug(wo.unit || wo.address?.street_address_2 || '');
  return unit ? `${street}--${unit}` : street;
}

/**
 * Human-facing CompanyCam project name for a location.
 */
export function projectNameFor(wo) {
  const base = clean(wo.address?.street_address_1) || clean(wo.property) || 'Unknown Address';
  const unit = clean(wo.unit);
  return unit ? `${base} — Unit ${unit}` : base;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b(unit|apt|apartment|suite|ste)\b\.?/g, '')
    .replace(/\b(street|str)\b\.?/g, 'st')
    .replace(/\b(avenue|ave)\b\.?/g, 'ave')
    .replace(/\b(road|rd)\b\.?/g, 'rd')
    .replace(/\b(drive|dr)\b\.?/g, 'dr')
    .replace(/\b(boulevard|blvd)\b\.?/g, 'blvd')
    .replace(/\b(apartment)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Collapse all whitespace — for single-line fields like names and categories. */
function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Tidy a multi-line field without destroying its line breaks.
 *
 * Work order descriptions are what the tech actually reads, and tenants write
 * them as several lines. Collapsing them to one line loses that structure, so
 * here we only collapse runs of spaces within a line and runs of blank lines.
 */
function cleanMultiline(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstLine(value, maxLength) {
  return String(value).split('\n')[0].slice(0, maxLength).trim();
}

function toIso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function toBoolOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const key = String(value).trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'granted'].includes(key)) return true;
  if (['no', 'n', 'false', '0', 'denied'].includes(key)) return false;
  return null;
}

export { slug as _slug, clean as _clean };
