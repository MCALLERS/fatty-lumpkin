'use strict';
// The spend broker: the only thing in FLPT allowed to start paid work.
//
// A human approves an itemised estimate; that mints a budget token with a cap. Every paid call must present a live
// token for the right provider and fit under what's left of the cap, and every call is written to an append-only
// ledger. Spending past the cap needs a new approval. Paid work so far: the optional setup sample, filming, the crew's
// planning budget, generated media (generate.js: B-roll on Kie.ai or Higgsfield, one approval per job), and Scribe's
// transcription for cutting laughs (Refine's tightening, flow.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Rates measured in production (playbook Part 5) or read from the providers' own price pages (2026-10-13; see
// docs/research/generation-apis.md). Estimates, shown to the user before any approval.
// Kie.ai bills in credits at 0.005 US dollars each (Seedance 2.5 without a video input: 28, 63 and 158 credits a
// second at 480p, 720p and 1080p). Higgsfield's API bills a prepaid US-dollar balance (not the higgsfield.ai plan
// credits): 480p is its list price, 720p a published estimate, 1080p and the still are cautious guesses, and FLPT
// asks Higgsfield's own free estimate endpoint for the exact price before every approval (unitUsd, below).
const RATES = {
  heygen_avatar_s: { provider: 'heygen', unit: 'second of avatar video', usd: 0.041 },
  heygen_tts_s: { provider: 'heygen', unit: 'second of voice sample', usd: 0.002 },
  kie_seedance_480p_s: { provider: 'kie', unit: 'second of video (480p)', usd: 0.14, credits: 28 },
  kie_seedance_720p_s: { provider: 'kie', unit: 'second of video (720p)', usd: 0.315, credits: 63 },
  kie_seedance_1080p_s: { provider: 'kie', unit: 'second of video (1080p)', usd: 0.79, credits: 158 },
  kie_still: { provider: 'kie', unit: 'still (Nano Banana Pro, 2K)', usd: 0.09, credits: 18 },
  kie_cutout: { provider: 'kie', unit: 'cut-out (background removal)', usd: 0.005, credits: 1 },
  higgsfield_seedance_480p_s: { provider: 'higgsfield', unit: 'second of video (480p)', usd: 0.21 },
  higgsfield_seedance_720p_s: { provider: 'higgsfield', unit: 'second of video (720p)', usd: 0.47 },
  higgsfield_seedance_1080p_s: { provider: 'higgsfield', unit: 'second of video (1080p)', usd: 1.16 },
  higgsfield_still: { provider: 'higgsfield', unit: 'still (2K)', usd: 0.05 },
  // ElevenLabs Speech to Text: 0.22 US dollars an hour (elevenlabs.io/pricing/api, 2026-10-14), from the plan's hours first
  elevenlabs_scribe_s: { provider: 'elevenlabs', unit: 'second of sound transcribed (Scribe v2)', usd: 0.22 / 3600 },
  anthropic_usd: { provider: 'anthropic', unit: 'US dollar of Claude usage (cap)', usd: 1 },
};

/**
 * An itemised estimate. Each item: { rate, qty, label }, plus unitUsd / unitCredits when the provider quoted its own
 * price for this exact job (Higgsfield's estimate endpoint), which then replaces the table's.
 */
function estimate(items) {
  const lines = items.map(({ rate, qty, label, unitUsd, unitCredits }) => {
    const r = RATES[rate];
    if (!r) throw new Error(`unknown rate ${rate}`);
    const q = Math.max(0, Number(qty) || 0);
    const quoted = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
    const usd = quoted(unitUsd) ? Number(unitUsd) : r.usd;
    const credits = quoted(unitCredits) ? Number(unitCredits) : r.credits;
    return { rate, label: label || r.unit, provider: r.provider, qty: q, unit: r.unit, quoted: quoted(unitUsd) || quoted(unitCredits),
      usd: usd != null ? +(usd * q).toFixed(2) : null, credits: credits != null ? Math.ceil(credits * q - 1e-9) : null };
  });
  const byProvider = {};
  for (const l of lines) {
    const p = (byProvider[l.provider] ||= { usd: 0, credits: 0 });
    p.usd = +(p.usd + (l.usd || 0)).toFixed(2);
    p.credits += l.credits || 0;
  }
  return { lines, byProvider, totalUsd: +lines.reduce((a, l) => a + (l.usd || 0), 0).toFixed(2) };
}

