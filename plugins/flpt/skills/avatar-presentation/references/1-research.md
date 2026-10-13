# Stage 1: Research

**Goal:** gather 10–15 key resources (articles, studies, primary texts, videos, infographics and images) that support the user's argument, verify the facts that carry weight, and index them.

## 1. Plan the buckets from the user's outline

Map the user's own notes onto 3–5 buckets. A typical set:

- **The hook.** The news item itself: primary article, licensed free reprint, quotes, stated rationale.
- **Trend and market.** Other examples, surveys (flag vendor bias), and counter-evidence.
- **Economics.** Cost claims and what the data actually shows.
- **Concepts.** The ideas the talk leans on, such as philosophy, strategy or logic. Use primary texts plus accessible explainers.
- **Analogies and images.** Things like Deep Blue vs AlphaGo, public-domain photos and book pages.

Add the one resource nobody asked for that the argument needs. In the first run that was a legal-ethics opinion (ABA Formal Opinion 512) that constrained the thesis. Research that yourself while the agents run.

## 2. Fan out: one background agent per bucket, all launched in one message

Give each agent a self-contained brief:

1. **Context:** a paragraph on who the user is, the talk's question, and the thesis or framework in brief.
2. **Task:** 3–4 cards at most, with exact filenames under `resources/<n>_<bucket>/`.
   - Say precisely what to find.
   - List specific facts to verify.
   - Name the likely misconceptions to check. In the first run those included "Big Blue" vs Deep Blue, a fake Sun Tzu quote, and HBR being paywalled while McKinsey hosts a free version.
3. **The card template below**, to be used exactly.
4. **Rules:**
   - Summaries in the agent's own words, at most one quote under 15 words.
   - No paywalled downloads or unauthorized mirrors.
   - Download only from trusted official sources that are public domain, openly licensed, or offered free by the rights holder.
   - Every number comes from a page actually fetched; label anything unverified.
   - Create no files other than the cards.
5. **Final report:** each card written (path plus one line), the 5 most talk-worthy facts with URLs, corrections to the user's premises, and up to 5 runners-up with URLs.

```
# <Title>
- **Type:** article | study | video | infographic | image | book | reference entry
- **Source / Author / Date:**
- **Link:** <main URL>
- **Access:** free | paywalled (+ free alternative if one exists)
- **Local file:** <relative path, or "none">
- **Supports talk section:**

## Why it matters for the talk
- 2–4 bullets

## Key points
- 4–8 bullets, own words, with verified numbers, dates and names

## Usable quote
- At most one exact quote under 15 words, with attribution. Or "none".

## Also see
- Optional: other links, one line each

## Caveats / accuracy notes
- Uncertainty, vendor bias, corrections to the talk's premises
```

For images, have an agent pull from Wikimedia Commons with `curl -L -A "<descriptive UA>"`, check each file with `file`, and write `resources/images/CREDITS.md`. Slide-ready crops, like a single proposition from a scanned book, beat full pages.

## 3. While the agents run

Draft the framework and diagrams (stage 2) from the user's notes. Don't duplicate an agent's searches.

## 4. When the agents report back

- **Spot-check the facts that will be said aloud.** Fetch the primary source.
  - If a PDF won't parse, decompress its streams with Python `zlib` and search the text.
  - For quotes from public-domain texts, grep the Project Gutenberg plain text.
- **Fold corrections into the framework right away.** In the first run: the cost premise was backwards (unit prices were falling), Oracle was BBB- but still investment grade, and "Tactics without strategy…" is not Sun Tzu.
- **Curate and index.** Keep 10–15 key resources and write the `README.md` index:
  - what's in the folder
  - a table of resources per bucket: #, resource with a card link, type, use it for, access
  - images for slides
  - a "45 minutes to prep" reading list
  - accuracy notes worth remembering

## Video sources with no transcript (X, Loom embeds)
Open the post in the browser pane. In the page, seek the `<video>` element and `drawImage` frames at chosen times onto a canvas grid (the MSE blob is same-origin), then screenshot it to read the slides. The video's resolution rises once it plays larger. Without audio you can cite slide text, but not the speaker's words. Offer a transcription (Gemini costs cents; whisper-cpp is free but needs the user's OK to install) if verbatim quotes matter.
