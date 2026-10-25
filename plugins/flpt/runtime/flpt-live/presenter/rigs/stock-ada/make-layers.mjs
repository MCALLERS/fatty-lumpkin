#!/usr/bin/env node
// FLPT K7: writes Ada's layered SVG rig (stock presenter, flat TV-cartoon, warm) into this folder.
// Every layer shares one 720×720 coordinate space, so the drawer places each at (0, 0) under its transform.
// Head centre ≈ (360, 340), eye line y = 332 (46 %), mouth anchor (360, 446), neck pivot (360, 560).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const C = {
  line: '#3A2620', skin: '#F4C7A5', skinShade: '#E6AC8C', blush: '#EE9483',
  hair: '#6E3B2A', hairHi: '#8D5139', hairShade: '#552C1F',
  top: '#E8B04A', topShade: '#CF9636', cardigan: '#3F7D78', cardiganShade: '#336A66',
  iris: '#5B3527', pupil: '#24140F', white: '#FFFDF8',
  lip: '#C9665C', lipLine: '#7E322C', mouth: '#4A1822', tongue: '#DE7A70', teeth: '#FFFAF1', backdrop: '#EBDDCB',
};
const LW = 5; // outline width at 720 (≈ 2 px in the 300 px bubble)
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720" width="720" height="720">\n${body}\n</svg>\n`;
const stroke = (w = LW, col = C.line) => `stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const EYES = [{ cx: 298, cy: 332 }, { cx: 422, cy: 332 }];
const RX = 30, RY = 34;

const layers = {};

layers['backdrop.svg'] = svg(`<circle cx="360" cy="372" r="292" fill="${C.backdrop}"/>`);

layers['bust.svg'] = svg(`
<path d="M326,462 L394,462 L400,590 L320,590 Z" fill="${C.skin}" ${stroke()}/>
<path d="M326,474 Q360,520 394,474 L395,506 Q360,540 325,506 Z" fill="${C.skinShade}"/>
<path d="M62,720 C66,642 132,604 226,588 C266,581 296,574 318,566 L402,566 C424,574 454,581 494,588 C588,604 654,642 658,720 Z" fill="${C.cardigan}" ${stroke()}/>
<path d="M126,720 C134,676 160,652 196,636" fill="none" ${stroke(4, C.cardiganShade)}/>
<path d="M594,720 C586,676 560,652 524,636" fill="none" ${stroke(4, C.cardiganShade)}/>
<path d="M296,568 L360,700 L424,568 Z" fill="${C.top}" ${stroke()}/>
<path d="M300,570 Q360,616 420,570 L434,584 Q360,640 286,584 Z" fill="${C.topShade}" ${stroke(4)}/>
<path d="M360,700 L360,720" ${stroke(4)}/>
<circle cx="398" cy="664" r="6" fill="${C.top}" ${stroke(3)}/>
<circle cx="404" cy="706" r="6" fill="${C.top}" ${stroke(3)}/>`);

layers['head.svg'] = svg(`
<path d="M360,136 C490,136 554,222 552,336 C551,412 546,464 518,488 C498,505 470,502 452,490 L268,490 C250,502 222,505 202,488 C174,464 169,412 168,336 C166,222 230,136 360,136 Z" fill="${C.hair}" ${stroke()}/>
<path d="M200,470 C188,440 184,400 186,360" fill="none" ${stroke(4, C.hairShade)}/>
<path d="M520,470 C532,440 536,400 534,360" fill="none" ${stroke(4, C.hairShade)}/>
<path d="M360,176 C452,176 510,238 510,324 C510,414 456,506 360,506 C264,506 210,414 210,324 C210,238 268,176 360,176 Z" fill="${C.skin}" ${stroke()}/>
<ellipse cx="258" cy="408" rx="30" ry="17" fill="${C.blush}" opacity="0.5"/>
<ellipse cx="462" cy="408" rx="30" ry="17" fill="${C.blush}" opacity="0.5"/>
<g fill="#C9826A"><circle cx="246" cy="396" r="2.6"/><circle cx="258" cy="390" r="2.6"/><circle cx="268" cy="398" r="2.6"/>
<circle cx="474" cy="396" r="2.6"/><circle cx="462" cy="390" r="2.6"/><circle cx="452" cy="398" r="2.6"/></g>
<path d="M364,362 C356,380 350,392 358,398 C362,400 368,399 372,396" fill="none" ${stroke(5, '#B9775C')}/>
<path d="M206,322 C196,214 262,146 362,146 C464,146 524,212 514,306 C502,272 484,250 456,241 C420,232 382,237 346,252 C302,270 258,280 234,266 C222,284 212,302 206,322 Z" fill="${C.hair}" ${stroke()}/>
<path d="M262,202 C300,176 360,168 410,178" fill="none" ${stroke(6, C.hairHi)}/>
<path d="M346,252 C384,238 424,236 456,244" fill="none" ${stroke(4, C.hairShade)}/>`);

const whites = EYES.map(({ cx, cy }) => `<ellipse cx="${cx}" cy="${cy}" rx="${RX}" ry="${RY}" fill="${C.white}" ${stroke(4)}/>`).join('\n');
const lash = EYES.map(({ cx, cy }) => `<path d="M${cx - RX - 2},${cy - 4} C${cx - 20},${cy - RY - 6} ${cx + 20},${cy - RY - 6} ${cx + RX + 2},${cy - 4}" fill="none" ${stroke(7)}/>`).join('\n');
layers['eyes_open.svg'] = svg(`${whites}\n${lash}`);

// half: the upper lid (skin) drawn OVER the pupils, so it closes on them
layers['eyes_half.svg'] = svg(EYES.map(({ cx, cy }) => `
<path d="M${cx - RX - 3},${cy + 2} C${cx - RX - 3},${cy - RY - 8} ${cx + RX + 3},${cy - RY - 8} ${cx + RX + 3},${cy + 2} Q${cx},${cy + 12} ${cx - RX - 3},${cy + 2} Z" fill="${C.skinShade}"/>
<path d="M${cx - RX - 2},${cy + 2} Q${cx},${cy + 12} ${cx + RX + 2},${cy + 2}" fill="none" ${stroke(7)}/>`).join('\n'));

layers['eyes_closed.svg'] = svg(EYES.map(({ cx, cy }) => `
<path d="M${cx - RX},${cy + 2} Q${cx},${cy + 20} ${cx + RX},${cy + 2}" fill="none" ${stroke(7)}/>
<path d="M${cx - RX - 2},${cy + 4} L${cx - RX - 10},${cy - 2}" ${stroke(4)}/>`).join('\n'));

layers['pupils.svg'] = svg(EYES.map(({ cx, cy }) => `
<circle cx="${cx}" cy="${cy + 4}" r="23" fill="${C.iris}"/>
<circle cx="${cx}" cy="${cy + 4}" r="12" fill="${C.pupil}"/>
<circle cx="${cx + 8}" cy="${cy - 5}" r="6.5" fill="${C.white}"/>
<circle cx="${cx - 7}" cy="${cy + 13}" r="3" fill="${C.white}" opacity="0.8"/>`).join('\n'));

layers['brows.svg'] = svg(`
<path d="M266,282 C280,268 304,264 326,272" fill="none" ${stroke(10, C.hairShade)}/>
<path d="M394,272 C416,264 440,268 454,282" fill="none" ${stroke(10, C.hairShade)}/>`);

// Mouths: Rhubarb's A–H and X, plus smile and laugh, around the anchor (360, 446).
const M = (d, fill = C.mouth) => `<path d="${d}" fill="${fill}" ${stroke(LW, C.lipLine)}/>`;
const teethTop = (d) => `<path d="${d}" fill="${C.teeth}"/>`;
const tongue = (d) => `<path d="${d}" fill="${C.tongue}"/>`;
layers['m_X.svg'] = svg(`<path d="M330,446 Q360,458 390,446" fill="none" ${stroke(LW, C.lipLine)}/>
<path d="M326,442 Q328,447 332,448" fill="none" ${stroke(3, C.lipLine)}/><path d="M394,442 Q392,447 388,448" fill="none" ${stroke(3, C.lipLine)}/>`);
layers['m_A.svg'] = svg(`<path d="M328,446 Q360,436 392,446 Q360,456 328,446 Z" fill="${C.lip}" ${stroke(4, C.lipLine)}/>
<path d="M330,446 Q360,450 390,446" fill="none" ${stroke(4, C.lipLine)}/>`);
layers['m_B.svg'] = svg(`${M('M324,440 Q360,431 396,440 Q393,460 360,462 Q327,460 324,440 Z')}
${teethTop('M331,441 Q360,434 389,441 L388,455 Q360,458 332,455 Z')}
<path d="M333,448 Q360,451 387,448" fill="none" stroke="#D9CEC2" stroke-width="2"/>
<path d="M324,440 Q360,431 396,440 Q393,460 360,462 Q327,460 324,440 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_C.svg'] = svg(`${M('M326,436 Q360,427 394,436 Q396,472 360,478 Q324,472 326,436 Z')}
${teethTop('M333,437 Q360,430 387,437 L385,447 Q360,450 335,447 Z')}
${tongue('M338,470 Q360,456 382,470 Q360,478 338,470 Z')}
<path d="M326,436 Q360,427 394,436 Q396,472 360,478 Q324,472 326,436 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_D.svg'] = svg(`${M('M324,432 Q360,422 396,432 Q400,488 360,498 Q320,488 324,432 Z')}
${teethTop('M332,433 Q360,425 388,433 L386,444 Q360,447 334,444 Z')}
${tongue('M334,484 Q360,464 386,484 Q360,498 334,484 Z')}
<path d="M324,432 Q360,422 396,432 Q400,488 360,498 Q320,488 324,432 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_E.svg'] = svg(`${M('M334,438 Q360,429 386,438 Q392,468 360,474 Q328,468 334,438 Z')}
${teethTop('M340,439 Q360,433 380,439 L379,446 Q360,448 341,446 Z')}
${tongue('M342,466 Q360,456 378,466 Q360,474 342,466 Z')}
<path d="M334,438 Q360,429 386,438 Q392,468 360,474 Q328,468 334,438 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_F.svg'] = svg(`<ellipse cx="360" cy="450" rx="18" ry="20" fill="${C.lip}" ${stroke(LW, C.lipLine)}/>
<ellipse cx="360" cy="451" rx="8" ry="10" fill="${C.mouth}"/>
<path d="M346,438 Q350,442 348,446 M374,438 Q370,442 372,446" fill="none" ${stroke(2.5, C.lipLine)}/>`);
layers['m_G.svg'] = svg(`${M('M328,442 Q360,435 392,442 Q389,458 360,460 Q331,458 328,442 Z')}
${teethTop('M335,442 Q360,437 385,442 L383,453 Q360,456 337,453 Z')}
<path d="M332,453 Q360,466 388,453" fill="none" ${stroke(6, C.lip)}/>
<path d="M328,442 Q360,435 392,442" fill="none" ${stroke(LW, C.lipLine)}/>
<path d="M330,455 Q360,470 390,455" fill="none" ${stroke(4, C.lipLine)}/>`);
layers['m_H.svg'] = svg(`${M('M328,436 Q360,428 392,436 Q394,470 360,476 Q326,470 328,436 Z')}
${teethTop('M335,437 Q360,431 385,437 L384,445 Q360,447 336,445 Z')}
${tongue('M340,472 Q344,448 360,446 Q376,448 380,472 Z')}
<path d="M328,436 Q360,428 392,436 Q394,470 360,476 Q326,470 328,436 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);
layers['m_smile.svg'] = svg(`<path d="M318,438 Q360,474 402,438" fill="none" ${stroke(LW + 1, C.lipLine)}/>
<path d="M314,432 Q316,440 322,442" fill="none" ${stroke(3.5, C.lipLine)}/><path d="M406,432 Q404,440 398,442" fill="none" ${stroke(3.5, C.lipLine)}/>`);
layers['m_laugh.svg'] = svg(`${M('M316,434 Q360,428 404,434 Q398,492 360,498 Q322,492 316,434 Z')}
${teethTop('M324,435 Q360,430 396,435 L393,448 Q360,451 327,448 Z')}
${tongue('M336,486 Q360,466 384,486 Q360,498 336,486 Z')}
<path d="M316,434 Q360,428 404,434 Q398,492 360,498 Q322,492 316,434 Z" fill="none" ${stroke(LW, C.lipLine)}/>`);

const MOUTH_SCALE = 1.3;
for (const [name, body] of Object.entries(layers)) {
  let out = body;
  if (name.startsWith('m_')) out = body.replace(/(<svg[^>]*>\n)([\s\S]*)(\n<\/svg>)/, `$1<g transform="translate(360 446) scale(${MOUTH_SCALE}) translate(-360 -446)">$2</g>$3`);
  writeFileSync(join(DIR, name), out);
}
console.log(`wrote ${Object.keys(layers).length} layers to ${DIR}`);
