#!/usr/bin/env node
'use strict';
// References, Save as style and Share in Claude Code (PLAN §2.10.2–§2.10.3, §2.11; W3-02), through the Mac app's own
// code (references.js, styles.js, api/refs.js, api/share.js): the same Library, the same Styles folder.
//   list · show <id>              the references (private: never offered to a crew), each as its measured card; show
//                                 prints what a crew may see of it (no link)
//   add <files…>                  pictures (up to 12) or one video of the user's, as a reference (measured here)
//   capture <url> [--motion]      one web page, captured with the pinned headless shell (public addresses only,
//                                 40 s at most; YouTube and Vimeo never)
//   chips <id> --type … --ease …  the user's chips on its card
//   attach <id> --shot <shot> [<episode>]   the reference into the episode (presentation/refs/<ref>/) and onto the shot
//   save-style <key> [<episode>] [--name "…"]   an approved Live Motion piece as a Mine style (free)
//   share <style> [--out <file>] [--no-media] [--send]  Share's neutral package, checked, then the .flptstyle: the ⚑
//                                 ticks are asked in a native dialog this command shows itself (never answered by the
//                                 model). --send: to FLPT's review queue as the signed-in user (W4-09; the sign-in is
//                                 W4-10's, common.signIn), else exported as before when the queue can't take it now
// The style study (Make a style) is the Mac app's in 2.0: it's a paid crew session, and the plugin's model can't
// approve money (divergence; the app asks in its own dialog).
const fs = require('fs');
const path = require('path');
const { ROOT, app, places, tools, episodeDir, library, cli, usageError, main, say } = require('./common');

const USAGE = `
Usage: flpt-refs <command> …
  list
  show <id>
  add <file>… [--title "…"]
  capture <url> [--motion] [--title "…"]
  chips <id> [--type grotesk|serif|mono|hand|mixed] [--case upper|sentence|mixed] [--weight light|regular|bold]
             [--ease snappy|smooth|heavy|linear|bouncy] [--density sparse|medium|dense] [--grid centred|asymmetric|columns]
             [--camera push,parallax,…] [--note "…"]
  attach <id> --shot <shot> [<episode>]
  save-style <slide:<id>|between:<id>> [<episode>] [--name "…"]
  share <style id> [--out <file.flptstyle>] [--no-media] [--send]
<episode> is the episode's folder (default: the one you're in, else the newest).`;

const OPTIONS = {
  title: { type: 'string' }, motion: { type: 'boolean' }, type: { type: 'string' }, case: { type: 'string' }, weight: { type: 'string' }, ease: { type: 'string' },
  density: { type: 'string' }, grid: { type: 'string' }, camera: { type: 'string' }, note: { type: 'string' }, shot: { type: 'string' }, name: { type: 'string' },
  out: { type: 'string' }, 'no-media': { type: 'boolean' }, send: { type: 'boolean' },
};
const COMMANDS = ['list', 'show', 'add', 'capture', 'chips', 'attach', 'save-style', 'share'];

const references = app('references');
const refsApi = app('api/refs');
const shareApi = app('api/share');
const stylesOf = () => app('styles').createStyles({ engineRoot: ROOT, projectsDir: places().projects, mediaRoot: null, env: require('./flpt-scene').liveEnv(), toolchain: require('./common').toolchainId() });

/** The references over the Library, as the app makes them: the pinned headless shell for links, the sandbox for ffmpeg. */
function refsOf() {
  const t = tools();
  let hf = null;
  try { hf = require('./flpt-scene').hyperframes(); } catch { hf = null; }
  const paths = { ffmpeg: t.ffmpeg, ffprobe: t.ffprobe, chrome: t.chrome, headless: (hf && hf.browser) || null, node: t.node };
  const sandbox = app('sandbox');
  return references.createReferences({ library: library(), media: app('media').createMedia(paths), tools: paths, sandbox, uaVersion: require('./lib/package.json').version });
}

