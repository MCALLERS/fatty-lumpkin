#!/usr/bin/env python3
"""Help the user pick their own HeyGen avatar look and voice instead of guessing.

  .venv/bin/python heygen_picker.py looks                 numbered contact sheet of your private looks (free)
  .venv/bin/python heygen_picker.py voices                list your private HeyGen voices (free)
  .venv/bin/python heygen_picker.py voices --sample-slide 12
                                                          speak that slide's narration in each private voice
                                                          (HeyGen text-to-speech, about $0.002/s: pennies)
  .venv/bin/python heygen_picker.py frame 24              gridded still of look #24 (or a look id) for framing

Outputs go to output/picker/. Show the PNG / MP3s to the user and let them choose by number and by ear.
Keys come from api_keys.txt, or ~/.config/avatar-presentation/keys.env (use set_keys.py [--global] to fill them
without pasting into a chat).
"""
import argparse, html, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import generate_presentation_video as g  # noqa: E402

OUT = HERE / "output" / "picker"
API = "https://api.heygen.com"
CHROME = [os.environ.get("FLPT_CHROME", ""),  # FLPT patch: the app's pinned Chrome first
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          shutil.which("google-chrome") or "", shutil.which("chromium") or ""]


def headers(cfg):
    return {"X-Api-Key": cfg["HEYGEN_API_KEY"], "accept": "application/json"}


def get(cfg, path, **params):
    r = g.api_call("GET", API + path, what=f"GET {path}", headers=headers(cfg), params=params, timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"  ✗ {g.explain_http('HeyGen', r)}")
    return r.json() or {}


def looks(cfg):
    out, token = [], None
    for _ in range(40):
        p = {"ownership": "private", "limit": 50}
        if token:
            p["token"] = token
        j = get(cfg, "/v3/avatars/looks", **p)
        out += j.get("data") or []
        token = j.get("next_token")
        if not j.get("has_more") or not token:
            break
    return out


def download(url, dst: Path):
    r = g.api_call("GET", url, what="download preview", headers={}, timeout=120)
    if r.status_code == 200:
        dst.write_bytes(r.content)
        return True
    return False


def cmd_looks(cfg, args):
    OUT.mkdir(parents=True, exist_ok=True)
    items = looks(cfg)
    if not items:
        print("  No private looks found. Create a Digital Twin or photo avatar in HeyGen first.")
        return 1
    (OUT / "looks.json").write_text(json.dumps(items, indent=1))
    cells = []
    for i, l in enumerate(items, 1):
        img = OUT / f"look_{i:02d}.img"
        ok = l.get("preview_image_url") and download(l["preview_image_url"], img)
        kind = "DIGITAL TWIN" if l.get("avatar_type") == "digital_twin" else "photo avatar"
        ctype = "avatar" if l.get("avatar_type") == "digital_twin" else "talking_photo"
        print(f"  {i:2d}  {l.get('id')}  {l.get('name', '')[:34]:<34s}  {kind:<12s}  "
              f"HEYGEN_CHARACTER_TYPE={ctype:<13s}  {l.get('image_width')}x{l.get('image_height')}  "
              f"status={l.get('status')}")
        cells.append(f'<figure><img src="{img.name}" onerror="this.style.visibility=\'hidden\'">'
                     f'<figcaption><b>{i}</b> {html.escape(l.get("name", ""))}'
                     f'{" · DIGITAL TWIN" if kind == "DIGITAL TWIN" else ""}</figcaption></figure>' if ok else
                     f'<figure><div class="ph"></div><figcaption><b>{i}</b> {html.escape(l.get("name", ""))}</figcaption></figure>')
    page = ("<html><head><style>body{margin:0;padding:16px;background:#fff;font:15px -apple-system,Arial,sans-serif}"
            ".g{display:grid;grid-template-columns:repeat(7,1fr);gap:12px}figure{margin:0}"
            "img,.ph{width:100%;aspect-ratio:1;object-fit:cover;object-position:50% 20%;border-radius:8px;display:block;background:#eee}"
            "figcaption{padding:4px 2px;line-height:1.25}b{font-size:18px;margin-right:4px}</style></head>"
            f"<body><div class='g'>{''.join(cells)}</div></body></html>")
    sheet_html = OUT / "looks.html"
    sheet_html.write_text(page)
    rows = (len(items) + 6) // 7
    chrome = next((c for c in CHROME if c and os.path.exists(c)), None)
    if chrome:
        subprocess.run([chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        f"--window-size=1800,{rows * 300 + 60}", "--virtual-time-budget=6000",
                        f"--screenshot={OUT / 'looks.png'}", sheet_html.as_uri()],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"\n  Contact sheet: {OUT / 'looks.png' if chrome else sheet_html}")
    print("  Ask the user which number is right. Never assume the Digital Twin is the one they want.")
    return 0


