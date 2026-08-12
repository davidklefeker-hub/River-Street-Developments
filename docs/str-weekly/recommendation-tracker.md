# Recommendation Tracker — closing the loop

Without this, the Friday report produces recommendations forever and nothing
records what happened to them. This is the piece that turns a weekly summary into
continual improvement.

## 1. Create the sheet

Google Sheet named **`STR Weekly - Recommendation Tracker`**, in
**Property Management OS → STR-MTR Operations → STR Weekly – YouTube Intelligence**.

One tab named `Recommendations`. Row 1 is headers, exactly these, in this order:

| Column | Header | Filled by | Notes |
|---|---|---|---|
| A | `Week Of` | Zap | Friday's date, `YYYY-MM-DD` |
| B | `Recommendation` | Zap | One sentence, imperative |
| C | `Category` | Zap | Pricing / Listing / Ops / Guest Experience / Acquisition / Regulatory |
| D | `Source` | Zap | Creator name — video title |
| E | `Effort` | Zap | S / M / L |
| F | `Decision` | **You** | Do / Skip / Later — leave blank until reviewed |
| G | `Owner` | **You** | David / Karma |
| H | `Date Decided` | **You** | |
| I | `Result` | **You** | What actually happened |

Columns F–I stay empty when the Zap writes a row. Filling them in is the weekly
five-minute job that makes the whole system worth running — if nobody ever fills
them, turn this change off, because the read-back will just feed Claude a list of
undecided items.

Freeze row 1 and set a data-validation dropdown on column F (`Do`, `Skip`,
`Later`) so it stays clean.

## 2. Read the history back — new step before the Claude synthesis

**App:** Google Sheets · **Action:** `Get Many Spreadsheet Rows`

| Field | Value |
|---|---|
| Drive | David's Drive (`david.klefeker@gmail.com`) |
| Spreadsheet | `STR Weekly - Recommendation Tracker` |
| Worksheet | `Recommendations` |
| Row count / limit | `30` |

Place this **after** `Digest: Release Existing Digest` and **before** the Claude
step. Map its output into the synthesis prompt at the `PRIOR RECOMMENDATIONS`
slot — see [`prompts/friday-synthesis.md`](./prompts/friday-synthesis.md).

If `Get Many Spreadsheet Rows` is not offered on the connected plan, use
`Lookup Spreadsheet Rows (output as line items)` filtered on a column that is
always populated, e.g. `Week Of` is not empty.

## 3. Write this week's rows — two new steps after the Claude synthesis

The synthesis prompt (see the prompt file) ends by emitting a machine-readable
block between `<<<ROWS` and `ROWS>>>`, one recommendation per line, pipe-delimited:

```
2026-08-14|Raise weekday minimums to 3 nights in Sep|Pricing|John Bianchi — Shoulder Season Pricing|S
```

### Step 3a — Formatter by Zapier

| Field | Value |
|---|---|
| Action Event | `Utilities` |
| Transform | `Line-itemize (Text to Line-item)` |
| Input | Claude's **Response Content Text**, the portion between the `<<<ROWS` markers |
| Separator | `[:newline:]` |

If isolating the marker block is awkward in the UI, add a
`Formatter → Text → Extract Pattern` step ahead of it with the pattern
`<<<ROWS([\s\S]*?)ROWS>>>` and line-itemize that output instead.

### Step 3b — Google Sheets

| Field | Value |
|---|---|
| Action Event | `Create Multiple Spreadsheet Rows` |
| Spreadsheet | `STR Weekly - Recommendation Tracker` |
| Worksheet | `Recommendations` |
| Rows | the line-item output from 3a |

Map the five pipe-delimited fields to columns A–E. Leave F–I unmapped.

## 4. Test it

1. Run the reporter Zap manually.
2. Confirm rows land in the sheet with A–E populated and F–I empty.
3. Fill in `Decision` on a couple of rows by hand.
4. Run it again and confirm the Claude step's input now contains those decisions —
   check the step's data-in panel in Zap history, not just the output.
5. Confirm the report text does not re-recommend anything marked `Skip`.

Step 5 is the actual acceptance test. If it fails, the prompt is not weighting the
history hard enough — strengthen the instruction in the prompt file rather than
adding more steps.

## Ongoing

Review the tracker together each Friday when the report lands. Ten minutes. The
`Result` column is the only place the system ever learns whether any of this
advice was worth taking.
