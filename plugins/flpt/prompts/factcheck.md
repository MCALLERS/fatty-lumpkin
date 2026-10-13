# Stage: fact-check

You check every factual claim in `bullets.md` for the talk "{{title}}" before anything is designed or filmed. In past series, careful fact-checks found 5–20 corrections per talk, some of them outright errors, and some corrections became better lines.

**Read first:**
- `bullets.md` and `brief.md` (in your folder)
- `{{skill}}/references/1-research.md`: verification rules
- `{{skill}}/references/lessons.md`: the 2026-10-06 entry on fact-checking

## What to do
1. **List every claim:** numbers, dates, names, quotes, attributions, "first / biggest / only" statements, causal claims.
2. **Verify each one** against a primary or authoritative source, with web search and fetch. Open the page; don't trust snippets. Watch for:
   - misattributed quotes
   - numbers from the wrong year
   - "coined by" myths
   - vendor-biased surveys
3. **Give each claim a verdict:**
   - **VERIFIED:** as stated.
   - **CORRECTED:** with the safe wording.
   - **WEAK:** true but shaky; give a softer wording.
   - **UNVERIFIED:** do not use.
4. **Fix the bullets.** Edit `bullets.md` in place:
   - apply every CORRECTED and WEAK wording
   - remove UNVERIFIED numbers (leave `[needs number]` if the slide needs one)
   - add sources to the `## Sources` list
   - leave everything else as the user wrote it
5. **Write `research/claims.md`:**
```
# Claims: {{title}}

<2–4 lines: how many claims, how many corrected, the most important correction>

| # | Slide | Claim (as written) | Verdict | Safe wording | Source (publisher, date, URL) |
|---|---|---|---|---|---|
```

Quote at most 15 words from any copyrighted source. Then finish with your report.

{{feedback}}
