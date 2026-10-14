'use strict';
// The seven deck modules: the repeatable pieces that make an FLPT talk land. They are the playbook's signature
// elements (references/playbook.md, Part 1). The crew picks them slide by slide, and the user can make a "call" for
// any of them: "animate the chart in this photo of my notebook", "make this short story a Cosmos cartoon".
//
// `now` says what the crew delivers in this version; motion, cartoons, insets and cut scenes are designed and
// briefed now, and produced by later versions (generated pieces only after the user approves an estimate).

const MODULES = [
  {
    id: 'chart', name: 'Live charts',
    short: 'Real data, built bar by bar as you talk.',
    ask: 'Turn the chart in this screenshot into one that builds as I speak.',
    now: 'a chart that builds as it\'s narrated',
    crew: 'Real data from the bullets\' sources, or from the user\'s attached table or screenshot, transcribed exactly. Pick the form from the headline\'s verb (compare → bar, share → stacked bar, change over time → line). Start grey and earn back one accent colour; label directly, no legends; bars start at zero; a receipt lower-third in mono (source · date · figure) clear of the bubble. Read the playbook, Part 1 §2.',
  },
  {
    id: 'sketch', name: 'Hand-drawn charts',
    short: 'Your notebook sketch, drawn stroke by stroke.',
    ask: 'Animate the chart in this photo of my notebook.',
    now: 'the drawing, which draws itself stroke by stroke as it\'s narrated',
    crew: 'The whiteboard look: a warm-white board (#FBFAF6), marker strokes as SVG paths (one continuous path per stroke, 6–10 px, round caps, a slight hand wobble), ink plus one or two accent inks, hand-lettered labels of 1–3 words in Caveat (add the Caveat face to deck.json), and an underline or circle on the punchline. Doodle concrete things, not boxes and arrows. When the user attaches a photo of their notebook, Read it and reproduce what it shows (the chart\'s shape, axes, labels, numbers, arrows and doodles) faithfully and cleanly; anything you can\'t read becomes [needs number] and goes in your report. It draws itself: a "draw" build with "pen": true for each stroke (or each doodle, with drawStagger), cued to its word, and labels written on with "wipe". Read the playbook, Part 1 §4.',
  },
  {
    id: 'motion', name: 'Motion graphics',
    short: 'Every slide builds, timed to the words.',
    ask: 'Make slide 5 build piece by piece as I talk through it.',
    now: 'the slide, building as it\'s narrated',
    crew: 'Nothing appears before it\'s said. Design the slide\'s final frame, then write its builds in reading order in modules.json (see Builds), each cued to the words that trigger it. Calm moves only (rise, fade, draw, wipe, grow, count-up, focus/dim); shown things stay and dim. Read the playbook, Part 1 §1, and references/hyperframes-slides.md.',
  },
  {
    id: 'cosmos', name: 'Cosmos cartoons',
    short: 'A backstory, told as a narrated cartoon.',
    ask: 'Make this short story a Cosmos cartoon and tie it to the main point.',
    now: 'the vignette\'s brief and a title card (the cartoon is generated later, after you approve its cost)',
    crew: 'A narrated slide becomes a short painted documentary with the presenter\'s bubble hidden: 4–6 painted keyframes, each cued to a verbatim narration phrase, slow pushes and parallax, ink-wipes between beats, 40–70 s of narration. Write its brief to deck/project/briefs/<slide-id>.md: the story in a few lines, how it ties to the through line, the keyframes (one line each, with the phrase that cues it), the narration lines, and the style (the series\' style frame if there is one; otherwise storybook limited animation: ink and teal shadows, amber light, one oxblood accent, no photoreal, no text in the art). Historical people are stylised, never look-alikes. The slide itself is the vignette\'s title card: a small CARTOON · TITLE label and one evocative line on a dark, painterly background. Read the playbook, Part 1 §5, and templates/hyperframes/examples/cartoon/BRIEF.md.',
  },
  {
    id: 'inset', name: 'Video insets',
    short: 'A clip playing inside a slide.',
    ask: 'Play this clip inside slide 3 while I talk about the launch.',
    now: 'the slide with the clip\'s frame and poster, plus the inset\'s exact placement for your editor',
    crew: 'Design the slide with a clear frame for the clip (about 40 % of the width, a thin rule or a monitor/TV drawn around it, clear of the bubble corner) and show the clip\'s poster frame inside it (an <img> through deck/asset_map.json). Record in modules.json the clip (its path), the frame\'s exact rectangle on the 1920×1080 slide, the in and out points, and the sound policy (muted unless the user says otherwise). Never fetch or download video yourself: use only clips the user attached or picked from their Library.',
  },
  {
    id: 'infographic', name: 'Infographics',
    short: 'One structure, explained.',
    ask: 'Turn these five steps into an infographic.',
    now: 'an infographic that builds piece by piece as it\'s narrated',
    crew: 'One structure per slide (a process, timeline, ladder, 2×2, before/after, hub and ring, map or anatomy), at most about six objects, labels touching what they name, the graphic taking 55–60 % of the frame with a small title up top. Illustrations need form: shading, weight and wobble, never flat clip art. Read the playbook, Part 1 §3.',
  },
  {
    id: 'cutscene', name: 'Cut scenes',
    short: 'A cinematic beat between slides.',
    ask: 'After slide 6, cut to the negotiation room at 2 a.m.',
    now: 'its brief and its place in the episode (it\'s generated later, after you approve its cost)',
    crew: 'A 5–15 s cinematic payoff between two slides, with no slide of its own. Write its brief to deck/project/briefs/cutscene-<n>.md: the line it pays off, 2–4 shots (one line each), the look, and the sound. Record where it plays (after which slide) in modules.json. Read references/cutscenes.md.',
  },
];
// What a call says when it starts from a file (the user can edit it before adding the call).
const WITH_FILE = {
  chart: 'Redraw the chart in this picture in our style, building as I talk.',
  sketch: 'Redraw this as a hand-drawn chart that draws itself.',
  motion: 'Build this on screen as I talk through it.',
  cosmos: 'Turn this into a Cosmos cartoon that ties back to the main point.',
  inset: 'Play this clip inside the slide where it fits.',
  infographic: 'Turn this into an infographic.',
  cutscene: 'Use this as the look for a short cut scene.',
};
for (const m of MODULES) m.withFile = WITH_FILE[m.id];
const IDS = MODULES.map((m) => m.id);

