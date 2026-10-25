#!/usr/bin/env node
'use strict';
// The cartoon presenter in Claude Code (PLAN §2.12; W3-05), through the Mac app's own presenter.js: who presents an
// episode (the HeyGen twin, or a stock cartoon, Ada or Bram), which voice speaks for the cartoon, and the cartoon's own
// pass (FLPT's Rhubarb lip sync → the drawn clips), keyless, offline and in macOS's sandbox. Nothing here spends money:
// a paid voice is priced and approved by flpt-film like any film (only that voice's key reaches the run, T19).
//   show    who presents this episode (its own choice; without one, the twin), the presenters and the voices
//   set     this episode's presenter: heygen, or cartoon [--rig <id>] [--voice say[:<Mac voice>] | heygen:<id> |
//           elevenlabs:<id> | fish:<id>] (written to the episode, so the draft, the estimate and the film agree; a voice
//           only when filming can approve its provider; a change after Spend's approval opens Spend again)
//   draw    draw the cartoon for the episode's draft (or --film) from its narration: the clips the next composite uses
//   sample  a few seconds of a presenter talking in the Mac's voice, free: the clip's path
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, app, places, cli, usageError, main, say, episodeDir, toolEnv, brokerFor } = require('./common');

const USAGE = `
Usage: flpt-presenter <command>
  show [<episode>]
  set [<episode>] heygen | cartoon [--rig <id>] [--voice say[:<Mac voice>] | heygen:<id> | elevenlabs:<id> | fish:<id>]
  draw [<episode>] [--film]
  sample <presenter id>`;

