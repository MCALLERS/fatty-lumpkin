# Night Shift

A dark stage shot on film, for the cuts between a talk's parts: interstitials (music-led, unnarrated, or narrated) and code cut scenes. Bone serif that sets in, mono chips that label and time things, sodium light, ember leaks, grain. FLPT original (MIT). On ones.

## Palette (each colour keeps one meaning)
- **Night** `#0B0D12` the ground: lifted at the centre, a sodium streetlight's pool and shaft high right.
- **Bone** `#ECE3D2` words. **Steel** `#8E99AB` secondary lines, far numerals. **Dim** `#2A303C` rules.
- **Sodium** `#F4A340` time and counts (clocks, a number that lands, chip outlines). **Ember** `#E8562A` light only (leaks, halation). **Dawn** `#F7C98B` the end of the night.
- Cyan, magenta, yellow only for print plates. Never a fourth accent.

## Type
- **Display** (Fraunces 144 pt SemiBold, `face:'display'`) for headlines, 120–210 px, tight; at most two lines.
- **Kinetic italic** (Fraunces Italic, wonky, `face:'italic'`): the one word that moves (`K.cascade`), 54–210 px.
- **Black** (Fraunces Soft Black, `face:'black'`): what lands (`K.slam`): a time, a number, two words. One per piece, two at most.
- **Mono** (IBM Plex Mono SemiBold, `face:'mono'`): chips and clocks, 24–32 px, upper case, tracked.
- Hierarchy per frame: chip → headline → one quiet line. Big type gets a red halation by itself (`halo`).

## Motion
- **set-in** (`K.strips`): a headline arrives in slices from alternate sides and clicks into register; `out` sends it back.
- **cascade**: letters fall in one by one. Slow (`stagger 0.12, preset 'heavy'`) is the kinetic moment of a piece.
- **slam**: lands from 1.25–1.7×, three frames of trail, a leak flare (`finish({ boost })`), a camera jolt.
- **roll**: digits flip once, right to left; `K.clock` puts them in a chip; ghost numerals (`stroke`) roll far back, only where a frame is otherwise empty.
- **rack** (`K.focus`): the layer you leave goes soft as the camera pushes past it.
- **burn**: light floods from a source (`finish({ flash, flashAt })`: the picture added to itself, so highlights clip first, and a white-hot core spreading), 0.5 s up, 0.5 s down, to change place without a hard cut.
- Springs over eases for anything with mass; land on the word (anticipate 0.03–0.2 s), then hold. Nothing just fades in.

## Camera
One world travelled: push in on the subject, pull back to reveal (`K.para` far layers at depth 0.5–0.6 move less), push through. At most one hard cut (two frames of over-exposure from the lamp, `flash` 0.85 then 0.5). `K.weave()` goes into every camera's `to`. End on the opening framing, changed.

## The film pass (always last, screen space)
`K.ground(g, { warm, lamp })` first; `K.finish(g, { boost, flash })` last: ambient leaks (right edge ember, top sodium, breathing), vignette, grain (coarse, a new tile and offset every frame), a 3 % exposure flicker, dust, a hair in the gate now and then. `K.letterbox(g, u)` for a cut scene's bars.

## Layout and the Duet
Safe area 64 px. Text blocks share one left edge, 176 px in a Solo. `K.zone().left(y)` gives the edge as a Duet: the presenter's corner (x 0–380, y 700–1080) holds no word, no dust, no hair; leaks stay right and top. Pin a full-size chip to a world thing with `K.anchor(cam, x, y)`.

## Kit (FLPT.styles['night-shift'], ctx.kit)
`ground` · `finish` · `leak` · `leaks` · `flash` · `vignette` · `grain` · `dust` · `weave` · `letterbox` · `type` · `strips` · `cascade` · `slam` · `chip` · `roll` · `clock` · `rule` · `frame` · `lines` (greeked copy: bars, never words) · `streaks` · `para` · `anchor` · `focus` · `zone` · `FONT` · `FACE` · `rgba(name, a)`. Every word goes through these (or `ctx.text`), so the checks see it.

## Sound
Score `pulse-112` (an 8th is 8 frames: cut on it); effects `on`. Interstitial beats take `at: "bar 2"`. Good hits: `pop` chip, `swish` set-in, `thump` slam, `sub` + `crack` the hard cut, `riser` ending on the slam, `chime` dawn.

