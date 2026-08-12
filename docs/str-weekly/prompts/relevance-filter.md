# Change 4 — Relevance pre-filter (collector Zap)

Goes between the RSS trigger and the Apify step. Three new steps: a free keyword
filter, a cheap Claude classification, and a filter on its verdict.

```
RSS: New Items in Multiple Feeds
  → Filter by Zapier          (4a — free)
  → Anthropic (Claude)        (4b — Haiku, cheap)
  → Filter by Zapier          (4c — free)
  → Apify: Run Actor
  → ... unchanged
```

Filter steps do not consume Zapier tasks, so 4a costs nothing at all and 4b only
runs on what survives it.

---

## Step 4a — Filter by Zapier (keyword pre-pass)

**Only continue if...** — all conditions joined with AND:

| Field | Condition | Value |
|---|---|---|
| Title | (Text) does not contain | `#shorts` |
| Title | (Text) does not contain | `podcast episode` |
| Title | (Text) does not contain | `giveaway` |
| Title | (Text) does not contain | `my portfolio` |
| Title | (Text) does not contain | `net worth` |
| Description | (Text) does not contain | `sponsored by` |

Tune this list from what you actually see in Zap history after a few weeks. Keep
it short — this is a blunt instrument by design, and the classifier below is what
does the real judging.

---

## Step 4b — Anthropic (Claude), relevance classification

**Action:** Send Message
**Model:** the cheapest one in the dropdown (a Haiku model). This step runs on
every video that clears 4a, so it should stay cheap. Do not hardcode a model name
from any document — pick from the dropdown.
**Max tokens:** `10` — the reply is one word.

**Prompt:**

```
You are screening YouTube videos for a short-term rental operator in
St. Petersburg / Pinellas County, Florida. They OWN their units — they are not
arbitrage, not co-hosting, not third-party property management.

Decide whether this video is likely to contain anything useful to how they price,
operate, furnish, market, or comply with regulations on units they own.

RELEVANT examples: pricing and revenue management, listing optimization,
operations and turnover, guest experience and reviews, Florida or Gulf Coast
regulation, insurance, seasonality and demand trends, mid-term rental strategy,
amenity ROI.

SKIP examples: pure motivation or mindset content, portfolio tours, net-worth
reveals, arbitrage or co-hosting how-tos, course and coaching sales pitches,
sponsor reads, giveaways, general real-estate investing with no STR operations
content, Shorts and clips under two minutes.

When genuinely uncertain, answer RELEVANT — a wasted transcript is cheaper than a
missed insight.

TITLE: {{title from RSS trigger}}
DESCRIPTION: {{description from RSS trigger}}

Answer with exactly one word: RELEVANT or SKIP. No punctuation, no explanation.
```

Map `{{title}}` and `{{description}}` from the RSS trigger's fields.

---

## Step 4c — Filter by Zapier (act on the verdict)

**Only continue if...**

| Field | Condition | Value |
|---|---|---|
| Step 4b → **Response Content Text** | (Text) contains | `RELEVANT` |

Use **Response Content Text**, not Response Content Type. `contains` rather than
`exactly matches` tolerates stray whitespace or a trailing newline.

> Note the deliberate asymmetry: `SKIP` does not contain the string `RELEVANT`,
> so `contains RELEVANT` is a safe test. If you ever reword the classifier's
> vocabulary, re-check that the two verdicts remain non-overlapping as substrings.

---

## Tuning

Watch the first two weeks in Zap history. For each filtered-out video, ask whether
you would have wanted it. The failure mode to fear is over-filtering — a video
silently dropped is invisible, whereas a marginal video that gets through merely
costs a few cents and one line in the digest.

If it is over-filtering: relax step 4a first (it is blunt and has no judgment),
then soften the SKIP examples in 4b.

If it is under-filtering: add specific patterns to 4a based on what actually got
through. Resist making the classifier stricter — that is where real insights get
lost.

## What this saves

Per filtered-out video you avoid: one Apify actor run, one 2-minute Delay step,
one Apify dataset fetch, one full-transcript Claude analysis, one Digest append,
and one Drive file — roughly 6 Zapier tasks and the bulk of the per-video cost,
traded for about 1 task and a fraction of a cent for the classification.

It does **not** reduce the RSS polling that causes the auto-pause problem in
gotcha 4.7 — polling happens before any of these steps run. That one is still
solved by splitting feeds or trimming sources.
