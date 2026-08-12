# Verified STR creator feeds

Copy-paste only — never retype. Capital `I` and lowercase `l` are
indistinguishable in most fonts and produce silent 404s.

**Verification status:** these are transcribed from the Cowork operating manual,
which marks them verified. They were **not** independently re-checked when this
file was written (YouTube was unreachable from that session). Re-verify any feed
before adding it to a Zap by opening the URL in a browser — a valid feed shows a
`<title>` with the channel name; a bad ID shows an error page.

| Creator | Feed URL | Re-verified |
|---|---|---|
| Sean Rakidzich | `https://www.youtube.com/feeds/videos.xml?channel_id=UCvwmrPfn8ff-rTlc9YoH7Bg` | ☐ |
| Thanks For Visiting | `https://www.youtube.com/feeds/videos.xml?channel_id=UCdAqMyNIw-0gRDH-2Rpe89Q` | ☐ |
| Boostly | `https://www.youtube.com/feeds/videos.xml?channel_id=UCj4GxNlzjWGASeQVC6hroiQ` | ☐ |
| Robuilt | `https://www.youtube.com/feeds/videos.xml?channel_id=UCdIM_XmhsVYbBhl3pgPq3dA` | ☐ |
| John Bianchi | `https://www.youtube.com/feeds/videos.xml?channel_id=UCHnwvtvqsfFG2S1d5x5B4HQ` | ☐ |
| Optimize My Airbnb | `https://www.youtube.com/feeds/videos.xml?channel_id=UCwKwfQEYlbTCUynJHqjDmUA` | ☐ |
| Isaac French | `https://www.youtube.com/feeds/videos.xml?channel_id=UCXaqsYjF3lC9sroMg4VUqww` | ☐ |
| Living Off Rentals | `https://www.youtube.com/feeds/videos.xml?channel_id=UCRpWXe2mWqBm5vvbO2R2AdA` | ☐ |
| The Short Term Shop | `https://www.youtube.com/feeds/videos.xml?channel_id=UC17mi738WbdXCVg8BuNZdZQ` | ☐ |

## Known conflict

The Level 3 PDF lists a **different** ID for Sean Rakidzich:
`UCuDGSixSNKWUPGEHHMd0scQ`. One of the two is wrong. Check both feed URLs in a
browser and keep whichever resolves to the right channel; delete the other from
every document so this does not resurface.

The PDF also lists BiggerPockets (`UC_Ek8FGO0DlDFE8KVKXGUXA`), which is not in
the live set, plus four `UCxxxxxxxxxxxxxxxxxxxxxx` placeholders that were never
filled in.

## The nine-feed problem

Polling 9+ YouTube RSS feeds from one Zap can get the collector auto-paused by
rate limiting. If the collector keeps turning itself off, either:

- split the feeds across two collector Zaps (both appending to the **same** digest
  name — the name must match exactly), or
- trim to the top 5–6 sources.

Re-paste feed URLs from this list rather than editing them in place.

Change 4 (the relevance pre-filter) reduces downstream load but does **not** help
here — the rate limiting is on the polling itself, which happens before any
filter step runs.