function createBroker({ dir, now = () => new Date() }) {
  fs.mkdirSync(dir, { recursive: true });
  const budgetsFile = path.join(dir, 'budgets.json');
  const ledgerFile = path.join(dir, 'ledger.jsonl');
  let budgets = null;

  function load() {
    if (budgets) return budgets;
    try { budgets = JSON.parse(fs.readFileSync(budgetsFile, 'utf8')); } catch { budgets = {}; }
    return budgets;
  }
  function save() {
    const tmp = budgetsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(budgets, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, budgetsFile);
  }
  function log(entry) {
    fs.appendFileSync(ledgerFile, JSON.stringify({ at: now().toISOString(), ...entry }) + '\n', { mode: 0o600 });
  }

  /** A human said yes to this estimate: mint one budget per provider in it. Returns {provider: token}. */
  function approve(est, { project = null, stage = null, approvedBy = 'user', marginPct = 15 } = {}) {
    load();
    const tokens = {};
    for (const [provider, amt] of Object.entries(est.byProvider)) {
      const token = `bud_${crypto.randomBytes(9).toString('hex')}`;
      const k = 1 + marginPct / 100; // a small margin for re-rolls, stated in the approval dialog
      budgets[token] = { token, provider, project, stage, approvedBy, createdAt: now().toISOString(),
        capUsd: amt.usd ? +(amt.usd * k).toFixed(2) : 0, capCredits: amt.credits ? Math.ceil(amt.credits * k) : 0,
        spentUsd: 0, spentCredits: 0, closed: false };
      tokens[provider] = token;
      log({ kind: 'approve', token, provider, project, stage, capUsd: budgets[token].capUsd, capCredits: budgets[token].capCredits });
    }
    save();
    return tokens;
  }

  /** Before a paid call. Throws (and starts nothing) unless the token is live and covers the cost. */
  function authorize(token, provider, { usd = 0, credits = 0, what = '' } = {}) {
    const b = load()[token];
    if (!b) throw new Error('No approved budget for this spend. Ask the user to approve an estimate first.');
    if (b.closed) throw new Error('That budget is closed. A new approval is needed.');
    if (b.provider !== provider) throw new Error(`That budget is for ${b.provider}, not ${provider}.`);
    if (b.capUsd && b.spentUsd + usd > b.capUsd + 1e-9) throw new Error(`Over budget: ${b.spentUsd + usd} of ${b.capUsd} US dollars. A new approval is needed.`);
    if (b.capCredits && b.spentCredits + credits > b.capCredits) throw new Error(`Over budget: ${b.spentCredits + credits} of ${b.capCredits} credits. A new approval is needed.`);
    if (!b.capUsd && !b.capCredits) throw new Error('That budget has no cap.');
    b.spentUsd = +(b.spentUsd + usd).toFixed(4);
    b.spentCredits += credits;
    save();
    log({ kind: 'authorize', token, provider, usd, credits, what });
    return { remainingUsd: b.capUsd ? +(b.capUsd - b.spentUsd).toFixed(2) : null, remainingCredits: b.capCredits ? b.capCredits - b.spentCredits : null };
  }

  /**
   * After a capped call whose real cost is known: give back the unused part of what authorize() reserved, the way a
   * card pre-authorisation is settled. Never raises spending above what was authorised.
   */
  function settle(token, { authorizedUsd = 0, actualUsd = 0, authorizedCredits = null, actualCredits = null, what = '' } = {}) {
    const b = load()[token];
    if (!b) return;
    const released = Math.max(0, Number(authorizedUsd) - Math.max(0, Number(actualUsd) || 0));
    b.spentUsd = Math.max(0, +(b.spentUsd - released).toFixed(4));
    const entry = { kind: 'settle', token, provider: b.provider, authorizedUsd, actualUsd, releasedUsd: +released.toFixed(4), what };
    if (authorizedCredits != null) { // a provider that bills in credits (Kie.ai) reports what it really took
      const releasedCredits = Math.max(0, Math.floor(Number(authorizedCredits) - Math.max(0, Number(actualCredits) || 0)));
      b.spentCredits = Math.max(0, b.spentCredits - releasedCredits);
      Object.assign(entry, { authorizedCredits, actualCredits, releasedCredits });
    }
    save();
    log(entry);
  }

  function record(token, entry) { log({ kind: 'job', token, ...entry }); }
  function close(token) { const b = load()[token]; if (b) { b.closed = true; save(); log({ kind: 'close', token }); } }
  function isLive(token, provider) { const b = load()[token]; return Boolean(b && !b.closed && b.provider === provider); }
  function list() { return Object.values(load()); }

  return { approve, authorize, settle, record, close, isLive, list, ledgerFile };
}

module.exports = { createBroker, estimate, RATES };
