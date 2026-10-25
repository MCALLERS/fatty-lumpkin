'use strict';
// The setup wizard's sample: a two-slide talk rendered end to end for free (the Mac's own voice and a placeholder
// bubble), to prove the toolchain and the pipeline before anything is spent. It's an ordinary FLPT project, so the
// same folder later takes the optional paid sample.
const fs = require('fs');
const path = require('path');

const INK = '#17202B';
const PAPER = '#F5F2EA';
const OX = '#8E2C48';
const BLUE = '#1F5A85';
const SERIF = "'Iowan Old Style', 'Palatino', 'Times New Roman', serif";
const SANS = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";

// Content stays clear of the presenter bubble (x < 380 below y ≈ 720), per the deck design rules.
const SLIDES = {
  hello: `<section id="hello" style="background:${PAPER}; color:${INK}; font-family:${SANS}; padding:160px 128px 0; justify-content:flex-start; gap:28px">
<p style="margin:0; font-size:28px; letter-spacing:0.18em; text-transform:uppercase; color:${OX}; font-weight:600">Fatty Lumpkin Presentation Tool</p>
<h1 style="margin:0; font-family:${SERIF}; font-size:120px; line-height:1.05; font-weight:600">Your Mac is ready<br>to make videos.</h1>
<p style="margin:0; font-size:40px; line-height:1.35; color:#3B4552; max-width:1400px">This sample was rendered right here on your Mac by the Fatty Lumpkin Presentation Tool.</p>
</section>`,
  next: `<section id="next" style="background:${INK}; color:${PAPER}; font-family:${SANS}; padding:120px 128px 120px 128px; gap:56px">
<p style="margin:0; font-size:28px; letter-spacing:0.18em; text-transform:uppercase; color:#E8B4C4; font-weight:600">What happens next</p>
<h1 style="margin:0; font-family:${SERIF}; font-size:96px; line-height:1.05; font-weight:600">From an idea to a finished episode</h1>
<div style="display:flex; gap:32px; margin-left:300px">
${[['1', 'Bullets', 'your idea, shaped and fact-checked'], ['2', 'Deck', 'every slide built to move'], ['3', 'Script', 'sounds like you, not a robot'], ['4', 'Filming', 'your avatar presents it']]
    .map(([n, t, s]) => `<div style="flex:1; display:flex; flex-direction:column; gap:12px; background:#223042; border-radius:16px; padding:36px">
<p style="margin:0; font-size:28px; color:#9CC3E4; font-weight:600">${n}</p>
<p style="margin:0; font-family:${SERIF}; font-size:52px; font-weight:600">${t}</p>
<p style="margin:0; font-size:28px; line-height:1.35; color:#C9D3DE">${s}</p></div>`).join('\n')}
</div>
<p style="margin:0 0 0 300px; font-size:30px; color:${PAPER}"><span style="color:${BLUE}; background:${PAPER}; border-radius:8px; padding:4px 12px; font-weight:600">Nothing costs money</span> until you approve an estimate.</p>
</section>`,
};

const SCRIPT = `# Sample talk: setup check

> Written by the setup wizard. The free draft uses the Mac's own voice and a placeholder bubble.

## SLIDE 1 — Your Mac is ready to make videos

> Stage note: the wizard's free end-to-end check.

Hi. This is a quick test from the Fatty Lumpkin Presentation Tool. [short pause] If you can see this slide and hear this voice, then, well, everything on your Mac is working, and you're ready to make your first episode.

## SLIDE 2 — From an idea to a finished episode

So here's what happens next. You bring an idea, or some notes, or a whole script. We shape it into bullets and a deck where every slide moves, write a script that sounds like you, and then your avatar presents it. [short pause] And nothing costs money until you say yes.
`;

function createSampleProject(projectsDir, name = 'Hello FLPT') {
  const dir = path.join(projectsDir, 'Samples', name);
  return { dir, name };
}

/** Write the sample's script, deck and brief into a scaffolded project. Safe to call again. */
function writeSampleContent(projectDir) {
  const pres = path.join(projectDir, 'presentation');
  const deck = path.join(pres, 'deck', 'project');
  fs.mkdirSync(path.join(deck, 'slides'), { recursive: true });
  fs.writeFileSync(path.join(deck, 'deck.json'), JSON.stringify({ title: 'Hello FLPT', order: Object.keys(SLIDES), faces: [] }, null, 2));
  for (const [id, html] of Object.entries(SLIDES)) fs.writeFileSync(path.join(deck, 'slides', `${id}.html`), html + '\n');
  fs.writeFileSync(path.join(pres, 'script.md'), SCRIPT);
  fs.writeFileSync(path.join(pres, 'brief.md'), '# Brief\n\nThe setup wizard\'s two-slide sample: proves the toolchain and the pipeline for free.\n');
  return pres;
}

module.exports = { createSampleProject, writeSampleContent, SLIDES, SCRIPT };