## Each frame, before it's done
One constant the eye holds? Things made of something (newsprint, steel, wood), lit from the lamp's side, with a shadow? The beat's change on its word? A camera move in the last two seconds? Grain, weave and a leak visible at phone size? Halation only on big type? Chips label, never instruct? No word in the bubble corner (read the check, not your eye)? Every number from the script?

## Measured (W2-09, an M-series Mac, the pinned toolchain)
- Draw cost, one worker, CPU raster: starter 32.2 ms mean (36 p95), the 26 s showcase 44.6 ms (58.5 p95; its paper, steel and halftone are made once in setup). HyperFrames, 4 workers: the showcase's 788 frames in 42 s. `cost.msPerFrame` 38.
- Determinism: starter, demo and showcase drawn at 24 frames in two fresh pages, in order and shuffled: identical. Deep lint clean. Hold 61.5 dB.
- Contrast on night: bone 15.3:1, dawn 12.7, sodium 9.4, steel 6.8, ember 5.4 (light only).
- Ground luma ≈ 27/255 at the centre, grain ±7 levels; dawn lifts the end to ≈ 119.
- Duet: no word in the corner (demo, and starter and showcase placed as Duets; the showcase 0 of 767 boxes at 262 times); corner edge density ≤ 1.03× the frame's median.
- Sound: showcase bed (pulse-112) 12.4 LU under a −20 LUFS voice, final −16.1 LUFS, −1.2 dBTP; starter stem −21.0 LUFS, −3.4 dBTP.
- Media: poster 68.1 kB, tall 55.7 kB; loops 7 s with the score, 783 kB and 917 kB.

## Not matched
- Letters of a moving word sit at prefix widths: pair kerning is exact only once it lands.
- Halation blurs the type's own outline; other bright things (leaks, pages) don't bloom.
- Rack focus is a quarter-size blur, not lens bokeh. No true motion blur: speed shows as streaks and a three-frame trail.
- Grain is luminance only. The Gallery's 4:5 crop is the centre (x 528–1392): keep a piece's key words inside it.

## Notes
- Pass 1 (first stills and render): the opening faded in on an empty frame; the grid of pages had no anchor and 40 % dead frame; the plates ran off the top, the 4 off the left; 00:00 sat centred on the gradient; the cut flashed full white; a canvas-filter rack cost 3.8 s a frame (8 min render). Fixed: the hour ticks 21:57 → 22:00 on "Ten" and flies into its chip; the grid fills the frame; plates refit; 00:00 climbs to the clock's home; a 2-frame flash; the rack drawn at quarter size (45 ms a frame).
- Pass 2: next to K6's parchment and dots the ground read as a flat gradient; the grid still had no anchor; the hall's top half was empty; the landing flash greyed the frame. Fixed: a sodium streetlight pool and shaft, coarser grain with a 3 % exposure flicker, page one framed bright, a ghost 00 raised into the hall by the tilt, no landing flash.
- Pass 3: the ghost 00 peeked behind "flat out"; clocks rolled through impossible times (89:?0); the starter's tall poster cut its title; the Duet put the 4 and a whip in the corner. Fixed: the ghost lowered, digits flip once, the starter's block inside the centre crop, Duet positions from `K.zone()` checked at 60 times.
- Pass 4 (after review: placeholder geometry next to K6 and Ledger): pages read as loading skeletons, the press as hairlines, bundles as flat bars, the trucks as a smudge; dead frames at 0–1.5, 15 and 19–21 s; wire ghost numerals; greige washes for the cut and the burn. Fixed: newsprint made once in setup (tooth, fibre, Fraunces mastheads and heads, word-shaped greek in columns, CMYK halftone at its screen angles) on a lamp-lit desk with shadows, a cup, a pencil and a rule; film plates with registration marks; a press with mass (machined cylinders, a drive gear, teeth and bolts that smear with speed, the web carrying the night's pages, the camera riding it); a belt of printed papers, bundles with a top sheet, twine and shadows; a lettered truck with ember tail-lights leaving a dawn dock; the hour bookends at 06:00; additive burns, highlights clipping first.
