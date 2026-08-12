# STR Weekly — YouTube Intelligence: Change Spec

This folder is the **source of truth** for the STR Weekly YouTube intelligence
automation. It supersedes `STR_MTR_Level3_Automation_Guide.pdf` (July 10), which
describes an older three-Zap design that does not match what is live and contains
errors that will break a build — see [Retiring the PDF](#retiring-the-pdf).

The live system is the two-Zap Digest pattern:

- **`STR Weekly - Collect Video Insights`** (collector, runs continuously)
  `RSS multi-feed → Apify Run Actor → Delay 2min → Apify Fetch Dataset → Claude analyze → Digest Append → Drive file`
- **`STR Weekly - Friday Digest Report`** (reporter, Friday 8:00 AM ET)
  `Schedule → Digest Release → Claude synthesize → Drive file → Outlook email`

That architecture is correct and should not change. The four changes below are
additive.

---

## The four changes

| # | Change | Zap | Risk |
|---|---|---|---|
| 1 | Verify recipient addresses + channel IDs | Reporter / Collector | None |
| 2 | Feed portfolio context into the Friday synthesis | Reporter | None |
| 3 | Write recommendations to a tracker sheet + read them back | Reporter | Low |
| 4 | Pre-filter videos before the expensive steps | Collector | Low |

Do them in order. 1 and 2 are quick and independent. 3 and 4 each add steps.

---

## Change 1 — Verify recipients and channel IDs

### 1a. Recipient addresses

The PDF lists `david@baybuy homes.com` — note the space, and the wrong domain.
The correct recipients are:

```
david@kenwoodequitygroup.com
karma@kenwoodequitygroup.com
```

One per line, **no trailing space** after either. A single invisible space after
`.com` fails the whole send with "recipient is not valid."

Open the reporter Zap's Outlook step and confirm both addresses. If the live Zap
has been sending successfully, this is already correct and there is nothing to do
— but check, because the PDF has been circulating as a build spec.

### 1b. Channel IDs

The PDF and the Cowork manual disagree on Sean Rakidzich's channel ID:

| Source | ID |
|---|---|
| Cowork manual (marked verified) | `UCvwmrPfn8ff-rTlc9YoH7Bg` |
| Level 3 PDF | `UCuDGSixSNKWUPGEHHMd0scQ` |

**These have not been re-verified** — YouTube was unreachable from the session
that produced this document. Verify before trusting either. To check one:

1. Open `https://www.youtube.com/feeds/videos.xml?channel_id=<ID>` in a browser.
2. The `<title>` near the top of the feed is the channel name. A wrong ID gives
   an error page, not a feed.

The manual's list is the one to work from — it is the one the live Zap was built
from. The PDF additionally contains four literal `UCxxxxxxxxxxxxxxxxxxxxxx`
placeholders and a BiggerPockets feed that is not in the live set.

Verified list lives in [`feeds.md`](./feeds.md). Copy-paste only, never retype:
capital `I` and lowercase `l` are indistinguishable on screen and produce silent
404s.

---

## Change 2 — Portfolio context in the Friday synthesis

**Problem:** Claude synthesizes the week with no knowledge of the portfolio, so
recommendations drift generic ("consider adding a hot tub").

**Fix:** Keep a short standing context document and paste it into the synthesis
prompt.

1. Fill in [`portfolio-context.md`](./portfolio-context.md). It has explicit
   `TO FILL` markers — every number in it must come from you; none are guessed.
2. Save it to Drive at **Property Management OS → STR-MTR Operations → STR Weekly
   – YouTube Intelligence → `Portfolio Context`**.
3. In the reporter Zap, open the **Anthropic (Claude)** synthesis step and paste
   the contents into the top of the prompt, under a heading like:

   ```
   ## OUR PORTFOLIO (ground every recommendation in this)
   <paste contents of Portfolio Context here>
   ```

4. The full replacement synthesis prompt is in
   [`prompts/friday-synthesis.md`](./prompts/friday-synthesis.md) — it already
   has the slot marked.

**Maintenance:** revisit the context doc quarterly, or whenever a unit is added
or a major operational problem is resolved. A stale context doc is worse than
none, because it produces confidently wrong advice.

> Pasting the context inline means editing the Zap whenever the numbers change.
> If that becomes annoying, the alternative is a Google Docs "Find a Document"
> step ahead of the Claude step, mapping its text into the prompt — one more
> task per run, but the doc becomes editable without touching the Zap.

---

## Change 3 — Recommendation tracker

**Problem:** the report generates recommendations every Friday and nothing
records what was done about them. That is a growing pile of documents, not
continual improvement.

**Fix:** a Google Sheet the reporter Zap appends to, and reads back from.

Schema, setup, and the exact Zapier step configuration are in
[`recommendation-tracker.md`](./recommendation-tracker.md).

Shape of the change to the reporter Zap:

```
Schedule
  → Digest: Release Existing Digest
  → Google Sheets: Get Many Spreadsheet Rows      ← NEW (read back last ~30)
  → Anthropic (Claude): synthesize                ← MODIFIED (context + history)
  → Formatter: Utilities → Line-itemize           ← NEW
  → Google Sheets: Create Multiple Spreadsheet Rows ← NEW
  → Google Drive: Create File From Text
  → Microsoft Outlook: Send Email
```

The read-back step is what makes it a loop rather than a log: last month's rows
go into the prompt, so Claude stops re-recommending things already rejected or
already done.

---

## Change 4 — Pre-filter before the expensive steps

**Problem:** every video gets the full Apify → Delay → Fetch → Claude treatment,
including Shorts, sponsor reads, and portfolio-tour vlogs. That is wasted Apify
credits, wasted Claude tokens, wasted Zapier tasks, and noise in the digest. It
also worsens the rate-limit auto-pause problem (gotcha 4.7).

**Fix:** two-stage gate ahead of the Apify step.

```
RSS: New Items in Multiple Feeds
  → Filter by Zapier: keyword pre-pass            ← NEW (free, no task cost)
  → Anthropic (Claude): relevance classify        ← NEW (cheap, Haiku)
  → Filter by Zapier: only continue if RELEVANT   ← NEW (free)
  → Apify: Run Actor
  → ... unchanged
```

Filter steps do not consume Zapier tasks, so the keyword pre-pass is genuinely
free and should catch the obvious junk before you spend anything at all.

Config and the classifier prompt are in
[`prompts/relevance-filter.md`](./prompts/relevance-filter.md).

**A caveat worth knowing:** YouTube's RSS feed gives you title, description, link
and published date — **not duration**. So you cannot filter Shorts by length at
this stage. The Haiku classifier judging title + description is doing the real
work here; the keyword filter is only a cheap first pass.

---

## Retiring the PDF

`STR_MTR_Level3_Automation_Guide.pdf` should not be used to build or rebuild this
system. Specific problems:

- **`Google Drive → Find Files in Folder` then `Formatter → Join`** is the
  load-bearing step of its Friday Zap and does not work as described. Drive's
  find actions return file *metadata*, not file *contents*, and do not produce a
  clean array of transcripts to join. It would need Looping by Zapier plus a
  download per file. Avoiding exactly this is why the Digest pattern exists.
- **One Claude call over a whole week of raw transcripts, truncated at 8,000
  words.** Twelve videos is 60k–100k+ words; most of the week is discarded. The
  live design's analyze-each-then-synthesize (map/reduce) is both better and
  cheaper.
- **A third Zap triggered by "New File in Drive"** adds up to 15 minutes of
  polling lag, races with the report Zap, and fires on any file dropped in that
  folder.
- **PDFShift** is an unnecessary dependency. `Create File From Text` with
  `Convert to Document = True`, plus an HTML email body, gets read more often
  than a PDF attachment.
- **youtube-transcript.io free tier is 25/month**, which six to nine active
  channels exhaust in about two weeks.
- **`claude-sonnet-4-6` is hardcoded.** Use whatever the Zapier Anthropic step's
  dropdown currently offers.
- **`david@baybuy homes.com`** — malformed, see Change 1a.

---

## Verification checklist

After each change, before turning the Zap back on:

- [ ] Every modified step tested individually and passed.
- [ ] No "finish required fields" warnings.
- [ ] Claude output mapped from **Response Content Text** (not Response Content Type).
- [ ] Digest content mapped from **List** (not Final Digest).
- [ ] Digest name still matches **exactly** between collector and reporter.
- [ ] Email "To" — one address per line, no trailing spaces.
- [ ] `Convert to Document = True`; email `Body Format = HTML`.
- [ ] Zap shows **ON** with no warning icon.
- [ ] Zap runs / History confirms a successful fire.

For Change 4 specifically, watch the first week's Zap history and confirm the
filter is not rejecting things it should keep. Loosen the classifier before
tightening it.
