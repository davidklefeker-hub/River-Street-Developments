# River Street Developments — CompanyCam → Asana Pipeline

Automatically converts CompanyCam project documents into structured Asana tasks and subtasks, with photo attachments.

## How It Works

1. **Create a document in CompanyCam** listing the work for a project (see format below)
2. **Export/save the document** as `.txt` or `.md` into the `incoming/` folder
3. **The watcher picks it up**, parses it into tasks & subtasks, and creates them in Asana
4. **Every task** is assigned to you, with Josh and Barry tagged as followers
5. The document is moved to `processed/` so it's not re-processed

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your values:

| Variable | Description |
|---|---|
| `ASANA_ACCESS_TOKEN` | Your Asana Personal Access Token ([generate here](https://app.asana.com/0/developer-console)) |
| `ASANA_WORKSPACE_ID` | Your Asana workspace GID |
| `ASANA_ASSIGNEE_GID` | Your Asana user GID (the assignee for all tasks) |
| `ASANA_FOLLOWER_JOSH_GID` | Josh's Asana user GID (tagged on all tasks) |
| `ASANA_FOLLOWER_BARRY_GID` | Barry's Asana user GID (tagged on all tasks) |

**Finding GIDs:** Run this in your terminal after setting your access token:
```bash
# Your user GID:
curl -s -H "Authorization: Bearer YOUR_TOKEN" https://app.asana.com/api/1.0/users/me | jq '.data.gid'

# Workspace GID:
curl -s -H "Authorization: Bearer YOUR_TOKEN" https://app.asana.com/api/1.0/workspaces | jq '.data[].gid'

# Find a user by name:
curl -s -H "Authorization: Bearer YOUR_TOKEN" "https://app.asana.com/api/1.0/workspaces/WORKSPACE_GID/users" | jq '.data[] | {gid, name}'
```

### 3. Start the watcher

```bash
npm start
```

Now drop a `.txt` or `.md` file into the `incoming/` folder and it will be processed automatically.

### One-off processing

Process a single file without starting the watcher:

```bash
npm run process -- path/to/document.txt
```

## Document Format

The parser is flexible and supports several styles. The recommended format:

```
Project: 123 Main Street - Kitchen Renovation

## Demolition
- Remove existing cabinets
- Remove countertops
- Remove flooring in kitchen area
![Kitchen before demo](photos/kitchen-before.jpg)

## Electrical
- Run new circuits for island
- Install recessed lighting (12 cans)
- Add dedicated outlet for dishwasher
![Panel location](photos/panel.jpg)
https://app.companycam.com/photos/abc123.jpg

## Plumbing
- Rough-in island sink
- Relocate dishwasher supply/drain

## Notes
Budget is $45,000. Target completion: 6 weeks.
```

### Parsing rules

| Document element | Becomes in Asana |
|---|---|
| `Project: ...` line | Project name (matched or created) |
| `## Section` heading | Parent task |
| `- Bullet item` under a section | Subtask of that task |
| Image references in a section | Attached to the parent task |
| `## Notes` section | Attached as notes, not tasks |

### Supported image formats

Images within a section are attached to that section's parent task in Asana. Three reference styles are supported:

| Style | Example |
|---|---|
| Markdown image | `![Description](photos/before.jpg)` |
| Image URL | `https://app.companycam.com/photos/abc123.jpg` |
| Local file path | `photos/kitchen-before.jpg` |

**Local images:** Drop the image files into the `incoming/` folder alongside your document. Use relative paths in the document (e.g., `photos/before.jpg`). After processing, both the document and referenced images are moved to `processed/`.

**CompanyCam URLs:** Any URL containing `companycam.com` is treated as a photo, even without an image file extension. These are attached as external links on the Asana task.

Supported image types: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.heic`, `.heif`, `.bmp`, `.tiff`

### Supported heading styles

- `## Markdown heading`
- `**Bold heading**`
- `ALL CAPS HEADING`

### Supported list styles

- `- Dash item`
- `* Star item`
- `1. Numbered item`

## Running Tests

```bash
npm test
```

## Project Structure

```
incoming/          ← Drop CompanyCam docs here
processed/         ← Processed docs are moved here
src/
  config.js        ← Environment config
  parser.js        ← Document → structured tasks parser
  asana-client.js  ← Asana API integration
  pipeline.js      ← Orchestrates parse → create
  watcher.js       ← Folder watcher (chokidar)
  index.js         ← Entry point
  process-document.js  ← CLI one-off processor
  tests/
    parser.test.js
examples/
  sample-companycam-doc.txt
```
