import 'dotenv/config';

export const config = {
  asana: {
    accessToken: process.env.ASANA_ACCESS_TOKEN,
    workspaceId: process.env.ASANA_WORKSPACE_ID,
    assigneeGid: process.env.ASANA_ASSIGNEE_GID,
    followers: [
      process.env.ASANA_FOLLOWER_JOSH_GID,
      process.env.ASANA_FOLLOWER_BARRY_GID,
    ].filter(Boolean),
  },

  companyCam: {
    accessToken: process.env.COMPANYCAM_ACCESS_TOKEN,

    // Credited as the creator of automated comments, photos and checklists.
    actAsUserEmail: process.env.COMPANYCAM_ACT_AS_USER || '',

    // Photo tags that mean "this needs a work order". Applied in the field by
    // cleaners and techs; this is the trigger for the outbound direction.
    damageTags: splitList(process.env.COMPANYCAM_DAMAGE_TAGS, ['Damage', 'Repair Needed']),

    // Photo tag → work order category, so the request arrives pre-classified.
    categoryTags: parseMap(process.env.COMPANYCAM_CATEGORY_TAGS, {
      plumbing: 'Plumbing',
      electrical: 'Electrical',
      hvac: 'HVAC',
      appliance: 'Appliance',
      drywall: 'Drywall',
      paint: 'Paint',
      flooring: 'Flooring',
      roof: 'Roofing',
      pest: 'Pest Control',
      landscaping: 'Landscaping',
    }),

    // Photo tag → priority.
    priorityTags: parseMap(process.env.COMPANYCAM_PRIORITY_TAGS, {
      emergency: 'emergency',
      urgent: 'emergency',
      'high priority': 'high',
      routine: 'low',
    }),

    defaultRequestPriority: process.env.COMPANYCAM_DEFAULT_PRIORITY || 'medium',

    // Label added to a project once a request has been raised from it, so the
    // field team can see the report was picked up. Blank disables it.
    requestRaisedLabel:
      process.env.COMPANYCAM_RAISED_LABEL === ''
        ? ''
        : process.env.COMPANYCAM_RAISED_LABEL || 'WO Requested',

    // Work order category → CompanyCam checklist template name. The API can
    // only instantiate templates that already exist in CompanyCam.
    checklistTemplatesByCategory: parseMap(process.env.COMPANYCAM_CHECKLIST_TEMPLATES, null),

    // Shared secret configured on the webhook; used to verify the signature.
    webhookToken: process.env.COMPANYCAM_WEBHOOK_TOKEN || '',
    webhookPort: Number(process.env.COMPANYCAM_WEBHOOK_PORT || 3000),
  },

  polling: {
    // Re-scan this far behind the high-water mark each poll, so a phone that
    // uploads late doesn't slip through the window.
    lookbackSeconds: Number(process.env.POLL_LOOKBACK_SECONDS || 3600),
    // How far back the very first poll reaches.
    initialLookbackSeconds: Number(process.env.POLL_INITIAL_LOOKBACK_SECONDS || 86400),
    maxPages: Number(process.env.POLL_MAX_PAGES || 10),
  },

  sinks: {
    active: process.env.WORKORDER_SINK || 'file',

    file: {
      outboxFolder: process.env.WORKORDER_OUTBOX_FOLDER || './outbox',
    },

    email: {
      from: process.env.WORKORDER_EMAIL_FROM || '',
      to: process.env.WORKORDER_EMAIL_TO || '',
      cc: process.env.WORKORDER_EMAIL_CC || '',
      smtp: {
        host: process.env.SMTP_HOST || '',
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    },

    rest: {
      url: process.env.WORKORDER_REST_URL || '',
      method: process.env.WORKORDER_REST_METHOD || 'POST',
      authHeader: process.env.WORKORDER_REST_AUTH || '',
      templatePath: process.env.WORKORDER_REST_TEMPLATE || '',
      headers: parseMap(process.env.WORKORDER_REST_HEADERS, {}),
    },
  },

  statePath: process.env.WORKORDER_STATE_FILE || './.workorder-state.json',

  watchFolder: process.env.WATCH_FOLDER || './incoming',
  processedFolder: process.env.PROCESSED_FOLDER || './processed',
};

export function validateConfig() {
  const required = [
    ['ASANA_ACCESS_TOKEN', config.asana.accessToken],
    ['ASANA_WORKSPACE_ID', config.asana.workspaceId],
    ['ASANA_ASSIGNEE_GID', config.asana.assigneeGid],
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Copy .env.example to .env and fill in your values.'
    );
  }
}

/**
 * Validate the environment needed by the work order loop. Kept separate from
 * validateConfig() so the existing CompanyCam → Asana pipeline can run without
 * work order credentials, and vice versa.
 */
export function validateWorkOrderConfig({ requireSink = true } = {}) {
  if (!config.companyCam.accessToken) {
    throw new Error(
      'Missing COMPANYCAM_ACCESS_TOKEN.\n' +
      'Create one at https://app.companycam.com/access_tokens and add it to .env.'
    );
  }

  if (!requireSink) return;

  const sink = config.sinks.active;
  if (sink === 'email' && !config.sinks.email.to) {
    throw new Error('WORKORDER_SINK=email requires WORKORDER_EMAIL_TO and SMTP_HOST.');
  }
  if (sink === 'rest' && !config.sinks.rest.url) {
    throw new Error('WORKORDER_SINK=rest requires WORKORDER_REST_URL.');
  }
}

/**
 * Parse a comma-separated env var into a trimmed list.
 */
function splitList(value, fallback) {
  if (!value) return fallback;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Parse `key=value,key=value` (or a JSON object) into a lowercase-keyed map.
 * Returns the fallback when unset.
 */
function parseMap(value, fallback) {
  if (!value) return fallback;

  const trimmed = value.trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k.toLowerCase(), v]));
  }

  return Object.fromEntries(
    trimmed
      .split(',')
      .map((pair) => pair.split('='))
      .filter((parts) => parts.length === 2)
      .map(([k, v]) => [k.trim().toLowerCase(), v.trim()])
  );
}
