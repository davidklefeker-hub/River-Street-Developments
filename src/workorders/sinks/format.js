/**
 * Shared formatting for outbound work order requests.
 *
 * Field order matches the order Yardi Breeze asks for them when you create a
 * work order by hand (property, unit, category, priority, description), so the
 * brief can be worked top to bottom without hunting.
 */

/**
 * Render a work order request as a paste-ready plain-text brief.
 *
 * @param {object} request - Normalized WorkOrderRequest
 * @returns {string}
 */
export function formatRequestBrief(request) {
  const lines = [];

  lines.push('NEW WORK ORDER REQUEST');
  lines.push('='.repeat(60));
  lines.push('');

  const field = (label, value) => {
    if (value) lines.push(`${label.padEnd(14)}${value}`);
  };

  field('Property', request.property);
  field('Unit', request.unit);
  field('Address', formatAddress(request.address));
  field('Category', request.category);
  field('Priority', titleCase(request.priority));
  field('Reported by', request.reportedBy);
  field('Reported at', formatDateTime(request.reportedAt));

  lines.push('');
  lines.push('Summary');
  lines.push('-'.repeat(60));
  lines.push(request.summary || '(none)');

  lines.push('');
  lines.push('Description');
  lines.push('-'.repeat(60));
  lines.push(request.description || '(none)');

  if (request.photoUrls.length > 0) {
    lines.push('');
    lines.push('Photos');
    lines.push('-'.repeat(60));
    for (const url of request.photoUrls) lines.push(url);
  }

  if (request.projectUrl) {
    lines.push('');
    lines.push(`CompanyCam project: ${request.projectUrl}`);
  }

  lines.push('');
  lines.push('-'.repeat(60));
  lines.push(`Raised automatically from CompanyCam photo ${request.originId}.`);

  return lines.join('\n');
}

/**
 * Subject line for email delivery.
 *
 * @param {object} request
 * @returns {string}
 */
export function formatRequestSubject(request) {
  const where = [request.property, request.unit && `Unit ${request.unit}`].filter(Boolean).join(' ');
  const priority = request.priority === 'emergency' || request.priority === 'high'
    ? `[${request.priority.toUpperCase()}] `
    : '';
  return `${priority}Work order request${where ? ` — ${where}` : ''}: ${request.summary}`;
}

export function formatAddress(address) {
  if (!address) return '';
  const street = [address.street_address_1, address.street_address_2].filter(Boolean).join(', ');
  const region = [address.city, [address.state, address.postal_code].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [street, region].filter(Boolean).join(', ');
}

function titleCase(value) {
  return String(value || '')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-US');
}
