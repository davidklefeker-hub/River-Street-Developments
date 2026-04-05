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