/** The likely module for files the user brings: a clip → video inset, a document → Cosmos cartoon (a story to tell),
 *  a phone photo → hand-drawn chart (a notebook page), any other picture → live chart (a screenshot). */
function guessFor(files) {
  const f = (files || [])[0];
  if (!f) return 'chart';
  if (f.kind === 'video') return 'inset';
  if (f.kind === 'doc') return 'cosmos';
  return /\.(jpe?g|heic|heif)$/i.test(f.name || '') ? 'sketch' : 'chart';
}
const byId = (id) => MODULES.find((m) => m.id === id) || null;

/** The ids of the seven modules a deck doesn't use yet, from the crew's modules.json (cut scenes are listed apart). */
function missing(map) {
  const used = new Set(Object.values((map && map.slides) || {}).map((x) => x && x.module));
  if (map && Array.isArray(map.cutscenes) && map.cutscenes.length) used.add('cutscene');
  return IDS.filter((id) => !used.has(id));
}

/** The module guide for the deck crew's prompt. */
function promptCatalog() {
  return MODULES.map((m, i) => `${i + 1}. **${m.name}** (\`${m.id}\`). ${m.crew} *In this version you deliver:* ${m.now}.`).join('\n');
}

/** The user's calls for the deck crew's prompt: every one is a requirement. */
function promptCalls(calls) {
  if (!calls || !calls.length) return 'The user made no calls: choose the modules yourself, slide by slide.';
  const lines = calls.map((c) => {
    const m = byId(c.module);
    const where = c.slide ? `on slide ${c.slide}` : 'wherever it fits best';
    const files = (c.attachments || []).map((a) => (a.kind === 'link' ? `the link ${a.url}` : `the file \`${a.path}\`${a.poster ? ` (poster frame: \`${a.poster}\`)` : ''}`));
    return `- **${c.id}: ${m ? m.name : c.module}**, ${where}. The user says: "${String(c.ask || '').replace(/\s+/g, ' ').trim()}"${files.length ? `\n  Attached: ${files.join('; ')}.` : ''}`;
  });
  return `${lines.join('\n')}\n\nDo every call exactly as asked, and record each one in modules.json under its slide with \`"call": "<id>"\`. Open every attached file (Read shows you images). If a call can't be done as asked, do the closest honest version and say why in your report.`;
}

module.exports = { MODULES, IDS, byId, promptCatalog, promptCalls, missing, guessFor };