def cmd_voices(cfg, args):
    j = get(cfg, "/v3/voices", type="private", limit=100)
    voices = j.get("data") or []
    if not voices:
        print("  No private HeyGen voices. Use an ElevenLabs clone instead (TTS_PROVIDER=elevenlabs).")
        return 1
    for v in voices:
        d = get(cfg, f"/v3/voices/{v['voice_id']}").get("data") or {}
        print(f"  {v['voice_id']}  {d.get('name', v.get('name', '')):<28s}  status={d.get('status')}")
    if args.sample_slide:
        OUT.mkdir(parents=True, exist_ok=True)
        g.init_tools()
        slides, _ = g.load_slides(g.PRES_DIR / "slides", g.PRES_DIR / "script.md")
        text = next((s.text for s in slides if s.n == args.sample_slide), None)
        if not text:
            raise SystemExit(f"  ✗ no narration for slide {args.sample_slide}")
        print(f"\n  Speaking slide {args.sample_slide} ({len(text)} chars) in each voice …")
        for v in voices:
            c = dict(cfg)
            c["HEYGEN_VOICE_ID"] = v["voice_id"]
            slug = re.sub(r"[^a-z0-9]+", "_", (v.get("name") or v["voice_id"]).lower()).strip("_")
            with tempfile.TemporaryDirectory() as td:
                wav = Path(td) / "n.wav"
                try:
                    e = g.HeyGenTTS(c)
                    e.synth(e.prepare(text), wav, Path(td))   # delivery tags → <break>, never read aloud
                    dst = OUT / f"voice_{slug}.mp3"
                    shutil.copyfile(wav.with_suffix(".mp3"), dst)
                    print(f"  ✓ {dst}  ({g.media_duration(dst):.1f}s)")
                except g.ApiError as e:
                    print(f"  ✗ {v.get('name')}: {e}")
        print("  Send these to the user and let them choose by ear.")
    return 0


def cmd_frame(cfg, args):
    OUT.mkdir(parents=True, exist_ok=True)
    items = looks(cfg)
    ref = args.look
    look = items[int(ref) - 1] if ref.isdigit() and int(ref) <= len(items) else next((l for l in items if l.get("id") == ref), None)
    if not look:
        raise SystemExit(f"  ✗ look {ref} not found (run: heygen_picker.py looks)")
    src = OUT / f"frame_{look['id']}.img"
    download(look["preview_image_url"], src)
    dst = OUT / f"frame_{look['id']}_grid.png"
    g.init_tools()
    g.run([g.FFMPEG, "-y", "-v", "error", "-i", src, "-vf", "scale=960:-2,drawgrid=w=96:h=54:t=1:c=red@0.5", dst],
          "grid frame")
    print(f"  {dst}\n  Grid = tenths of width/height. Read off the face centre → BUBBLE_FOCUS_X / BUBBLE_FOCUS_Y,")
    print("  and set BUBBLE_ZOOM so head + shoulders fill the circle (head ≈ 55% of the crop height).")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("looks")
    v = sub.add_parser("voices")
    v.add_argument("--sample-slide", type=int)
    f = sub.add_parser("frame")
    f.add_argument("look", help="number from the contact sheet, or a look id")
    args = ap.parse_args()
    cfg, _src = g.load_merged_config(HERE / "api_keys.txt")      # presenter.env → keys.env → api_keys.txt
    if not cfg.get("HEYGEN_API_KEY"):
        raise SystemExit("  ✗ HEYGEN_API_KEY missing — run: python3 set_keys.py heygen (or --global heygen)")
    return {"looks": cmd_looks, "voices": cmd_voices, "frame": cmd_frame}[args.cmd](cfg, args)


if __name__ == "__main__":
    sys.exit(main())
