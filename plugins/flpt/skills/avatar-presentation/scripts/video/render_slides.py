#!/usr/bin/env python3
"""
render_slides.py — render the HTML slide deck to 1920x1080 PNGs with headless Chrome.

Standard library only.

Reads   presentation/deck/project/deck.json      ("order" = slide ids, "faces" = Google Fonts)
        presentation/deck/project/slides/<id>.html (one inline-styled <section> per file)
        presentation/deck/asset_map.json          ("/_blob/<id>" -> local image path; optional)
Writes  presentation/slides/slide_01.png ...      (numbered by "order")
        presentation/slides/index.json            ({"1": "<id>", "2": "<id>", ...})

Usage:
    python3 render_slides.py                      # render the real deck
    python3 render_slides.py --force              # ignore the render cache
    python3 render_slides.py --deck DIR --slides-dir DIR [--asset-map FILE]

Unchanged slides are skipped (a hash of each wrapped page is kept in
slides/.render_cache.json), so re-running after editing one slide re-renders only it.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

VIDEO_DIR = Path(__file__).resolve().parent
PRES_DIR = VIDEO_DIR.parent
DEFAULT_DECK = PRES_DIR / "deck" / "project"
DEFAULT_SLIDES_DIR = PRES_DIR / "slides"
W, H = 1920, 1080
RENDER_VERSION = "1"

CHROME_CANDIDATES = [c for c in [os.environ.get("FLPT_CHROME", "")] if c] + [  # FLPT patch: pinned Chrome first
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "chromium", "chrome",
]

# Required flags (see task spec) + flags that keep a throwaway profile quiet and
# stop macOS keychain prompts / background network chatter.
CHROME_FLAGS = [
    "--headless=new",
    "--window-size=1920,1080",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--virtual-time-budget=6000",
    "--no-first-run",
    "--no-default-browser-check",
    "--use-mock-keychain",
    "--password-store=basic",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-extensions",
    "--mute-audio",
    "--allow-file-access-from-files",
]

BASE_CSS = """
html,body{margin:0;padding:0;background:#000}
section{width:1920px;height:1080px;box-sizing:border-box;position:relative;overflow:hidden;display:flex;flex-direction:column}
h1,h2,h3,p,ul,ol,li,table{margin:0}
h1{font-size:96px;font-weight:600;line-height:1.1}
h2{font-size:64px;font-weight:600;line-height:1.15}
h3{font-size:44px;font-weight:600;line-height:1.2}
p{font-size:32px;font-weight:400;line-height:1.4}
ul,ol{padding-left:1.2em}
img{display:block}
table{border-collapse:collapse}
th,td{padding:0.35em 0.6em}
aside{display:none !important}
"""


def log(msg: str = "") -> None:
    print(msg, flush=True)


# ─── helpers ────────────────────────────────────────────────────────────────

def find_chrome(explicit: str | None) -> str:
    cands = [explicit] if explicit else CHROME_CANDIDATES
    for c in cands:
        if not c:
            continue
        if os.path.isabs(c) and os.path.exists(c):
            return c
        w = shutil.which(c)
        if w:
            return w
    sys.exit("ERROR: Google Chrome not found. Install it or pass --chrome /path/to/chrome")


def png_size(path: Path) -> tuple[int, int] | None:
    try:
        with open(path, "rb") as f:
            head = f.read(24)
        if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
            return None
        return struct.unpack(">II", head[16:24])
    except OSError:
        return None


def parse_range(spec: str | None, n: int) -> list[int]:
    if not spec:
        return list(range(1, n + 1))
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(part))
    return sorted(i for i in out if 1 <= i <= n)


def load_deck(deck_arg: Path) -> tuple[Path, dict]:
    deck_json = deck_arg / "deck.json" if deck_arg.is_dir() else deck_arg
    if not deck_json.exists():
        sys.exit(f"ERROR: deck.json not found at {deck_json}")
    with open(deck_json, encoding="utf-8-sig") as f:
        return deck_json.parent, json.load(f)


def deck_order(deck: dict) -> list[str]:
    order = deck.get("order") or []
    ids = []
    for item in order:
        if isinstance(item, str):
            ids.append(item)
        elif isinstance(item, dict) and item.get("id"):
            ids.append(str(item["id"]))
    if not ids:
        sys.exit("ERROR: deck.json has no 'order' list of slide ids")
    return ids


def deck_faces(deck: dict) -> tuple[list[str], list[str]]:
    """Return (hrefs, families) from deck['faces'] (dict of {family, href}, or a list)."""
    faces = deck.get("faces") or []
    items = list(faces.values()) if isinstance(faces, dict) else list(faces)
    hrefs, fams = [], []
    for it in items:
        if isinstance(it, str):
            hrefs.append(it)
            m = re.search(r"family=([^:&]+)", it)
            if m:
                fams.append(m.group(1).replace("+", " "))
        elif isinstance(it, dict):
            href = it.get("href") or it.get("url")
            if href:
                hrefs.append(href)
            fam = it.get("family") or it.get("name")
            if fam:
                fams.append(fam)
    return hrefs, fams


def load_asset_map(path: Path | None) -> tuple[dict, Path | None]:
    if path is None or not path.exists():
        return {}, None
    try:
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f), path.parent
    except (OSError, json.JSONDecodeError) as e:
        log(f"  WARNING: could not read asset map {path}: {e}")
        return {}, None


def resolve_asset(value: str, bases: list[Path]) -> Path | None:
    if value.startswith("file://"):
        from urllib.parse import unquote, urlparse
        p = Path(unquote(urlparse(value).path))
        return p if p.exists() else None
    p = Path(os.path.expanduser(value))
    if p.is_absolute():
        return p if p.exists() else None
    for b in bases:
        q = (b / p).resolve()
        if q.exists():
            return q
    return None


BLOB_RE = re.compile(r"/_blob/[^\"'()\s&<>]+")


def build_page(section_html: str, hrefs: list[str], families: list[str],
               asset_map: dict, asset_bases: list[Path], slide_id: str,
               problems: list[str]) -> tuple[str, list[Path]]:
    # 1) Speaker notes: strip <aside> (CSS also hides any we miss).
    section_html = re.sub(r"<aside\b[^>]*>.*?</aside\s*>", "", section_html, flags=re.S | re.I)

    # 2) /_blob/ references -> file:// URLs via the asset map.
    used: list[Path] = []

    def repl(m: re.Match) -> str:
        key = m.group(0)
        val = asset_map.get(key) or asset_map.get(key[len("/_blob/"):])
        if not val:
            problems.append(f"{slide_id}: no asset_map entry for {key}")
            return key
        p = resolve_asset(str(val), asset_bases)
        if not p:
            problems.append(f"{slide_id}: asset for {key} not found on disk: {val}")
            return key
        used.append(p)
        return p.as_uri()

    section_html = BLOB_RE.sub(repl, section_html)

    links = []
    if any(h.startswith("https://fonts.googleapis.com") for h in hrefs):
        links.append('<link rel="preconnect" href="https://fonts.googleapis.com">')
        links.append('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    for h in hrefs:
        links.append(f'<link rel="stylesheet" href="{html.escape(h, quote=True)}">')
    # Fallback body font = first deck face (slides normally set font-family inline).
    font_css = ""
    if families:
        font_css = "body{font-family:%s,system-ui,sans-serif}" % ",".join(
            "'" + f.replace("'", "") + "'" for f in families[:1])

    page = (
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">\n"
        + "\n".join(links)
        + "\n<style>" + BASE_CSS + font_css + "</style>\n</head>\n<body>\n"
        + section_html.strip()
        + "\n</body></html>\n"
    )
    return page, used


def extract_section(raw: str) -> str | None:
    start = re.search(r"<section\b", raw, flags=re.I)
    if not start:
        return None
    ends = [m.end() for m in re.finditer(r"</section\s*>", raw, flags=re.I)]
    if not ends:
        return raw[start.start():] + "</section>"
    return raw[start.start():ends[-1]]


def run_chrome(chrome: str, html_path: Path, png_path: Path, timeout: float = 60.0) -> tuple[bool, str]:
    """Run headless Chrome once. Some Chrome builds write the screenshot but never
    exit, so we watch for the "bytes written" line / the file and then kill the
    whole process group ourselves."""
    tmp_png = png_path.with_suffix(".tmp.png")
    if tmp_png.exists():
        tmp_png.unlink()
    profile = tempfile.mkdtemp(prefix="render_slides_profile_")
    cmd = [chrome, *CHROME_FLAGS, f"--user-data-dir={profile}",
           f"--screenshot={tmp_png}", html_path.as_uri()]
    out_lines: list[str] = []
    done = threading.Event()
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, start_new_session=True)
    except OSError as e:
        shutil.rmtree(profile, ignore_errors=True)
        return False, f"could not start Chrome: {e}"

    def reader():
        assert proc.stdout is not None
        for raw in iter(proc.stdout.readline, b""):
            line = raw.decode("utf-8", "replace").rstrip()
            out_lines.append(line)
            if "bytes written to file" in line:
                done.set()
        done.set()

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    deadline = time.time() + timeout
    while time.time() < deadline and not done.is_set():
        done.wait(0.25)
    # Give Chrome a moment to exit on its own, then make sure it is gone.
    try:
        proc.wait(timeout=1.5)
    except subprocess.TimeoutExpired:
        pass
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            proc.kill()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
    shutil.rmtree(profile, ignore_errors=True)

    if not tmp_png.exists() or tmp_png.stat().st_size < 1000:
        tail = "\n".join(out_lines[-8:])
        return False, f"Chrome produced no screenshot (timeout {timeout:.0f}s). Output:\n{tail}"
    os.replace(tmp_png, png_path)
    return True, ""


# ─── main ───────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="Render the HTML deck to 1920x1080 PNG slides.")
    ap.add_argument("--deck", type=Path, default=DEFAULT_DECK,
                    help="deck project folder (containing deck.json and slides/) or deck.json path")
    ap.add_argument("--asset-map", type=Path, default=None,
                    help="asset_map.json (default: <deck>/asset_map.json or <deck>/../asset_map.json)")
    ap.add_argument("--slides-dir", type=Path, default=DEFAULT_SLIDES_DIR,
                    help="where slide_NN.png and index.json are written")
    ap.add_argument("--chrome", default=None, help="path to Chrome/Chromium")
    ap.add_argument("--only", default=None, help="render only these slide numbers, e.g. 3-5,9")
    ap.add_argument("--force", action="store_true", help="re-render even if unchanged")
    ap.add_argument("--jobs", type=int, default=4, help="parallel Chrome processes (default 4)")
    ap.add_argument("--keep-html", action="store_true", help="keep wrapped HTML pages in <slides-dir>/_html")
    args = ap.parse_args()

    deck_dir, deck = load_deck(args.deck.expanduser().resolve())
    ids = deck_order(deck)
    hrefs, families = deck_faces(deck)
    slides_src = deck_dir / "slides"

    am_path = args.asset_map
    if am_path is None:
        for cand in (deck_dir / "asset_map.json", deck_dir.parent / "asset_map.json"):
            if cand.exists():
                am_path = cand
                break
    asset_map, am_dir = load_asset_map(am_path)
    asset_bases = [b for b in (am_dir, deck_dir, deck_dir.parent, PRES_DIR, PRES_DIR.parent) if b]

    out_dir = args.slides_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    chrome = find_chrome(args.chrome)

    log("=" * 64)
    log("  Render slides")
    log("=" * 64)
    log(f"  Deck:       {deck_dir}  ({len(ids)} slides)")
    log(f"  Fonts:      {', '.join(families) or '(none)'}")
    log(f"  Asset map:  {am_path if am_path and am_path.exists() else '(none found — /_blob/ images will be missing)'}"
        + (f"  ({len(asset_map)} entries)" if asset_map else ""))
    log(f"  Output:     {out_dir}")
    log(f"  Chrome:     {chrome}")
    log("")

    cache_file = out_dir / ".render_cache.json"
    try:
        cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    except (OSError, json.JSONDecodeError):
        cache = {}

    work = Path(tempfile.mkdtemp(prefix="render_slides_"))
    html_keep = out_dir / "_html"
    if args.keep_html:
        html_keep.mkdir(exist_ok=True)

    selected = set(parse_range(args.only, len(ids)))
    problems: list[str] = []
    jobs = []
    index = {}
    for n, sid in enumerate(ids, start=1):
        index[str(n)] = sid
        if n not in selected:
            continue
        src = slides_src / f"{sid}.html"
        png = out_dir / f"slide_{n:02d}.png"
        if not src.exists():
            problems.append(f"slide {n} ({sid}): missing {src}")
            continue
        raw = src.read_text(encoding="utf-8-sig")
        section = extract_section(raw)
        if section is None:
            problems.append(f"slide {n} ({sid}): no <section> element in {src.name}")
            continue
        if len(re.findall(r"<section\b", raw, flags=re.I)) > 1:
            problems.append(f"slide {n} ({sid}): more than one <section> — rendering the whole block")
        page, used = build_page(section, hrefs, families, asset_map, asset_bases, f"slide {n} ({sid})", problems)
        h = hashlib.sha256()
        h.update(RENDER_VERSION.encode())
        h.update(" ".join(CHROME_FLAGS).encode())
        h.update(page.encode())
        for p in used:
            st = p.stat()
            h.update(f"{p}|{st.st_size}|{st.st_mtime_ns}".encode())
        digest = h.hexdigest()
        html_path = work / f"slide_{n:02d}.html"
        html_path.write_text(page, encoding="utf-8")
        if args.keep_html:
            (html_keep / f"slide_{n:02d}_{sid}.html").write_text(page, encoding="utf-8")
        up_to_date = (not args.force and png.exists() and png_size(png) == (W, H)
                      and cache.get(str(n), {}).get("hash") == digest
                      and cache.get(str(n), {}).get("id") == sid)
        jobs.append((n, sid, html_path, png, digest, up_to_date))

    to_render = [j for j in jobs if not j[5]]
    for n, sid, *_ in [j for j in jobs if j[5]]:
        log(f"  slide {n:2d}  {sid:<28s} unchanged, skipped")

    results: dict[int, tuple[bool, str, float]] = {}
    lock = threading.Lock()

    def do(job):
        n, sid, html_path, png, digest, _ = job
        t0 = time.time()
        ok, err = run_chrome(chrome, html_path, png)
        if ok and png_size(png) != (W, H):
            ok, err = False, f"wrong size {png_size(png)} (expected {W}x{H})"
        dt = time.time() - t0
        with lock:
            results[n] = (ok, err, dt)
            if ok:
                cache[str(n)] = {"id": sid, "hash": digest}
                log(f"  slide {n:2d}  {sid:<28s} rendered  ({dt:.1f}s)")
            else:
                cache.pop(str(n), None)
                log(f"  slide {n:2d}  {sid:<28s} FAILED: {err}")

    if to_render:
        with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
            list(ex.map(do, to_render))

    # Remove stale slide PNGs beyond the deck length (e.g. a slide was deleted).
    for f in out_dir.glob("slide_*.png"):
        m = re.fullmatch(r"slide_(\d+)\.png", f.name)
        if m and int(m.group(1)) > len(ids):
            f.unlink()
            cache.pop(str(int(m.group(1))), None)
            log(f"  removed stale {f.name}")

    cache_file.write_text(json.dumps(cache, indent=1))
    (out_dir / "index.json").write_text(json.dumps(index, indent=1) + "\n")
    shutil.rmtree(work, ignore_errors=True)

    # Verify every PNG in the deck.
    log("")
    bad = []
    for n in range(1, len(ids) + 1):
        png = out_dir / f"slide_{n:02d}.png"
        size = png_size(png)
        if size != (W, H):
            bad.append(f"slide_{n:02d}.png: {'missing' if size is None else f'{size[0]}x{size[1]}'}")
    failed = [n for n, r in results.items() if not r[0]]

    if problems:
        log("  Warnings:")
        for p in problems:
            log(f"    - {p}")
    log(f"  index.json written ({len(ids)} slides)")
    if bad:
        log("  ✗ Size check failed:")
        for b in bad:
            log(f"    - {b}")
    else:
        log(f"  ✓ All {len(ids)} PNGs are {W}x{H}")
    if failed:
        log(f"  ✗ {len(failed)} slide(s) failed to render: {failed}")
    return 1 if (bad or failed) else 0


if __name__ == "__main__":
    sys.exit(main())
