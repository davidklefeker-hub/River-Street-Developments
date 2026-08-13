/**
 * Field synonym map shared by the Breeze email and CSV sources.
 *
 * Yardi Breeze doesn't publish a stable export or notification schema, and the
 * column set differs between the work order report, the maintenance report and
 * the notification email. Rather than pin one spelling, both sources resolve
 * labels through this map, and unrecognized labels are kept on `raw` so nothing
 * from the source is silently lost.
 *
 * Add a spelling here once and both sources pick it up.
 */

export const FIELD_SYNONYMS = {
  number: ['work order', 'work order #', 'work order number', 'wo #', 'wo number', 'wo', 'id', 'number'],
  status: ['status', 'work order status', 'wo status'],
  priority: ['priority', 'urgency', 'priority level'],
  category: ['category', 'work order category', 'type', 'problem type', 'service type', 'maintenance type'],
  summary: ['summary', 'subject', 'brief description', 'title', 'problem'],
  description: ['description', 'details', 'notes', 'problem description', 'request', 'comments', 'tenant notes'],
  property: ['property', 'property name', 'building', 'community', 'site'],
  unit: ['unit', 'unit code', 'unit number', 'unit #', 'apt', 'apartment', 'space'],
  addressLine: ['address', 'property address', 'street address', 'location', 'unit address'],
  city: ['city'],
  state: ['state', 'st'],
  postalCode: ['zip', 'zip code', 'postal code', 'postalcode'],
  tenantName: ['tenant', 'tenant name', 'resident', 'resident name', 'caller', 'requested by'],
  tenantPhone: ['tenant phone', 'phone', 'phone number', 'contact phone', 'resident phone', 'mobile'],
  tenantEmail: ['tenant email', 'email', 'email address', 'resident email', 'contact email'],
  assignedTo: ['assigned to', 'assigned', 'technician', 'tech', 'vendor', 'assigned vendor', 'maintenance tech'],
  requestedAt: ['date', 'created', 'created on', 'date created', 'requested', 'call date', 'date reported', 'submitted'],
  dueAt: ['due', 'due date', 'scheduled', 'scheduled date', 'target date', 'complete by'],
  permissionToEnter: ['permission to enter', 'pte', 'entry permission', 'permission', 'has permission to enter'],
};

/**
 * Resolve a source label ("Work Order #", "TENANT NAME") to a canonical field
 * name, or null if we don't recognize it.
 *
 * @param {string} label
 * @returns {string|null}
 */
export function canonicalField(label) {
  const key = normalizeLabel(label);
  if (!key) return null;

  for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    if (synonyms.includes(key)) return field;
  }
  return null;
}

/**
 * Lowercase, strip punctuation and collapse whitespace so "Work Order #:" and
 * "work_order_#" resolve the same.
 *
 * @param {string} label
 * @returns {string}
 */
export function normalizeLabel(label) {
  return String(label ?? '')
    .replace(/[_]+/g, ' ')
    .replace(/[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Turn a bag of canonical fields into the shape toWorkOrder() expects.
 *
 * @param {Record<string, string>} fields
 * @param {{ source: string, raw?: object }} meta
 * @returns {object}
 */
export function fieldsToWorkOrderInput(fields, meta) {
  const number = fields.number ? String(fields.number).replace(/^#/, '').trim() : '';

  return {
    source: meta.source,
    externalId: number ? `${meta.source}:${number}` : '',
    number,
    status: fields.status,
    priority: fields.priority,
    category: fields.category,
    summary: fields.summary,
    description: fields.description,
    property: fields.property,
    unit: fields.unit,
    address: buildAddress(fields),
    tenantName: fields.tenantName,
    tenantPhone: fields.tenantPhone,
    tenantEmail: fields.tenantEmail,
    assignedTo: fields.assignedTo,
    requestedAt: fields.requestedAt,
    dueAt: fields.dueAt,
    permissionToEnter: fields.permissionToEnter,
    raw: meta.raw ?? fields,
  };
}

function buildAddress(fields) {
  // A single "Address" column may already carry city/state/zip — let the model's
  // line parser split it, then layer any explicit columns on top.
  const base = fields.addressLine || '';

  if (!fields.city && !fields.state && !fields.postalCode) {
    return base;
  }

  return {
    street_address_1: base.split(',')[0] || base,
    city: fields.city,
    state: fields.state,
    postal_code: fields.postalCode,
  };
}
