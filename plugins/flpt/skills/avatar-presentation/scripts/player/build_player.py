#!/usr/bin/env python3
"""Build the Loom-style player page (index.html + media/) from the video pipeline's web output.

Run after `generate_presentation_video.py --web` (draft or final). It reads:
  ../video/output/web/parts.json   part files, chapter timings (slides + cut scenes), draft flag
  ../script.md                     narration, shown as the synced transcript (delivery tags removed)
  ../deck/project/deck.json        section outline, used to group chapters (optional)
  ./player_config.json             page title, eyebrow, subtitle, deck link (created with defaults if missing)
and writes index.html plus media/ (the parts and a poster frame) next to this file.
Publish index.html with media/* as supporting files (each part is < 14 MB).

Path overrides (for fixtures or other layouts):
  --web DIR  --script FILE  --deck DIR|deck.json  --slides-dir DIR  --out DIR  --config FILE
"""
import argparse, html, json, os, re, shutil, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
PRES = os.path.dirname(HERE)
DEFAULT_CONFIG = {
    "page_title": "Talk Recording",          # <title>: a 2–4 word name for the gallery
    "title": "Talk title",                   # the H1 shown on the page
    "eyebrow": "Team meeting",               # small label above the title
    "subtitle": "One-line description of the talk",
    "deck_url": "",                          # the Slides artifact link; leave "" to hide the link
    "links": [],                             # optional extra links: [{"label", "text", "url"}] (https only)
    "media_note": "",                        # replaces the disclosure's "cut scenes are AI-generated" sentence,
                                             # e.g. to also cover cartoons or archival footage
}
SLIDE_RE = re.compile(r"^\s{0,3}#{1,6}\s*SLIDE\s+(\d+)\b.*$", re.I)
CUT_RE = re.compile(r"^\s{0,3}#{1,6}\s*CUT[ _-]?SCENE\s+([A-Za-z0-9][\w-]*).*$", re.I)
# Delivery tags ([pause], [laughs], <sigh>, <break time="1s"/>) are for the voice, not the transcript.
TAG_RE = re.compile(r"<\s*break\b[^>]*>|\[\s*[A-Za-z][A-Za-z' \-]{0,38}\s*\]|<\s*[A-Za-z][A-Za-z' \-]{0,38}?\s*/?\s*>")


def load_config(path):
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_CONFIG, f, indent=1)
        print(f"  ! wrote {path} with placeholder text; edit it and run again")
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(json.load(open(path, encoding="utf-8")))
    return cfg


def clean_para(p):
    p = TAG_RE.sub(" ", p)
    p = re.sub(r"\*\*|__|`", "", p)
    p = re.sub(r"\s+", " ", p).strip()
    return re.sub(r" +([,.;:!?])", r"\1", p)


def narration(script):
    """{("slide", n) | ("cutscene", id): [paragraphs]} from script.md."""
    out, key, buf = {}, None, []

    def flush():
        if key is None:
            return
        text = re.sub(r"<!--.*?-->", "", "\n".join(buf), flags=re.S)
        lines = [l for l in text.splitlines() if not l.lstrip().startswith(">") and not re.match(r"^\s*#{1,6}\s", l)]
        paras = [clean_para(p) for p in "\n".join(lines).split("\n\n")]
        out[key] = [p for p in paras if p and not re.fullmatch(r"-{3,}|\*{3,}|_{3,}", p)]

    for line in open(script, encoding="utf-8-sig").read().splitlines():
        m, c = SLIDE_RE.match(line), CUT_RE.match(line)
        if m or c:
            flush()
            key, buf = (("slide", int(m.group(1))) if m else ("cutscene", c.group(1).strip("-_").lower())), []
        elif key is not None:
            buf.append(line)
    flush()
    return out


