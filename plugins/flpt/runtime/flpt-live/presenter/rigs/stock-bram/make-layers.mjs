#!/usr/bin/env node
// Writes Bram's layered SVG rig (stock presenter 2 of 2 in 2.0: flat TV-cartoon, warm; Ada's sibling) into this folder.
// Every layer shares one 720×720 coordinate space, as Ada's do: head centre ≈ (360, 340), eye line y = 332 (46 %), mouth
// anchor (360, 446), neck pivot (360, 560). Bram adds three plain layers that ride on the head: glasses (over the eyes,
// under the brows), a moustache (over the mouth, so an open mouth tucks under it) and the beard on the head itself.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const C = {
  line: '#2C2420', skin: '#E9B892', skinShade: '#D59D78', blush: '#E08C76', ear: '#DDA581',
  hair: '#3B2A22', hairHi: '#56402F', hairShade: '#291D17', beard: '#4A3528', beardShade: '#3A2A20',
  sweater: '#5A6E3C', sweaterShade: '#4A5C31', shirt: '#F2EEE4', shirtShade: '#D9D2C2',
  iris: '#3F5A6B', pupil: '#1C1714', white: '#FFFDF8', frame: '#2C2420', lens: '#DCEAF0',
  lip: '#B8645A', lipLine: '#6E2E28', mouth: '#4A1A22', tongue: '#D9776D', teeth: '#FFFAF1', backdrop: '#DCE3D2',
};
const LW = 5; // outline width at 720 (about 2 px in the 300 px bubble)
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720" width="720" height="720">\n${body}\n</svg>\n`;
const stroke = (w = LW, col = C.line) => `stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const EYES = [{ cx: 298, cy: 332 }, { cx: 422, cy: 332 }];
const RX = 27, RY = 30;

const layers = {};

layers['backdrop.svg'] = svg(`<circle cx="360" cy="372" r="292" fill="${C.backdrop}"/>`);

layers['bust.svg'] = svg(`
<path d="M322,458 L398,458 L404,592 L316,592 Z" fill="${C.skin}" ${stroke()}/>
<path d="M322,470 Q360,520 398,470 L399,506 Q360,542 321,506 Z" fill="${C.skinShade}"/>
<path d="M50,720 C56,640 126,600 222,584 C262,577 294,570 316,562 L404,562 C426,570 458,577 498,584 C594,600 664,640 670,720 Z" fill="${C.sweater}" ${stroke()}/>
<path d="M118,720 C126,676 154,650 192,632" fill="none" ${stroke(4, C.sweaterShade)}/>
<path d="M602,720 C594,676 566,650 528,632" fill="none" ${stroke(4, C.sweaterShade)}/>
<path d="M300,566 Q360,640 420,566 L430,580 Q360,664 290,580 Z" fill="${C.sweaterShade}" ${stroke(4)}/>
<path d="M314,560 L360,616 L332,640 L296,578 Z" fill="${C.shirt}" ${stroke(4)}/>
<path d="M406,560 L360,616 L388,640 L424,578 Z" fill="${C.shirt}" ${stroke(4)}/>
<path d="M360,616 L360,660" ${stroke(3, C.shirtShade)}/>`);

layers['head.svg'] = svg(`
<ellipse cx="208" cy="356" rx="22" ry="34" fill="${C.ear}" ${stroke()}/>
<ellipse cx="512" cy="356" rx="22" ry="34" fill="${C.ear}" ${stroke()}/>
<path d="M206,350 C200,344 202,366 210,370" fill="none" ${stroke(3.5, '#B97F5E')}/>
<path d="M514,350 C520,344 518,366 510,370" fill="none" ${stroke(3.5, '#B97F5E')}/>
<path d="M360,180 C452,180 512,240 512,326 C512,420 462,512 360,512 C258,512 208,420 208,326 C208,240 268,180 360,180 Z" fill="${C.skin}" ${stroke()}/>
<path d="M214,360 C222,450 280,520 360,522 C440,520 498,450 506,360 C494,398 470,420 440,424 C420,404 392,396 360,396 C328,396 300,404 280,424 C250,420 226,398 214,360 Z" fill="${C.beard}" ${stroke()}/>
<ellipse cx="360" cy="448" rx="34" ry="19" fill="${C.skinShade}"/>
<path d="M300,486 C320,504 400,504 420,486" fill="none" ${stroke(3, C.beardShade)}/>
<ellipse cx="256" cy="396" rx="24" ry="13" fill="${C.blush}" opacity="0.35"/>
<ellipse cx="464" cy="396" rx="24" ry="13" fill="${C.blush}" opacity="0.35"/>
<path d="M364,356 C356,374 350,386 358,392 C362,394 368,393 372,390" fill="none" ${stroke(5, '#A8694E')}/>
<path d="M210,318 C200,222 262,158 362,158 C462,158 522,220 512,312 C506,292 498,276 488,264 C470,236 440,222 404,222 C372,222 336,234 300,236 C270,238 246,232 232,224 C222,250 214,282 210,318 Z" fill="${C.hair}" ${stroke()}/>
<path d="M210,318 C212,338 214,350 218,360 L228,352 C226,336 228,318 232,300 Z" fill="${C.hair}" ${stroke(4)}/>
<path d="M510,318 C508,338 506,350 502,360 L492,352 C494,336 492,318 488,300 Z" fill="${C.hair}" ${stroke(4)}/>
<path d="M266,196 C302,176 352,170 404,178" fill="none" ${stroke(6, C.hairHi)}/>
<path d="M300,236 C336,234 372,222 404,222" fill="none" ${stroke(4, C.hairShade)}/>`);

const whites = EYES.map(({ cx, cy }) => `<ellipse cx="${cx}" cy="${cy}" rx="${RX}" ry="${RY}" fill="${C.white}" ${stroke(4)}/>`).join('\n');
const lid = EYES.map(({ cx, cy }) => `<path d="M${cx - RX - 2},${cy - 6} C${cx - 18},${cy - RY - 4} ${cx + 18},${cy - RY - 4} ${cx + RX + 2},${cy - 6}" fill="none" ${stroke(6)}/>`).join('\n');
layers['eyes_open.svg'] = svg(`${whites}\n${lid}`);

// half: the upper lid drawn over the pupils, so it closes on them
layers['eyes_half.svg'] = svg(EYES.map(({ cx, cy }) => `
<path d="M${cx - RX - 3},${cy + 2} C${cx - RX - 3},${cy - RY - 8} ${cx + RX + 3},${cy - RY - 8} ${cx + RX + 3},${cy + 2} Q${cx},${cy + 10} ${cx - RX - 3},${cy + 2} Z" fill="${C.skinShade}"/>
<path d="M${cx - RX - 2},${cy + 2} Q${cx},${cy + 10} ${cx + RX + 2},${cy + 2}" fill="none" ${stroke(6)}/>`).join('\n'));

layers['eyes_closed.svg'] = svg(EYES.map(({ cx, cy }) => `
<path d="M${cx - RX},${cy + 2} Q${cx},${cy + 18} ${cx + RX},${cy + 2}" fill="none" ${stroke(6)}/>`).join('\n'));

layers['pupils.svg'] = svg(EYES.map(({ cx, cy }) => `
<circle cx="${cx}" cy="${cy + 3}" r="19" fill="${C.iris}"/>
<circle cx="${cx}" cy="${cy + 3}" r="10" fill="${C.pupil}"/>
<circle cx="${cx + 7}" cy="${cy - 5}" r="5.5" fill="${C.white}"/>`).join('\n'));

// round frames over the eyes, under the brows; the lenses barely tinted
layers['glasses.svg'] = svg(`
${EYES.map(({ cx, cy }) => `<circle cx="${cx}" cy="${cy + 2}" r="46" fill="${C.lens}" fill-opacity="0.18" ${stroke(6, C.frame)}/>`).join('\n')}
<path d="M344,326 Q360,316 376,326" fill="none" ${stroke(6, C.frame)}/>
<path d="M252,322 L220,314" ${stroke(6, C.frame)}/><path d="M468,322 L500,314" ${stroke(6, C.frame)}/>`);

layers['brows.svg'] = svg(`
<path d="M258,268 C276,254 304,250 330,258" fill="none" ${stroke(12, C.hairShade)}/>
<path d="M390,258 C416,250 444,254 462,268" fill="none" ${stroke(12, C.hairShade)}/>`);

// the moustache rides over the mouth: an open mouth tucks under it
layers['moustache.svg'] = svg(`
<path d="M360,420 C340,410 312,412 298,428 C306,438 324,440 340,434 C350,430 356,428 360,428 C364,428 370,430 380,434 C396,440 414,438 422,428 C408,412 380,410 360,420 Z" fill="${C.beard}" ${stroke(4)}/>`);

// Mouths: Rhubarb's A–H and X, plus smile and laugh, around the anchor (360, 446). Ada's shapes in Bram's colours.
const M = (d, fill = C.mouth) => `<path d="${d}" fill="${fill}" ${stroke(LW, C.lipLine)}/>`;
const teethTop = (d) => `<path d="${d}" fill="${C.teeth}"/>`;
const tongue = (d) => `<path d="${d}" fill="${C.tongue}"/>`;
layers['m_X.svg'] = svg(`<path d="M332,446 Q360,456 388,446" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_A.svg'] = svg(`<path d="M330,446 Q360,438 390,446 Q360,454 330,446 Z" fill="${C.lip}" ${stroke(4, C.lipLine)}/>
<path d="M332,446 Q360,449 388,446" fill="none" ${stroke(4, C.lipLine)}/>`);
layers['m_B.svg'] = svg(`${M('M326,440 Q360,432 394,440 Q391,458 360,460 Q329,458 326,440 Z')}
${teethTop('M333,441 Q360,435 387,441 L386,454 Q360,457 334,454 Z')}
<path d="M326,440 Q360,432 394,440 Q391,458 360,460 Q329,458 326,440 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_C.svg'] = svg(`${M('M328,436 Q360,428 392,436 Q394,470 360,476 Q326,470 328,436 Z')}
${teethTop('M335,437 Q360,431 385,437 L383,446 Q360,449 337,446 Z')}
${tongue('M340,468 Q360,455 380,468 Q360,476 340,468 Z')}
<path d="M328,436 Q360,428 392,436 Q394,470 360,476 Q326,470 328,436 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_D.svg'] = svg(`${M('M326,432 Q360,423 394,432 Q398,486 360,496 Q322,486 326,432 Z')}
${teethTop('M334,433 Q360,426 386,433 L384,443 Q360,446 336,443 Z')}
${tongue('M336,482 Q360,463 384,482 Q360,496 336,482 Z')}
<path d="M326,432 Q360,423 394,432 Q398,486 360,496 Q322,486 326,432 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_E.svg'] = svg(`${M('M336,438 Q360,430 384,438 Q390,466 360,472 Q330,466 336,438 Z')}
${teethTop('M342,439 Q360,434 378,439 L377,445 Q360,447 343,445 Z')}
${tongue('M344,464 Q360,455 376,464 Q360,472 344,464 Z')}
<path d="M336,438 Q360,430 384,438 Q390,466 360,472 Q330,466 336,438 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_F.svg'] = svg(`<ellipse cx="360" cy="450" rx="17" ry="19" fill="${C.lip}" ${stroke(LW, C.lipLine)}/>
<ellipse cx="360" cy="451" rx="7" ry="9" fill="${C.mouth}"/>`);
layers['m_G.svg'] = svg(`${M('M330,442 Q360,436 390,442 Q387,457 360,459 Q333,457 330,442 Z')}
${teethTop('M337,442 Q360,438 383,442 L381,452 Q360,455 339,452 Z')}
<path d="M334,452 Q360,464 386,452" fill="none" ${stroke(6, C.lip)}/>
<path d="M332,454 Q360,468 388,454" fill="none" ${stroke(4, C.lipLine)}/>`);
layers['m_H.svg'] = svg(`${M('M330,436 Q360,429 390,436 Q392,468 360,474 Q328,468 330,436 Z')}
${teethTop('M337,437 Q360,432 383,437 L382,444 Q360,446 338,444 Z')}
${tongue('M342,470 Q346,448 360,446 Q374,448 378,470 Z')}
<path d="M330,436 Q360,429 390,436 Q392,468 360,474 Q328,468 330,436 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_smile.svg'] = svg(`<path d="M322,440 Q360,470 398,440" fill="none" ${stroke(LW + 1, C.lipLine)}/>`);
layers['m_laugh.svg'] = svg(`${M('M318,434 Q360,429 402,434 Q396,490 360,496 Q324,490 318,434 Z')}
${teethTop('M326,435 Q360,431 394,435 L391,447 Q360,450 329,447 Z')}
${tongue('M338,484 Q360,465 382,484 Q360,496 338,484 Z')}
<path d="M318,434 Q360,429 402,434 Q396,490 360,496 Q324,490 318,434 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);

const MOUTH_SCALE = 1.25;
for (const [name, body] of Object.entries(layers)) {
  let out = body;
  if (name.startsWith('m_')) out = body.replace(/(<svg[^>]*>\n)([\s\S]*)(\n<\/svg>)/, `$1<g transform="translate(360 446) scale(${MOUTH_SCALE}) translate(-360 -446)">$2</g>$3`);
  writeFileSync(join(DIR, name), out);
}
console.log(`wrote ${Object.keys(layers).length} layers to ${DIR}`);