const OPTIONS = { rig: { type: 'string' }, voice: { type: 'string' }, film: { type: 'boolean' } };
const lib = () => app('presenter');
const presenters = () => path.join(places().projects, 'Presenters');
const appSettings = () => {
  const userData = places().userData;
  try { return fs.existsSync(path.join(userData, 'settings.json')) ? app('settings').createSettings({ dir: userData }).read() : null; } catch { return null; }
};
const PRICE = { say: 'free', heygen: '0.2 cents a second', elevenlabs: '8 cents per 1,000 characters', fish: 'about 1.5 cents per 1,000 characters (billed by the byte)' };
const describe = (p) => (p.kind !== 'cartoon' ? 'your HeyGen twin'
  : `${p.rig} in ${p.voice.provider === 'say' ? `the Mac's voice${p.voice.id ? ` (${p.voice.id})` : ''}` : `your ${lib().VOICES[p.voice.provider].name} voice ${p.voice.name || p.voice.id || '(none picked yet)'}`}`);

function cmdShow(arg) {
  const s = appSettings();
  let dir = null;
  try { dir = episodeDir(arg); } catch (e) { if (arg) throw e; }
  if (dir) {
    // here, an episode follows its own choice (flpt-presenter set), else the twin, as the plugin's draft and film do
    const p = lib().of(dir, null);
    say(`${path.basename(dir)}: ${describe(p)}${p.from === 'settings' ? ' (no choice of its own yet)' : ''}`);
  }
  if (s && s.presenter) say(`The Mac app's presenter: ${describe(lib().clean(s.presenter))}`);
  say('Presenters:');
  for (const r of lib().rigs(ROOT, presenters())) say(`  ${r.id.padEnd(16)}${r.name}${r.stock ? '' : ' (yours)'}`);
  say('Voices (a cartoon\'s film bills its voice only, never an avatar):');
  for (const id of lib().offered()) say(`  ${id.padEnd(12)}${lib().VOICES[id].name} · ${PRICE[id]}${lib().VOICES[id].key ? ` · needs ${lib().VOICES[id].key}` : ''}`);
}

function parseVoice(v) {
  if (!v) return null;
  const i = v.indexOf(':');
  const provider = (i < 0 ? v : v.slice(0, i)).trim();
  const id = i < 0 ? '' : v.slice(i + 1).trim();
  const out = lib().cleanVoice({ provider, id, name: '' });
  if (!out || (provider !== 'say' && !id)) throw Object.assign(new Error('--voice is say[:<Mac voice>], heygen:<id>, elevenlabs:<id> or fish:<id>.'), { usage: true });
  if (!lib().offered().includes(provider)) throw new Error(`Filming with your ${lib().VOICES[provider].name} voice isn't ready yet: say[:<Mac voice>] or heygen:<id>.`);
  return out;
}

function cmdSet(rest, values) {
  const kinds = new Set(['heygen', 'cartoon']);
  const kind = rest.find((x) => kinds.has(x));
  const where = rest.find((x) => !kinds.has(x));
  if (!kind) throw Object.assign(new Error('set needs heygen or cartoon.'), { usage: true });
  const dir = episodeDir(where);
  const episode = app('episode');
  const st = episode.read(dir);
  if (!st) throw new Error('That episode has no record yet.');
  const now = lib().of(dir, null);
  let next = { kind: 'heygen' };
  if (kind === 'cartoon') {
    const rig = values.rig || (now.kind === 'cartoon' ? now.rig : lib().DEFAULT_RIG);
    if (!lib().rigDir(ROOT, rig, presenters())) throw new Error(`There's no presenter called "${String(rig).slice(0, 40)}" (flpt-presenter show).`);
    const voice = parseVoice(values.voice) || (now.kind === 'cartoon' ? now.voice : { provider: 'say', id: '', name: '' });
    next = { kind: 'cartoon', rig, voice };
  }
  // who presents, as filming sees it: the twin, or a rig and a voice
  const same = (a, b) => [a, b].map((x) => { const c = lib().clean(x); return c.kind === 'cartoon' ? `${c.rig}|${c.voice.provider}|${c.voice.id}` : c.kind; })
    .reduce((x, y) => x === y);
  const spend = st.stages && st.stages.spend;
  let reopened = false;
  if (spend && spend.status === 'approved' && !same(spend.presenter || now, next)) {
    // Spend approved another presenter: that approval goes (its budgets closed), and what was built on it is out of date
    const b = brokerFor(dir);
    for (const [p, t] of Object.entries(st.budgets || {})) if (typeof t === 'string' && b.isLive(t, p)) b.close(t);
    st.stages.spend = { status: 'todo', at: new Date().toISOString(), reopened: 'presenter' };
    for (const later of episode.STAGE_IDS.slice(episode.STAGE_IDS.indexOf('spend') + 1)) {
      if (st.stages[later] && st.stages[later].status === 'approved') st.stages[later] = { ...st.stages[later], status: 'stale' };
    }
    reopened = true;
  }
  episode.write(dir, { ...st, intake: { ...(st.intake || {}), presenter: next } });
  say(`${path.basename(dir)}: ${describe(lib().clean(next))}.${reopened ? ' Spend is open again: filming needs a new approval.' : ''}`);
  if (next.kind === 'cartoon' && next.voice.provider !== 'say') say(`Filming bills that voice only (${PRICE[next.voice.provider]}), approved in flpt-film like any film.`);
}

async function cmdDraw(arg, values) {
  const dir = episodeDir(arg);
  const p = lib().of(dir, null);
  if (p.kind !== 'cartoon') { say('This episode is presented by your HeyGen twin: nothing to draw.'); return 0; }
  const which = values.film ? 'final' : 'draft';
  if (!lib().slidesFor(dir, which).length) throw new Error(`There's no ${values.film ? 'film' : 'draft'} narration yet: make the ${values.film ? 'film' : 'draft'} first.`);
  const r = await lib().render(dir, which, { engineRoot: ROOT, presenter: p, presentersDir: presenters(), toolEnv, onLine: (l) => say(`  ${l}`) });
  for (const x of r.problems || []) say(`! ${x}`);
  say(`${(r.clips || []).length} clip(s) for the ${values.film ? 'film' : 'draft'}${r.made ? `, ${r.made} new` : ''}. The next ${values.film ? 'film (flpt-film --final, from the cache)' : 'draft (flpt-film --draft)'} puts them in the bubble.`);
  return r.ok ? 0 : 1;
}

async function cmdSample(id) {
  if (!id) throw Object.assign(new Error('sample needs a presenter id (flpt-presenter show).'), { usage: true });
  const s = appSettings();
  const v = s && s.presenter && s.presenter.voice;
  const out = path.join(os.tmpdir(), 'flpt-presenter-samples', String(id).replace(/[^a-z0-9-]/g, ''));
  const clip = await lib().sampleClip(id, out, { engineRoot: ROOT, presentersDir: presenters(), toolEnv, sayVoice: v && v.provider === 'say' ? v.id : '' });
  say(clip);
}

main(async () => {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd, ...rest] = positionals;
  try {
    if (cmd === 'show') return cmdShow(rest[0]);
    if (cmd === 'set') return cmdSet(rest, values);
    if (cmd === 'draw') return await cmdDraw(rest[0], values);
    if (cmd === 'sample') return await cmdSample(rest[0]);
  } catch (e) {
    if (e.usage) usageError(USAGE, e.message);
    throw e;
  }
  return usageError(USAGE, cmd ? `Unknown command: ${cmd}` : '');
});