def deck_sections(deck):
    """{slide number: section description} from deck.json, if there is one."""
    path = os.path.join(deck, "deck.json") if os.path.isdir(deck) else deck
    if not os.path.isfile(path):
        return {}
    d = json.load(open(path, encoding="utf-8"))
    order = d.get("order") or []
    return {order.index(s["start"]) + 1: s.get("description", "")
            for s in (d.get("sections") or {}).values() if s.get("start") in order}


def main():
    ap = argparse.ArgumentParser(description="Build the player page from the video pipeline's web output.")
    ap.add_argument("--web", default=os.path.join(PRES, "video", "output", "web"), help="folder with parts.json")
    ap.add_argument("--script", default=os.path.join(PRES, "script.md"))
    ap.add_argument("--deck", default=os.path.join(PRES, "deck", "project"), help="deck folder or deck.json")
    ap.add_argument("--slides-dir", default=os.path.join(PRES, "slides"), help="for the draft poster (slide_01.png)")
    ap.add_argument("--out", default=HERE, help="where index.html + media/ go (default: this folder)")
    ap.add_argument("--config", help="player_config.json (default: <out>/player_config.json)")
    a = ap.parse_args()
    web, out = os.path.abspath(a.web), os.path.abspath(a.out)
    media = os.path.join(out, "media")

    parts = json.load(open(os.path.join(web, "parts.json"), encoding="utf-8"))
    starts = deck_sections(a.deck)
    notes = narration(a.script)

    os.makedirs(media, exist_ok=True)
    for f in os.listdir(media):
        if f.startswith("part_"):
            os.remove(os.path.join(media, f))
    for p in parts["parts"]:
        shutil.copy2(os.path.join(web, p["file"]), os.path.join(media, p["file"]))
    # Poster: a frame of the final video (shows the presenter bubble); the cover slide for a draft.
    src = os.path.join(os.path.dirname(web), parts.get("source", ""))
    cover = os.path.join(a.slides_dir, "slide_01.png")
    if not parts["draft"] and os.path.isfile(src):
        cmd = ["-ss", "3", "-i", src, "-frames:v", "1"]
    elif os.path.isfile(cover):
        cmd = ["-i", cover]
    else:
        cmd = ["-ss", "1", "-i", os.path.join(web, parts["parts"][0]["file"]), "-frames:v", "1"]
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *cmd, "-vf", "scale=1280:720", "-q:v", "3",
                    os.path.join(media, "poster.jpg")], check=True)

    # Chapters: slides and cut scenes in play order (older parts.json files only list slides).
    rows = parts.get("chapters") or [{**s, "kind": "slide"} for s in parts["slides"]]
    chapters = []
    for r in rows:
        if r.get("kind") == "cutscene":
            title = r.get("title") or f"Cut scene {r.get('id')}"
            chapters.append({"kind": "cutscene", "id": r.get("id"), "title": title,
                             "label": r.get("label") or f"Cut scene: {title}", "start": r["start"],
                             "duration": r["duration"], "section": None,
                             "text": notes.get(("cutscene", str(r.get("id")).lower()), [])})
        else:
            chapters.append({"kind": "slide", "n": r["n"], "title": r["title"], "label": f"{r['n']}. {r['title']}",
                             "start": r["start"], "duration": r["duration"], "section": starts.get(r["n"]),
                             "text": notes.get(("slide", r["n"]), [])})
    n_slides = sum(1 for c in chapters if c["kind"] == "slide")
    n_cuts = len(chapters) - n_slides
    data = {
        "draft": parts["draft"],
        "total": parts["total_duration"],
        "parts": [{"file": p["file"], "start": p["start"], "duration": p["duration"]} for p in parts["parts"]],
        "slides": chapters,
        "nSlides": n_slides,
    }
    cfg = load_config(a.config or os.path.join(out, "player_config.json"))
    data["mediaNote"] = cfg.get("media_note", "")
    page = TEMPLATE.replace("__DATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    deck_link = (f'<span>Slides: <a href="{html.escape(cfg["deck_url"])}" target="_blank" rel="noopener">open the deck</a></span>'
                 if cfg.get("deck_url") else "")
    # optional extra links beside the deck link, e.g. "links": [{"label": "Paper", "text": "arXiv 2610.11715", "url": "https://…"}]
    for ln in cfg.get("links") or []:
        if str(ln.get("url", "")).startswith("https://"):
            deck_link += (f' <span>{html.escape(ln.get("label", "Link"))}: <a href="{html.escape(ln["url"])}" target="_blank" '
                          f'rel="noopener">{html.escape(ln.get("text") or ln["url"])}</a></span>')
    for k, v in (("__PAGE_TITLE__", cfg["page_title"]), ("__TITLE__", cfg["title"]),
                 ("__EYEBROW__", cfg["eyebrow"]), ("__SUBTITLE__", cfg["subtitle"])):
        page = page.replace(k, html.escape(v))
    count = f"{n_slides} slides" + (f" · {n_cuts} cut scene{'s' if n_cuts > 1 else ''}" if n_cuts else "")
    page = page.replace("__DECK_LINK__", deck_link).replace("__N_SLIDES__", count)
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    mb = sum(os.path.getsize(os.path.join(media, p["file"])) for p in parts["parts"]) / 1e6
    print(f"index.html written · {len(chapters)} chapters ({count}) · {len(parts['parts'])} parts ({mb:.1f} MB) · "
          f"{'DRAFT' if parts['draft'] else 'FINAL'}")