/** One reference, one line: id, kind, title, the palette's hexes and the measured pace. */
function row(r) {
  const c = r.card;
  const pal = c ? c.palette.slice(0, 5).map((p) => p.hex).join(' ') : 'no card';
  const pace = c && c.motion ? ` · energy ${c.motion.energy}${c.motion.onTwos ? ' on twos' : ''}` : '';
  return `  ${r.id}  ${String((c && c.source.kind) || '?').padEnd(6)} ${r.title} · ${pal}${pace}`;
}

/** The ticks, from the person at the Mac (attest-native: a native dialog; tests stub its ask). */
async function ticks(name, refs) {
  const a = await require('./attest-native').ask({ name, refs });
  if (!a.ok) throw new Error(`Not shared: ${a.why === 'no-gui' ? 'there is no screen to ask on' : a.why === 'sandboxed' ? 'the dialog can\'t open inside Claude Code\'s sandbox' : 'the ⚑ lines weren\'t ticked'}.`);
  return { attest: true, refsAttested: refs ? a.refs === true : false };
}

main(async () => {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd, ...rest] = positionals;
  if (!COMMANDS.includes(cmd)) usageError(USAGE, cmd ? `Unknown command: ${cmd}` : '');

  if (cmd === 'list') {
    const list = refsOf().list();
    if (!list.length) return say('No reference yet. Add pictures or a video (flpt-refs add), or capture a page (flpt-refs capture).');
    say(`${list.length} reference${list.length === 1 ? '' : 's'} (private to this Mac):`);
    for (const it of list) say(row(it));
    return undefined;
  }

  if (cmd === 'show') {
    if (!rest[0]) usageError(USAGE, 'show needs a reference id (flpt-refs list).');
    const r = refsOf().get(rest[0]);
    say(`${r.title} (${r.id})`);
    say(JSON.stringify(r.card ? references.crewView(r.card) : null, null, 1));
    return undefined;
  }

  if (cmd === 'add') {
    if (!rest.length) usageError(USAGE, 'add needs pictures or a video.');
    const files = rest.map((p) => path.resolve(p));
    const r = await refsOf().addFiles(files, { title: values.title || '' });
    if (r.status !== 'ok') throw new Error(r.label || 'Those files didn\'t make a reference.');
    say(`Added ${r.item.id}: ${r.item.title}`);
    say(row({ ...r.item, card: r.card }));
    return undefined;
  }

  if (cmd === 'capture') {
    if (!rest[0]) usageError(USAGE, 'capture needs a link.');
    const r = await refsOf().captureLink(rest[0], { motion: values.motion === true, title: values.title || '' });
    if (r.status !== 'ok') throw new Error(`${r.label || r.status}${r.offer === 'upload' ? '. Pictures or a screen recording of it work instead (flpt-refs add).' : '.'}`);
    say(`Captured ${r.item.id} in ${r.seconds} s${r.motion ? ' (with motion)' : ''}: ${r.item.title}`);
    say(row({ ...r.item, card: r.card }));
    return undefined;
  }

  if (cmd === 'chips') {
    if (!rest[0]) usageError(USAGE, 'chips needs a reference id.');
    const chips = {};
    const type = Object.fromEntries(['type', 'case', 'weight'].filter((k) => values[k]).map((k) => [k === 'type' ? 'class' : k, values[k]]));
    if (Object.keys(type).length) chips.type = type;
    const layout = Object.fromEntries(['density', 'grid'].filter((k) => values[k]).map((k) => [k, values[k]]));
    if (Object.keys(layout).length) chips.layout = layout;
    if (values.camera) chips.camera = values.camera.split(',').map((s) => s.trim()).filter(Boolean);
    if (values.ease) chips.ease = values.ease;
    if (values.note != null) chips.note = values.note;
    if (!Object.keys(chips).length) usageError(USAGE, 'chips needs at least one chip.');
    const card = refsOf().setChips(rest[0], chips);
    say(JSON.stringify(references.crewView(card), null, 1));
    return undefined;
  }

  if (cmd === 'attach') {
    if (!rest[0] || !values.shot) usageError(USAGE, 'attach needs a reference id and --shot.');
    const dir = episodeDir(rest[1]);
    const item = refsOf().get(rest[0]);
    if (!item.card) throw new Error('That reference has no card yet.');
    const at = refsApi.attachTo(dir, item);
    const sb = app('storyboard');
    const board = sb.read(dir);
    if (!board) throw new Error('This episode has no storyboard yet.');
    sb.edit(dir, { op: 'ref', id: values.shot, add: at.ref }, { caps: { surface: 'plugin' } });
    say(`${item.title} is reference ${at.ref} of shot ${values.shot} (presentation/refs/${at.ref}/: its card and pictures, never read by a crew).`);
    return undefined;
  }

  if (cmd === 'save-style') {
    const key = rest[0];
    if (!key || !app('livemotion').KEY.test(key)) usageError(USAGE, 'save-style needs a piece: slide:<id> or between:<id>.');
    const dir = episodeDir(rest[1]);
    const p = shareApi.approvedPiece(dir, key);
    const styles = stylesOf();
    const styleDir = app('livemotion').styleDirOf(dir, p, { engineRoot: ROOT, styles });
    if (!styleDir) throw new Error('The episode has no copy of its style.');
    const rec = await styles.saveAsStyle({ sceneDir: app('livemotion').folderOf(dir, p), styleDir, name: values.name || '', fromEpisode: path.basename(dir), fromShot: p.shot || null, refsUsed: shareApi.usedRefs(dir, p), episodeDir: dir });
    say(`Saved ${rec.name} (${rec.id}) in ${path.dirname(rec.dir)}: the piece is its private demo (it stays on this Mac).`);
    try { const m = await styles.renderMedia(rec.id, { from: 'demo' }); say(`Its poster and loop: ${m.seconds} s${m.score && m.score.music ? `, ${m.score.music}` : ''}.`); } catch (e) { say(`No poster or loop yet (${e.message}).`); }
    return undefined;
  }

  if (cmd === 'share') {
    const id = rest[0];
    if (!id) usageError(USAGE, 'share needs a style id (flpt-styles list).');
    const styles = stylesOf();
    const pkg = await styles.sharePackage({ id, scope: 'mine' }, { render: values['no-media'] !== true });
    say(`${pkg.name} (${pkg.id}@${pkg.version}): ${pkg.files.length} files, ${(pkg.bytes / 1024).toFixed(0)} KB, its demo the starter, checked${pkg.talkGone ? ' (not against its talk: that episode has gone)' : ''}.`);
    for (const f of pkg.files) say(`  ${f.name}  ${f.bytes}`);
    if (pkg.media && pkg.media.loop) say(`Its loop, rendered from the package's own demo: ${pkg.media.loop}`);
    try {
      const t = await ticks(pkg.name, pkg.refsUsed);
      if (values.send) {
        // the review queue (api/share.js's send: the queue, or Export when it can't be reached); the plugin's sign-in
        const common = require('./common');
        const signIn = typeof common.signIn === 'function' ? common.signIn() : null;
        const r = await shareApi.send({ styles, signIn, caps: () => ({ surface: 'plugin' }), settings: { read: () => ({ deliverablesDir: places().deliverables }) }, send: () => {} }, pkg.token, t);
        if (r.status === 'sent' || r.status === 'duplicate') return say(`${r.label} (${r.id}).`);
        if (r.status === 'exported') return say(`The review queue didn't take it (${r.reason}): exported ${r.file}.`);
        say('The review queue isn\'t open here yet: exporting.');
      }
      const out = path.resolve(values.out || shareApi.exportPath(places().deliverables, pkg.id, pkg.version));
      const r = await styles.exportShare(pkg.token, out, { ...t, surface: 'plugin', appVersion: require('./lib/package.json').version });
      say(`Exported ${r.file} (${r.bytes} bytes, sha256 ${r.sha256.slice(0, 12)}…).`);
    } finally {
      styles.discardShare(pkg.token);
    }
    return undefined;
  }
  return undefined;
});
