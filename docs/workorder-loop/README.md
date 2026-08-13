# The Work Order Loop

Tenant reports a problem → work order in the property management (PM) platform →
crew sees it in CompanyCam → crew photographs what they find → new damage becomes
a new work order in the same PM platform.

One system of record (the PM platform), one field app (CompanyCam), and nothing
re-typed between them.

```
                 ┌──────────────────────────────┐
   Tenant ──────▶│  PM platform (Yardi Breeze)  │◀──────── new work order
   (portal)      │      system of record        │          from the field
                 └───────────────┬──────────────┘                 ▲
                                 │                                │
                    work orders  │ (A) inbound                    │ (B) outbound
                                 ▼                                │
                 ┌──────────────────────────────┐                 │
                 │  CompanyCam project per unit │─────────────────┘
                 │  labels · comment · notepad  │   photo tagged "Damage"
                 └──────────────────────────────┘
```

Direction (A) is solved. Direction (B) is where the platform choice matters.

## The constraint you need to decide around

**Yardi Breeze cannot accept a work order programmatically.**

Yardi has no self-serve public API. Write access to work orders runs through the
[Interface Partnership Program](https://www.yardi.com/company/become-an-interface-partner/):
an annual license fee per interface, a Data Exchange Agreement, and partner
qualifications (a two-year-old company with three or more active Voyager
clients). There is also no Zapier connector for Breeze.

That doesn't block direction (A) — work orders can be got *out* of Breeze by
email notification or report export, and this repo does both. It blocks the
automatic half of (B): nothing can create the work order in Breeze but a person.

So the loop closes one of three ways.

| Option | Direction B | Cost | Trade-off |
|---|---|---|---|
| **Stay on Breeze**, `file` or `email` sink | Automated up to the last step; a coordinator pastes a ready-made brief into Breeze | $0 | ~30 seconds of human time per repair. Nothing is re-typed or re-photographed |
| **Move to DoorLoop or Buildium**, `rest` sink | Fully automatic | Migration + platform cost | Both have self-serve APIs that create work orders. Real migration effort |
| **License Yardi Interfaces**, `rest` sink | Fully automatic | Annual fee, agreement, qualification | Keeps Breeze. Gated on Yardi accepting you as a partner |

### Recommendation

Run the `file` or `email` sink on Breeze first. It costs nothing, closes 90% of
the loop today, and the last step is a paste rather than a transcription. Live
with it for a month and count how many requests actually come through — that
number tells you whether a migration is worth it, and you'll have real data
instead of a guess.

If the volume does justify moving, **DoorLoop** is the smaller step: API keys are
self-serve from company settings, the REST API is two-way, and there's a Zapier
connector as a fallback. **Buildium**'s Open API also creates and updates work
orders, but the API is a Premium-plan feature. Either one is a one-line change
here: set `WORKORDER_SINK=rest` and point it at the endpoint.

Nothing else in this repo changes with the platform. That's the reason for the
adapter layout below.

## How it works

### Direction A — work orders into CompanyCam

Sources normalize into one work order shape, then land on the CompanyCam project
for that unit:

| Source | Trigger | Latency |
|---|---|---|
| `sources/breeze-email.js` | Breeze notification email, saved to the watch folder | Minutes |
| `sources/breeze-csv.js` | Breeze work order report export, dropped in the watch folder | Batch |

One CompanyCam **project per property/unit** — not per work order — so every
photo ever taken at a unit stays on one timeline. Each work order becomes:

- **Labels**: `WO 1042`, `Plumbing`, `Priority: Emergency`, `Unit 2B`
- **A comment**: the full detail a tech reads on their phone
- **A notepad line**: what's currently open at this unit, removed when it closes
- **Optionally a checklist**, instantiated from a template matched by category

Re-running is safe. Work orders are keyed by external id and a content hash, so
an unchanged work order is skipped and a changed one posts a fresh comment.

### Direction B — damage into work orders

A cleaner photographs damage and applies the **`Damage`** tag. That's the whole
field procedure — one tag, on a phone, with gloves on.

The photo is picked up two ways, both landing in the same place:

- **Polling** (`npm run wo:poll`) — `GET /photos?tag_ids[]=…&start_date=…` with a
  durable high-water mark in the state file. This is the reliable path.
- **Webhook** (`npm run wo:webhook`) — CompanyCam POSTs on photo events for
  low latency.

Run both. The webhook only ever extracts a photo id and re-fetches the photo from
the API, and both paths share one state file, so a webhook that is missed,
duplicated, or fires before the crew finishes tagging still resolves correctly on
the next poll. The high-water mark only advances when a poll has no failures, so
a sink outage retries rather than silently skipping repairs.

Additional tags refine the request without any extra typing: `plumbing` sets the
category, `urgent` sets the priority. Both maps are configuration.

The result goes to a **sink**, which is the only part that knows about your PM
platform:

| Sink | What it does | Use when |
|---|---|---|
| `file` | Writes JSON + a paste-ready text brief to `outbox/` | Breeze; testing the loop |
| `email` | SMTP to a coordinator, or to an intake address | Breeze; any email-to-work-order intake |
| `rest` | POSTs to a work order API or automation webhook | DoorLoop, Buildium, Zapier, Make |

## Setup

```bash
npm install
cp .env.example .env      # fill in COMPANYCAM_ACCESS_TOKEN
npm run wo:doctor         # verify credentials, tags, templates, sink
```

`wo:doctor` is the command to run first and after any config change. Most setup
failures are a tag or checklist template that was never created in CompanyCam,
and they otherwise present as silence rather than an error.

### 1. Create the tags in CompanyCam

Trigger tags must exist before crews can apply them. Create `Damage` and
`Repair Needed`, plus whichever category tags you want (`plumbing`, `electrical`,
`hvac`, …) and priority tags (`urgent`, `routine`). `wo:doctor` lists which are
missing.

### 2. Bring work orders in

```bash
npm run wo:import -- examples/sample-breeze-workorders.csv --dry-run
npm run wo:import -- examples/sample-breeze-workorders.csv
npm run wo:watch                    # or watch the folder continuously
```

Save Breeze notification emails (`.eml`, `.html`, `.txt`) or export the work
order report to CSV, and drop either into `incoming/`.

### 3. Turn damage photos into work order requests

```bash
npm run wo:poll -- --dry-run        # see what would be raised
npm run wo:poll
```

Then schedule it — every 15 minutes is plenty:

```
*/15 * * * * cd /path/to/repo && npm run wo:poll >> logs/wo-poll.log 2>&1
```

For lower latency, also run the receiver and register it:

```bash
npm run wo:webhook
npm run wo:webhook:register -- https://your-host/companycam-webhook
```

Set `COMPANYCAM_WEBHOOK_TOKEN` before registering. With a token set, unsigned
requests are rejected — an endpoint that creates work orders should fail closed.

## Pointing the `rest` sink at a real API

The field mapping is configuration, not code, because every platform names its
work order fields differently and renames them on its own schedule. Write a JSON
template whose values are `{{path}}` references into the normalized request:

```json
{
  "Title":       "{{summary}}",
  "Description": "{{description}}",
  "Priority":    "{{priority}}",
  "Category":    "{{category}}",
  "UnitNumber":  "{{unit}}",
  "Photos":      "{{photoUrls}}"
}
```

```bash
WORKORDER_SINK=rest
WORKORDER_REST_URL=https://api.example.com/v1/workorders
WORKORDER_REST_AUTH=Bearer your_api_key
WORKORDER_REST_TEMPLATE=./config/workorder-template.json
```

A string that is exactly one placeholder keeps the value's type, so
`"{{photoUrls}}"` yields an array. Placeholders inside longer strings interpolate
as text. Omit the template entirely to post the whole normalized request, which
is what a Zapier or Make catch hook wants.

Because the mapping is a file, switching PM platforms is a new template and a new
URL — not a code change.

## Field procedure for crews

Worth printing for the van:

1. Open the CompanyCam project for the unit. Work orders show as comments and as
   labels on the project.
2. Photograph anything damaged or needing repair.
3. Tag the photo **Damage**.
4. Optional but useful: add a category tag (`plumbing`, `electrical`, `hvac`) and
   `urgent` if it can't wait. Type what you see in the photo description — that
   becomes the work order description.

That's it. The project picks up a `WO Requested` label once the office has it.

## Notes and limits

- **Checklists can only come from templates.** CompanyCam's API instantiates a
  checklist from an existing template; it can't create ad-hoc line items. Build
  the templates in CompanyCam first, then map categories to them by name.
- **Breeze's export and email formats aren't published** and vary by account
  configuration. Both parsers resolve labels through a shared synonym map
  (`sources/field-map.js`) rather than matching a fixed template, and keep
  everything they don't recognize on `raw`. Add a spelling there once and both
  sources pick it up.
- **Numeric priorities are an assumption.** Breeze exports priority as a number
  and the levels are user-definable. The default mapping treats 1 as most urgent
  — check yours and adjust `PRIORITY_ALIASES` in `src/workorders/model.js`.
- **Address matching is normalized, not geocoded.** `12 River Street, Unit 2B`
  and `12 River St, 2b` resolve to the same project. Genuinely different
  spellings of a building name will not.

## Layout

```
src/workorders/
  model.js               normalized WorkOrder / WorkOrderRequest, address + location keys
  companycam-client.js   CompanyCam Core API v2 client
  state.js               idempotency + poll high-water mark
  inbound.js             work order → CompanyCam project
  outbound.js            tagged photo → work order request
  webhook-server.js      CompanyCam webhook receiver
  cli.js                 import · poll · watch · register-webhook · doctor
  sources/
    field-map.js         label synonyms shared by both Breeze sources
    breeze-email.js      Breeze notification email → work order
    breeze-csv.js        Breeze report export → work order
  sinks/
    index.js             sink resolver
    format.js            paste-ready brief formatting
    file.js  email.js  rest.js
```

The CompanyCam client is written against Yardi-independent ground truth:
CompanyCam's [published OpenAPI spec](https://github.com/CompanyCam/openapi-spec).