TEMPLATE = r"""<title>__PAGE_TITLE__</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Source+Serif+4:opsz,wght@8..60,600&display=swap">
<style>
  /* Single dark "screening room" look, chosen deliberately for a video page. */
  :root {
    color-scheme: dark;
    --bg: #11161D;
    --stage: #0B0F14;
    --panel: #18202A;
    --panel-2: #1F2935;
    --line: #2B3644;
    --text: #ECE8E0;
    --muted: #9BA5B1;
    --faint: #6E7986;
    --accent: #E7A1B5;      /* the deck's oxblood, lifted for dark ground */
    --accent-ink: #2A0F18;
    --blue: #8FB8DA;
    --amber: #E0B26E;
    --serif: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    --sans: 'IBM Plex Sans', -apple-system, 'Segoe UI', Arial, sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { background: var(--bg); color: var(--text); font: 15px/1.55 var(--sans); }
  a { color: var(--blue); }
  a:hover { color: var(--text); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .wrap { max-width: 1280px; margin: 0 auto; padding-inline: 20px; padding-block: 28px 64px; display: flex; flex-direction: column; gap: 24px; }

  header { display: flex; flex-direction: column; gap: 10px; }
  .eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  h1 { margin: 0; font: 600 clamp(28px, 4.2vw, 44px)/1.1 var(--serif); text-wrap: balance; letter-spacing: -.005em; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; color: var(--muted); font-size: 14px; }
  .meta .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--faint); }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; letter-spacing: .02em; }
  .chip.draft { background: #3A2A12; color: var(--amber); }
  .chip.final { background: #173024; color: #9ED2B4; }
  .chip i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; align-items: start; }
  .main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

  .player { background: var(--stage); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .screen { position: relative; aspect-ratio: 16 / 9; max-width: 100%; background: var(--stage); }
  .screen video { position: absolute; inset: 0; width: 100%; height: 100%; display: block; background: #000; }
  .bigplay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, rgba(11,15,20,0) 40%, rgba(11,15,20,.55)); border: 0; cursor: pointer; color: var(--text); font: inherit; }
  .bigplay .pill { display: inline-flex; align-items: center; gap: 12px; padding: 14px 22px 14px 18px; border-radius: 999px; background: rgba(17,22,29,.88); border: 1px solid var(--line); font-weight: 600; font-size: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.35); }
  .bigplay svg { width: 22px; height: 22px; fill: var(--accent); }
  .bigplay:hover .pill { border-color: var(--accent); }

  .controls { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px 12px; border-top: 1px solid var(--line); }
  .bar { position: relative; height: 22px; }
  .ticks { position: absolute; left: 0; right: 0; top: 50%; height: 6px; transform: translateY(-50%); border-radius: 3px; background: var(--panel-2); overflow: hidden; pointer-events: none; }
  .ticks .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); width: 0; }
  .ticks .tick { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--stage); }
  #seek { position: absolute; inset: 0; width: 100%; margin: 0; background: transparent; -webkit-appearance: none; appearance: none; cursor: pointer; }
  #seek::-webkit-slider-runnable-track { height: 22px; background: transparent; }
  #seek::-moz-range-track { height: 22px; background: transparent; }
  #seek::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: 4px; border-radius: 50%; background: var(--text); border: 2px solid var(--accent); }
  #seek::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--text); border: 2px solid var(--accent); }
  .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; min-width: 34px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--text); font: 500 13px var(--sans); cursor: pointer; }
  .btn:hover { border-color: var(--faint); }
  .btn svg { width: 16px; height: 16px; fill: currentColor; }
  .time { font: 500 13px var(--mono); font-variant-numeric: tabular-nums; color: var(--muted); }
  .time b { color: var(--text); font-weight: 500; }
  .now { flex: 1; min-width: 0; color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .now b { color: var(--text); font-weight: 600; }
  select.btn { padding-right: 8px; }

  .notice { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 10px; background: #2A2314; border: 1px solid #4A3A1A; color: #E9D9B8; font-size: 14px; }
  .notice.final { background: var(--panel); border-color: var(--line); color: var(--muted); }
  .notice strong { color: var(--text); }

  .transcript { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
  .transcript h2 { margin: 0; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); font-weight: 600; display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .transcript h3 { margin: 0; font: 600 20px/1.25 var(--serif); text-wrap: balance; }
  .transcript p { margin: 0; max-width: 68ch; color: #D6D1C7; }
  .transcript .all { display: flex; flex-direction: column; gap: 18px; border-top: 1px solid var(--line); padding-top: 14px; }
  .transcript .all h4 { margin: 0 0 4px; font: 600 15px var(--sans); }
  .transcript .all button { all: unset; cursor: pointer; font: 500 12px var(--mono); color: var(--accent); }
  .linkbtn { all: unset; cursor: pointer; color: var(--blue); font-size: 13px; text-transform: none; letter-spacing: 0; }
  .linkbtn:hover { color: var(--text); }

  aside.chapters { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; position: sticky; top: calc(env(safe-area-inset-top, 0px) + 16px); max-height: calc(100vh - 32px); display: flex; flex-direction: column; }
  .chapters .head { padding: 16px 18px 12px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: baseline; }
  .chapters .head h2 { margin: 0; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .chapters .head span { font: 500 12px var(--mono); color: var(--faint); }
  .chapters ol { list-style: none; margin: 0; padding: 6px 0 10px; overflow-y: auto; }
  .chapters li.sec { padding: 14px 18px 6px; font-size: 12px; color: var(--faint); font-style: italic; }
  .chapters li button { all: unset; box-sizing: border-box; width: 100%; display: grid; grid-template-columns: 52px 1fr; gap: 8px; padding: 8px 18px; cursor: pointer; border-left: 3px solid transparent; }
  .chapters li button:hover { background: var(--panel-2); }
  .chapters li button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .chapters li button .ts { font: 500 12px/1.9 var(--mono); font-variant-numeric: tabular-nums; color: var(--faint); }
  .chapters li button .t { font-size: 14px; line-height: 1.4; color: #D6D1C7; }
  .chapters li button[aria-current="true"] { background: var(--panel-2); border-left-color: var(--accent); }
  .chapters li button[aria-current="true"] .t { color: var(--text); font-weight: 600; }
  .chapters li button[aria-current="true"] .ts { color: var(--accent); }
  .chapters li.cut button .t { color: var(--amber); font-style: italic; }
  .chapters li.cut button .t::before { content: "\25B6\FE0E  "; font-style: normal; font-size: 11px; }
  .ticks .tick.cut { background: var(--amber); }

  .foot { color: var(--faint); font-size: 13px; display: flex; flex-wrap: wrap; gap: 6px 18px; }

  @media (max-width: 980px) {
    .layout { grid-template-columns: 1fr; }
    aside.chapters { position: static; max-height: none; }
  }
  @media (max-width: 520px) {
    .wrap { padding-inline: 16px; }
    .now { flex-basis: 100%; order: 3; }
  }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>

<div class="wrap">
  <header>
    <div class="eyebrow">__EYEBROW__</div>
    <h1>__TITLE__</h1>
    <div class="meta">
      <span>__SUBTITLE__</span>
      <span class="dot" aria-hidden="true"></span>
      <span id="runtime"></span>
      <span class="dot" aria-hidden="true"></span>
      <span>__N_SLIDES__</span>
      <span id="chip" class="chip"><i></i><span></span></span>
    </div>
  </header>

  <div class="layout">
    <div class="main">
      <div class="player" id="player">
        <div class="screen">
          <video id="vid" playsinline preload="metadata" poster="media/poster.jpg" aria-label="Presentation video"></video>
          <button class="bigplay" id="bigplay" type="button" aria-label="Play presentation">
            <span class="pill"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg><span id="bigplay-label">Play</span></span>
          </button>
        </div>
        <div class="controls">
          <div class="bar">
            <div class="ticks" id="ticks"><div class="fill" id="fill"></div></div>
            <input id="seek" type="range" min="0" step="0.1" value="0" aria-label="Seek">
          </div>
          <div class="row">
            <button class="btn" id="play" type="button" aria-label="Play"><svg viewBox="0 0 24 24" aria-hidden="true"><path id="play-icon" d="M7 4.5v15l13-7.5z"/></svg></button>
            <button class="btn" id="back" type="button" aria-label="Back 10 seconds">−10s</button>
            <button class="btn" id="fwd" type="button" aria-label="Forward 10 seconds">+10s</button>
            <span class="time"><b id="cur">0:00</b> / <span id="dur">0:00</span></span>
            <span class="now" id="now"></span>
            <select class="btn" id="speed" aria-label="Playback speed">
              <option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="1.75">1.75×</option><option value="2">2×</option>
            </select>
            <button class="btn" id="fs" type="button" aria-label="Full screen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm10-5h6v5h-2V6h-4zM6 15v3h3v2H4v-5zm12 0h2v5h-5v-2h3z"/></svg></button>
          </div>
        </div>
      </div>

      <div class="notice" id="notice"></div>

      <section class="transcript" aria-live="polite">
        <h2><span id="tr-label">Transcript</span> <button class="linkbtn" id="tr-toggle" type="button">Show full transcript</button></h2>
        <h3 id="tr-title"></h3>
        <div id="tr-body" style="display:flex; flex-direction:column; gap:10px"></div>
        <div class="all" id="tr-all" hidden></div>
      </section>

      <div class="foot">
        __DECK_LINK__
        <span>Keyboard: Space play/pause · ← → 5 seconds · [ ] previous/next chapter</span>
      </div>
    </div>

    <aside class="chapters" aria-label="Chapters">
      <div class="head"><h2>Chapters</h2><span id="ch-count"></span></div>
      <ol id="chapters"></ol>
    </aside>
  </div>
</div>

<script>
const DATA = __DATA__;
(() => {
  const $ = id => document.getElementById(id);
  const v = $('vid'), seek = $('seek'), fill = $('fill');
  const parts = DATA.parts, slides = DATA.slides, total = DATA.total;
  let cur = -1, active = -1, scrubbing = false, rate = 1;

  const fmt = s => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); };
  const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  // Header
  $('runtime').textContent = Math.round(total / 60) + ' min';
  $('dur').textContent = fmt(total);
  $('bigplay-label').textContent = 'Play · ' + Math.round(total / 60) + ' min';
  $('ch-count').textContent = DATA.nSlides + ' slides' + (slides.length > DATA.nSlides ? ' · ' + (slides.length - DATA.nSlides) + ' cut scene' + (slides.length - DATA.nSlides > 1 ? 's' : '') : '');
  const chip = $('chip');
  chip.classList.add(DATA.draft ? 'draft' : 'final');
  chip.lastElementChild.textContent = DATA.draft ? 'Draft preview' : 'AI presenter';
  $('notice').innerHTML = DATA.draft
    ? '<div><strong>Draft preview.</strong> The narration is a placeholder system voice and the bubble is a stand-in. The final version uses the speaker’s cloned voice and avatar, with the same slides, script and timing.</div>'
    : '<div><strong>AI presenter.</strong> This recording was generated with an AI avatar and a cloned voice of the speaker, reading the speaker’s own script.' + (DATA.mediaNote ? ' ' + esc(DATA.mediaNote) : slides.some(s => s.kind === 'cutscene') ? ' The cinematic cut scenes are AI-generated.' : '') + '</div>';
  if (!DATA.draft) $('notice').classList.add('final');

  // Seek bar + chapter ticks
  seek.max = total;
  const ticks = $('ticks');
  slides.slice(1).forEach(s => { const t = document.createElement('div'); t.className = 'tick' + (s.kind === 'cutscene' ? ' cut' : ''); t.style.left = (s.start / total * 100) + '%'; ticks.appendChild(t); });
  const label = s => s.label || (s.n + '. ' + s.title);

  // Chapters list
  const list = $('chapters');
  const rows = slides.map((s, i) => {
    if (s.section) { const li = document.createElement('li'); li.className = 'sec'; li.textContent = s.section; list.appendChild(li); }
    const li = document.createElement('li');
    if (s.kind === 'cutscene') li.className = 'cut';
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span class="ts">' + fmt(s.start) + '</span><span class="t">' + esc(label(s)) + '</span>';
    b.addEventListener('click', () => goSlide(i, true));
    li.appendChild(b); list.appendChild(li);
    return b;
  });

  // Full transcript
  const all = $('tr-all');
  slides.forEach((s, i) => {
    const sec = document.createElement('div');
    const body = s.text.length ? s.text.map(p => '<p>' + esc(p) + '</p>').join('') : (s.kind === 'cutscene' ? '<p><em>Cut scene — no narration.</em></p>' : '');
    sec.innerHTML = '<h4>' + esc(label(s)) + ' <button type="button" data-i="' + i + '">' + fmt(s.start) + '</button></h4>' + body;
    all.appendChild(sec);
  });
  all.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) goSlide(+b.dataset.i, true); });
  $('tr-toggle').addEventListener('click', () => { all.hidden = !all.hidden; $('tr-toggle').textContent = all.hidden ? 'Show full transcript' : 'Hide full transcript'; });

  // Playback across parts
  const partAt = T => { for (let i = parts.length - 1; i >= 0; i--) if (T >= parts[i].start - 0.01) return i; return 0; };
  const slideAt = T => { for (let i = slides.length - 1; i >= 0; i--) if (T >= slides[i].start - 0.05) return i; return 0; };
  const now = () => cur < 0 ? 0 : parts[cur].start + (v.currentTime || 0);

  function load(i, t, play) {
    if (i !== cur) {
      cur = i;
      v.src = 'media/' + parts[i].file;
      v.addEventListener('loadedmetadata', () => {
        v.playbackRate = rate;
        try { v.currentTime = Math.min(t, (v.duration || t) - 0.05); } catch (e) {}
        if (play) v.play().catch(() => {});
      }, { once: true });
      v.load();
    } else {
      try { v.currentTime = t; } catch (e) {}
      if (play) v.play().catch(() => {});
    }
  }
  function seekTo(T, play) {
    T = Math.max(0, Math.min(total - 0.1, T));
    const i = partAt(T);
    load(i, T - parts[i].start, play);
    render(T);
  }
  function goSlide(i, play) { seekTo(slides[i].start + 0.05, play); }

  function render(T) {
    if (!scrubbing) seek.value = T;
    fill.style.width = (T / total * 100) + '%';
    $('cur').textContent = fmt(T);
    const i = slideAt(T);
    if (i !== active) {
      if (active >= 0) rows[active].removeAttribute('aria-current');
      active = i;
      rows[i].setAttribute('aria-current', 'true');
      const s = slides[i];
      if (s.kind === 'cutscene') {
        $('now').innerHTML = 'Cut scene · <b>' + esc(s.title) + '</b>';
        $('tr-label').textContent = 'Transcript · cut scene';
        $('tr-title').textContent = label(s);
        $('tr-body').innerHTML = s.text.length ? s.text.map(p => '<p>' + esc(p) + '</p>').join('') : '<p><em>No narration during the cut scene.</em></p>';
      } else {
        $('now').innerHTML = 'Slide ' + s.n + ' of ' + DATA.nSlides + ' · <b>' + esc(s.title) + '</b>';
        $('tr-label').textContent = 'Transcript · slide ' + s.n;
        $('tr-title').textContent = s.title;
        $('tr-body').innerHTML = s.text.map(p => '<p>' + esc(p) + '</p>').join('');
      }
      const box = list.getBoundingClientRect(), r = rows[i].getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) list.scrollTop += r.top - box.top - 40;
    }
  }

  v.addEventListener('timeupdate', () => render(now()));
  v.addEventListener('play', () => { $('bigplay').hidden = true; $('play-icon').setAttribute('d', 'M6 4.5h4v15H6zm8 0h4v15h-4z'); $('play').setAttribute('aria-label', 'Pause'); });
  v.addEventListener('pause', () => { $('play-icon').setAttribute('d', 'M7 4.5v15l13-7.5z'); $('play').setAttribute('aria-label', 'Play'); });
  v.addEventListener('ended', () => {
    if (cur < parts.length - 1) load(cur + 1, 0, true);
    else { $('bigplay-label').textContent = 'Watch again'; $('bigplay').hidden = false; }
  });

  const toggle = () => {
    if (cur < 0) { seekTo(0, true); return; }
    if (v.ended && cur === parts.length - 1) { seekTo(0, true); return; }
    v.paused ? v.play().catch(() => {}) : v.pause();
  };
  $('bigplay').addEventListener('click', toggle);
  $('play').addEventListener('click', toggle);
  v.addEventListener('click', toggle);
  $('back').addEventListener('click', () => seekTo(now() - 10, !v.paused));
  $('fwd').addEventListener('click', () => seekTo(now() + 10, !v.paused));
  $('speed').addEventListener('change', e => { rate = +e.target.value; v.playbackRate = rate; });
  $('fs').addEventListener('click', () => {
    const el = $('player');
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).catch(() => { if (v.webkitEnterFullscreen) try { v.webkitEnterFullscreen(); } catch (e) {} });
  });

  seek.addEventListener('input', () => { scrubbing = true; const T = +seek.value; fill.style.width = (T / total * 100) + '%'; $('cur').textContent = fmt(T); });
  seek.addEventListener('change', () => { scrubbing = false; seekTo(+seek.value, !v.paused); });

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'k') { if (e.target.closest('button')) return; e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(now() + 5, !v.paused); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(now() - 5, !v.paused); }
    else if (e.key === ']') { e.preventDefault(); goSlide(Math.min(slides.length - 1, active + 1), !v.paused); }
    else if (e.key === '[') { e.preventDefault(); goSlide(Math.max(0, active - 1), !v.paused); }
  });

  // Rest state: first part cued, first chapter shown.
  cur = 0; v.src = 'media/' + parts[0].file;
  render(0);
})();
</script>
"""

if __name__ == "__main__":
    main()
