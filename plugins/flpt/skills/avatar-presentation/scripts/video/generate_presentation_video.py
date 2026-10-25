#!/usr/bin/env python3
"""
generate_presentation_video.py — Loom-style narrated presentation video.

Slides fill the 1920x1080 frame; a "presenter bubble" (your HeyGen avatar,
lip-synced to your narration) sits in a corner (bottom-left by default; circle or
rounded square). Slides can have a video background, and full-screen "cut scenes"
can play between slides (see media.json in SETUP.md).

MODES
  --draft           FREE, zero network. macOS `say` narration + placeholder bubble
                    (presenter.jpg if present); missing videos become title cards.
                    -> output/draft_presentation.mp4
  (default)/--final PAID. Narration from TTS_PROVIDER (elevenlabs | heygen | gemini) +
                    a HeyGen avatar clip per slide, lip-synced to that exact audio.
                    -> output/presentation.mp4
  --edit-master     Make output/<name>_for_editing.mov (CapCut-safe: no edit lists, PCM, voice +20 ms).
                    --final makes it automatically (skip with --no-edit-master).
  --web             Make output/web/ (1280x720, split at chapter boundaries into
                    parts < 14 MB, plus parts.json) from the draft or final video.
  --check           Validate keys + IDs + media with free GET calls only. No generation.
  --list-voices     List ElevenLabs voices (find your clone's voice ID). GET only.
  --list-avatars    List HeyGen avatars / photo avatars (find your twin's ID). GET only.
  --profile show    Print the merged settings (presenter profile, global keys, project
                    api_keys.txt) with keys masked, and where each value came from.
  --profile save    Copy this project's voice/avatar/bubble settings into the profile.

OPTIONS
  --slides 3-5      Only these slides (writes a separate *_slides_03-05.mp4 preview).
  --no-avatar       Slides + narration only.
  --regen           With --slides: regenerate audio + avatar for those slides.
  --regen-avatar    With --slides: regenerate only the avatar clips (keeps audio).
  --yes             Don't ask before paid generation (RUN_ME.command asks for you).
  --bubble-position/--bubble-shape/--bubble-size/--bubble-margin   bubble overrides.
  --deck/--script/--slides-dir/--out/--cache/--keys/--presenter/--media/--config-dir
                    path overrides.

Settings are read from ~/.config/avatar-presentation/presenter.env (your stable
presenter profile), then ~/.config/avatar-presentation/keys.env (API keys), then
the project's api_keys.txt; later files override earlier ones, blank values never do.

Everything expensive is cached under cache/ (audio keyed by text+voice, avatar
clips keyed by audio+avatar, video segments keyed by all inputs). An interrupted
run resumes (even HeyGen jobs that were still rendering), and editing one slide's
narration only regenerates that slide.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import wave
import zlib
from datetime import datetime, timezone
from pathlib import Path

# ─── constants ──────────────────────────────────────────────────────────────

VIDEO_DIR = Path(__file__).resolve().parent
PRES_DIR = VIDEO_DIR.parent
PIPELINE_VERSION = "1"

W, H, FPS = 1920, 1080, 30
SR = 48000
SPF = SR // FPS                 # audio samples per video frame (1600)

TAIL_S = 0.6                    # silence after each slide's narration
FIRST_LEAD_S = 0.5              # silence before the very first slide's narration
LAST_TAIL_S = 1.6               # longer tail on the final slide (fade-out lives here)
SILENT_HOLD_S = 3.0             # slide with no narration in the script
XFADE_S = 0.3                   # crossfade between slide images (visual only)
INTRO_FADE_S = 0.5              # fade from black at the start
OUTRO_FADE_S = 1.0              # fade to black at the very end

BUBBLE_D = 300                  # avatar bubble size (px): circle diameter / rounded-square side
RING_W = 4                      # white ring around the bubble
MARGIN = 48                     # from the frame edge to the outside of the ring
SHADOW_BLUR = 22
SHADOW_DY = 6
SHADOW_OPACITY = 0.38
DECOR_PAD = 30                  # canvas padding around the bubble for ring + shadow
BUBBLE_POSITIONS = ("bottom-left", "bottom-right", "top-left", "top-right")
BUBBLE_SHAPES = ("circle", "rounded")
DEFAULT_POSITION = "bottom-left"
ROUNDED_RADIUS = 0.22           # corner radius of the "rounded" bubble, as a fraction of its side

CUT_FADE_S = 0.5                # a slide fades to / from black next to a cut scene
BUBBLE_FADE_S = 0.4             # the bubble fades out / in around a slide with "bubble": false
CUT_LEAD_S = 0.5                # silence before the narration of the slide after a cut scene
CUT_TAIL_S = 0.8                # minimum silent tail on the slide before a cut scene
CUTSCENE_FADE_S = 0.6           # a cut scene's own fade in/out (media.json "fade")
PLACEHOLDER_CUTSCENE_S = 20.0   # --draft stand-in length for a cut scene whose file doesn't exist yet
VOICEOVER_BED = 0.35            # cut-scene audio level under an optional voiceover
MIX_VOLUME = 0.25               # video-slide audio level under the narration ("audio": "mix")
VIDEO_EXTS = (".mp4", ".mov", ".m4v", ".webm", ".mkv")

DEFAULT_CONFIG_DIR = Path.home() / ".config" / "avatar-presentation"


EL_API = "https://api.elevenlabs.io"
HG_API = "https://api.heygen.com"
HG_UPLOAD = "https://upload.heygen.com/v1/asset"

DEFAULT_MODEL = "eleven_multilingual_v2"
GEMINI_API = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_DEFAULT_MODEL = "gemini-3.8-flash-tts"   # GA 2026-09-22; also gemini-3.8-flash-lite-tts
GEMINI_DEFAULT_VOICE = "Kore"
CHARS_PER_SEC = 14.5            # rough speaking rate, only for estimates

# ─── console helpers ────────────────────────────────────────────────────────


def log(msg: str = "") -> None:
    print(msg, flush=True)


def step(title: str) -> None:
    log("")
    log("=" * 70)
    log(f"  {title}")
    log("=" * 70)


def mask_key(k: str | None) -> str:
    if not k:
        return "(not set)"
    k = str(k)
    return (k[:4] + "…" + k[-4:]) if len(k) > 10 else "…" * 3


class PipelineError(Exception):
    pass


def die(msg: str, code: int = 1) -> None:
    log("")
    log(f"  ✗ {msg}")
    sys.exit(code)


def fmt_t(sec: float) -> str:
    m, s = divmod(max(0.0, sec), 60)
    return f"{int(m)}:{s:04.1f}"


def fmt_mb(n: int | float) -> str:
    return f"{n / 1_000_000:.1f} MB"


# ─── external tools ─────────────────────────────────────────────────────────


def find_tool(name: str) -> str:
    p = shutil.which(name)
    if p:
        return p
    for d in ("/opt/homebrew/bin", "/usr/local/bin"):
        c = os.path.join(d, name)
        if os.path.exists(c):
            return c
    die(f"{name} not found. Install it with Homebrew:  brew install ffmpeg")
    return name  # unreachable


FFMPEG = FFPROBE = ""


def init_tools() -> None:
    global FFMPEG, FFPROBE
    FFMPEG = find_tool("ffmpeg")
    FFPROBE = find_tool("ffprobe")


def run(cmd: list, what: str, capture: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run([str(c) for c in cmd], capture_output=capture)
    if r.returncode != 0:
        err = (r.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        tail = "\n      ".join(err[-12:])
        raise PipelineError(f"{what} failed (exit {r.returncode}):\n      {tail}")
    return r


def ffprobe_json(path: Path, *extra: str) -> dict:
    r = run([FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", *extra, path],
            f"ffprobe {Path(path).name}")
    return json.loads(r.stdout or b"{}")


def media_duration(path: Path) -> float:
    info = ffprobe_json(path)
    try:
        return float(info["format"]["duration"])
    except (KeyError, ValueError):
        return 0.0


def video_size(path: Path) -> tuple[int, int]:
    info = ffprobe_json(path)
    for s in info.get("streams", []):
        if s.get("codec_type") == "video":
            return int(s["width"]), int(s["height"])
    raise PipelineError(f"no video stream in {path}")


def sha_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha_text(*parts) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(str(p).encode("utf-8"))
        h.update(b"\x1f")
    return h.hexdigest()


def atomic_write_json(path: Path, data) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    os.replace(tmp, path)


def block_network() -> None:
    """--draft promises zero network: make any socket connect from Python fail."""
    import socket

    def _blocked(*_a, **_k):
        raise RuntimeError("network access is disabled in --draft mode")

    socket.socket.connect = _blocked          # type: ignore[assignment]
    socket.socket.connect_ex = _blocked       # type: ignore[assignment]
    socket.create_connection = _blocked       # type: ignore[assignment]


# ─── config (api_keys.txt) ──────────────────────────────────────────────────


def load_config(path: Path) -> dict:
    cfg: dict[str, str] = {}
    if not path.exists():
        return cfg
    text = path.read_bytes().decode("utf-8-sig", "replace")
    for raw in text.splitlines():
        line = raw.strip().lstrip("﻿").strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        if k.lower().startswith("export "):
            k = k[7:].strip()
        v = re.sub(r"\s+#.*$", "", v.strip())
        v = v.strip().strip("\"'“”‘’").strip()
        cfg[k.upper()] = v
    return cfg


def cfg_float(cfg: dict, key: str, default: float) -> float:
    try:
        return float(cfg.get(key) or default)
    except ValueError:
        log(f"  WARNING: {key}={cfg.get(key)!r} is not a number; using {default}")
        return default


# ─── presenter profile + global keys ────────────────────────────────────────
#
# Three KEY=VALUE files, read in this order; a later file overrides an earlier one,
# and a blank value (KEY=) never overrides anything:
#   1. ~/.config/avatar-presentation/presenter.env   your stable voice + avatar + bubble look
#   2. ~/.config/avatar-presentation/keys.env        API keys shared by all projects (chmod 600)
#   3. <project>/presentation/video/api_keys.txt     per-project keys and overrides
# The folder can be moved with AVATAR_PRESENTATION_CONFIG_DIR or --config-dir.

PROFILE_GROUPS = [
    ("Narration", ["TTS_PROVIDER", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL", "ELEVENLABS_STABILITY",
                   "ELEVENLABS_SIMILARITY", "ELEVENLABS_STYLE", "ELEVENLABS_SPEED", "HEYGEN_VOICE_ID",
                   "HEYGEN_VOICE_SPEED", "HEYGEN_VOICE_LANGUAGE", "GEMINI_TTS_MODEL", "GEMINI_VOICE",
                   "GEMINI_STYLE_PROMPT", "GEMINI_LANGUAGE"]),
    ("Avatar", ["HEYGEN_AVATAR_ID", "HEYGEN_CHARACTER_TYPE", "HEYGEN_ENGINE", "HEYGEN_RESOLUTION",
                "HEYGEN_BACKGROUND", "HEYGEN_EXPRESSIVENESS", "HEYGEN_API_VERSION"]),
    ("Bubble", ["BUBBLE_POSITION", "BUBBLE_SHAPE", "BUBBLE_SIZE", "BUBBLE_MARGIN", "BUBBLE_ZOOM",
                "BUBBLE_FOCUS_X", "BUBBLE_FOCUS_Y"]),
    ("Keys", ["ELEVENLABS_API_KEY", "HEYGEN_API_KEY", "GEMINI_API_KEY"]),
]
PROFILE_KEYS = [k for g, ks in PROFILE_GROUPS if g != "Keys" for k in ks]
CONFIG_DEFAULTS = {
    "TTS_PROVIDER": "elevenlabs", "ELEVENLABS_MODEL": DEFAULT_MODEL,
    "HEYGEN_CHARACTER_TYPE": "avatar", "HEYGEN_RESOLUTION": "1080p", "HEYGEN_API_VERSION": "v3",
    "BUBBLE_POSITION": DEFAULT_POSITION, "BUBBLE_SHAPE": "circle", "BUBBLE_SIZE": str(BUBBLE_D),
    "BUBBLE_MARGIN": str(MARGIN), "BUBBLE_ZOOM": "1.6", "BUBBLE_FOCUS_X": "0.5", "BUBBLE_FOCUS_Y": "0.40",
    "GEMINI_TTS_MODEL": GEMINI_DEFAULT_MODEL, "GEMINI_VOICE": GEMINI_DEFAULT_VOICE,
}


def is_secret(key: str) -> bool:
    return key.endswith(("_KEY", "_TOKEN", "_SECRET"))


def config_dir(override: Path | None = None) -> Path:
    if override:
        return Path(override).expanduser().resolve()
    env = os.environ.get("AVATAR_PRESENTATION_CONFIG_DIR", "").strip()
    return Path(env).expanduser().resolve() if env else DEFAULT_CONFIG_DIR


def config_layers(keys_path: Path, cfg_dir: Path | None = None) -> list[tuple[str, Path]]:
    d = config_dir(cfg_dir)
    return [("profile", d / "presenter.env"), ("global keys", d / "keys.env"), ("project", Path(keys_path))]


def load_merged_config(keys_path: Path, cfg_dir: Path | None = None) -> tuple[dict, dict]:
    """(settings, {KEY: layer label}) from presenter.env → keys.env → project api_keys.txt."""
    # FLPT_ALLOW_KEYS_V1: a paid run gets only the keys of the providers it holds an approval for
    cfg, src = _load_merged_config_all(keys_path, cfg_dir)
    allowed = os.environ.get("FLPT_ALLOW_KEYS")
    if allowed is not None:
        keep = {k.strip() for k in allowed.split(",") if k.strip()}
        for k in [k for k in cfg if is_secret(k) and k not in keep]:
            del cfg[k]
            src.pop(k, None)
    return cfg, src


def _load_merged_config_all(keys_path: Path, cfg_dir: Path | None = None) -> tuple[dict, dict]:
    """Every layer, before FLPT_ALLOW_KEYS_V1 drops the keys a paid run holds no approval for."""
    cfg: dict[str, str] = {}
    src: dict[str, str] = {}
    for label, path in config_layers(keys_path, cfg_dir):
        for k, v in load_config(path).items():
            if v != "":
                cfg[k] = v
                src[k] = label
    # FLPT patch: keys may arrive in this process's environment (decrypted from the Keychain by the app),
    # so they never have to be written to a file. Only when the app sets FLPT_ENV_KEYS=1.
    if os.environ.get("FLPT_ENV_KEYS") == "1":
        for k, v in os.environ.items():
            if is_secret(k) and v.strip():
                cfg[k] = v.strip()
                src[k] = "environment (FLPT)"
    return cfg, src


def _file_mode(path: Path) -> str:
    try:
        return oct(path.stat().st_mode & 0o777)[2:]
    except OSError:
        return ""


def cmd_profile_show(keys_path: Path, cfg_dir: Path | None) -> int:
    cfg, src = load_merged_config(keys_path, cfg_dir)
    step("Presenter profile — merged settings (keys masked)")
    log("  Read in this order; later files override earlier ones, blank values never do:")
    for i, (label, path) in enumerate(config_layers(keys_path, cfg_dir), start=1):
        state = "found" if path.exists() else "not there"
        mode = _file_mode(path)
        if path.exists() and label != "profile" and mode and int(mode, 8) & 0o077:
            state += f", mode {mode} — make it private: chmod 600 \"{path}\""
        log(f"   {i}. {label:<12s} {path}  ({state})")
    known = {k for _, ks in PROFILE_GROUPS for k in ks}
    groups = PROFILE_GROUPS + [("Other", sorted(k for k in cfg if k not in known))]
    for title, keys in groups:
        if not keys:
            continue
        log(f"\n  {title}")
        for k in keys:
            if k in cfg:
                v, where = cfg[k], src[k]
            elif CONFIG_DEFAULTS.get(k):
                v, where = CONFIG_DEFAULTS[k], "default"
            else:
                v, where = "", "not set"
            shown = mask_key(v) if (is_secret(k) and v) else (v or "—")
            if len(shown) > 44:
                shown = shown[:41] + "…"
            log(f"    {k:<24s} {shown:<46s} {where}")
    leaked = [k for k in load_config(config_layers(keys_path, cfg_dir)[0][1]) if is_secret(k)]
    if leaked:
        log(f"\n  ! {', '.join(leaked)} is in presenter.env — API keys belong in keys.env (chmod 600): "
            "python3 set_keys.py --global")
    log("\n  Change the profile by editing presenter.env; override per project in api_keys.txt.")
    return 0


def cmd_profile_save(keys_path: Path, cfg_dir: Path | None) -> int:
    """Write the voice/avatar/bubble settings in effect for this project into presenter.env (never keys)."""
    cfg, src = load_merged_config(keys_path, cfg_dir)
    vals = {k: cfg[k] for k in PROFILE_KEYS if cfg.get(k) and not is_secret(k)}
    if not vals:
        die("Nothing to save: no voice/avatar/bubble settings are set in this project's api_keys.txt.")
    d = config_dir(cfg_dir)
    d.mkdir(parents=True, exist_ok=True)
    try:
        d.chmod(0o700)
    except OSError:
        pass
    path = d / "presenter.env"
    lines = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else [
        "# presenter.env — your presenter profile, shared by every presentation project.",
        "# Same KEY=VALUE format as api_keys.txt. A project's api_keys.txt overrides these.",
        "# API keys do NOT go here: use keys.env (python3 set_keys.py --global).", ""]
    for k, v in vals.items():
        for i, line in enumerate(lines):
            if re.match(rf"^\s*(export\s+)?{k}\s*=", line):
                lines[i] = f"{k}={v}"
                break
        else:
            lines.append(f"{k}={v}")
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    step(f"Saved {len(vals)} setting(s) to {path}")
    for k, v in vals.items():
        log(f"    {k:<24s} {v[:60]}   (from {src[k]})")
    return 0


# ─── delivery tags ([pause], [laughs], <sigh>, <break time="1s"/> …) ───────
#
# Scripts may carry delivery tags. Each TTS engine translates them into what it
# supports (cheat sheet: references/tts-tags.md) and drops the rest, so a tag is
# never read aloud. Text without tags passes through unchanged (same cache key).

PAUSE_SECONDS = {"pause": 0.8, "short pause": 0.4, "medium pause": 0.8, "long pause": 1.6, "beat": 0.8,
                 "pause short": 0.4, "pause long": 1.6}
# Gemini 3.8 TTS inline tags (angle brackets), as listed on
# https://ai.google.dev/gemini-api/docs/generate-content/speech-generation (2026-09-24).
GEMINI_TAGS = {"argh", "breath", "heavy breath", "exhales", "cackle", "cheer", "chuckle", "chuckles", "cough",
               "cry", "gasp", "giggle", "groan", "growl", "grunt", "grr", "hiss", "laugh", "laughter", "moan",
               "pant", "pff", "phew", "scream", "shout", "shriek", "sigh", "sighs", "sneeze", "snicker", "snort",
               "sob", "throat-clearing", "tsk", "whimper", "whispers", "whispering", "yawn",
               "short pause", "long pause"}
TAG_ALIASES = {"laughs": "laugh", "laughing": "laughter", "sighs": "sigh", "sighing": "sigh", "breathes": "breath",
               "inhales": "breath", "breathing": "breath", "deep breath": "heavy breath", "exhale": "exhales",
               "coughs": "cough", "clears throat": "throat-clearing", "throat clearing": "throat-clearing",
               "whisper": "whispers", "giggles": "giggle", "gasps": "gasp", "groans": "groan", "yawns": "yawn",
               "chuckling": "chuckle", "crying": "cry", "sobs": "sob", "snorts": "snort", "shouting": "shout"}
KNOWN_TAGS = GEMINI_TAGS | set(TAG_ALIASES) | set(PAUSE_SECONDS)

_TAG_TOKEN_RE = re.compile(
    r"(?P<brk><\s*break\b[^>]*>)"
    r"|\[\s*(?P<sq>[A-Za-z][A-Za-z' \-]{0,38})\s*\]"
    r"|<\s*(?P<ang>[A-Za-z][A-Za-z' \-]{0,38}?)\s*/?\s*>", re.I)
_BREAK_TIME_RE = re.compile(r"""time\s*=\s*["']?\s*(\d+(?:\.\d+)?)\s*(ms|s)?""", re.I)


def _tag_name(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.strip().lower())


def break_seconds(tag: str) -> float:
    m = _BREAK_TIME_RE.search(tag)
    if not m:
        return PAUSE_SECONDS["pause"]
    v = float(m.group(1))
    return v / 1000.0 if (m.group(2) or "s").lower() == "ms" else v


def has_tags(text: str) -> bool:
    return bool(_TAG_TOKEN_RE.search(text or ""))


def translate_tags(text: str, pause_fn, tag_fn, dropped: list | None = None) -> str:
    """Rewrite every delivery tag: pauses via pause_fn(seconds, original_break_tag_or_None), other tags via
    tag_fn(name) (return "" to drop). Untagged text is returned unchanged."""
    if not has_tags(text):
        return text
    out: list[str] = []
    pos = 0
    changed = False
    for m in _TAG_TOKEN_RE.finditer(text):
        out.append(text[pos:m.start()])
        pos = m.end()
        if m.group("brk"):
            r = pause_fn(break_seconds(m.group(0)), m.group(0))
        else:
            name = _tag_name(m.group("sq") or m.group("ang"))
            r = pause_fn(PAUSE_SECONDS[name], None) if name in PAUSE_SECONDS else tag_fn(name)
            if not r and dropped is not None:
                dropped.append(m.group(0))
        changed |= r != m.group(0)
        out.append(f" {r} " if r else " ")
    out.append(text[pos:])
    if not changed:          # every tag passes through verbatim: keep the text byte-for-byte (same cache key)
        return text
    paras = []
    for p in "".join(out).split("\n\n"):
        p = re.sub(r"[ \t]+", " ", p).strip()
        p = re.sub(r" +([,.;:!?])", r"\1", p)
        if p:
            paras.append(p)
    return "\n\n".join(paras)


def strip_tags_for_display(text: str) -> str:
    """Transcript text: every delivery tag removed."""
    return translate_tags(text, lambda s, o: "", lambda n: "")


class TagRules:
    """Mix-in for TTS engines: prepare() turns script text into what the engine should hear."""
    dropped: list = []

    def pause_markup(self, seconds: float, original: str | None) -> str:
        return ""

    def tag_markup(self, name: str) -> str:
        return ""

    def prepare(self, text: str) -> str:
        self.dropped = []
        return translate_tags(text, self.pause_markup, self.tag_markup, self.dropped)


def _secs(v: float) -> str:
    return f"{round(v, 2):g}"


# ─── script + slides ────────────────────────────────────────────────────────

HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s*SLIDE\s+(\d+)\b\s*(?:[—–\-:|.]+)?\s*(.*?)\s*#*\s*$", re.I)
CUT_HEADING_RE = re.compile(
    r"^\s{0,3}#{1,6}\s*CUT[ _-]?SCENE\s+([A-Za-z0-9][\w-]*)\s*(?:[—–\-:|.]+)?\s*(.*?)\s*#*\s*$", re.I)


def strip_markdown(text: str) -> str:
    import html as _html
    t = text
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", t)                    # images
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)                 # links -> text
    t = re.sub(r"`([^`]*)`", r"\1", t)                              # inline code
    t = re.sub(r"(\*\*\*|___)(?=\S)(.+?)(?<=\S)\1", r"\2", t)
    t = re.sub(r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1", r"\2", t)
    t = re.sub(r"(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])", r"\1", t)
    t = re.sub(r"(?<![\w_])_(?=\S)(.+?)(?<=\S)_(?![\w_])", r"\1", t)
    t = re.sub(r"~~(.+?)~~", r"\1", t)
    t = re.sub(r"<(?!break\b)([^>]+)>",                              # html tags (keep <break>, <sigh> …)
               lambda m: m.group(0) if _tag_name(m.group(1).rstrip("/ ")) in KNOWN_TAGS else "", t)
    t = t.replace("**", "").replace("__", "")
    t = _html.unescape(t)
    return t


def clean_narration(lines: list[str]) -> str:
    paras: list[list[str]] = [[]]
    in_comment = False
    in_fence = False
    for raw in lines:
        s = raw.strip()
        if in_comment:
            if "-->" in s:
                in_comment = False
                s = s.split("-->", 1)[1].strip()
            else:
                continue
        if "<!--" in s:
            before, _, after = s.partition("<!--")
            if "-->" in after:
                s = (before + after.split("-->", 1)[1]).strip()
            else:
                in_comment = True
                s = before.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if s.startswith(">"):                   # stage directions: not spoken
            continue
        if re.match(r"^#{1,6}\s", s):           # sub-headings: labels, not spoken
            continue
        if not s or re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", s):
            if paras[-1]:
                paras.append([])
            continue
        s = re.sub(r"^([-*+]|\d+[.)])\s+", "", s)   # list markers
        paras[-1].append(s)
    text = "\n\n".join(" ".join(p) for p in paras if p)
    text = strip_markdown(text)
    text = "\n\n".join(re.sub(r"[ \t]+", " ", p).strip() for p in text.split("\n\n"))
    return text.strip()


def parse_script(path: Path) -> tuple[dict[int, dict], list[str]]:
    """Return ({n: {"title", "text"}}, warnings)."""
    out, _cuts, warnings = parse_script_full(path)
    return out, warnings


def parse_script_full(path: Path) -> tuple[dict[int, dict], list[dict], list[str]]:
    """Return ({n: {"title", "text"}}, [cut scene {"id","title","text","after"}], warnings).
    A '## CUTSCENE A — Title' heading marks a cut scene after the SLIDE section above it; any
    narration under it is an optional voiceover."""
    warnings: list[str] = []
    if not path.exists():
        die(f"Script not found: {path}")
    lines = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
    sections: list[tuple[int, str, list[str]]] = []
    cut_secs: list[tuple[str, str, int, list[str]]] = []
    cur: list[str] | None = None
    for line in lines:
        m = HEADING_RE.match(line)
        c = CUT_HEADING_RE.match(line) if not m else None
        if m:
            sections.append((int(m.group(1)), m.group(2).strip(), []))
            cur = sections[-1][2]
        elif c:
            after = sections[-1][0] if sections else 0
            cut_secs.append((c.group(1).strip("-_"), c.group(2).strip(), after, []))
            cur = cut_secs[-1][3]
        elif cur is not None:
            cur.append(line)
    if not sections:
        die(f"No '## SLIDE <n> — <title>' headings found in {path}")
    cuts: list[dict] = []
    for cid, title, after, body in cut_secs:
        if any(x["id"].lower() == cid.lower() for x in cuts):
            warnings.append(f"script: CUTSCENE {cid} appears more than once — only the first is used")
            continue
        cuts.append({"id": cid, "title": title, "text": clean_narration(body), "after": after})
    out: dict[int, dict] = {}
    for n, title, body in sections:
        text = clean_narration(body)
        if n in out:
            warnings.append(f"script: SLIDE {n} appears more than once — the texts were joined")
            out[n]["text"] = (out[n]["text"] + "\n\n" + text).strip()
        else:
            out[n] = {"title": title, "text": text}
            out[n]["voice"] = flpt_guest_tag(body)  # FLPT_GUEST_VOICE_V1
    nums = sorted(out)
    expected = list(range(1, (max(nums) if nums else 0) + 1))
    missing = [n for n in expected if n not in out]
    if missing:
        warnings.append(f"script: slide numbers should run 1..{max(nums)}; missing {missing}")
    if nums and nums[0] != 1:
        warnings.append(f"script: first slide heading is SLIDE {nums[0]}, expected SLIDE 1")
    for n in nums:
        if not out[n]["text"]:
            warnings.append(f"script: SLIDE {n} has no narration (it will be held silently for {SILENT_HOLD_S:.0f}s)")
    return out, cuts, warnings


class Slide:
    kind = "slide"

    def __init__(self, n: int, png: Path, title: str, text: str, sid: str | None):
        self.n, self.png, self.title, self.text, self.sid = n, png, title, text, sid
        self.narration_wav: Path | None = None
        self.narration_s = 0.0
        self.frames = 0
        self.padded_wav: Path | None = None
        self.pad_key = ""
        self.avatar_kind = "none"       # clip | still | none
        self.avatar_src: Path | None = None
        self.avatar_key = ""
        self.clip_offset = 0.0          # seconds; + = clip speech starts late (trim), - = early (delay)
        self.start = 0.0
        self.video: dict | None = None  # media.json video background (resolved), if any
        self.card: Path | None = None   # --draft placeholder card when that video is missing
        self.cut_before = False         # a cut scene plays right before this slide (whole deck)
        self.cut_after = False          # ... right after it
        self.audio_wav: Path | None = None   # what goes into the final mix (padded narration, or + video audio)
        self.bubble = True              # media.json "bubble": false → narration only, no presenter (no HeyGen clip)

    @property
    def duration(self) -> float:
        return self.frames / FPS

    @property
    def name(self) -> str:
        return f"slide {self.n:2d}"

    @property
    def live_video(self) -> bool:
        return bool(self.video and self.video["exists"])

    @property
    def bg_png(self) -> Path:
        return self.card or self.png

    def probe_copy(self) -> "Slide":
        p = Slide(self.n, self.png, self.title, self.text, self.sid)
        p.cut_before, p.cut_after = self.cut_before, self.cut_after
        p.cut_after_hard = getattr(self, "cut_after_hard", False)
        p.bubble = self.bubble
        return p


class CutScene:
    """A full-screen clip between slides: no bubble, its own audio, fades through black."""
    kind = "cutscene"

    def __init__(self, cid: str, title: str, after: int):
        self.id, self.title, self.after = cid, title, after
        self.src: Path | None = None       # the clip (None / missing → placeholder card in --draft)
        self.src_label = ""
        self.exists = False
        self.audio = "keep"                # keep | mute
        self.fade = CUTSCENE_FADE_S
        self.volume = 1.0
        self.clip_start = 0.0
        self.max_len: float | None = None  # media.json "duration"
        self.fit = "cover"
        self.pad = "freeze"
        self.text = ""                     # optional voiceover
        self.bed = VOICEOVER_BED
        self.card: Path | None = None
        self.narration_wav: Path | None = None
        self.narration_s = 0.0
        self.frames = 0
        self.start = 0.0
        self.audio_wav: Path | None = None
        self.stereo = True

    @property
    def duration(self) -> float:
        return self.frames / FPS

    @property
    def name(self) -> str:
        return f"cut   {self.id:>2s}"

    @property
    def label(self) -> str:
        return f"Cut scene: {self.title}" if self.title else f"Cut scene {self.id}"

    @property
    def slug(self) -> str:
        return re.sub(r"[^A-Za-z0-9_-]+", "_", self.id)


# ─── media.json: video slides + cut scenes ──────────────────────────────────
#
# presentation/media.json (next to script.md; override with --media). Paths are relative to it.
# {
#   "slides":    {"5": {"video": "media/slide_05.mp4", "fit": "cover", "pad": "freeze", "audio": "mute"},
#                 "11": {"video": "media/slide_11.mp4", "bubble": false}},   # bubble false = voice-over only, no avatar clip
#   "cutscenes": [{"id": "A", "after_slide": 7, "video": "media/cutscene_A.mp4", "title": "…",
#                  "audio": "keep", "fade": 0.6}]
# }

SLIDE_MEDIA_KEYS = {"video", "fit", "pad", "audio", "volume", "start", "note", "bubble",
                    "stereo"}  # FLPT_STEREO_V1
CUT_MEDIA_KEYS = {"id", "after_slide", "video", "title", "audio", "fade", "fade_in", "volume", "start", "duration",
                  "fit", "voiceover", "voiceover_bed", "note"}
_clip_info_cache: dict[Path, dict] = {}


def clip_info(path: Path) -> dict:
    """{"duration": video seconds, "has_audio": bool, "w", "h"} of a video file."""
    path = Path(path)
    if path not in _clip_info_cache:
        info = ffprobe_json(path)
        vs = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
        if not vs:
            raise PipelineError(f"{path.name} has no video stream")
        dur = 0.0
        for cand in (vs.get("duration"), (info.get("format") or {}).get("duration")):
            try:
                dur = float(cand)
                if dur > 0:
                    break
            except (TypeError, ValueError):
                continue
        _clip_info_cache[path] = {"duration": dur, "w": int(vs["width"]), "h": int(vs["height"]),
                                  "has_audio": any(s.get("codec_type") == "audio" for s in info.get("streams", []))}
    return _clip_info_cache[path]


def _find_media(base: Path, rel: str | None, default_stem: str) -> tuple[Path | None, str]:
    """Resolve a media path; with no path given, look for <base>/media/<default_stem>.<ext>."""
    if rel:
        p = Path(rel).expanduser()
        p = p if p.is_absolute() else (base / p)
        return p.resolve(), rel
    for ext in VIDEO_EXTS:
        p = base / "media" / f"{default_stem}{ext}"
        if p.exists():
            return p.resolve(), f"media/{default_stem}{ext}"
    return (base / "media" / f"{default_stem}.mp4").resolve(), f"media/{default_stem}.mp4"


def _num(v, what: str, lo: float, hi: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise PipelineError(f"media.json: {what} must be a number (got {v!r})")
    if not lo <= f <= hi:
        raise PipelineError(f"media.json: {what}={f:g} is out of range ({lo:g}–{hi:g})")
    return f


def _choice(v, what: str, options: tuple, default: str) -> str:
    if v is None or v == "":
        return default
    s = str(v).strip().lower()
    if s not in options:
        raise PipelineError(f"media.json: {what} must be one of {', '.join(options)} (got {v!r})")
    return s


def load_media(media_path: Path, script_cuts: list[dict], slide_nums: list[int]) -> tuple[dict, list[CutScene], list[str], set[int]]:
    """Read media.json (optional) and merge it with the script's CUTSCENE headings.
    Returns ({slide n: resolved video spec}, [CutScene in play order], warnings, {slides with "bubble": false})."""
    warnings: list[str] = []
    base = media_path.parent
    data: dict = {}
    if media_path.exists():
        try:
            data = json.loads(media_path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as e:
            raise PipelineError(f"{media_path.name} is not valid JSON: {e}")
        if not isinstance(data, dict):
            raise PipelineError(f"{media_path.name}: the top level must be an object with \"slides\" / \"cutscenes\"")
        for k in data:
            if k not in ("slides", "cutscenes") and not k.startswith("_"):
                warnings.append(f"media.json: unknown top-level key {k!r} (ignored)")
    videos: dict[int, dict] = {}
    no_bubble: set[int] = set()
    for key, spec in (data.get("slides") or {}).items():
        if str(key).startswith("_"):
            continue
        try:
            n = int(key)
        except ValueError:
            raise PipelineError(f"media.json: slide key {key!r} must be a slide number like \"5\"")
        if isinstance(spec, str):
            spec = {"video": spec}
        if not isinstance(spec, dict) or not (spec.get("video") or "bubble" in spec):
            raise PipelineError(f"media.json: slide {n} needs a \"video\" path (or \"bubble\": false)")
        if "bubble" in spec:
            bv = spec["bubble"]
            if isinstance(bv, str):
                bv = bv.strip().lower() not in ("false", "no", "0", "off", "hide", "hidden")
            if not bool(bv) and n in slide_nums:
                no_bubble.add(n)
        for k in spec:
            if k not in SLIDE_MEDIA_KEYS and not k.startswith("_"):
                warnings.append(f"media.json: slide {n}: unknown key {k!r} (ignored)")
        if n not in slide_nums:
            warnings.append(f"media.json: slide {n} does not exist in the deck — its video is ignored")
            continue
        if not spec.get("video"):
            continue
        path, label = _find_media(base, spec["video"], f"slide_{n:02d}")
        videos[n] = {"path": path, "label": label, "exists": path.exists(),
                     "fit": _choice(spec.get("fit"), f"slide {n} fit", ("cover", "contain", "stretch"), "cover"),
                     "pad": _choice(spec.get("pad"), f"slide {n} pad", ("freeze", "loop"), "freeze"),
                     "audio": _choice(spec.get("audio"), f"slide {n} audio", ("mute", "mix"), "mute"),
                     "volume": _num(spec.get("volume", MIX_VOLUME), f"slide {n} volume", 0, 4),
                     "start": _num(spec.get("start", 0), f"slide {n} start", 0, 36000)}
        # FLPT_STEREO_V1: "stereo": true keeps the video's own sound in stereo; only set when asked for
        if spec.get("stereo") is True or str(spec.get("stereo", "")).strip().lower() in ("true", "yes", "1", "on"):
            videos[n]["stereo"] = True

    # Cut scenes: media.json entries first (their order), then script-only ones; media.json wins per field.
    by_id: dict[str, dict] = {}
    order: list[str] = []
    raw_cuts = data.get("cutscenes") or []
    if not isinstance(raw_cuts, list):
        raise PipelineError("media.json: \"cutscenes\" must be a list")
    for i, spec in enumerate(raw_cuts):
        if not isinstance(spec, dict):
            raise PipelineError(f"media.json: cutscenes[{i}] must be an object")
        cid = str(spec.get("id") or chr(ord("A") + i)).strip()
        for k in spec:
            if k not in CUT_MEDIA_KEYS and not k.startswith("_"):
                warnings.append(f"media.json: cut scene {cid}: unknown key {k!r} (ignored)")
        if cid.lower() in by_id:
            raise PipelineError(f"media.json: cut scene id {cid!r} is used twice")
        by_id[cid.lower()] = {"media": spec, "id": cid}
        order.append(cid.lower())
    for sc in script_cuts:
        k = sc["id"].lower()
        if k not in by_id:
            by_id[k] = {"id": sc["id"]}
            order.append(k)
        by_id[k]["script"] = sc

    cuts: list[CutScene] = []
    last = max(slide_nums) if slide_nums else 0
    for k in order:
        ent = by_id[k]
        m, sc = ent.get("media") or {}, ent.get("script") or {}
        cid = ent["id"]
        after = m.get("after_slide", sc.get("after"))
        if after is None:
            raise PipelineError(f"media.json: cut scene {cid} needs \"after_slide\" (or a ## CUTSCENE {cid} heading "
                                "in script.md)")
        after = int(_num(after, f"cut scene {cid} after_slide", 0, 100000))
        if sc and "after_slide" in m and int(m["after_slide"]) != sc.get("after"):
            warnings.append(f"cut scene {cid}: media.json says after slide {m['after_slide']} but script.md puts it "
                            f"after slide {sc.get('after')} — using media.json")
        if after > last:
            warnings.append(f"cut scene {cid}: after_slide {after} is past the last slide ({last}) — plays at the end")
            after = last
        c = CutScene(cid, str(m.get("title") or sc.get("title") or "").strip(), after)
        c.src, c.src_label = _find_media(base, m.get("video"), f"cutscene_{cid}")
        c.exists = c.src.exists()
        c.audio = _choice(m.get("audio"), f"cut scene {cid} audio", ("keep", "mute"), "keep")
        c.fade = _num(m.get("fade", CUTSCENE_FADE_S), f"cut scene {cid} fade", 0, 5)
        # "fade_in": 0 = hard cut in (no video fade in, and the slide before it doesn't fade out) — for a slide
        # that ends on the cut scene's exact first frame. The cut scene's audio still fades in by "fade".
        c.fade_in = _num(m.get("fade_in", c.fade), f"cut scene {cid} fade_in", 0, 5)
        c.volume = _num(m.get("volume", 1.0), f"cut scene {cid} volume", 0, 4)
        c.clip_start = _num(m.get("start", 0), f"cut scene {cid} start", 0, 36000)
        c.max_len = _num(m["duration"], f"cut scene {cid} duration", 0.5, 3600) if m.get("duration") else None
        c.fit = _choice(m.get("fit"), f"cut scene {cid} fit", ("cover", "contain", "stretch"), "cover")
        c.bed = _num(m.get("voiceover_bed", VOICEOVER_BED), f"cut scene {cid} voiceover_bed", 0, 4)
        vo = m.get("voiceover", True)
        if isinstance(vo, str) and vo.strip().lower() not in ("true", "false", "yes", "no", "1", "0"):
            c.text = clean_narration(vo.splitlines())            # voiceover text given in media.json
        elif str(vo).strip().lower() not in ("false", "no", "0"):
            c.text = sc.get("text", "")
        cuts.append(c)
    cuts.sort(key=lambda c: c.after)   # stable: same after_slide keeps file order
    return videos, cuts, warnings, no_bubble


def load_project(paths, draft: bool) -> tuple[list[Slide], list[CutScene], list[str]]:
    """Slides (with their video backgrounds) + cut scenes, in deck order. Missing media → draft placeholders."""
    slides, warnings = load_slides(paths.slides_dir, paths.script)
    _, script_cuts, _ = parse_script_full(paths.script)
    nums = [s.n for s in slides]
    videos, cuts, w2, no_bubble = load_media(paths.media, script_cuts, nums)
    warnings += w2
    for s in slides:
        s.video = videos.get(s.n)
        s.bubble = s.n not in no_bubble
    for c in cuts:
        nxt = next((n for n in nums if n > c.after), None)
        if nxt is not None:
            next(s for s in slides if s.n == nxt).cut_before = True
        if c.after in nums:
            sl = next(s for s in slides if s.n == c.after)
            sl.cut_after = True
            sl.cut_after_hard = getattr(c, "fade_in", None) == 0
    missing = [f"slide {s.n}: {s.video['label']}" for s in slides if s.video and not s.video["exists"]] + \
              [f"cut scene {c.id}: {c.src_label}" for c in cuts if not c.exists]
    if missing:
        warnings.append("media not found (" + ("placeholder title cards in this draft" if draft else
                        "the final render needs them") + "): " + "; ".join(missing))
    return slides, cuts, warnings


def sequence(slides: list[Slide], cuts: list[CutScene]) -> list:
    """Interleave cut scenes after their slides (after_slide 0 = before the first slide)."""
    items: list = [c for c in cuts if c.after < slides[0].n] if slides else []
    for s in slides:
        items.append(s)
        items += [c for c in cuts if c.after == s.n]
    return items


def load_slides(slides_dir: Path, script: Path) -> tuple[list[Slide], list[str]]:
    warnings: list[str] = []
    pngs: dict[int, Path] = {}
    for f in slides_dir.glob("slide_*.png"):
        m = re.fullmatch(r"slide_(\d+)\.png", f.name)
        if m:
            pngs[int(m.group(1))] = f
    if not pngs:
        die(f"No slide_NN.png files in {slides_dir}. Run render_slides.py first.")
    ids: dict[str, str] = {}
    idx = slides_dir / "index.json"
    if idx.exists():
        try:
            ids = json.loads(idx.read_text())
        except json.JSONDecodeError:
            pass
    nums = sorted(pngs)
    if nums != list(range(1, len(nums) + 1)):
        warnings.append(f"slides: PNG numbers are not contiguous 1..N: {nums}")
    sections, w2 = parse_script(script)
    warnings += w2
    if len(sections) != len(pngs):
        warnings.append(f"MISMATCH: script has {len(sections)} slide sections but there are {len(pngs)} slide PNGs")
    for n in sorted(sections):
        if n not in pngs:
            warnings.append(f"script SLIDE {n} has no slide_{n:02d}.png — its narration is skipped")
    slides = []
    for n in nums:
        sec = sections.get(n)
        if sec is None:
            warnings.append(f"slide_{n:02d}.png has no script section — held silently for {SILENT_HOLD_S:.0f}s")
        slides.append(Slide(n, pngs[n], (sec or {}).get("title", ""), (sec or {}).get("text", ""), ids.get(str(n))))
        slides[-1].flpt_voice = (sec or {}).get("voice")  # FLPT_GUEST_VOICE_V1
    return slides, warnings


def parse_range(spec: str | None, valid: list[int]) -> list[int]:
    if not spec:
        return list(valid)
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            if "-" in part:
                a, b = part.split("-", 1)
                out.update(range(int(a), int(b) + 1))
            else:
                out.add(int(part))
        except ValueError:
            die(f"--slides: can't read {part!r}; use e.g. 3-5 or 2,7,9")
    sel = [n for n in valid if n in out]
    if not sel:
        die(f"--slides {spec}: none of those slides exist (have {valid[0]}..{valid[-1]})")
    return sel


# ─── tiny PNG writer + bubble artwork (pure Python) ─────────────────────────


def write_png(path: Path, w: int, h: int, mode: str, data: bytes) -> None:
    ct, bpp = {"L": (0, 1), "RGB": (2, 3), "RGBA": (6, 4)}[mode]
    stride = w * bpp
    raw = b"".join(b"\x00" + data[y * stride:(y + 1) * stride] for y in range(h))

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ct, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    tmp = path.with_suffix(".tmp.png")
    tmp.write_bytes(png)
    os.replace(tmp, path)


def _smoothstep(e0: float, e1: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _sd_round_box(px: float, py: float, half: float, corner: float) -> float:
    """Signed distance from (px, py) (relative to the centre) to a rounded square; a circle when corner == half."""
    qx, qy = abs(px) - (half - corner), abs(py) - (half - corner)
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - corner


class Bubble:
    """Geometry + cached artwork (mask + ring/shadow PNGs) for the presenter bubble."""

    def __init__(self, assets_dir: Path, diameter: int = BUBBLE_D, position: str = DEFAULT_POSITION,
                 shape: str = "circle", margin: int = MARGIN):
        if position not in BUBBLE_POSITIONS:
            raise PipelineError(f"BUBBLE_POSITION must be one of {', '.join(BUBBLE_POSITIONS)} (got {position!r})")
        if shape not in BUBBLE_SHAPES:
            raise PipelineError(f"BUBBLE_SHAPE must be one of {', '.join(BUBBLE_SHAPES)} (got {shape!r})")
        self.d = max(60, min(1000, int(diameter))) // 2 * 2
        self.r = self.d / 2.0
        self.shape, self.position, self.margin = shape, position, int(margin)
        self.corner = self.r if shape == "circle" else ROUNDED_RADIUS * self.d
        self.outer_r = self.r + RING_W                       # half-size of the ring's outer edge
        cx = (self.margin + self.outer_r) if position.endswith("left") else (W - self.margin - self.outer_r)
        cy = (self.margin + self.outer_r) if position.startswith("top") else (H - self.margin - self.outer_r)
        self.ax = int(round(cx - self.r)) // 2 * 2          # avatar top-left (even for yuv420)
        self.ay = int(round(cy - self.r)) // 2 * 2
        self.pad = DECOR_PAD
        self.decor_size = self.d + 2 * self.pad
        self.dx, self.dy = self.ax - self.pad, self.ay - self.pad
        self.assets = assets_dir
        self.assets.mkdir(parents=True, exist_ok=True)
        tag = f"d{self.d}_r{RING_W}_p{self.pad}_v{PIPELINE_VERSION}"
        if shape != "circle":
            tag = f"{shape}{ROUNDED_RADIUS:g}_" + tag
        self.mask_png = self.assets / f"bubble_mask_{tag}.png"
        self.decor_png = self.assets / f"bubble_decor_{tag}.png"
        self._mask: bytes | None = None
        self._decor: bytes | None = None

    def geometry_key(self) -> str:
        return (f"{self.shape}|{self.corner:.3f}|{self.d}|{RING_W}|{self.ax},{self.ay}|{self.pad}|{SHADOW_BLUR}|"
                f"{SHADOW_DY}|{SHADOW_OPACITY}")

    def describe(self) -> str:
        return f"{self.shape} {self.d}px · {self.position} · margin {self.margin}px"

    def still_name(self, stem: str) -> Path:
        return self.assets / f"{stem}_{self.d}{'' if self.shape == 'circle' else '_' + self.shape}.png"

    def ensure_artwork(self) -> None:
        if not self.mask_png.exists():
            d, r, k = self.d, self.r, self.corner
            buf = bytearray(d * d)
            for y in range(d):
                py = y + 0.5 - r
                for x in range(d):
                    sd = _sd_round_box(x + 0.5 - r, py, r, k)
                    buf[y * d + x] = int(round(255 * min(1.0, max(0.0, 0.5 - sd))))
            write_png(self.mask_png, d, d, "L", bytes(buf))
        if not self.decor_png.exists():
            s, c = self.decor_size, self.decor_size / 2.0
            buf = bytearray(s * s * 4)
            half, k = self.outer_r, self.corner + RING_W
            for y in range(s):
                for x in range(s):
                    ra = min(1.0, max(0.0, 0.5 - _sd_round_box(x + 0.5 - c, y + 0.5 - c, half, k))) * 0.96
                    ds = _sd_round_box(x + 0.5 - c, y + 0.5 - c - SHADOW_DY, half, k)
                    sa = SHADOW_OPACITY * (1.0 - _smoothstep(-10, SHADOW_BLUR, ds))
                    a = ra + sa * (1 - ra)
                    col = int(round(255 * ra / a)) if a > 0 else 0
                    i = (y * s + x) * 4
                    buf[i:i + 4] = bytes((col, col, col, int(round(255 * a))))
            write_png(self.decor_png, s, s, "RGBA", bytes(buf))

    def _load_raw(self, png: Path, mode: str) -> bytes:
        size = self.d if "mask" in png.name else self.decor_size
        pix = {"gray": 1, "rgba": 4}[mode]
        r = run([FFMPEG, "-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", mode, "-"], f"read {png.name}")
        if len(r.stdout) != size * size * pix:
            raise PipelineError(f"unexpected size reading {png}")
        return r.stdout

    def still_bubble(self, src: Path, zoom: float, focus_y: float, out: Path) -> Path:
        """Composite ring+shadow+circle-cropped still image into one RGBA PNG."""
        if out.exists():
            return out
        self.ensure_artwork()
        if self._mask is None:
            self._mask = self._load_raw(self.mask_png, "gray")
            self._decor = self._load_raw(self.decor_png, "rgba")
        sw, sh = video_size(src)
        crop = crop_expr(sw, sh, zoom, focus_y)
        r = run([FFMPEG, "-v", "error", "-i", src, "-frames:v", "1",
                 "-vf", f"{crop},scale={self.d}:{self.d}:flags=lanczos",
                 "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], f"crop {src.name}")
        rgb = r.stdout
        if len(rgb) != self.d * self.d * 3:
            raise PipelineError(f"could not read image {src}")
        s, d, p = self.decor_size, self.d, self.pad
        out_buf = bytearray(self._decor)  # type: ignore[arg-type]
        m = self._mask
        for y in range(d):
            for x in range(d):
                a = m[y * d + x] / 255.0  # type: ignore[index]
                if a <= 0:
                    continue
                i = ((y + p) * s + (x + p)) * 4
                j = (y * d + x) * 3
                da = out_buf[i + 3] / 255.0
                oa = a + da * (1 - a)
                for k in range(3):
                    out_buf[i + k] = int(round((rgb[j + k] * a + out_buf[i + k] * da * (1 - a)) / oa))
                out_buf[i + 3] = int(round(oa * 255))
        write_png(out, s, s, "RGBA", bytes(out_buf))
        return out


BUBBLE_FOCUS_X = 0.5   # horizontal face position 0..1; set from BUBBLE_FOCUS_X in api_keys.txt


def crop_expr(sw: int, sh: int, zoom: float, focus_y: float) -> str:
    """Square crop: side = min(w,h)/zoom, centre at (BUBBLE_FOCUS_X*w, focus_y*h), clamped to the frame."""
    zoom = max(1.0, zoom)
    side = int(min(sw, sh) / zoom) // 2 * 2
    x0 = int(round(BUBBLE_FOCUS_X * sw - side / 2))
    x0 = max(0, min(sw - side, x0))
    y0 = int(round(focus_y * sh - side / 2))
    y0 = max(0, min(sh - side, y0))
    return f"crop={side}:{side}:{x0}:{y0}"


def gradient_placeholder(out: Path) -> Path:
    """Fallback if assets/ai_presenter_placeholder.png is missing: neutral gradient + silhouette."""
    if out.exists():
        return out
    s = 600
    buf = bytearray(s * s * 3)
    top, bot = (0x5B, 0x6B, 0x82), (0x1A, 0x21, 0x2C)
    for y in range(s):
        for x in range(s):
            t = min(1.0, math.hypot(x - 180, y - 130) / 620)
            base = [top[k] + (bot[k] - top[k]) * t for k in range(3)]
            head = 82 - math.hypot(x - 300, y - 230) + 0.5
            body = 1.0 if (y >= 318 and y <= 430 and ((x - 300) / 150) ** 2 + ((y - 430) / 118) ** 2 <= 1) else 0.0
            a = max(min(1.0, max(0.0, head)), body) * 0.42
            i = (y * s + x) * 3
            buf[i:i + 3] = bytes(int(round(base[k] * (1 - a) + 0xC9 * a)) for k in range(3))
    write_png(out, s, s, "RGB", bytes(buf))
    return out


# ─── WAV helpers (stdlib) ───────────────────────────────────────────────────


def wav_frames(path: Path) -> int:
    with wave.open(str(path), "rb") as w:
        return w.getnframes()


def to_wav48(src: Path, dst: Path) -> None:
    tmp = dst.with_suffix(".tmp.wav")
    run([FFMPEG, "-y", "-v", "error", "-i", src, "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", tmp],
        f"convert {src.name} to 48 kHz WAV")
    os.replace(tmp, dst)


def concat_wavs(parts: list[Path], dst: Path) -> None:
    tmp = dst.with_suffix(".tmp.wav")
    with wave.open(str(tmp), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SR)
        for p in parts:
            with wave.open(str(p), "rb") as w:
                if (w.getnchannels(), w.getsampwidth(), w.getframerate()) != (1, 2, SR):
                    raise PipelineError(f"{p} is not 48 kHz mono 16-bit")
                out.writeframes(w.readframes(w.getnframes()))
    os.replace(tmp, dst)


def concat_audio(parts: list[Path], dst: Path) -> int:
    """Sample-exact join of 48 kHz 16-bit WAVs. All mono → mono (as before); if any part is stereo
    (a cut scene), mono parts are duplicated to both channels. Returns the channel count."""
    import array
    chans = []
    for p in parts:
        with wave.open(str(p), "rb") as w:
            if w.getsampwidth() != 2 or w.getframerate() != SR or w.getnchannels() not in (1, 2):
                raise PipelineError(f"{p} is not 48 kHz 16-bit mono/stereo")
            chans.append(w.getnchannels())
    if max(chans, default=1) == 1:
        concat_wavs(parts, dst)
        return 1
    tmp = dst.with_suffix(".tmp.wav")
    with wave.open(str(tmp), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(SR)
        for p, ch in zip(parts, chans):
            with wave.open(str(p), "rb") as w:
                data = w.readframes(w.getnframes())
            if ch == 1:
                a = array.array("h")
                a.frombytes(data)
                st = array.array("h", bytes(len(data) * 2))
                st[0::2] = a
                st[1::2] = a
                data = st.tobytes()
            out.writeframes(data)
    os.replace(tmp, dst)
    return 2


def fix_wav_length(path: Path, n: int) -> None:
    """Pad with silence / truncate a WAV to exactly n sample frames (guards ffmpeg rounding)."""
    with wave.open(str(path), "rb") as w:
        params = w.getparams()
        have = w.getnframes()
        if have == n:
            return
        data = w.readframes(min(have, n))
    bpf = params.nchannels * params.sampwidth
    data += b"\x00" * (bpf * (n - min(have, n)))
    tmp = path.with_suffix(".fix.wav")
    with wave.open(str(tmp), "wb") as out:
        out.setnchannels(params.nchannels)
        out.setsampwidth(params.sampwidth)
        out.setframerate(params.framerate)
        out.writeframes(data)
    os.replace(tmp, path)


def write_padded_wav(src: Path | None, dst: Path, lead: int, total: int) -> None:
    tmp = dst.with_suffix(".tmp.wav")
    with wave.open(str(tmp), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SR)
        out.writeframes(b"\x00\x00" * lead)
        n = 0
        if src is not None:
            with wave.open(str(src), "rb") as w:
                n = min(w.getnframes(), total - lead)
                out.writeframes(w.readframes(n))
        out.writeframes(b"\x00\x00" * (total - lead - n))
    os.replace(tmp, dst)


# ─── video slides + cut scenes: media helpers ───────────────────────────────

_sha_memo: dict[tuple, str] = {}


def sha_file_memo(path: Path) -> str:
    st = Path(path).stat()
    k = (str(path), st.st_size, st.st_mtime_ns)
    if k not in _sha_memo:
        _sha_memo[k] = sha_file(path)
    return _sha_memo[k]


def fit_filter(fit: str) -> str:
    if fit == "contain":
        return (f"scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1")
    if fit == "stretch":
        return f"scale={W}:{H}:flags=lanczos,setsar=1"
    return f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},setsar=1"


def video_input(path: Path, start: float, loop: bool) -> list:
    a: list = ["-stream_loop", "-1"] if loop else []
    if start > 0:
        a += ["-ss", f"{start:.3f}"]
    return a + ["-i", path]


def video_chain(fit: str, n: int, loop: bool) -> str:
    """Decoded clip → exactly n frames of 1920x1080 yuv420p at FPS (last frame frozen if the clip is short)."""
    pad = "" if loop else f"tpad=stop_mode=clone:stop_duration={n / FPS + 1:.3f},"
    return (f"setpts=PTS-STARTPTS,fps={FPS},{fit_filter(fit)},{TO_YUV},{pad}"
            f"trim=end_frame={n},setpts=N/{FPS}/TB,settb=1/{FPS}")


def video_frame_png(path: Path, t: float, fit: str, out: Path) -> Path | None:
    """One fitted 1920x1080 frame of a clip at time t (cached)."""
    if out.exists():
        return out
    tmp = out.with_suffix(".tmp.png")
    r = subprocess.run([FFMPEG, "-y", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(path),
                        "-frames:v", "1", "-vf", fit_filter(fit), str(tmp)], capture_output=True)
    if r.returncode != 0 or not tmp.exists():
        return None
    os.replace(tmp, out)
    return out


def tail_png(s: "Slide", cache: Path) -> Path:
    """What the slide shows in its last frame, for the cross-fade into the next slide."""
    if not s.live_video:
        return s.bg_png
    v = s.video
    L = max(0.0, clip_info(v["path"])["duration"])
    T = max(0.0, (s.frames - 1) / FPS) if s.frames else 0.0     # unknown length (subset preview) → first frame
    if v["pad"] == "loop" and L > 0:
        first = max(0.0, L - v["start"])
        t = v["start"] + T if T < first else (T - first) % L
    else:
        t = v["start"] + T
    t = max(0.0, min(t, L - 2.0 / FPS))
    out = cache / "assets" / f"tail_{sha_file_memo(v['path'])[:12]}_{v['fit']}_{t:.3f}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    return video_frame_png(v["path"], t, v["fit"], out) or s.png


def placeholder_card(cache: Path, kicker: str, title: str, detail: str) -> Path:
    """Dark 1920x1080 title card (PNG) for media that doesn't exist yet. Rendered with headless Chrome
    because this ffmpeg has no drawtext; falls back to a plain dark card without text."""
    import html as _html
    out = cache / "assets" / f"card_{sha_text('card2', kicker, title, detail)[:16]}.png"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    e = _html.escape
    page = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:#0B0E13}}
body{{display:flex;flex-direction:column;justify-content:center;padding:0 160px;box-sizing:border-box;
  background:radial-gradient(1200px 700px at 30% 35%,#1D2533 0%,#0B0E13 70%);color:#ECE8E0;
  font-family:-apple-system,'Helvetica Neue',Arial,sans-serif}}
.k{{font:600 30px/1 -apple-system,Arial;letter-spacing:.24em;text-transform:uppercase;color:#E7A1B5}}
.t{{font:600 92px/1.08 Georgia,'Times New Roman',serif;margin:34px 0 40px;max-width:1500px}}
.d{{font:400 30px/1.4 Menlo,monospace;color:#8C97A4}}
.bar{{position:absolute;left:0;right:0;height:70px;background:#000}} .top{{top:0}} .bot{{bottom:0}}
</style><div class="bar top"></div><div class="bar bot"></div>
<div class="k">{e(kicker)}</div><div class="t">{e(title or '(untitled)')}</div><div class="d">{e(detail)}</div>"""
    ok = False
    try:
        if str(VIDEO_DIR) not in sys.path:
            sys.path.insert(0, str(VIDEO_DIR))
        import render_slides as _rs
        chrome = _rs.find_chrome(None)
        with tempfile.TemporaryDirectory(prefix="card_") as td:
            hp = Path(td) / "card.html"
            hp.write_text(page, encoding="utf-8")
            ok, _msg = _rs.run_chrome(chrome, hp, out, timeout=40)
    except (SystemExit, ImportError, OSError):
        ok = False
    if not ok:
        run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=0x141A23:s={W}x{H}", "-frames:v", "1", out],
            "plain placeholder card")
        log(f"  ! Chrome unavailable: placeholder card for {title!r} has no text")
    return out


def cutscene_frames(c: "CutScene") -> int:
    if c.exists:
        avail = max(0.1, clip_info(c.src)["duration"] - c.clip_start)
        if c.max_len:
            avail = min(avail, c.max_len)
    else:
        avail = c.max_len or PLACEHOLDER_CUTSCENE_S
    need = avail
    if c.narration_wav is not None:
        need = max(need, c.fade + c.narration_s + TAIL_S + c.fade)
    return max(FPS, math.ceil(need * FPS - 1e-3))


def cut_fade(c: "CutScene") -> float:
    return round(min(c.fade, c.duration / 3), 3)


def make_cutscene_audio(c: "CutScene", cache: Path) -> Path:
    """The cut scene's own sound (48 kHz stereo, exact length), faded with the picture, plus any voiceover."""
    n = c.frames * SPF
    dur = c.frames / FPS
    fade = cut_fade(c)
    use_clip = c.exists and c.audio == "keep" and clip_info(c.src)["has_audio"]
    key = sha_text("cutaudio", sha_file_memo(c.src) if use_clip else "none", c.clip_start, c.frames, fade,
                   c.volume, c.bed, c.narration_wav.stem if c.narration_wav else "")[:20]
    out = cache / "audio" / "cut" / f"{c.slug}_{key}.wav"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd: list = [FFMPEG, "-y", "-v", "error"]
    f = []
    if use_clip:
        cmd += (["-ss", f"{c.clip_start:.3f}"] if c.clip_start else []) + ["-i", c.src]
        f.append(f"[0:a]aresample={SR},aformat=sample_fmts=s16:channel_layouts=stereo,volume={c.volume:g},"
                 f"apad,atrim=end_sample={n},afade=t=in:st=0:d={fade:.3f},"
                 f"afade=t=out:st={max(0.0, dur - fade):.4f}:d={fade:.3f}[bed]")
    else:
        cmd += ["-f", "lavfi", "-i", f"anullsrc=r={SR}:cl=stereo"]
        f.append(f"[0:a]aformat=sample_fmts=s16:channel_layouts=stereo,atrim=end_sample={n}[bed]")
    if c.narration_wav is not None:
        cmd += ["-i", c.narration_wav]
        f.append(f"[bed]volume={c.bed if use_clip else 1:g}[b2]")
        f.append(f"[1:a]aformat=sample_fmts=s16:channel_layouts=stereo,adelay={int(round(fade * 1000))}:all=1,"
                 f"apad,atrim=end_sample={n}[vo]")
        f.append(f"[b2][vo]amix=inputs=2:normalize=0:duration=first,apad=whole_len={n},atrim=end_sample={n}[out]")
    else:
        f.append(f"[bed]apad=whole_len={n},atrim=end_sample={n}[out]")
    tmp = out.with_suffix(".tmp.wav")
    run(cmd + ["-filter_complex", ";".join(f), "-map", "[out]", "-ac", "2", "-ar", str(SR), "-c:a", "pcm_s16le", tmp],
        f"audio for cut scene {c.id}")
    fix_wav_length(tmp, n)
    os.replace(tmp, out)
    return out


def make_slide_audio(s: "Slide", cache: Path) -> Path:
    """Padded narration, plus the background video's own sound when media.json says "audio": "mix"."""
    v = s.video
    if not (s.live_video and v["audio"] == "mix" and clip_info(v["path"])["has_audio"]):
        return s.padded_wav  # type: ignore[return-value]
    n = s.frames * SPF
    st = bool(v.get("stereo"))  # FLPT_STEREO_V1: in the hash only when set, so mono mixes keep their keys
    key = sha_text("mix", s.pad_key, sha_file_memo(v["path"]), v["start"], v["pad"], v["volume"], n,
                   *(["stereo"] if st else []))[:20]
    out = cache / "audio" / "mix" / f"{key}.wav"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp.wav")
    run([FFMPEG, "-y", "-v", "error", "-i", s.padded_wav, *video_input(v["path"], v["start"], v["pad"] == "loop"),
         "-filter_complex",
         f"[1:a]aresample={SR},aformat=sample_fmts=s16:channel_layouts={'stereo' if st else 'mono'},"
         f"volume={v['volume']:g},apad,atrim=end_sample={n}[b];"
         f"{'[0:a]pan=stereo|c0=c0|c1=c0[a];[a]' if st else '[0:a]'}[b]"  # FLPT_STEREO_V1: narration in the middle
         f"amix=inputs=2:normalize=0:duration=first,atrim=end_sample={n}[out]",
         "-map", "[out]", "-ac", "2" if st else "1", "-ar", str(SR), "-c:a", "pcm_s16le", tmp],
        f"audio mix for slide {s.n}")
    fix_wav_length(tmp, n)
    os.replace(tmp, out)
    return out


# ─── HTTP (requests is only needed for paid / list / check modes) ───────────


class ApiError(Exception):
    def __init__(self, msg: str, status: int | None = None, body: str = ""):
        super().__init__(msg)
        self.status, self.body = status, body


def _requests():
    try:
        import requests  # noqa: F401
        return requests
    except ImportError:
        die("The Python package 'requests' is needed for API calls.\n"
            "    Double-click RUN_ME.command once (it sets this up), or run:\n"
            "    python3 -m venv .venv && .venv/bin/pip install requests && .venv/bin/python generate_presentation_video.py ...")


def api_call(method: str, url: str, *, what: str, headers: dict, retries: int = 3,
             retry_statuses: tuple = (429, 500, 502, 503, 504), timeout: float = 60, **kw):
    rq = _requests()
    delay = 3.0
    for attempt in range(retries + 1):
        try:
            r = rq.request(method, url, headers=headers, timeout=timeout, **kw)
        except rq.RequestException as e:
            if attempt < retries:
                log(f"      {what}: network problem ({e.__class__.__name__}); retrying in {delay:.0f}s")
                time.sleep(delay)
                delay *= 2
                continue
            raise ApiError(f"{what}: network error: {e}")
        if r.status_code in retry_statuses and attempt < retries:
            ra = r.headers.get("Retry-After", "")
            wait = float(ra) if ra.replace(".", "", 1).isdigit() else delay
            log(f"      {what}: HTTP {r.status_code}; retrying in {wait:.0f}s")
            time.sleep(min(wait, 120))
            delay *= 2
            continue
        return r
    raise ApiError(f"{what}: gave up after retries")


def body_snippet(r) -> str:
    try:
        return json.dumps(r.json())[:400]
    except ValueError:
        return (r.text or "")[:400]


def explain_http(service: str, r) -> str:
    code = r.status_code
    hint = ""
    if code in (401, 403):
        hint = {
            "ElevenLabs": "Your ElevenLabs API key was rejected. Create a new key at elevenlabs.io → "
                          "Developers → API Keys (give it Text to Speech + Voices read access, and User read "
                          "for quota checks), then paste it into api_keys.txt.",
            "HeyGen": "Your HeyGen API key was rejected. Copy it again from app.heygen.com → Settings → "
                      "API (API token), then paste it into api_keys.txt.",
            "Gemini": "Your Gemini API key was rejected. Create one at aistudio.google.com/apikey and save it "
                      "with: python3 set_keys.py --global gemini",
        }.get(service, "The API key was rejected.")
    elif code == 404:
        hint = ("Not found — check GEMINI_TTS_MODEL / GEMINI_VOICE." if service == "Gemini"
                else "Not found — check the voice/avatar ID in api_keys.txt.")
    elif code == 400 and service == "Gemini":
        hint = "Gemini refused the request — check GEMINI_TTS_MODEL, GEMINI_VOICE and GEMINI_LANGUAGE."
    elif code == 429:
        hint = "Rate limited or out of credits/quota."
    return f"{service} HTTP {code}: {body_snippet(r)}" + (f"\n      → {hint}" if hint else "")


# ─── ElevenLabs ─────────────────────────────────────────────────────────────


class ElevenLabs:
    def __init__(self, key: str):
        self.key = key

    def h(self, **extra) -> dict:
        return {"xi-api-key": self.key, **extra}

    def get(self, path: str, what: str, **params):
        return api_call("GET", EL_API + path, what=what, headers=self.h(accept="application/json"),
                        params=params or None)

    def voices(self) -> list[dict]:
        r = self.get("/v1/voices", "list voices")
        if r.status_code != 200:
            raise ApiError(explain_http("ElevenLabs", r), r.status_code)
        return r.json().get("voices", [])

    def voice(self, voice_id: str):
        return self.get(f"/v1/voices/{voice_id}", "get voice")

    def subscription(self):
        return self.get("/v1/user/subscription", "subscription")


def split_for_tts(text: str, limit: int = 4500) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    cur = ""
    pieces: list[str] = []
    for para in text.split("\n\n"):
        if len(para) <= limit:
            pieces.append(para)
        else:
            pieces += re.split(r"(?<=[.!?])\s+", para)
    for p in pieces:
        if cur and len(cur) + len(p) + 2 > limit:
            chunks.append(cur)
            cur = p
        else:
            cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        chunks.append(cur)
    return chunks


class ElevenLabsTTS(TagRules):
    """ElevenLabs. Delivery tags: eleven_v3 keeps [laughs]-style audio tags and uses [short pause]/[pause]/
    [long pause]; every other model gets <break time="Xs" /> (max 3 s) and drops the other tags."""
    tag = "elevenlabs"
    label = "ElevenLabs"

    @property
    def v3(self) -> bool:
        return self.model.startswith("eleven_v3")

    def pause_markup(self, seconds: float, original: str | None) -> str:
        if self.v3:   # "Eleven v3 does not support SSML break tags"
            return "[short pause]" if seconds < 0.6 else ("[pause]" if seconds < 1.2 else "[long pause]")
        if original and seconds <= 3.0:
            return original
        return f'<break time="{_secs(min(seconds, 3.0))}s" />'

    def tag_markup(self, name: str) -> str:
        return f"[{name}]" if self.v3 else ""

    def __init__(self, cfg: dict):
        self.api = ElevenLabs(cfg["ELEVENLABS_API_KEY"])
        self.voice_id = cfg["ELEVENLABS_VOICE_ID"]
        self.model = cfg.get("ELEVENLABS_MODEL") or DEFAULT_MODEL
        self.fmt = cfg.get("ELEVENLABS_OUTPUT_FORMAT") or "mp3_44100_128"
        self.settings = {
            "stability": cfg_float(cfg, "ELEVENLABS_STABILITY", 0.5),
            "similarity_boost": cfg_float(cfg, "ELEVENLABS_SIMILARITY", 0.8),
            "style": cfg_float(cfg, "ELEVENLABS_STYLE", 0.0),
            "use_speaker_boost": True,
        }
        if cfg.get("ELEVENLABS_SPEED"):
            self.settings["speed"] = cfg_float(cfg, "ELEVENLABS_SPEED", 1.0)

    def key(self) -> str:
        return f"eleven|{self.voice_id}|{self.model}|{json.dumps(self.settings, sort_keys=True)}|{self.fmt}"

    def describe(self) -> str:
        return f"ElevenLabs voice {self.voice_id} · model {self.model}"

    def synth(self, text: str, out_wav: Path, tmp: Path) -> None:
        parts = []
        chunks = split_for_tts(text)
        for i, chunk in enumerate(chunks):
            body = {"text": chunk, "model_id": self.model, "voice_settings": self.settings}
            if not self.model.startswith("eleven_v3"):   # continuity hints (not supported by v3)
                if i > 0:
                    body["previous_text"] = chunks[i - 1][-1000:]
                if i + 1 < len(chunks):
                    body["next_text"] = chunks[i + 1][:1000]
            r = api_call("POST", f"{EL_API}/v1/text-to-speech/{self.voice_id}", what="text-to-speech",
                         headers=self.api.h(accept="audio/mpeg", **{"Content-Type": "application/json"}),
                         params={"output_format": self.fmt}, json=body, timeout=300)
            if r.status_code != 200 or not r.headers.get("content-type", "").startswith("audio"):
                raise ApiError(explain_http("ElevenLabs", r), r.status_code, body_snippet(r))
            ext = "mp3" if self.fmt.startswith("mp3") else "raw"
            src = tmp / f"chunk{i}.{ext}"
            src.write_bytes(r.content)
            if ext == "raw":  # pcm_<rate>: 16-bit little-endian mono
                rate = int(self.fmt.split("_")[1])
                wav_src = tmp / f"chunk{i}.src.wav"
                run([FFMPEG, "-y", "-v", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", src, wav_src],
                    "decode pcm")
                src = wav_src
            w = tmp / f"chunk{i}.wav"
            to_wav48(src, w)
            parts.append(w)
        if len(parts) == 1:
            os.replace(parts[0], out_wav)
        else:
            concat_wavs(parts, out_wav)
        # keep the original MP3 alongside the WAV for reference
        if len(chunks) == 1 and self.fmt.startswith("mp3"):
            shutil.copyfile(tmp / "chunk0.mp3", out_wav.with_suffix(".mp3"))


HG_API = "https://api.heygen.com"
FISH_API = "https://api.fish.audio"  # FLPT_VOICES_V1
# FLPT_VOICES_V1 (engine/tools/patches/34_voices.py): QA only. FLPT_QA_API_BASE=http://127.0.0.1:<port> sends HeyGen,
# ElevenLabs and Fish.audio to FLPT's loopback stand-in; anything but a loopback address is ignored.
_FLPT_QA = os.environ.get("FLPT_QA_API_BASE", "").strip().rstrip("/")
if re.fullmatch(r"http://127\.0\.0\.1:\d{2,5}", _FLPT_QA):
    HG_API, EL_API, FISH_API = f"{_FLPT_QA}/heygen", f"{_FLPT_QA}/elevenlabs", f"{_FLPT_QA}/fish"


def flpt_fish() -> bool:
    return os.environ.get("FLPT_TTS", "").strip().lower() == "fish"


class FishTTS(TagRules):
    """Narration in a Fish.audio voice (FLPT_TTS=fish): POST /v1/tts with the voice model as reference_id."""
    tag = "fish"
    label = "Fish.audio"

    def pause_markup(self, seconds: float, original: str | None) -> str:
        return " ... " if seconds >= 0.4 else ", "

    def __init__(self, cfg: dict):
        self.api_key = cfg["FISH_AUDIO_API_KEY"]
        self.voice_id = cfg["FISH_VOICE_ID"]
        self.model = (cfg.get("FISH_MODEL") or "s2.1-pro").strip()

    def key(self) -> str:
        return f"fish|{self.voice_id}|{self.model}|wav"

    def describe(self) -> str:
        return f"Fish.audio voice {self.voice_id} · model {self.model}"

    def synth(self, text: str, out_wav: Path, tmp: Path) -> None:
        parts = []
        h = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json", "model": self.model}
        for i, chunk in enumerate(split_for_tts(text, 2000)):
            body = {"text": chunk, "reference_id": self.voice_id, "format": "wav", "latency": "normal", "normalize": True}
            r = api_call("POST", f"{FISH_API}/v1/tts", what="Fish.audio text-to-speech", headers=h, json=body, timeout=300)
            if r.status_code != 200 or not r.content:
                raise ApiError(explain_http("Fish.audio", r), r.status_code, body_snippet(r))
            src = tmp / f"chunk{i}.src.wav"
            src.write_bytes(r.content)
            w = tmp / f"chunk{i}.wav"
            to_wav48(src, w)
            parts.append(w)
        if len(parts) == 1:
            os.replace(parts[0], out_wav)
        else:
            concat_wavs(parts, out_wav)


TTS_PROVIDERS = ("elevenlabs", "heygen", "gemini")


# FLPT_HEYGEN_BASE (engine/tools/patches/41_heygen_base.py): in the web image HeyGen goes through FLPT's egress broker
# (http://heygen.internal, or a loopback wrangler dev / stand-in), which swaps the container's dummy key for the user's
# only on a request carrying the job's capability (X-FLPT-Job) and dedupes creates on their clip key (X-FLPT-Clip).
def flpt_heygen_base() -> str:
    b = os.environ.get("FLPT_HEYGEN_BASE", "").strip().rstrip("/")
    ok = re.fullmatch(r"http://heygen\.internal(:\d{2,5})?", b) or re.fullmatch(r"http://127\.0\.0\.1:\d{2,5}(/[A-Za-z0-9_-]+)*", b)
    return b if ok else ""


_FLPT_HG_BASE = flpt_heygen_base()
if _FLPT_HG_BASE:
    HG_API, HG_UPLOAD = _FLPT_HG_BASE, f"{_FLPT_HG_BASE}/upload/v1/asset"


def flpt_hg(h: dict, clip: str | None = None) -> dict:
    """HeyGen's headers, plus (only through FLPT's broker) the job's capability and, on a create, its clip key."""
    if not _FLPT_HG_BASE:
        return h
    out = dict(h)
    job = os.environ.get("FLPT_HEYGEN_JOB", "").strip()
    if re.fullmatch(r"[A-Za-z0-9._~-]{16,256}", job):
        out["X-FLPT-Job"] = job
    if clip:
        out["X-FLPT-Clip"] = clip
    return out


def tts_provider(cfg: dict) -> str:
    """Which service narrates: 'elevenlabs' (default), 'heygen' (your HeyGen voice) or 'gemini' (Gemini TTS)."""
    if flpt_fish():  # FLPT_VOICES_V1: Fish.audio, chosen by FLPT for this run only
        return "fish"
    p = (cfg.get("TTS_PROVIDER") or "elevenlabs").strip().lower()
    if p not in TTS_PROVIDERS:
        die(f"TTS_PROVIDER={p!r} is not one of {', '.join(TTS_PROVIDERS)}")
    return p


def provider_keys(provider: str) -> list[str]:
    return {"heygen": ["HEYGEN_API_KEY", "HEYGEN_VOICE_ID"], "gemini": ["GEMINI_API_KEY"],
            "elevenlabs": ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"],
            "fish": ["FISH_AUDIO_API_KEY", "FISH_VOICE_ID"]}[provider]  # FLPT_VOICES_V1


def make_engine(cfg: dict):
    p = tts_provider(cfg)
    return {"heygen": HeyGenTTS, "gemini": GeminiTTS, "elevenlabs": ElevenLabsTTS, "fish": FishTTS}[p](cfg)  # FLPT_VOICES_V1


# FLPT_WORDS_V1: a provider's word timings, kept in a words/ subfolder beside the narration (never *.json beside it:
# retime.py reads every cache/audio/*/*.json as narration metadata)
def flpt_words(reply: dict, at: float) -> list:
    raw = reply.get("word_timestamps") if isinstance(reply, dict) else None
    out = []
    for w in raw if isinstance(raw, list) else []:
        if not isinstance(w, dict):
            continue
        text = w.get("word", w.get("text"))
        start, end = w.get("start", w.get("start_time")), w.get("end", w.get("end_time"))
        if isinstance(text, str) and isinstance(start, (int, float)) and isinstance(end, (int, float)) and end >= start:
            out.append({"text": text, "start": round(at + float(start), 3), "end": round(at + float(end), 3)})
    return out


def flpt_save_words(out_wav: Path, words: list) -> None:
    if not words:
        return
    d = out_wav.parent / "words"
    d.mkdir(parents=True, exist_ok=True)
    atomic_write_json(d / f"{out_wav.stem}.json", words)


class HeyGenTTS(TagRules):
    """Narration in a HeyGen voice via POST /v3/voices/speech (returns an audio URL). The rest of the pipeline is
    unchanged: that audio is uploaded back to HeyGen and the avatar lip-syncs to it.
    HEYGEN_VOICE_ENGINE picks the speech engine. Since 2026-10 the API requires one of the voice's
    `available_engines` (GET /v3/voices?type=private): starfish (the default and original sound), orca,
    elevenlabs, elevenlabs_v3.
    Delivery tags: starfish/orca/elevenlabs turn pauses into <break time="Xs"/> and drop the rest; elevenlabs_v3
    keeps audio tags such as [laughs] [chuckles] [sighs] [breath] and uses [short pause]/[pause]/[long pause]."""
    tag = "heygen"
    label = "HeyGen voice"

    @property
    def v3(self) -> bool:
        return self.engine == "elevenlabs_v3"

    def pause_markup(self, seconds: float, original: str | None) -> str:
        if self.v3:   # ElevenLabs v3 has no SSML breaks; it reads bracketed pause tags
            return "[short pause]" if seconds < 0.6 else ("[pause]" if seconds < 1.2 else "[long pause]")
        if original and re.search(r"\d\s*s\b", original) and "ms" not in original.lower():
            return original
        return f'<break time="{_secs(seconds)}s"/>'

    def tag_markup(self, name: str) -> str:
        return f"[{name}]" if self.v3 else ""

    def __init__(self, cfg: dict):
        self.api_key = cfg["HEYGEN_API_KEY"]
        self.voice_id = cfg["HEYGEN_VOICE_ID"]
        self.speed = cfg_float(cfg, "HEYGEN_VOICE_SPEED", 1.0)
        self.language = (cfg.get("HEYGEN_VOICE_LANGUAGE") or "en").strip()
        self.engine = (cfg.get("HEYGEN_VOICE_ENGINE") or "starfish").strip()

    def key(self) -> str:
        # starfish keeps the pre-2026-10 cache key, so earlier narration stays cached
        base = f"heygen|{self.voice_id}|{self.speed}|{self.language}"
        return base if self.engine == "starfish" else f"{base}|{self.engine}"

    def describe(self) -> str:
        return f"HeyGen voice {self.voice_id} · engine {self.engine} · speed {self.speed}"

    def synth(self, text: str, out_wav: Path, tmp: Path) -> None:
        parts = []
        words, at = [], 0.0  # FLPT_WORDS_V1
        h = {"X-Api-Key": self.api_key, "Content-Type": "application/json", "accept": "application/json"}
        for i, chunk in enumerate(split_for_tts(text, 4800)):
            body = {"text": chunk, "voice_id": self.voice_id, "speed": self.speed, "language": self.language,
                    "engine": self.engine}
            r = api_call("POST", f"{HG_API}/v3/voices/speech", what="HeyGen text-to-speech", headers=flpt_hg(h, f"tts-{out_wav.stem}-{i}"),
                         json=body, timeout=300)
            if r.status_code != 200:
                raise ApiError(explain_http("HeyGen", r), r.status_code, body_snippet(r))
            j = r.json() or {}
            d = j.get("data") if isinstance(j.get("data"), dict) else j
            url = d.get("audio_url")
            if not url:
                raise ApiError("HeyGen text-to-speech returned no audio_url", r.status_code, body_snippet(r))
            a = api_call("GET", url, what="download HeyGen speech", headers={}, timeout=300)
            if a.status_code != 200:
                raise ApiError(f"download HeyGen speech: HTTP {a.status_code}", a.status_code)
            src = tmp / f"chunk{i}.mp3"
            src.write_bytes(a.content)
            w = tmp / f"chunk{i}.wav"
            to_wav48(src, w)
            parts.append(w)
            words += flpt_words(d, at)  # FLPT_WORDS_V1
            at += wav_frames(w) / SR
        if len(parts) == 1:
            os.replace(parts[0], out_wav)
            shutil.copyfile(tmp / "chunk0.mp3", out_wav.with_suffix(".mp3"))
        else:
            concat_wavs(parts, out_wav)
        flpt_save_words(out_wav, words)


# ─── Gemini TTS ─────────────────────────────────────────────────────────────
#
# POST {GEMINI_API}/models/{model}:generateContent, header x-goog-api-key.
# Docs (checked 2026-09-27): https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
#   body   contents[0].parts[0] = {"text": <verbatim transcript>, "speech_metadata": {"style": "..."}}
#          generationConfig = {"responseModalities": ["AUDIO"],
#                              "speechConfig": {"voiceConfig": {"voice": "Kore" | "voice_…" | "voicekey_…"}}}
#   reply  candidates[0].content.parts[0].inlineData.data = base64 audio. 3.8 models return a WAV
#          (24 kHz mono s16le) by default; 3.1/2.5 previews returned headerless PCM (audio/L16;rate=24000).
#   voice replication (your cloned voice): gemini-3.8-flash-tts / -lite only, via voiceConfig.voice
#          https://ai.google.dev/gemini-api/docs/generate-content/voice-replication
#   limits 8,192 input / 16,384 output tokens per request (25 audio tokens per second ≈ 655 s of audio).

GEMINI_VOICES = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
                 "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
                 "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird",
                 "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"]
GEMINI_CHUNK_CHARS = 4000       # ≈ 4.5 min of speech per request (one request per normal slide); cap ≈ 655 s


def gemini_legacy(model: str) -> bool:
    """3.1 / 2.5 preview TTS models: prebuilt voices only, no speech_metadata, no angle-bracket tags."""
    return model.startswith(("gemini-2.", "gemini-3.0", "gemini-3.1"))


def decode_gemini_audio(data: bytes, mime: str, stem: Path, out_wav: Path) -> None:
    """Gemini audio (WAV, or raw 16-bit little-endian PCM labelled audio/L16;rate=24000) → 48 kHz mono WAV."""
    mime = (mime or "").lower()
    if data[:4] == b"RIFF":
        src = stem.with_suffix(".src.wav")
        src.write_bytes(data)
        to_wav48(src, out_wav)
        return
    if "l16" in mime or "pcm" in mime or not mime:
        m = re.search(r"rate=(\d+)", mime)
        ch = re.search(r"channels=(\d+)", mime)
        raw = stem.with_suffix(".pcm")
        raw.write_bytes(data)
        tmp = out_wav.with_suffix(".tmp.wav")
        run([FFMPEG, "-y", "-v", "error", "-f", "s16le", "-ar", m.group(1) if m else "24000",
             "-ac", ch.group(1) if ch else "1", "-i", raw, "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", tmp],
            "decode Gemini PCM")
        os.replace(tmp, out_wav)
        return
    ext = {"audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/ogg": ".ogg"}.get(mime.split(";")[0], ".bin")
    src = stem.with_suffix(ext)
    src.write_bytes(data)
    to_wav48(src, out_wav)


class GeminiTTS(TagRules):
    """Narration from Google's Gemini TTS (e.g. gemini-3.8-flash-tts) in a prebuilt voice or your replicated
    (cloned) voice. The WAV then goes to HeyGen for lip-sync exactly like ElevenLabs audio.
    Delivery tags: Gemini 3.8's own angle-bracket tags (<sigh>, <laugh>, <short pause> …) pass through;
    [laughs]/[sighs]/[breath]/[pause] are converted; anything Gemini doesn't list is dropped."""
    tag = "gemini"
    label = "Gemini TTS"

    def __init__(self, cfg: dict):
        self.api_key = cfg["GEMINI_API_KEY"]
        self.model = (cfg.get("GEMINI_TTS_MODEL") or GEMINI_DEFAULT_MODEL).strip()
        self.voice = (cfg.get("GEMINI_VOICE") or GEMINI_DEFAULT_VOICE).strip()
        self.style = (cfg.get("GEMINI_STYLE_PROMPT") or "").strip()
        self.language = (cfg.get("GEMINI_LANGUAGE") or "").strip()
        self.chunk_chars = int(cfg_float(cfg, "GEMINI_CHUNK_CHARS", GEMINI_CHUNK_CHARS))
        self.legacy = gemini_legacy(self.model)
        if self.legacy and self.custom_voice:
            raise PipelineError(f"GEMINI_VOICE is a cloned voice, which needs gemini-3.8-flash-tts or "
                                f"gemini-3.8-flash-lite-tts (GEMINI_TTS_MODEL is {self.model})")

    @property
    def custom_voice(self) -> bool:
        return self.voice.startswith(("voice_", "voicekey_"))

    def voice_label(self) -> str:
        # a voicekey_ is a client-held encrypted voice: treat it like a secret in logs
        return mask_key(self.voice) if self.voice.startswith("voicekey_") else self.voice

    def key(self) -> str:
        return f"gemini|{self.model}|{self.voice}|{self.style}|{self.language}|{self.chunk_chars}"

    def describe(self) -> str:
        kind = "cloned voice" if self.custom_voice else "voice"
        return (f"Gemini TTS {self.model} · {kind} {self.voice_label()}"
                + (f" · style “{self.style[:40]}”" if self.style else ""))

    def pause_markup(self, seconds: float, original: str | None) -> str:
        if self.legacy:
            return "..."
        return "<short pause>" if seconds < 1.0 else "<long pause>"

    def tag_markup(self, name: str) -> str:
        if self.legacy:
            return ""
        canon = TAG_ALIASES.get(name, name)
        return f"<{canon}>" if canon in GEMINI_TAGS else ""

    def request_body(self, text: str, prebuilt_shape: bool | None = None) -> dict:
        prebuilt_shape = self.legacy if prebuilt_shape is None else prebuilt_shape
        part: dict = {"text": text}
        if self.style and not self.legacy:
            part["speech_metadata"] = {"style": self.style}      # 3.8: never put directions inside the text
        elif self.style:
            part["text"] = f"{self.style}: {text}"              # 3.1 / 2.5: style prompt as a prefix
        voice_cfg = {"prebuiltVoiceConfig": {"voiceName": self.voice}} if prebuilt_shape else {"voice": self.voice}
        speech: dict = {"voiceConfig": voice_cfg}
        if self.language:
            speech["languageCode"] = self.language
        return {"contents": [{"role": "user", "parts": [part]}],
                "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": speech}}

    def _request(self, text: str) -> tuple[bytes, str]:
        import base64
        url = f"{GEMINI_API}/models/{self.model}:generateContent"
        h = {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}
        last, j = "", {}
        prebuilt_shape, no_audio = self.legacy, 0
        while True:
            r = api_call("POST", url, what="Gemini text-to-speech", headers=h,
                         json=self.request_body(text, prebuilt_shape), timeout=300)
            if (r.status_code == 400 and not prebuilt_shape and not self.custom_voice
                    and re.search(r"voice", body_snippet(r), re.I)):
                # Older accounts/models may only know the prebuiltVoiceConfig.voiceName shape (a 400 is not billed).
                log("      Gemini refused voiceConfig.voice; retrying with prebuiltVoiceConfig.voiceName")
                prebuilt_shape = True
                continue
            if r.status_code != 200:
                raise ApiError(explain_http("Gemini", r), r.status_code, body_snippet(r))
            j = r.json() or {}
            for cand in j.get("candidates") or []:
                for part in ((cand.get("content") or {}).get("parts") or []):
                    inline = part.get("inlineData") or part.get("inline_data") or {}
                    if inline.get("data"):
                        return (base64.b64decode(inline["data"]),
                                inline.get("mimeType") or inline.get("mime_type") or "")
            cands = j.get("candidates") or [{}]
            last = (f"finishReason={cands[0].get('finishReason')} "
                    f"blockReason={(j.get('promptFeedback') or {}).get('blockReason')}")
            no_audio += 1
            if no_audio >= 2:             # the TTS models occasionally answer without audio: retry once
                raise ApiError(f"Gemini returned no audio ({last})", 200, json.dumps(j)[:400])

    def synth(self, text: str, out_wav: Path, tmp: Path) -> None:
        chunks = split_for_tts(text, self.chunk_chars)
        parts: list[Path] = []
        for i, chunk in enumerate(chunks):
            data, mime = self._request(chunk)
            w = tmp / f"chunk{i}.wav"
            decode_gemini_audio(data, mime, tmp / f"chunk{i}", w)
            if parts:                                   # a short breath between requests
                gap = tmp / f"gap{i}.wav"
                write_padded_wav(None, gap, 0, int(0.25 * SR))
                parts.append(gap)
            parts.append(w)
        if len(parts) == 1:
            os.replace(parts[0], out_wav)
        else:
            concat_wavs(parts, out_wav)


# ─── macOS `say` (draft) ────────────────────────────────────────────────────

NOVELTY_VOICES = {
    "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Wobble", "Fred", "Good News",
    "Jester", "Junior", "Kathy", "Organ", "Superstar", "Ralph", "Trinoids", "Whisper", "Zarvox",
    "Eddy", "Flo", "Grandma", "Grandpa", "Reed", "Rocko", "Sandy", "Shelley",
}
PREFERRED_VOICES = ["Ava", "Zoe", "Evan", "Nathan", "Allison", "Samantha", "Tom", "Susan", "Serena",
                    "Daniel", "Karen", "Moira", "Tessa", "Alex"]


# FLPT_FREE_TTS (engine/tools/patches/40_free_tts.py): where there is no Mac voice (the web image on Linux), the free
# voice is Kokoro-82M, run by FLPT's own Python for it from pinned model files. Only with FLPT_FREE_TTS=kokoro: SayTTS
# keeps its name, tag ("say") and pause markup and speaks through Kokoro; its cache key says kokoro. Offline, keyless.
FLPT_KOKORO_VOICE = "af_heart"
FLPT_KOKORO_ENGLISH = ("af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "am_michael", "am_fenrir",
                       "am_puck", "bf_emma", "bf_isabella", "bm_george", "bm_fable")
FLPT_KOKORO_RUN = r"""
import json, sys, wave
import numpy as np
from kokoro_onnx import Kokoro
a = json.loads(sys.argv[1])
k = Kokoro(a["model"], a["voices"])
sr, out = 24000, []
for p in a["parts"]:
    if "text" in p:
        audio, sr = k.create(p["text"], voice=a["voice"], speed=a["speed"], lang=a["lang"])
        out.append(np.asarray(audio, dtype=np.float32).ravel())
    else:
        out.append(np.zeros(int(round(p["pause"] * sr)), dtype=np.float32))
pcm = np.concatenate(out) if out else np.zeros(int(0.2 * sr), dtype=np.float32)
pcm = (np.clip(pcm, -1.0, 1.0) * 32767.0).round().astype("<i2")
with wave.open(a["out"], "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    w.writeframes(pcm.tobytes())
print(json.dumps({"ok": True, "samples": int(pcm.size), "rate": int(sr)}))
"""
_flpt_kokoro_names: list | None = None


def flpt_free_tts() -> bool:
    return os.environ.get("FLPT_FREE_TTS", "").strip().lower() == "kokoro"


def flpt_kokoro_env() -> dict:
    """FLPT's Kokoro: its Python, model and voices files, each there, or the run stops before anything is made."""
    need = {k: os.environ.get(k, "").strip() for k in ("FLPT_KOKORO_PYTHON", "FLPT_KOKORO_MODEL", "FLPT_KOKORO_VOICES")}
    missing = [k for k, v in need.items() if not v or not Path(v).is_file()]
    if missing:
        die(f"FLPT_FREE_TTS=kokoro needs {', '.join(missing)} (FLPT's Kokoro and its pinned model files). Nothing was made.")
    return need


def flpt_kokoro_voices() -> list[tuple[str, str]]:
    """FLPT's English Kokoro voices in the voices file, as say_voices() lists the Mac's: (name, locale)."""
    global _flpt_kokoro_names
    if _flpt_kokoro_names is None:
        env = flpt_kokoro_env()
        code = "import json, sys, numpy; print(json.dumps(sorted(numpy.load(sys.argv[1]).keys())))"
        r = subprocess.run([env["FLPT_KOKORO_PYTHON"], "-I", "-B", "-c", code, env["FLPT_KOKORO_VOICES"]],
                           capture_output=True, text=True)
        try:
            present = set(json.loads(r.stdout.strip().splitlines()[-1]))
        except (ValueError, IndexError):
            die(f"Kokoro's voices file couldn't be read: {(r.stderr or r.stdout).strip()[-300:]}")
        _flpt_kokoro_names = [n for n in FLPT_KOKORO_ENGLISH if n in present]
    return [(n, "en_GB" if n.startswith("b") else "en_US") for n in _flpt_kokoro_names]


def flpt_kokoro_pick(requested: str | None) -> str:
    """The voice asked for when Kokoro has it, else Kokoro's default (a Mac voice's name means the default)."""
    names = [n for n, _ in flpt_kokoro_voices()]
    if not names:
        die("Kokoro's voices file holds none of FLPT's English voices.")
    if requested and requested in names:
        return requested
    return FLPT_KOKORO_VOICE if FLPT_KOKORO_VOICE in names else names[0]


def flpt_kokoro_speed(rate) -> float:
    """say's words per minute as Kokoro's speed: 165 (the draft's default) is 1.0, kept within Kokoro's 0.5–2.0."""
    return round(min(2.0, max(0.5, float(rate) / 165.0)), 3)


def flpt_kokoro_key(voice: str, rate) -> str:
    mid = os.environ.get("FLPT_KOKORO_MODEL_ID", "").strip()
    if not mid:
        m = Path(os.environ.get("FLPT_KOKORO_MODEL", "").strip() or "kokoro")
        mid = f"{m.name}:{m.stat().st_size if m.is_file() else 0}"
    return f"kokoro|{voice}|{flpt_kokoro_speed(rate)}|{mid}"


def flpt_kokoro_synth(text: str, voice: str, rate, out_wav: Path, tmp: Path) -> None:
    """One narration through Kokoro: the text between [[slnc ms]] pauses spoken, the pauses kept as silence."""
    env = flpt_kokoro_env()
    parts = []
    for i, bit in enumerate(re.split(r"\[\[slnc (\d+)\]\]", text)):
        if i % 2:
            parts.append({"pause": int(bit) / 1000.0})
        elif bit.strip():
            parts.append({"text": " ".join(bit.split())})
    raw = tmp / "kokoro.wav"
    req = {"model": env["FLPT_KOKORO_MODEL"], "voices": env["FLPT_KOKORO_VOICES"], "voice": voice,
           "speed": flpt_kokoro_speed(rate), "lang": "en-gb" if voice.startswith("b") else "en-us", "parts": parts,
           "out": str(raw)}
    r = subprocess.run([env["FLPT_KOKORO_PYTHON"], "-I", "-B", "-c", FLPT_KOKORO_RUN, json.dumps(req)],
                       capture_output=True, text=True)
    if r.returncode != 0 or not raw.is_file():
        raise PipelineError(f"Kokoro couldn't speak this line: {(r.stderr or r.stdout).strip()[-400:]}")
    to_wav48(raw, out_wav)


def say_voices() -> list[tuple[str, str]]:
    if flpt_free_tts():  # FLPT_FREE_TTS: the free voices are Kokoro's
        return flpt_kokoro_voices()
    try:
        out = subprocess.run(["say", "-v", "?"], capture_output=True, text=True).stdout
    except OSError:
        return []
    voices = []
    for line in out.splitlines():
        m = re.match(r"^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9]{2,4})\s+#", line)
        if m:
            voices.append((m.group(1).strip(), m.group(2)))
    return voices


def pick_say_voice(requested: str | None) -> str:
    if flpt_free_tts():  # FLPT_FREE_TTS: Kokoro's voice (a Mac voice's name means its default)
        return flpt_kokoro_pick(requested)
    voices = say_voices()
    if not voices:
        die("macOS `say` is not available — draft mode needs a Mac.")
    names = [v[0] for v in voices]
    if requested:
        if requested in names:
            return requested
        die(f"--say-voice {requested!r} is not installed. Installed English voices: "
            + ", ".join(n for n, l in voices if l.startswith("en_")))

    def score(v: tuple[str, str]) -> float:
        name, loc = v
        base = name.split(" (")[0]
        if not loc.startswith("en_") or base in NOVELTY_VOICES:
            return -1
        s = 0.0
        if "Premium" in name:
            s += 100
        elif "Enhanced" in name:
            s += 80
        if base in PREFERRED_VOICES:
            s += 50 - PREFERRED_VOICES.index(base)
        s += {"en_US": 5, "en_GB": 3}.get(loc, 0)
        return s

    best = max(voices, key=score)
    if score(best) < 0:
        en = [n for n, l in voices if l.startswith("en_")]
        return en[0] if en else names[0]
    return best[0]


class SayTTS(TagRules):
    """Draft voice. Pauses become [[slnc ms]]; every other tag is stripped."""
    tag = "say"
    label = "macOS say"

    def __init__(self, voice: str, rate: int):
        self.voice, self.rate = voice, rate

    def key(self) -> str:
        if flpt_free_tts():  # FLPT_FREE_TTS: Kokoro's narration never shares a key with the Mac's
            return flpt_kokoro_key(self.voice, self.rate)
        return f"say|{self.voice}|{self.rate}"

    def describe(self) -> str:
        if flpt_free_tts():  # FLPT_FREE_TTS
            return f"Kokoro-82M · voice {self.voice} · speed {flpt_kokoro_speed(self.rate)}"
        return f"macOS say · voice {self.voice} · {self.rate} wpm"

    def pause_markup(self, seconds: float, original: str | None) -> str:
        return f"[[slnc {int(round(seconds * 1000))}]]"

    def synth(self, text: str, out_wav: Path, tmp: Path) -> None:
        t = self.prepare(text) if has_tags(text) else text      # idempotent: [[slnc]] is not a tag
        t = re.sub(r"<[^>]+>", "", t)
        t = t.replace("\n\n", " [[slnc 350]] ")
        if flpt_free_tts():  # FLPT_FREE_TTS: Kokoro speaks it, the pauses kept as silence
            flpt_kokoro_synth(t, self.voice, self.rate, out_wav, tmp)
            return
        txt = tmp / "in.txt"
        txt.write_text(t, encoding="utf-8")
        aiff = tmp / "out.aiff"
        run(["say", "-v", self.voice, "-r", str(self.rate), "-f", txt, "-o", aiff], "say")
        to_wav48(aiff, out_wav)


# FLPT_DRAFT_FINAL (engine/tools/patches/33_draft_final.py): with --draft and FLPT_DRAFT_FINAL=1 the draft's path makes
# the film itself (a cartoon presenter on the Mac's voice): final quality, presentation.mp4 and its timeline, the editing
# master, still no network and no key. Its narration lives in its own cache folder (say_final), where every reader of
# the film's narration finds it, and is the draft's audio whenever that's cached (the same file: the same pad_keys).
def flpt_draft_final() -> bool:
    return os.environ.get("FLPT_DRAFT_FINAL") == "1"


class FilmSayTTS(SayTTS):
    tag = "say_final"
    label = "macOS say (film)"

    def synth(self, text: str, out_wav: Path, tmp: Path) -> None:
        draft = out_wav.parent.parent / "say" / out_wav.name
        if draft.is_file():
            shutil.copyfile(draft, out_wav)
            return
        super().synth(text, out_wav, tmp)


# FLPT_FIXTURE_TTS: QA only (see engine/tools/patches/11_fixture_tts.py). With FLPT_FIXTURE_TTS=<folder>, narration
# comes from <folder>/<sha256(spoken text)[:16]>.wav, else from a fixed stand-in voice; nothing is synthesized.
class FixtureTTS:
    def __init__(self, inner, folder: Path):
        self.inner, self.folder = inner, folder
        self.tag = inner.tag
        self.label = f"fixture voice ({inner.label})"

    def __getattr__(self, name):  # prepare(), dropped and the tag rules stay the wrapped engine's
        if name == "inner":
            raise AttributeError(name)
        return getattr(self.inner, name)

    def key(self) -> str:
        return f"{self.inner.key()}|fixture"

    def describe(self) -> str:
        return f"fixture voice from {self.folder} (standing in for {self.inner.describe()})"

    def synth(self, text: str, out_wav: Path, tmp: Path) -> None:
        src = self.folder / f"{hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]}.wav"
        if src.is_file():
            to_wav48(src, out_wav)
            return
        import array
        pcm = array.array("h")
        rest = lambda s: pcm.extend([0] * int(round(s * SR)))  # noqa: E731
        rest(0.12)
        for tok in re.findall(r"\[\[slnc (\d+)\]\]|<break time=\"([\d.]+)s\"|([\w']+)", text):
            if tok[0] or tok[1]:
                rest(int(tok[0]) / 1000 if tok[0] else float(tok[1]))
                continue
            period = 160 + 8 * (sum(map(ord, tok[2])) % 17)       # one pitch per word, from its letters
            n = int(SR * (0.16 + 0.03 * min(len(tok[2]), 8)))
            ramp = SR // 200
            for i in range(n):
                ph = i % period
                tri = (4 * 5000 * ph) // period - 5000 if ph < period // 2 else 15000 - (4 * 5000 * ph) // period
                pcm.append((tri * min(i, n - 1 - i, ramp)) // ramp)
            rest(0.07)
        rest(0.2)
        tmp_wav = out_wav.with_suffix(".tmp.wav")
        with wave.open(str(tmp_wav), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            if sys.byteorder != "little":
                pcm.byteswap()
            w.writeframes(pcm.tobytes())
        os.replace(tmp_wav, out_wav)


def fixture_tts(engine):
    """FLPT_FIXTURE_TTS: the run's engine, or with FLPT_FIXTURE_TTS=<folder> set, fixed voices in its place."""
    folder = os.environ.get("FLPT_FIXTURE_TTS", "").strip()
    return FixtureTTS(engine, Path(folder).expanduser().resolve()) if folder else engine


# ─── narration + timeline ───────────────────────────────────────────────────


def narration_hash(engine, text: str) -> str:
    """Cache key of the audio for `text` (the text the engine actually hears — see TagRules.prepare)."""
    return sha_text("narr", PIPELINE_VERSION, engine.key(), text)[:20]


def spoken_text(engine, text: str) -> str:
    return engine.prepare(text) if hasattr(engine, "prepare") else text


# FLPT_GUEST_VOICE_V1 (engine/tools/patches/42_guest_voice.py): guest narrators. A slide with no presenter on screen
# may be narrated by another voice, named under its heading in script.md ("> flpt-voice: <provider>/<id> · <name>",
# a stage direction no narrator reads). That slide gets the guest's engine and the guest's cache key; nothing else moves.
FLPT_GUEST_TAG = re.compile(r"^\s*>\s*flpt-voice:\s*([a-z][a-z-]{1,15})/([A-Za-z0-9%._:()'~*!-]{1,192})(?:\s+·\s+.*)?\s*$")
FLPT_HOUSE_VOICES = {"362c984bbb7143aebbcf1b87f7ca7624": "Epic Storyteller Female",
                     "a1f443e46ae74ecbb84b5ef9ab9555f6": "Sarcastic Old Man",
                     "81dcca64ec094339b4dcd6508d04c28b": "Hobbiton Narrator",
                     "0d63fefbbba84269884f80c4718af930": "Young Professional Analyst",
                     "a57d512e30bf40cb996f14ab9be3f16a": "Rin",
                     "3274196bca8f4208a36aba959bff5746": "Profound Narrator JD"}
FLPT_GUEST_IDS = {
    "fish-house": lambda s: s in FLPT_HOUSE_VOICES,
    "fish": lambda s: re.fullmatch(r"[0-9a-f]{32}", s) is not None,
    "elevenlabs": lambda s: re.fullmatch(r"[A-Za-z0-9]{8,64}", s) is not None,
    "heygen": lambda s: re.fullmatch(r"[A-Za-z0-9_-]{6,128}", s) is not None,
    "say": lambda s: re.fullmatch(r"[\w ()._'-]{1,64}", s) is not None,
}
FLPT_GUEST_KEYS = {"fish-house": "FLPT_VOICES_TOKEN", "fish": "FISH_AUDIO_API_KEY", "elevenlabs": "ELEVENLABS_API_KEY",
                   "heygen": "HEYGEN_API_KEY"}
FLPT_GUEST_SAY = ("Daniel", "Moira", "Karen", "Rishi", "Tessa", "Fred", "Ralph")  # the draft's guests, by preference
# the two runs FLPT's base patches add in which nothing is made (its estimate, a cached-only re-composite)
_FLPT_NOTHING_MADE = ("FLPT_" "ESTIMATE_ONLY", "FLPT_" "CACHED_ONLY")
FLPT_VOICES_API = "https://flpt.bombadillo-ai.com"
# another Worker only on FLPT's own domain, or a loopback `wrangler dev`: the user's sign-in is sent nowhere else
FLPT_VOICES_HOSTS = re.compile(r"https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,4}bombadillo-ai\.com(?::\d{2,5})?"
                               r"|https://bombadillo-ai\.com(?::\d{2,5})?|http://(?:127\.0\.0\.1|localhost):\d{2,5}")
if FLPT_VOICES_HOSTS.fullmatch(os.environ.get("FLPT_VOICES_URL", "").strip().rstrip("/")):
    FLPT_VOICES_API = os.environ["FLPT_VOICES_URL"].strip().rstrip("/")
if re.fullmatch(r"http://127\.0\.0\.1:\d{2,5}", _FLPT_QA):  # QA only: FLPT's loopback stand-in
    FLPT_VOICES_API = f"{_FLPT_QA}/flpt"


def flpt_guest_tag(lines):
    """A slide section's guest voice ({provider, id}) from its first flpt-voice line, or None."""
    from urllib.parse import unquote
    for line in lines:
        m = FLPT_GUEST_TAG.match(line)
        if not m:
            continue
        p, vid = m.group(1), unquote(m.group(2))
        ok = FLPT_GUEST_IDS.get(p)
        return {"provider": p, "id": vid} if ok and ok(vid) else None
    return None


class FlptHouseTTS(TagRules):
    """An FLPT voice (fish-house): made by FLPT's Worker with Michael's Fish.audio house voice, for the signed-in user."""
    tag = "flpt_voice"
    label = "FLPT voice"

    def pause_markup(self, seconds: float, original: str | None) -> str:
        return " ... " if seconds >= 0.4 else ", "

    def __init__(self, cfg: dict, voice_id: str):
        self.token = cfg.get("FLPT_VOICES_TOKEN", "")
        self.voice_id = voice_id
        # the video the Worker meters (15,000 characters a video): FLPT names it, else this episode's folder does
        self.video = (cfg.get("FLPT_VOICES_VIDEO") or os.environ.get("FLPT_VOICES_VIDEO") or "").strip()[:64] \
            or sha_text("flpt-video", str(VIDEO_DIR.resolve()))[:16]

    def key(self) -> str:
        return f"flpt_voice|{self.voice_id}|wav"

    def describe(self) -> str:
        return f"FLPT voice {FLPT_HOUSE_VOICES.get(self.voice_id, self.voice_id)}"

    def request_key(self, text: str, i: int) -> str:
        """The request's idempotency key: this video, this narration (its cache hash) and the chunk. A retry (a 5xx, a
        dropped connection) sends the same key, so the Worker makes and meters it once (W4-10)."""
        return f"{sha_text('flpt-voice', self.video, narration_hash(self, text))[:32]}-{i}"

    def synth(self, text: str, out_wav: Path, tmp: Path) -> None:
        parts = []
        for i, chunk in enumerate(split_for_tts(text, 2000)):
            h = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json", "Accept": "audio/wav",
                 "Idempotency-Key": self.request_key(text, i)}
            body = {"voice": self.voice_id, "text": chunk, "video": self.video, "format": "wav"}
            r = api_call("POST", f"{FLPT_VOICES_API}/api/voices/fish", what="FLPT voice", headers=h, json=body, timeout=300)
            if r.status_code != 200 or not r.content:
                why = {401: "the FLPT voices sign-in has expired", 402: "this video's free FLPT voice characters (or this "
                       "month's videos) are used up", 403: "that voice isn't one of the FLPT voices"}.get(r.status_code, "")
                raise ApiError(f"FLPT voices HTTP {r.status_code}" + (f": {why}" if why else f": {body_snippet(r)}"),
                               r.status_code, body_snippet(r))
            src = tmp / f"chunk{i}.src.wav"
            src.write_bytes(r.content)
            w = tmp / f"chunk{i}.wav"
            to_wav48(src, w)
            parts.append(w)
        if len(parts) == 1:
            os.replace(parts[0], out_wav)
        else:
            concat_wavs(parts, out_wav)


def flpt_guest_say(spec: dict, main_voice) -> str:
    """The Mac voice a guest speaks in the draft: the one named for a Mac guest, else one of FLPT_GUEST_SAY (never the
    draft's own when another is there), the same for the same guest on every run."""
    voices = say_voices()
    names = [n for n, _loc in voices]
    if spec["provider"] == "say" and spec["id"] in names:
        return spec["id"]
    english = [n for n, loc in voices if loc.startswith("en_")]
    cands = sorted(n for n in english if n.split(" (")[0] in FLPT_GUEST_SAY and n != main_voice)
    if not cands:
        cands = sorted(n for n in english if n != main_voice) or [main_voice or (names[0] if names else "Samantha")]
    i = int(hashlib.sha256(f"{spec['provider']}/{spec['id']}".encode("utf-8")).hexdigest(), 16) % len(cands)
    return cands[i]


def flpt_guest_engine(spec: dict, main, cfg: dict, args, draft: bool, where: str):
    """The engine a guest's slide is narrated by (QA's fixture voices still stand in for it: fixture_tts)."""
    p, vid = spec["provider"], spec["id"]
    if draft and not flpt_draft_final():  # the free draft: another Mac voice shows where the guest jumps in
        voice = flpt_guest_say(spec, getattr(getattr(main, "inner", main), "voice", None))
        return fixture_tts(SayTTS(voice, args.say_rate))
    if p == "say":
        return fixture_tts(FilmSayTTS(pick_say_voice(vid), args.say_rate))
    if draft:  # the film on the draft's path, made offline: only the Mac can speak (never another voice in its place)
        die(f"{where}: its guest voice needs the network, and this film is made offline. Nothing was generated.")
    c = dict(cfg)
    key = FLPT_GUEST_KEYS[p]
    if not c.get(key):
        if any(os.environ.get(k) == "1" for k in _FLPT_NOTHING_MADE):
            c[key] = "guest-placeholder"  # nothing is made in these runs: no key is needed or sent
        else:
            die(f"{where}: its guest voice needs {'the FLPT voices sign-in' if p == 'fish-house' else key}, which this run "
                f"doesn't have. Nothing was generated.")
    if p == "fish-house":
        return fixture_tts(FlptHouseTTS(c, vid))
    if p == "fish":
        c["FISH_VOICE_ID"] = vid
        return fixture_tts(FishTTS(c))
    if p == "elevenlabs":
        c["ELEVENLABS_VOICE_ID"] = vid
        return fixture_tts(ElevenLabsTTS(c))
    c["HEYGEN_VOICE_ID"] = vid
    return fixture_tts(HeyGenTTS(c))


def flpt_guests(items: list, engine, cfg: dict, args, draft: bool) -> None:
    """Each slide with a guest voice (and no presenter on screen) gets its engine: s.flpt_engine."""
    made = {}
    for s in items:
        spec = getattr(s, "flpt_voice", None)
        if s.kind != "slide" or not spec:
            continue
        if getattr(s, "flpt_bubble", s.bubble):
            log(f"  {s.name}  guest voice left out: the presenter is on screen here, so the presenter speaks")
            continue
        k = f"{spec['provider']}/{spec['id']}"
        if k not in made:
            made[k] = flpt_guest_engine(spec, engine, cfg, args, draft, s.name.strip())
        s.flpt_engine = made[k]
        log(f"  {s.name}  guest voice: {made[k].describe()}")


def flpt_engine(s, engine):
    """The engine that narrates this item: its guest's, else the run's."""
    return getattr(s, "flpt_engine", None) or engine


def flpt_guest_items(cache: Path) -> set:
    """The slides (narration items) a guest has narrated in this cache: cache/audio/flpt_guest_items.json."""
    try:
        got = json.loads((cache / "audio" / "flpt_guest_items.json").read_text())
    except (OSError, ValueError):
        return set()
    return {x for x in got if isinstance(x, str)} if isinstance(got, list) else set()


def flpt_note_guest(cache: Path, seen: set, s) -> None:
    """A guest narrates this slide: its item is noted once, so flpt_newest follows it when its voice changes again."""
    item = s.name.strip()
    if s.kind != "slide" or not getattr(s, "flpt_engine", None) or item in seen:
        return
    seen.add(item)
    atomic_write_json(cache / "audio" / "flpt_guest_items.json", sorted(seen))


def flpt_newest(cache: Path, adir: Path, h: str, s, seen: set) -> None:
    """The narration this run uses for a slide made that slide's newest (retime.py and FLPT take the newest), only for a
    slide a guest has narrated (seen): every other slide's narration metadata stays exactly as it was."""
    meta = adir / f"{h}.json"
    if s.kind != "slide" or s.name.strip() not in seen or not meta.is_file():
        return
    try:
        mine = json.loads(meta.read_text())
    except ValueError:
        return
    draftish = adir.name == "say"
    newest = ""
    for j in (cache / "audio").glob("*/*.json"):
        if j == meta or (j.parent.name == "say") != draftish:
            continue
        try:
            m = json.loads(j.read_text())
        except ValueError:
            continue
        if isinstance(m, dict) and m.get("item") == mine.get("item"):
            newest = max(newest, str(m.get("created", "")))
    if not newest or str(mine.get("created", "")) > newest:
        return
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    stamp = now_iso()
    try:
        if stamp <= newest:
            t = datetime.strptime(newest, fmt).replace(tzinfo=timezone.utc).timestamp() + 1
            stamp = datetime.fromtimestamp(t, timezone.utc).strftime(fmt)
    except ValueError:
        pass
    mine["created"] = stamp
    atomic_write_json(meta, mine)


def flpt_guest_estimate(items: list, cache: Path, regen: set) -> None:
    """In FLPT's estimate run, with guests: one line of its own, {"flpt_guests": {provider: characters still to make}},
    printed before the estimate's; then the guests' slides are left out of the estimate's voice_chars (the presenter's
    voice, which doesn't speak them). The run ends right after the estimate, so nothing else reads them."""
    if os.environ.get(_FLPT_NOTHING_MADE[0]) != "1":
        return
    out = {}
    for s in items:
        eng = getattr(s, "flpt_engine", None)
        if not eng or not s.text:
            continue
        spoken = spoken_text(eng, s.text)
        p = s.flpt_voice["provider"]
        wav = cache / "audio" / eng.tag / f"{narration_hash(eng, spoken)}.wav"
        out[p] = out.get(p, 0) + (len(spoken) if spoken and (s.n in regen or not wav.exists()) else 0)
        s.text = ""
    if out:
        print(json.dumps({"flpt_guests": out}), flush=True)


def flpt_guest_row(s) -> dict:
    """A guest's slide on the timeline: {"voice": "<provider>/<id>"}."""
    spec = getattr(s, "flpt_voice", None)
    return {"voice": f"{spec['provider']}/{spec['id']}"} if spec and getattr(s, "flpt_engine", None) else {}


def make_narration(items: list, engine, cache: Path, regen: set[int]) -> list:
    """Synthesize (or reuse) narration for each slide / cut-scene voiceover. Returns the names that failed."""
    main = engine  # FLPT_GUEST_VOICE_V1: a guest's slide is narrated by its own engine, in its own folder
    failed = []
    flpt_seen = flpt_guest_items(cache)  # FLPT_GUEST_VOICE_V1: the slides a guest has narrated in this cache
    for s in items:
        engine = flpt_engine(s, main)
        adir = cache / "audio" / engine.tag
        adir.mkdir(parents=True, exist_ok=True)
        flpt_note_guest(cache, flpt_seen, s)
        if not s.text:
            if s.kind == "slide":
                log(f"  {s.name}  (no narration — silent hold)")
            continue
        spoken = spoken_text(engine, s.text)
        dropped = list(getattr(engine, "dropped", []) or [])
        if dropped:
            log(f"  {s.name}  tags not supported by {engine.label}, left out: {' '.join(sorted(set(dropped)))}")
        if not spoken.strip():
            log(f"  {s.name}  (only delivery tags — silent)")
            continue
        h = narration_hash(engine, spoken)
        wav = adir / f"{h}.wav"
        rid = s.n if s.kind == "slide" else s.after
        if rid in regen and wav.exists():
            wav.unlink()
        if wav.exists():
            s.narration_wav = wav
            s.narration_s = wav_frames(wav) / SR
            log(f"  {s.name}  cached   {s.narration_s:6.1f}s  ({len(spoken)} chars)")
            flpt_newest(cache, adir, h, s, flpt_seen)  # FLPT_GUEST_VOICE_V1
            continue
        log(f"  {s.name}  generating ({len(spoken)} chars) …")
        t0 = time.time()
        with tempfile.TemporaryDirectory(prefix="narr_") as td:
            try:
                engine.synth(spoken, wav, Path(td))
            except (ApiError, PipelineError) as e:
                log(f"            ✗ failed: {e}")
                failed.append(s.name.strip())
                continue
        (adir / f"{h}.json").write_text(json.dumps(
            {"item": s.name.strip(), "engine": engine.key(), "chars": len(spoken), "created": now_iso(),
             "text_start": spoken[:120]}, indent=1))
        s.narration_wav = wav
        s.narration_s = wav_frames(wav) / SR
        log(f"            ✓ {s.narration_s:.1f}s audio in {time.time() - t0:.1f}s")
    return failed


def slide_lead_tail(s: Slide, first: int, last: int, tail: float) -> tuple[float, float]:
    lead = FIRST_LEAD_S if s.n == first else 0.0
    if s.cut_before:
        lead = max(lead, CUT_LEAD_S)
    tl = max(tail, LAST_TAIL_S) if s.n == last else tail
    if s.cut_after:
        tl = max(tl, CUT_TAIL_S)
    return lead, tl


def build_timeline(items: list, all_numbers: list[int], cache: Path, tail: float) -> None:
    """Frame-quantise every slide / cut scene and write each slide's padded narration WAV (exact length).
    Leads and tails depend only on the slide's place in the whole deck, so a --slides preview and the
    full render share the same audio (and HeyGen clips)."""
    pdir = cache / "audio" / "padded"
    pdir.mkdir(parents=True, exist_ok=True)
    first, last = all_numbers[0], all_numbers[-1]
    t = 0.0
    for s in items:
        if s.kind == "cutscene":
            s.frames = cutscene_frames(s)
            s.start = t
            t += s.duration
            continue
        lead, tl = slide_lead_tail(s, first, last, tail)
        body = (wav_frames(s.narration_wav) if s.narration_wav else int(SILENT_HOLD_S * SR))
        lead_n = int(round(lead * SR))
        s.flpt_lead = lead_n / SR  # FLPT_PADKEYS_V1
        total = lead_n + body + int(round(tl * SR))
        s.frames = math.ceil(total / SPF)
        total = s.frames * SPF
        src_key = s.narration_wav.stem if s.narration_wav else "silence"
        s.pad_key = sha_text("pad", src_key, lead_n, total)[:20]
        s.padded_wav = pdir / f"{s.pad_key}.wav"
        if not s.padded_wav.exists():
            write_padded_wav(s.narration_wav, s.padded_wav, lead_n, total)
        s.start = t
        t += s.duration


def make_item_audio(items: list, cache: Path) -> None:
    """The audio each item contributes to the final mix (exactly frames × 1600 samples)."""
    for it in items:
        it.audio_wav = make_cutscene_audio(it, cache) if it.kind == "cutscene" else make_slide_audio(it, cache)


# ─── HeyGen ─────────────────────────────────────────────────────────────────
#
# Default: the v3 API (POST /v3/assets, POST /v3/videos, GET /v3/videos/{id},
# GET /v3/avatars/looks, GET /v3/users/me). HeyGen retires v1/v2 after
# 2026-10-31. Set HEYGEN_API_VERSION=v2 to use the legacy route
# (upload.heygen.com/v1/asset + /v2/video/generate + /v1/video_status.get).

RES_TO_DIM = {"4k": (3840, 2160), "1080p": (1920, 1080), "720p": (1280, 720)}
RES_FALLBACK = ["4k", "1080p", "720p"]


class HeyGen:
    def __init__(self, key: str, version: str = "v3"):
        self.key = key
        self.v = "v2" if version.lower().startswith("v2") else "v3"

    def h(self, **extra) -> dict:
        return flpt_hg({"x-api-key": self.key, "accept": "application/json", **extra})  # FLPT_HEYGEN_BASE

    def get(self, path: str, what: str, **params):
        return api_call("GET", HG_API + path, what=what, headers=self.h(), params=params or None, timeout=90)

    # account / quota -----------------------------------------------------
    def me(self):
        return self.get("/v3/users/me" if self.v == "v3" else "/v2/user/remaining_quota", "account")

    @staticmethod
    def describe_balance(j: dict) -> str:
        d = (j or {}).get("data") or {}
        if "remaining_quota" in d:
            return f"remaining_quota {d['remaining_quota']}"
        bt = d.get("billing_type")
        if bt == "wallet" and d.get("wallet"):
            w = d["wallet"]
            return f"wallet balance {w.get('remaining_balance')} {w.get('currency', '')}".strip()
        if bt == "subscription" and d.get("subscription"):
            c = (d["subscription"].get("credits") or {})
            pc = (c.get("premium_credits") or {}).get("remaining")
            ac = (c.get("add_on_credits") or {}) or {}
            return f"plan {d['subscription'].get('plan')} · premium credits {pc} · add-on {ac.get('remaining')}"
        if bt == "usage_based" and d.get("usage_based"):
            u = d["usage_based"]
            return f"usage-based · remaining credits {u.get('remaining_credits')} · spent ${u.get('spending_current_usd')}"
        return json.dumps(d)[:200]

    # avatars -------------------------------------------------------------
    def looks(self, ownership: str = "private", max_pages: int = 60) -> list[dict]:
        """v3: every avatar look (digital twins, photo avatars) you own. The look `id` is the avatar_id."""
        out: list[dict] = []
        token = None
        for _ in range(max_pages):
            params = {"ownership": ownership, "limit": 50}
            if token:
                params["token"] = token
            r = self.get("/v3/avatars/looks", "list avatar looks", **params)
            if r.status_code != 200:
                raise ApiError(explain_http("HeyGen", r), r.status_code, body_snippet(r))
            j = r.json() or {}
            out += j.get("data") or []
            token = j.get("next_token")
            if not j.get("has_more") or not token:
                break
        return out

    def legacy_avatars(self) -> dict:
        r = self.get("/v2/avatars", "list avatars (v2)")
        if r.status_code != 200:
            raise ApiError(explain_http("HeyGen", r), r.status_code)
        return r.json().get("data") or {}

    # generation ----------------------------------------------------------
    def upload_audio(self, mp3: Path) -> str:
        data = mp3.read_bytes()
        if self.v == "v3":
            r = api_call("POST", HG_API + "/v3/assets", what="upload audio",
                         headers=flpt_hg({"x-api-key": self.key, "accept": "application/json"}),
                         files={"file": (mp3.name, data, "audio/mpeg")}, timeout=300)
            if r.status_code != 200:
                raise ApiError(explain_http("HeyGen", r), r.status_code, body_snippet(r))
            d = (r.json() or {}).get("data") or {}
            aid = d.get("asset_id") or d.get("id")
        else:
            # Legacy: multipart field "file" (proven in practice); the spec also allows a raw body.
            r = api_call("POST", HG_UPLOAD, what="upload audio", headers=flpt_hg({"X-Api-Key": self.key}),
                         files={"file": (mp3.name, data, "audio/mpeg")}, timeout=300)
            if r.status_code != 200:
                log(f"      multipart upload returned HTTP {r.status_code}; trying a raw-body upload")
                r = api_call("POST", HG_UPLOAD, what="upload audio (raw)",
                             headers=flpt_hg({"X-Api-Key": self.key, "Content-Type": "audio/mpeg"}), data=data, timeout=300)
            if r.status_code != 200:
                raise ApiError(explain_http("HeyGen", r), r.status_code, body_snippet(r))
            d = (r.json() or {}).get("data") or {}
            aid = d.get("id") or d.get("asset_id")
        if not aid:
            raise ApiError(f"HeyGen upload returned no asset id: {body_snippet(r)}")
        return aid

    def generate(self, payload: dict, idem_key: str, clip: str | None = None) -> str:  # FLPT_HEYGEN_BASE: clip
        if self.v == "v3":
            # Idempotency-Key makes retries safe: a repeat within 24 h replays the first answer
            # instead of starting (and billing) a second render.
            r = api_call("POST", HG_API + "/v3/videos", what="create video",
                         headers={**self.h(**{"Content-Type": "application/json", "Idempotency-Key": idem_key}), **flpt_hg({}, clip)},
                         json=payload, timeout=120)
        else:
            # Legacy route has no idempotency: only retry when the request was clearly refused (429).
            r = api_call("POST", HG_API + "/v2/video/generate", what="generate video",
                         headers={**self.h(**{"Content-Type": "application/json"}), **flpt_hg({}, clip)}, json=payload,
                         retry_statuses=(429,), retries=4, timeout=120)
        if r.status_code != 200:
            raise ApiError(explain_http("HeyGen", r), r.status_code, body_snippet(r))
        j = r.json() or {}
        if j.get("error"):
            raise ApiError(f"HeyGen error: {json.dumps(j['error'])[:300]}", r.status_code, body_snippet(r))
        vid = (j.get("data") or {}).get("video_id")
        if not vid:
            raise ApiError(f"HeyGen returned no video_id: {body_snippet(r)}", r.status_code)
        return vid

    def status(self, video_id: str) -> dict:
        """Normalised: {"status": waiting|pending|processing|completed|failed|poll_error, "video_url", "error"}."""
        if self.v == "v3":
            r = api_call("GET", f"{HG_API}/v3/videos/{video_id}", what="video status", headers=self.h(), timeout=60)
        else:
            r = api_call("GET", HG_API + "/v1/video_status.get", what="video status", headers=self.h(),
                         params={"video_id": video_id}, timeout=60)
        if r.status_code != 200:
            return {"status": "poll_error", "error": explain_http("HeyGen", r)}
        d = (r.json() or {}).get("data") or {}
        err = d.get("error") or ({"code": d.get("failure_code"), "message": d.get("failure_message")}
                                 if d.get("failure_code") or d.get("failure_message") else None)
        return {"status": (d.get("status") or "unknown").lower(), "video_url": d.get("video_url"), "error": err}

    def download(self, url: str, dst: Path) -> None:
        rq = _requests()
        tmp = dst.with_suffix(".part")
        for attempt in range(4):
            try:
                with rq.get(url, stream=True, timeout=300) as r:
                    r.raise_for_status()
                    with open(tmp, "wb") as f:
                        for chunk in r.iter_content(1 << 20):
                            f.write(chunk)
                os.replace(tmp, dst)
                return
            except rq.RequestException as e:
                if attempt == 3:
                    raise ApiError(f"download failed: {e}")
                time.sleep(5 * (attempt + 1))


def heygen_version(cfg: dict) -> str:
    return "v2" if (cfg.get("HEYGEN_API_VERSION") or "v3").lower().startswith("v2") else "v3"


def heygen_resolution(cfg: dict) -> str:
    r = (cfg.get("HEYGEN_RESOLUTION") or "1080p").lower().replace(" ", "")
    return {"2160p": "4k", "uhd": "4k", "1080": "1080p", "720": "720p"}.get(r, r if r in RES_TO_DIM else "1080p")


def character_type(cfg: dict) -> str:
    t = (cfg.get("HEYGEN_CHARACTER_TYPE") or "avatar").strip().lower()
    return "talking_photo" if t in ("talking_photo", "photo", "photo_avatar") else "avatar"


def heygen_payload(cfg: dict, version: str, asset_id: str, resolution: str, title: str) -> dict:
    aid = cfg.get("HEYGEN_AVATAR_ID", "")
    ctype = character_type(cfg)
    bg = cfg.get("HEYGEN_BACKGROUND")
    if version == "v3":
        # v3: digital twins AND photo avatars are both "looks" -> same avatar_id field.
        p: dict = {"type": "avatar", "avatar_id": aid, "audio_asset_id": asset_id, "title": title,
                   "resolution": resolution, "aspect_ratio": cfg.get("HEYGEN_ASPECT_RATIO") or "16:9"}
        if cfg.get("HEYGEN_ENGINE"):
            p["engine"] = {"type": cfg["HEYGEN_ENGINE"].strip().lower()}   # avatar_iii | avatar_iv | avatar_v
        if ctype == "talking_photo" and cfg.get("HEYGEN_EXPRESSIVENESS"):
            p["expressiveness"] = cfg["HEYGEN_EXPRESSIVENESS"]               # high | medium | low
        if bg:
            p["background"] = {"type": "color", "value": bg}
        if (cfg.get("HEYGEN_REMOVE_BACKGROUND") or "").lower() in ("1", "true", "yes"):
            p["remove_background"] = True
        return p
    # Legacy v2: a photo avatar needs talking_photo_id instead of avatar_id.
    if ctype == "talking_photo":
        ch: dict = {"type": "talking_photo", "talking_photo_id": aid}
        if cfg.get("HEYGEN_TALKING_STYLE"):
            ch["talking_style"] = cfg["HEYGEN_TALKING_STYLE"]                # stable | expressive
        if cfg.get("HEYGEN_EXPRESSION"):
            ch["expression"] = cfg["HEYGEN_EXPRESSION"]                      # default | happy
    else:
        ch = {"type": "avatar", "avatar_id": aid, "avatar_style": cfg.get("HEYGEN_AVATAR_STYLE") or "normal"}
    vi: dict = {"character": ch, "voice": {"type": "audio", "audio_asset_id": asset_id}}
    if bg:
        vi["background"] = {"type": "color", "value": bg}
    w, h = RES_TO_DIM[resolution]
    return {"title": title, "caption": False, "video_inputs": [vi], "dimension": {"width": w, "height": h}}


def clip_key(cfg: dict, s: Slide) -> str:
    look = heygen_payload(cfg, heygen_version(cfg), "", heygen_resolution(cfg), "")
    return sha_text("clip", s.pad_key, json.dumps(look, sort_keys=True))[:20]


def _resolution_rejected(e: ApiError) -> bool:
    return e.status == 400 and bool(re.search(r"resolution|dimension|4k|width|height|aspect", e.body or str(e), re.I))


def make_avatar_clips(slides: list[Slide], cfg: dict, cache: Path, regen: set[int],
                      timeout_min: float) -> dict[int, str]:
    """For each slide: upload its padded narration, create a lip-synced clip, poll, download.
    Returns {slide: reason} for slides left without a clip. Never falls back to HeyGen TTS voices."""
    version = heygen_version(cfg)
    hg = HeyGen(cfg["HEYGEN_API_KEY"], version)
    cdir = cache / "avatar"
    (cdir / "clips").mkdir(parents=True, exist_ok=True)
    (cdir / "upload").mkdir(parents=True, exist_ok=True)
    jobs_file = cdir / "jobs.json"
    jobs: dict = json.loads(jobs_file.read_text()) if jobs_file.exists() else {}
    resolution = heygen_resolution(cfg)
    max_conc = max(1, min(10, int(cfg_float(cfg, "HEYGEN_MAX_CONCURRENT", 4))))
    problems: dict[int, str] = {}

    todo: list[tuple[str, Slide]] = []
    for s in slides:
        k = clip_key(cfg, s)
        clip = cdir / "clips" / f"{k}.mp4"
        if s.n in regen:
            if clip.exists():
                clip.unlink()
            if k in jobs:
                jobs[k] = {"attempt": jobs[k].get("attempt", 0), "slide": s.n, "status": "regen"}
        if clip.exists():
            s.avatar_kind, s.avatar_src = "clip", clip
            log(f"  slide {s.n:2d}  cached clip")
        else:
            if s.duration > 600:
                log(f"  ! slide {s.n}: {s.duration:.0f}s of audio — HeyGen's limit is 600 s per request")
            todo.append((k, s))
    atomic_write_json(jobs_file, jobs)
    if not todo:
        return problems

    secs = sum(s.duration for _, s in todo)
    log(f"\n  HeyGen API {version} · {len(todo)} clip(s) to make · {secs / 60:.1f} min of avatar video · "
        f"{resolution} · up to {max_conc} at a time")

    inflight: dict[str, Slide] = {}
    queue: list[tuple[str, Slide]] = []
    for k, s in todo:
        j = jobs.get(k) or {}
        if j.get("video_id") and j.get("status") not in ("failed", "regen", "downloaded"):
            inflight[k] = s
            log(f"  slide {s.n:2d}  resuming HeyGen job {j['video_id']} (no new charge)")
        else:
            queue.append((k, s))

    stop_reason = ""
    last_report = 0.0
    while queue or inflight:
        while queue and len(inflight) < max_conc and not stop_reason:
            k, s = queue.pop(0)
            try:
                mp3 = cdir / "upload" / f"{s.pad_key}.mp3"
                if not mp3.exists():
                    run([FFMPEG, "-y", "-v", "error", "-i", s.padded_wav, "-c:a", "libmp3lame", "-b:a", "192k",
                         "-ar", "48000", mp3.with_suffix(".tmp.mp3")], "encode upload mp3")
                    os.replace(mp3.with_suffix(".tmp.mp3"), mp3)
                prev = jobs.get(k) or {}
                # Reuse the idempotency key if a previous run was cut off mid-request (< 24 h ago),
                # so HeyGen replays that answer instead of starting a second, billable render.
                if prev.get("status") == "submitting" and time.time() - prev.get("t", 0) < 23 * 3600:
                    attempt = prev.get("attempt", 1)
                    asset_id = prev.get("asset_id") or ""
                else:
                    attempt = prev.get("attempt", 0) + 1
                    asset_id = ""
                if not asset_id:
                    log(f"  slide {s.n:2d}  uploading narration ({s.duration:.1f}s) …")
                    asset_id = hg.upload_audio(mp3)
                idem = f"pv-{k}-{attempt}"
                jobs[k] = {"slide": s.n, "status": "submitting", "attempt": attempt, "asset_id": asset_id,
                           "t": time.time()}
                atomic_write_json(jobs_file, jobs)
                res = resolution
                while True:
                    payload = heygen_payload(cfg, version, asset_id, res, f"slide {s.n:02d} {s.title}"[:90])
                    try:
                        vid = hg.generate(payload, f"{idem}-{res}", clip=k)  # FLPT_HEYGEN_BASE: X-FLPT-Clip
                        break
                    except ApiError as e:
                        nxt = RES_FALLBACK[RES_FALLBACK.index(res) + 1:] if res in RES_FALLBACK else []
                        if _resolution_rejected(e) and nxt:
                            log(f"            {res} was refused ({e.status}); trying {nxt[0]} (a refused request is not billed)")
                            res = resolution = nxt[0]
                            continue
                        raise
                jobs[k].update({"video_id": vid, "status": "submitted", "submitted": time.time(), "resolution": res})
                atomic_write_json(jobs_file, jobs)
                inflight[k] = s
                log(f"  slide {s.n:2d}  submitted → video_id {vid}")
            except ApiError as e:
                msg = str(e)
                problems[s.n] = msg
                if k in jobs and not jobs[k].get("video_id"):
                    jobs[k]["status"] = "failed"
                    atomic_write_json(jobs_file, jobs)
                log(f"  slide {s.n:2d}  ✗ {msg}")
                if re.search(r"insufficient|quota|credit|balance|exceed|payment", msg, re.I) or e.status in (401, 402, 403):
                    stop_reason = "HeyGen refused further jobs (credits/quota/auth) — not submitting more"
                    log(f"  ✗ {stop_reason}")
            except PipelineError as e:
                problems[s.n] = str(e)
                log(f"  slide {s.n:2d}  ✗ {e}")
        if stop_reason:
            for _k, s in queue:
                problems.setdefault(s.n, stop_reason)
            queue = []
        if not inflight:
            break
        time.sleep(12)
        states = []
        for k, s in list(inflight.items()):
            j = jobs[k]
            st = hg.status(j["video_id"])
            status = st["status"]
            if status != "poll_error":
                j["status"] = status
            if status == "completed" and st.get("video_url"):
                clip = cdir / "clips" / f"{k}.mp4"
                try:
                    hg.download(st["video_url"], clip)
                    d = media_duration(clip)
                    log(f"  slide {s.n:2d}  ✓ clip ready ({d:.1f}s, {'x'.join(map(str, video_size(clip)))})")
                    s.avatar_kind, s.avatar_src = "clip", clip
                    j["status"] = "downloaded"
                except (ApiError, PipelineError) as e:
                    problems[s.n] = f"download failed: {e} (re-run to retry — no new charge)"
                    log(f"  slide {s.n:2d}  ✗ {problems[s.n]}")
                del inflight[k]
            elif status in ("failed", "error"):
                problems[s.n] = f"HeyGen render failed: {json.dumps(st.get('error'))[:300]}"
                log(f"  slide {s.n:2d}  ✗ {problems[s.n]}")
                del inflight[k]
            elif time.time() - j.get("submitted", time.time()) > timeout_min * 60:
                problems[s.n] = (f"still rendering after {timeout_min:.0f} min (job {j['video_id']} is saved; "
                                 "re-run later to pick it up without paying again)")
                log(f"  slide {s.n:2d}  … {problems[s.n]}")
                del inflight[k]
            else:
                states.append(f"{s.n}:{status}")
        atomic_write_json(jobs_file, jobs)
        if states and time.time() - last_report > 45:
            last_report = time.time()
            log(f"    [{datetime.now().strftime('%H:%M:%S')}] rendering on HeyGen: {', '.join(states)}"
                f"{f' · queued: {len(queue)}' if queue else ''}")
    return problems


def speech_onset(pcm: bytes, rate: int = SR, win_s: float = 0.01, thresh_db: float = -36.0) -> float | None:
    """Time of the first 10 ms window louder than thresh_db (16-bit mono PCM)."""
    import array
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) // 2 * 2])
    if sys.byteorder == "big":
        a.byteswap()
    n = max(4, int(rate * win_s))
    thr = (10 ** (thresh_db / 20) * 32768) ** 2
    for i in range(0, len(a) - n, n):
        chunk = a[i:i + n:4]
        if sum(v * v for v in chunk) / len(chunk) > thr:
            return i / rate
    return None


def clip_sync_offset(clip: Path, padded_wav: Path) -> float:
    """Compare where speech starts in HeyGen's clip (its own audio track) with our narration.
    Guards against the service trimming or padding silence, which would break lip-sync."""
    side = clip.with_suffix(".sync.json")
    if side.exists():
        try:
            return float(json.loads(side.read_text())["offset"])
        except (ValueError, KeyError):
            pass
    off = 0.0
    r = subprocess.run([FFMPEG, "-v", "error", "-i", str(clip), "-t", "20", "-vn", "-ac", "1", "-ar", str(SR),
                        "-f", "s16le", "-"], capture_output=True)
    if r.returncode == 0 and r.stdout:
        with wave.open(str(padded_wav), "rb") as w:
            ours = w.readframes(min(w.getnframes(), 20 * SR))
        a, b = speech_onset(ours), speech_onset(r.stdout)
        if a is not None and b is not None and 0.04 <= abs(b - a) < 3.0:
            off = round(b - a, 3)
    side.write_text(json.dumps({"offset": off}))
    return off


# ─── compositing ────────────────────────────────────────────────────────────


class Encoder:
    def __init__(self, draft: bool):
        self.draft = draft
        if draft:
            self.args = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-tune", "stillimage"]
        else:
            self.args = ["-c:v", "libx264", "-preset", "medium", "-crf", "18"]
        self.args += ["-pix_fmt", "yuv420p", "-g", "300", "-colorspace", "bt709", "-color_primaries", "bt709",
                      "-color_trc", "bt709", "-color_range", "tv", "-video_track_timescale", "15360"]

    def key(self) -> str:
        return " ".join(self.args)


TO_YUV = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
TO_YUVA = "scale=out_color_matrix=bt709:out_range=tv,format=yuva420p"


def hold(n: int) -> str:
    """Repeat a single decoded frame n times at FPS (decode once, not per frame)."""
    return f"loop=loop=-1:size=1:start=0,trim=end_frame={n},setpts=N/{FPS}/TB"


def fade_filters(n: int, fade_in: float, fade_out: float) -> list[str]:
    f = []
    if fade_in > 0:
        f.append(f"fade=t=in:st=0:d={fade_in:g}")
    if fade_out > 0:
        f.append(f"fade=t=out:st={max(0.0, n / FPS - fade_out):.4f}:d={fade_out:g}")
    return f


def bubble_fades(n: int, fin: float, fout: float) -> str:
    """Alpha fades on the bubble layer only (next to a slide that hides the bubble)."""
    f = []
    if fin > 0:
        f.append(f"fade=t=in:st=0:d={fin:g}:alpha=1")
    if fout > 0:
        f.append(f"fade=t=out:st={max(0.0, n / FPS - fout):.4f}:d={fout:g}:alpha=1")
    return ("," + ",".join(f)) if f else ""


def build_segment(s: Slide, prev_png: Path | None, fade_in: float, fade_out: float, bubble: Bubble | None,
                  crop: str, enc: Encoder, out: Path, bub_in: float = 0.0, bub_out: float = 0.0) -> None:
    """One slide: its PNG (or video background) + optional cross-fade from the previous slide's last
    picture + the presenter bubble, with fades to/from black where the deck starts/ends or meets a cut scene."""
    n = s.frames
    xf = int(round(XFADE_S * FPS)) if prev_png is not None and n > int(XFADE_S * FPS) + 2 else 0
    cmd: list = [FFMPEG, "-y", "-v", "error"]
    if s.live_video:
        v = s.video
        cmd += video_input(v["path"], v["start"], v["pad"] == "loop")  # type: ignore[index]
        f = [f"[0:v]{video_chain(v['fit'], n, v['pad'] == 'loop')}[cur]"]  # type: ignore[index]
    else:
        cmd += ["-framerate", str(FPS), "-i", s.bg_png]
        f = [f"[0:v]{TO_YUV},{hold(n)}[cur]"]
    nxt = 1
    if xf:
        cmd += ["-framerate", str(FPS), "-i", prev_png]
        f.append(f"[{nxt}:v]{TO_YUV},{hold(xf)}[prv]")
        f.append(f"[prv][cur]xfade=transition=fade:duration={xf / FPS:.6f}:offset=0[bg]")
        nxt += 1
    else:
        f.append("[cur]null[bg]")
    v = "bg"
    bf = bubble_fades(n, bub_in, bub_out)
    if bubble is not None and s.avatar_kind == "still":
        cmd += ["-framerate", str(FPS), "-i", s.avatar_src]
        f.append(f"[{nxt}:v]{TO_YUVA},{hold(n)}{bf}[bub]")
        f.append(f"[{v}][bub]overlay={bubble.dx}:{bubble.dy}:format=yuv420[v1]")
        v, nxt = "v1", nxt + 1
    elif bubble is not None and s.avatar_kind == "clip":
        cmd += ["-framerate", str(FPS), "-i", bubble.decor_png, "-i", s.avatar_src,
                "-framerate", str(FPS), "-i", bubble.mask_png]
        i_dec, i_clip, i_mask = nxt, nxt + 1, nxt + 2
        f.append(f"[{i_dec}:v]{TO_YUVA},{hold(n)}{bf}[dec]")
        f.append(f"[{v}][dec]overlay={bubble.dx}:{bubble.dy}:format=yuv420[v0]")
        sync = ""
        if s.clip_offset > 0:
            sync = f"trim=start={s.clip_offset:.3f},setpts=PTS-STARTPTS,"
        elif s.clip_offset < 0:
            sync = f"tpad=start_mode=clone:start_duration={-s.clip_offset:.3f},"
        f.append(f"[{i_clip}:v]setpts=PTS-STARTPTS,fps={FPS},{sync}{crop},"
                 f"scale={bubble.d}:{bubble.d}:flags=lanczos,format=yuva420p,"
                 f"tpad=stop_mode=clone:stop_duration={n / FPS + 2:.3f},trim=end_frame={n},setpts=N/{FPS}/TB[av]")
        f.append(f"[{i_mask}:v]format=gray,{hold(n)}[msk]")
        f.append(f"[av][msk]alphamerge{bf}[avm]")
        f.append(f"[v0][avm]overlay={bubble.ax}:{bubble.ay}:format=yuv420[v1]")
        v, nxt = "v1", nxt + 3
    fades = fade_filters(n, fade_in, fade_out)
    f.append(f"[{v}]{','.join(fades) + ',' if fades else ''}format=yuv420p[out]")
    tmp = out.with_suffix(".tmp.mp4")
    cmd += ["-filter_complex", ";".join(f), "-map", "[out]", "-frames:v", str(n), "-r", str(FPS), *enc.args,
            "-an", tmp]
    run(cmd, f"segment for slide {s.n}")
    os.replace(tmp, out)


def build_cutscene_segment(c: CutScene, enc: Encoder, out: Path) -> None:
    """Full-screen clip (or its draft title card), no bubble, fading in from and out to black."""
    n, fade = c.frames, cut_fade(c)
    cmd: list = [FFMPEG, "-y", "-v", "error"]
    if c.exists:
        cmd += video_input(c.src, c.clip_start, False)  # type: ignore[arg-type]
        chain = video_chain(c.fit, n, False)
    else:
        cmd += ["-framerate", str(FPS), "-i", c.card]
        chain = f"{TO_YUV},{hold(n)}"
    fin = fade if getattr(c, "fade_in", None) is None else round(min(c.fade_in, c.duration / 3), 3)
    fades = ",".join(fade_filters(n, fin, fade))
    tmp = out.with_suffix(".tmp.mp4")
    cmd += ["-filter_complex", f"[0:v]{chain}{',' + fades if fades else ''},format=yuv420p[out]",
            "-map", "[out]", "-frames:v", str(n), "-r", str(FPS), *enc.args, "-an", tmp]
    run(cmd, f"segment for cut scene {c.id}")
    os.replace(tmp, out)


def slide_fades(s: Slide, nums: list[int]) -> tuple[float, float]:
    """(fade in, fade out) from/to black: the deck's start/end and either side of a cut scene."""
    fin = CUT_FADE_S if s.cut_before else (INTRO_FADE_S if s.n == nums[0] else 0.0)
    fout = ((0.0 if getattr(s, "cut_after_hard", False) else CUT_FADE_S) if s.cut_after
            else (OUTRO_FADE_S if s.n == nums[-1] else 0.0))
    return fin, fout


def composite(items: list, all_slides: dict[int, Slide], cache: Path, out_mp4: Path,
              bubble: Bubble | None, crop: str, enc: Encoder, mode_tag: str) -> None:
    sdir = cache / "segments" / mode_tag
    sdir.mkdir(parents=True, exist_ok=True)
    nums = sorted(all_slides)
    png_sha: dict[Path, str] = {}

    def psha(p: Path) -> str:
        if p not in png_sha:
            png_sha[p] = sha_file(p)
        return png_sha[p]

    def bg_key(s: Slide) -> str:
        if s.live_video:
            v = s.video
            return sha_text("vid", sha_file_memo(v["path"]), v["fit"], v["pad"], v["start"])  # type: ignore[index]
        return psha(s.bg_png)

    segs = []
    t_all = time.time()
    for it in items:
        if it.kind == "cutscene":
            c = it
            vis = sha_text("vid", sha_file_memo(c.src), c.fit, c.clip_start) if c.exists else psha(c.card)
            key = sha_text("cut", PIPELINE_VERSION, enc.key(), c.frames, vis, cut_fade(c), FPS,
                           *([c.fade_in] if getattr(c, "fade_in", None) not in (None, c.fade) else []))[:20]
            # FLPT_FADEIN_KEY_V1: fade_in is in the key only when it differs from fade (old segments keep theirs)
            seg = sdir / f"c_{c.slug}_{key}.mp4"
            segs.append(seg)
            if seg.exists():
                log(f"  {c.name}  cached segment   {c.duration:6.1f}s")
                continue
            t0 = time.time()
            log(f"  {c.name}  encoding segment {c.duration:6.1f}s  (cut scene{'' if c.exists else ', placeholder card'}) …")
            build_cutscene_segment(c, enc, seg)
            log(f"            ✓ {time.time() - t0:.1f}s")
            continue
        s = it
        i = nums.index(s.n)
        prev = all_slides[nums[i - 1]] if (i > 0 and not s.cut_before) else None
        prev_png = tail_png(prev, cache) if prev else None
        fin, fout = slide_fades(s, nums)
        nb_prev = all_slides[nums[i - 1]] if i > 0 else None
        nb_next = all_slides[nums[i + 1]] if i + 1 < len(nums) else None
        bub_in = BUBBLE_FADE_S if (bubble and s.bubble and nb_prev is not None and not nb_prev.bubble
                                   and not s.cut_before) else 0.0
        # a hard cut into a cut scene ("fade_in": 0) has no bubble on the far side: fade it out first
        bub_out = BUBBLE_FADE_S if (bubble and s.bubble and (getattr(s, "cut_after_hard", False) or (
            nb_next is not None and not nb_next.bubble and not s.cut_after))) else 0.0
        key = sha_text("seg", PIPELINE_VERSION, enc.key(), s.frames, bg_key(s), bub_in, bub_out,
                       psha(prev_png) if prev_png else "", fin, fout,
                       s.avatar_kind if bubble else "none", s.avatar_key if bubble else "",
                       s.clip_offset if (bubble and s.avatar_kind == "clip") else 0,
                       bubble.geometry_key() if bubble else "", crop if (bubble and s.avatar_kind == "clip") else "",
                       XFADE_S)[:20]
        seg = sdir / f"s{s.n:02d}_{key}.mp4"
        segs.append(seg)
        if seg.exists():
            log(f"  slide {s.n:2d}  cached segment   {s.duration:6.1f}s")
            continue
        t0 = time.time()
        what = "video" if s.live_video else ("placeholder card" if s.card else "image")
        log(f"  slide {s.n:2d}  encoding segment {s.duration:6.1f}s  ({what}; bubble: "
            f"{s.avatar_kind if bubble else 'off'}) …")
        build_segment(s, prev_png, fin, fout, bubble, crop, enc, seg, bub_in, bub_out)
        log(f"            ✓ {time.time() - t0:.1f}s")

    # Sound: sample-exact join of each item's audio (narration, cut-scene sound, voiceover).
    parts = [it.audio_wav for it in items]
    narr = sdir / f"narration_{sha_text(*[p.stem for p in parts])[:16]}.wav"
    if not narr.exists():
        concat_audio(parts, narr)  # type: ignore[arg-type]
    lst = out_mp4.with_suffix(".concat.txt")
    lst.write_text("".join("file '" + str(p).replace("'", "'\\''") + "'\n" for p in segs))
    tmp = out_mp4.with_suffix(".tmp.mp4")
    log(f"\n  joining {len(segs)} segments + sound → {out_mp4.name}")
    run([FFMPEG, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-i", narr,
         "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2",
         "-ar", str(SR), "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
         "-movflags", "+faststart", "-metadata", f"title={out_mp4.stem}", tmp], "final mux")
    os.replace(tmp, out_mp4)
    lst.unlink(missing_ok=True)
    log(f"  ✓ composite done in {time.time() - t_all:.1f}s")


def chapter_row(it) -> dict:
    base = {"kind": it.kind, "title": it.title, "start": round(it.start, 3), "duration": round(it.duration, 3),
            "frames": it.frames, "narration_seconds": round(it.narration_s, 3)}
    if it.kind == "cutscene":
        return {**base, "id": it.id, "label": it.label, "after_slide": it.after,
                "media": it.src_label if it.exists else None, "placeholder": not it.exists}
    return {**base, "n": it.n, "label": f"{it.n}. {it.title}", "avatar": it.avatar_kind,
            "video": (it.video or {}).get("label") if it.video else None}


# FLPT_PADKEYS_V1: what the cartoon presenter (FLPT's own pass) needs to draw a slide's bubble, on its timeline row
def flpt_pad_row(s, timeline: Path) -> dict:
    if not getattr(s, "pad_key", ""):
        return {}
    base = timeline.parent.parent
    rel = lambda p: os.path.relpath(p, base) if p else None  # noqa: E731
    return {"pad_key": s.pad_key, "padded_wav": rel(s.padded_wav), "narration": rel(s.narration_wav),
            "lead": round(getattr(s, "flpt_lead", 0.0), 4), "bubble": bool(s.bubble),
            "spoken": strip_tags_for_display(s.text or "").strip()}


def write_timeline(path: Path, items: list, video: Path, draft: bool, extra: dict) -> None:
    slides = [s for s in items if s.kind == "slide"]
    data = {
        "video": video.name, "draft": draft, "created": now_iso(), "fps": FPS,
        "total_duration": round(sum(s.duration for s in items), 3),
        "slides": [{"n": s.n, "id": s.sid, "title": s.title, "start": round(s.start, 3),
                    "duration": round(s.duration, 3), "frames": s.frames,
                    "narration_seconds": round(s.narration_s, 3), "avatar": s.avatar_kind,
                    **({"video": s.video["label"]} if s.video else {}), **flpt_pad_row(s, path)} for s in slides],
        "cutscenes": [chapter_row(c) for c in items if c.kind == "cutscene"],
        "chapters": [chapter_row(it) for it in items],
        **extra,
    }
    for row, s in zip(data["slides"], slides):  # FLPT_GUEST_VOICE_V1: a guest's slide names its voice
        row.update(flpt_guest_row(s))
    atomic_write_json(path, data)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ─── verify ─────────────────────────────────────────────────────────────────


def verify(video: Path, slides: list | None = None) -> bool:
    step(f"Verify — {video.name}")
    info = ffprobe_json(video)
    fmt = info.get("format", {})
    vs = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), {})
    as_ = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), {})
    dur = float(fmt.get("duration", 0))
    vdur, adur = float(vs.get("duration", 0) or 0), float(as_.get("duration", 0) or 0)
    size = video.stat().st_size
    log(f"  File:        {video}")
    log(f"  Duration:    {fmt_t(dur)}  ({dur:.2f}s)")
    log(f"  Video:       {vs.get('codec_name')} {vs.get('width')}x{vs.get('height')} "
        f"{vs.get('pix_fmt')} @ {vs.get('r_frame_rate')}  ({vdur:.2f}s)")
    log(f"  Audio:       {as_.get('codec_name')} {as_.get('sample_rate')} Hz {as_.get('channels')} ch  ({adur:.2f}s)")
    log(f"  Size:        {fmt_mb(size)}")
    ok = bool(vs) and bool(as_)
    if slides:
        expected = sum(s.duration for s in slides)
        log(f"  Expected:    {expected:.2f}s from the timeline")
        if abs(vdur - expected) > 0.1:
            log(f"  ✗ video length is off by {vdur - expected:+.2f}s")
            ok = False
        log("")
        log("   #  start     length  narr.   bubble  title")
        for s in slides:
            if s.kind == "cutscene":
                log(f"  {s.id:>2s}  {fmt_t(s.start):>8s}  {s.duration:6.1f}s {s.narration_s:6.1f}s  "
                    f"{'—':<6s}  {s.label[:44]}{'' if s.exists else '  (placeholder)'}")
                continue
            bg = "  [video]" if s.live_video else ("  [card]" if s.card else "")
            log(f"  {s.n:2d}  {fmt_t(s.start):>8s}  {s.duration:6.1f}s {s.narration_s:6.1f}s  "
                f"{s.avatar_kind:<6s}  {s.title[:44]}{bg}")
    if abs(vdur - adur) > 0.15:
        log(f"  ✗ audio/video length differ by {adur - vdur:+.2f}s")
        ok = False
    log(f"\n  {'✓ looks good' if ok else '✗ problems found (see above)'}")
    return ok


# ─── web copies ─────────────────────────────────────────────────────────────


EDIT_NUDGE_MS = 20   # voice delay for the editing master; measured on the Games talk (±5 ms after this nudge)


def make_edit_master(src: Path, nudge_ms: float = EDIT_NUDGE_MS) -> Path | None:
    """Write <name>_for_editing.mov next to the final MP4: an editor-friendly copy for CapCut, Premiere, Resolve…
    The MP4's edit lists (video +66.7 ms from B-frames, audio +21.3 ms of AAC priming) are honoured by browsers but not
    by some editors (CapCut, 2026-09-29), which puts the voice a frame or two off the lips. This copy has H.264 with no
    B-frames at constant 30 fps, PCM audio, no edit lists, and the voice nudged +nudge_ms."""
    out = src.with_name(f"{src.stem}_for_editing.mov")
    d = media_duration(src)
    step(f"Editing master (CapCut-safe) — {out.name}")
    run([FFMPEG, "-y", "-v", "error", "-i", str(src), "-map", "0:v", "-map", "0:a",
         "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-bf", "0", "-g", "30", "-pix_fmt", "yuv420p",
         "-r", str(FPS), "-fps_mode", "cfr", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
         "-af", f"adelay={nudge_ms:g}:all=1,atrim=0:{d:.3f},asetpts=PTS-STARTPTS", "-c:a", "pcm_s16le", "-ar", str(SR),
         "-use_editlist", "0", "-t", f"{d:.3f}", str(out)], "editing master")
    log(f"  ✓ {out.name}: {out.stat().st_size / 1e6:.0f} MB · no edit lists · PCM audio · voice +{nudge_ms:g} ms")
    log("    Use this file (not the .mp4) when editing in CapCut or any other app.")
    return out


def make_web(src: Path, timeline_path: Path, web_dir: Path, work_dir: Path, max_mb: float = 14.0) -> bool:
    max_bytes = int(max_mb * 1_000_000)
    target_bytes = int(max_bytes * 0.95)
    step(f"Web copies (1280x720, parts under {max_mb:g} MB)")
    if not src.exists():
        die(f"{src} does not exist yet — render it first.")
    if not timeline_path.exists():
        die(f"{timeline_path.name} is missing — re-run the render step so slide timings are known.")
    tl = json.loads(timeline_path.read_text())
    # Chapters = slides and cut scenes in play order (older timelines only have "slides").
    sl = tl.get("chapters") or [{**s, "kind": "slide", "label": f"{s['n']}. {s.get('title', '')}"}
                                for s in tl["slides"]]
    starts = [s["start"] for s in sl]
    total = tl["total_duration"]
    work_dir.mkdir(parents=True, exist_ok=True)
    full = work_dir / f"{src.stem}_720p.mp4"
    kf = ",".join(f"{t - 0.0005:.4f}" for t in starts[1:]) or "0"

    crf = 26
    for attempt in range(4):
        log(f"  encoding 1280x720 (CRF {crf}) …")
        t0 = time.time()
        tmp = full.with_suffix(".tmp.mp4")
        run([FFMPEG, "-y", "-v", "error", "-i", src, "-vf", "scale=1280:720:flags=lanczos",
             "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p", "-g", "300",
             "-force_key_frames", kf, "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
             "-c:a", "aac", "-b:a", "80k", "-ac", "1", "-ar", "48000", "-movflags", "+faststart", tmp],
            "720p encode")
        os.replace(tmp, full)
        log(f"  ✓ {full.name}: {fmt_mb(full.stat().st_size)} in {time.time() - t0:.0f}s")

        # Bytes per slide, from packet sizes.
        r = run([FFPROBE, "-v", "error", "-show_entries", "packet=pts_time,dts_time,size", "-of", "csv=p=0", full],
                "packet sizes")
        per = [0] * len(sl)
        for line in r.stdout.decode().splitlines():
            parts = line.split(",")
            if len(parts) < 3:
                continue
            try:
                t = float(parts[0]) if parts[0] not in ("", "N/A") else float(parts[1])
                size = int(parts[2])
            except ValueError:
                continue
            i = max(0, min(len(sl) - 1, _bisect(starts, t)))
            per[i] += size + 16   # + mp4 index overhead per packet
        if max(per) > target_bytes:
            crf += 3
            log(f"  one chapter alone is {fmt_mb(max(per))} — re-encoding smaller")
            continue

        target = target_bytes
        for _pack in range(4):
            groups = balanced_groups(per, target)
            for old in web_dir.glob("*.mp4"):
                old.unlink()
            web_dir.mkdir(parents=True, exist_ok=True)
            cut_times = [starts[g[0]] for g in groups[1:]]
            pattern = web_dir / "part_%02d.mp4"
            cmd = [FFMPEG, "-y", "-v", "error", "-i", full, "-map", "0", "-c", "copy", "-f", "segment",
                   "-reset_timestamps", "1", "-segment_start_number", "1",
                   "-segment_format_options", "movflags=+faststart"]
            if cut_times:
                cmd += ["-segment_times", ",".join(f"{t - 0.0005:.4f}" for t in cut_times)]
            else:
                cmd += ["-segment_time", "999999"]
            run(cmd + [pattern], "split into parts")
            files = sorted(web_dir.glob("part_*.mp4"))
            sizes = [f.stat().st_size for f in files]
            if len(files) == len(groups) and max(sizes) < max_bytes:
                break
            target = int(target * 0.85)
            log(f"  a part came out at {fmt_mb(max(sizes))}; repacking with a smaller target")
        else:
            crf += 3
            continue

        parts = []
        for gi, (g, f) in enumerate(zip(groups, files), start=1):
            d = media_duration(f)
            start = starts[g[0]]
            exp = sum(sl[i]["duration"] for i in g)
            ns = [sl[i]["n"] for i in g if sl[i].get("kind", "slide") == "slide"]
            parts.append({"file": f.name, "slides": [ns[0], ns[-1]] if ns else [],
                          "chapters": [g[0], g[-1]], "start": round(start, 3), "duration": round(d, 3),
                          "expected_duration": round(exp, 3), "bytes": f.stat().st_size})
        slide_rows, chapter_rows = [], []
        for gi, g in enumerate(groups, start=1):
            for i in g:
                c = sl[i]
                row = {"kind": c.get("kind", "slide"), "title": c.get("title", ""), "label": c.get("label", ""),
                       "part": gi, "start": round(starts[i], 3),
                       "start_in_part": round(starts[i] - starts[g[0]], 3), "duration": c["duration"]}
                if row["kind"] == "slide":
                    row["n"] = c["n"]
                    slide_rows.append({k: row[k] for k in ("n", "title", "part", "start", "start_in_part",
                                                           "duration")})
                else:
                    row.update({"id": c.get("id"), "after_slide": c.get("after_slide"),
                                "placeholder": bool(c.get("placeholder"))})
                chapter_rows.append(row)
        manifest = {"source": src.name, "draft": bool(tl.get("draft")), "created": now_iso(),
                    "resolution": "1280x720", "crf": crf, "total_duration": total,
                    "max_part_bytes": max_bytes, "parts": parts, "slides": slide_rows,
                    "chapters": chapter_rows}
        atomic_write_json(web_dir / "parts.json", manifest)
        log("")
        log("  part            chapters  start      length   size")
        for p in parts:
            first, last_ = sl[p["chapters"][0]], sl[p["chapters"][1]]
            span = "–".join(str(x.get("n") if x.get("kind", "slide") == "slide" else x.get("id")) for x in (first, last_))
            log(f"  {p['file']:<14s}  {span:<8s}  {fmt_t(p['start']):>8s}  "
                f"{p['duration']:7.1f}s  {fmt_mb(p['bytes'])}")
        ok = all(p["bytes"] < max_bytes for p in parts)
        drift = abs(sum(p["duration"] for p in parts) - total)
        log(f"\n  total of parts: {sum(p['duration'] for p in parts):.2f}s (timeline {total:.2f}s, diff {drift:.2f}s)")
        log(f"  {'✓' if ok else '✗'} {len(parts)} part(s) in {web_dir}  ·  parts.json written"
            + ("  ·  NOTE: made from the DRAFT video" if tl.get("draft") else ""))
        return ok
    log("  ✗ could not get parts under the size cap")
    return False


def balanced_groups(sizes: list[int], cap: int) -> list[list[int]]:
    """Split consecutive slides into the fewest parts under `cap`, with parts as even as possible."""
    total = sum(sizes)
    for k in range(max(1, math.ceil(total / cap)), len(sizes) + 1):
        ideal = total / k
        groups: list[list[int]] = [[] for _ in range(k)]
        cum = 0
        for i, b in enumerate(sizes):
            g = min(k - 1, int((cum + b / 2) / ideal))
            groups[g].append(i)
            cum += b
        groups = [g for g in groups if g]
        if all(sum(sizes[i] for i in g) <= cap for g in groups):
            return groups
    return [[i] for i in range(len(sizes))]


def _bisect(starts: list[float], t: float) -> int:
    lo, hi = 0, len(starts)
    while lo < hi:
        mid = (lo + hi) // 2
        if starts[mid] <= t + 1e-6:
            lo = mid + 1
        else:
            hi = mid
    return lo - 1


# ─── list / check (GET only) ────────────────────────────────────────────────


def need(cfg: dict, keys: list[str], keys_path: Path) -> None:
    missing = [k for k in keys if not cfg.get(k)]
    if missing:
        die(f"Missing: {', '.join(missing)} (not in {keys_path.name}, keys.env or presenter.env)\n"
            f"    Keys: python3 set_keys.py (this project) or --global (all projects). Settings: SETUP.md.\n"
            f"    See what is set and where: generate_presentation_video.py --profile show")


def el_all_voices(el: ElevenLabs) -> list[dict]:
    """GET /v2/voices (paginated); falls back to the legacy GET /v1/voices."""
    out: list[dict] = []
    token = None
    for _ in range(50):
        params = {"page_size": 100}
        if token:
            params["next_page_token"] = token
        r = el.get("/v2/voices", "list voices", **params)
        if r.status_code != 200:
            if out:
                break
            return el.voices()
        j = r.json() or {}
        out += j.get("voices") or []
        token = j.get("next_page_token")
        if not j.get("has_more") or not token:
            break
    return out


def cmd_list_gemini_voices(cfg: dict, keys_path: Path) -> int:
    """Your replicated (cloned) Gemini voices + the prebuilt names. GET only."""
    need(cfg, ["GEMINI_API_KEY"], keys_path)
    step(f"Gemini voices (key {mask_key(cfg['GEMINI_API_KEY'])})")
    h = {"x-goog-api-key": cfg["GEMINI_API_KEY"], "accept": "application/json"}
    mine: list[dict] = []
    token = None
    for _ in range(20):
        params = {"type": "replicated", "page_size": 100, **({"page_token": token} if token else {})}
        try:
            r = api_call("GET", f"{GEMINI_API}/voices", what="list Gemini voices", headers=h, params=params)
        except ApiError as e:
            die(str(e))
        if r.status_code != 200:
            log(f"  ✗ {explain_http('Gemini', r)}")
            break
        j = r.json() or {}
        mine += j.get("voices") or []
        token = j.get("nextPageToken") or j.get("next_page_token")
        if not token:
            break
    if mine:
        log("  Your cloned (replicated) voices → GEMINI_VOICE=<id>  (needs a gemini-3.8 TTS model)")
        for v in mine:
            vid = v.get("id") or (v.get("name") or "").split("/")[-1]
            log(f"    {vid:<34s} {v.get('displayName') or v.get('display_name') or ''}")
    else:
        log("  No cloned voices found for this key (or the listing isn't available to it).")
    log("\n  Prebuilt voices: " + ", ".join(GEMINI_VOICES))
    log("  Put your choice in presenter.env (or api_keys.txt) as GEMINI_VOICE=...")
    return 0


def cmd_list_voices(cfg: dict, keys_path: Path) -> int:
    if tts_provider(cfg) == "gemini":
        return cmd_list_gemini_voices(cfg, keys_path)
    need(cfg, ["ELEVENLABS_API_KEY"], keys_path)
    step(f"ElevenLabs voices (key {mask_key(cfg['ELEVENLABS_API_KEY'])})")
    try:
        voices = el_all_voices(ElevenLabs(cfg["ELEVENLABS_API_KEY"]))
    except ApiError as e:
        die(str(e))
    order = {"cloned": 0, "professional": 1, "generated": 2}
    voices.sort(key=lambda v: (order.get(v.get("category", ""), 9), v.get("name", "")))
    mine = [v for v in voices if v.get("category") in ("cloned", "professional")]
    log(f"  {len(voices)} voices; {len(mine)} clone(s) (instant = 'cloned', professional = 'professional').\n")
    log(f"  {'category':<13s} {'voice_id':<24s} name")
    for v in voices:
        tag = "   ← your clone" if v in mine else ""
        log(f"  {v.get('category', ''):<13s} {v.get('voice_id', ''):<24s} {v.get('name', '')}{tag}")
    if not mine:
        log("\n  No cloned voice yet — create one first (SETUP.md, step 1).")
    log("\n  Put your clone's voice_id in api_keys.txt as ELEVENLABS_VOICE_ID=...")
    return 0


def cmd_list_avatars(cfg: dict, keys_path: Path, show_all: bool) -> int:
    need(cfg, ["HEYGEN_API_KEY"], keys_path)
    version = heygen_version(cfg)
    hg = HeyGen(cfg["HEYGEN_API_KEY"], version)
    step(f"HeyGen avatars (key {mask_key(cfg['HEYGEN_API_KEY'])}, API {version})")
    if version == "v3":
        try:
            looks = hg.looks("private")
        except ApiError as e:
            die(str(e))
        if not looks:
            log("  You have no private avatars yet. Create your Digital Twin (or photo avatar) in the HeyGen")
            log("  web app first (SETUP.md, step 2) and wait until it finishes training, then run this again.")
        by_type: dict[str, list[dict]] = {}
        for lk in looks:
            by_type.setdefault(lk.get("avatar_type") or "?", []).append(lk)
        labels = {"digital_twin": "Digital Twins → HEYGEN_CHARACTER_TYPE=avatar",
                  "photo_avatar": "Photo avatars → HEYGEN_CHARACTER_TYPE=talking_photo",
                  "studio_avatar": "Studio avatars → HEYGEN_CHARACTER_TYPE=avatar"}
        for t, items in by_type.items():
            log(f"\n  {labels.get(t, t)}")
            for lk in items:
                eng = ",".join(lk.get("supported_api_engines") or [])
                dims = f"{lk.get('image_width', '?')}x{lk.get('image_height', '?')}"
                log(f"    {lk.get('id'):<36s} {lk.get('name', '')[:28]:<28s} status={lk.get('status')}  "
                    f"{dims} {lk.get('preferred_orientation', '')}  engines={eng}")
        if show_all:
            log("\n  Public (stock) looks:")
            for lk in hg.looks("public", max_pages=40):
                log(f"    {lk.get('id'):<36s} {lk.get('name', '')[:40]}  [{lk.get('avatar_type')}]")
        log("\n  Put the look id in api_keys.txt as HEYGEN_AVATAR_ID=... (status must be 'completed').")
        return 0
    # Legacy v2 listing
    try:
        data = hg.legacy_avatars()
    except ApiError as e:
        die(str(e))
    avatars = data.get("avatars") or []
    photos = data.get("talking_photos") or []
    custom = [a for a in avatars if re.fullmatch(r"[0-9a-f]{32}", a.get("avatar_id", "") or "")]
    log(f"  {len(avatars)} avatars ({len(custom)} look custom), {len(photos)} photo avatars\n")
    for a in (avatars if show_all else custom):
        log(f"    avatar        {a.get('avatar_id')}  {a.get('avatar_name', '')}")
    for p in photos:
        log(f"    talking_photo {p.get('talking_photo_id')}  {p.get('talking_photo_name', '')}")
    if not show_all:
        log(f"\n  ({len(avatars) - len(custom)} stock avatars hidden; add --all to show them)")
    return 0


def cmd_check(cfg: dict, paths, args) -> int:
    ok = True
    step("Check (free: GET requests only — nothing is generated or billed)")
    log(f"  ffmpeg:   {FFMPEG}")
    try:
        slides, cuts, warnings = load_project(paths, draft=False)
    except SystemExit:
        return 1
    except PipelineError as e:
        log(f"  ✗ {e}")
        return 1
    provider = tts_provider(cfg)
    # FLPT_CARTOON_V1: a cartoon has no avatar to check; on the Mac's voice (FLPT_TTS=say: the film's draft path) there's
    # no key and nothing online to check at all
    flpt_say = flpt_cartoon() and os.environ.get("FLPT_TTS", "").strip().lower() == "say"
    if flpt_say:
        provider = "say"
        block_network()
    probe = SayTTS("draft", 165) if flpt_say else make_engine_for_estimate(cfg)
    texts = [s.text for s in slides] + [c.text for c in cuts]
    chars = sum(len(spoken_text(probe, t)) for t in texts if t)
    est_s = chars / CHARS_PER_SEC + len(slides) * TAIL_S
    hidden = [s.n for s in slides if not s.bubble]
    if hidden:      # avatar minutes exclude voice-over-only slides and cut scenes
        est_s = sum(len(spoken_text(probe, s.text)) for s in slides if s.bubble and s.text) / CHARS_PER_SEC \
            + sum(1 for s in slides if s.bubble) * TAIL_S
    log(f"  slides:   {len(slides)} PNGs in {paths.slides_dir}")
    log(f"  script:   {paths.script}  ({chars:,} characters of narration, ≈ {est_s / 60:.1f} min spoken)")
    for w in warnings:
        log(f"  ! {w}")
    if hidden:
        log(f"  bubble:   hidden on slides {hidden} (voice-over only, no avatar clip)")
    vids = [s for s in slides if s.video]
    if vids or cuts:
        log(f"  media:    {paths.media}{'' if paths.media.exists() else '  (no media.json; script CUTSCENE headings only)'}")
        for s in vids:
            v = s.video
            st = f"{clip_info(v['path'])['duration']:.1f}s" if v["exists"] else "MISSING"
            log(f"            slide {s.n:<3d} video  {v['label']}  ({st}, fit {v['fit']}, pad {v['pad']}, audio {v['audio']})")
        for c in cuts:
            st = f"{clip_info(c.src)['duration']:.1f}s" if c.exists else "MISSING"
            log(f"            cut {c.id:<5s} after slide {c.after}: {c.src_label}  ({st}) {c.label}")
        missing_media = [s for s in vids if not s.video["exists"]] + [c for c in cuts if not c.exists]
        if missing_media:
            log(f"  ✗ {len(missing_media)} media file(s) missing — the final render needs them (a --draft shows cards)")
            ok = False
    _cfg, src = load_merged_config(paths.keys, paths.config_dir)
    log(f"  settings: {paths.keys}{'' if paths.keys.exists() else '  (not there)'}")
    for label, path in config_layers(paths.keys, paths.config_dir)[:2]:
        log(f"            + {label}: {path}{'' if path.exists() else '  (not there)'}")
    for k in ("TTS_PROVIDER", "HEYGEN_VOICE_ID", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL",
              "GEMINI_API_KEY", "GEMINI_TTS_MODEL", "GEMINI_VOICE", "HEYGEN_API_KEY",
              "HEYGEN_AVATAR_ID", "HEYGEN_CHARACTER_TYPE", "HEYGEN_API_VERSION", "HEYGEN_RESOLUTION", "HEYGEN_ENGINE",
              "BUBBLE_POSITION", "BUBBLE_SHAPE", "BUBBLE_SIZE"):
        v = cfg.get(k)
        blank = "(not set)" if k in ("ELEVENLABS_VOICE_ID", "HEYGEN_AVATAR_ID") else "(default)"
        shown = mask_key(v) if is_secret(k) else (v or blank)
        if k == "GEMINI_VOICE" and v and v.startswith("voicekey_"):
            shown = mask_key(v)
        log(f"            {k:<22s} {shown}{'   ← ' + src[k] if k in src and src[k] != 'project' else ''}")
    required = ([] if flpt_say else provider_keys(provider)) + \
        ([] if args.no_avatar or flpt_cartoon() else ["HEYGEN_API_KEY", "HEYGEN_AVATAR_ID"])  # FLPT_CARTOON_V1
    if flpt_cartoon():
        log(f"  presenter: FLPT's cartoon, no avatar · voice: {'the Mac' if flpt_say else provider}")
    missing = [k for k in required if not cfg.get(k)]
    if missing:
        log(f"  ✗ missing: {', '.join(missing)}  (see SETUP.md)")
        return 1

    if provider == "gemini":
        step("Narration voice (Gemini TTS)")
        try:
            g = GeminiTTS(cfg)
            r = api_call("GET", f"{GEMINI_API}/models/{g.model}", what="Gemini model",
                         headers={"x-goog-api-key": cfg["GEMINI_API_KEY"], "accept": "application/json"})
            if r.status_code == 200:
                m = r.json() or {}
                log(f"  ✓ key accepted · model {g.model} ({m.get('displayName', '')}) · "
                    f"input limit {m.get('inputTokenLimit', '?')} tokens")
            else:
                log(f"  ✗ {explain_http('Gemini', r)}")
                ok = False
            if g.custom_voice:
                log(f"  · cloned voice {g.voice_label()} (voice replication; needs a gemini-3.8 TTS model)")
            elif g.voice not in GEMINI_VOICES:
                log(f"  ✗ GEMINI_VOICE={g.voice} is not a prebuilt voice or a voice_… / voicekey_… id")
                ok = False
            else:
                log(f"  ✓ prebuilt voice {g.voice}")
            if g.style:
                log(f"  · style (speech_metadata.style): {g.style[:80]}")
            log(f"  a full run synthesizes ≈ {chars:,} characters with Gemini TTS")
        except (ApiError, PipelineError) as e:
            log(f"  ✗ {e}")
            ok = False

    if provider == "heygen":
        step("Narration voice (HeyGen)")
        try:
            r = api_call("GET", f"{HG_API}/v3/voices/{cfg['HEYGEN_VOICE_ID']}", what="HeyGen voice",
                         headers=flpt_hg({"X-Api-Key": cfg["HEYGEN_API_KEY"], "accept": "application/json"}))
            if r.status_code == 200:
                v = (r.json() or {}).get("data") or {}
                log(f"  ✓ voice: {v.get('name')}  (status: {v.get('status')})")
                log(f"  a full run synthesizes ≈ {chars:,} characters with HeyGen text-to-speech")
            else:
                log(f"  ✗ {explain_http('HeyGen', r)}")
                ok = False
        except ApiError as e:
            log(f"  ✗ {e}")
            ok = False
    step("ElevenLabs" + (f"  (not used: TTS_PROVIDER={provider})" if provider != "elevenlabs" else ""))
    el = ElevenLabs(cfg.get("ELEVENLABS_API_KEY") or "")
    model = cfg.get("ELEVENLABS_MODEL") or DEFAULT_MODEL
    try:
        if provider != "elevenlabs":
            raise ApiError("skipped")
        r = el.voice(cfg["ELEVENLABS_VOICE_ID"])
        if r.status_code == 200:
            v = r.json()
            cat = v.get("category", "?")
            log(f"  ✓ key accepted · voice: {v.get('name')}  (category: {cat})")
            if cat not in ("cloned", "professional") and not flpt_cartoon():  # FLPT_CARTOON_V1: any voice will do
                log("  ✗ this is NOT a cloned voice. Use your clone's voice_id (run --list-voices).")
                ok = False
        else:
            log(f"  ✗ {explain_http('ElevenLabs', r)}")
            ok = False
        rm = el.get("/v1/models", "models")
        if rm.status_code == 200:
            ids = [m.get("model_id") for m in rm.json()]
            log(f"  {'✓' if model in ids else '✗'} model {model}" + ("" if model in ids else " is not available"))
            ok &= model in ids
        rs = el.subscription()
        if rs.status_code == 200:
            sub = rs.json()
            used, limit = sub.get("character_count", 0), sub.get("character_limit", 0)
            left = limit - used
            log(f"  plan '{sub.get('tier', '?')}': {used:,} of {limit:,} credits used this period · {left:,} left")
            log(f"  a full run needs ≈ {chars:,} characters (Multilingual v2: 1 credit per character; "
                f"unchanged slides are cached and never re-billed)")
            if left < chars:
                log("  ! not enough credits left for a full run — upgrade or wait for the monthly reset")
        else:
            log(f"  · could not read the quota (HTTP {rs.status_code}); a restricted key without 'User: read' "
                "permission does this — generation still works")
    except ApiError as e:
        if str(e) != "skipped":
            log(f"  ✗ {e}")
            ok = False

    if not args.no_avatar and not flpt_cartoon():  # FLPT_CARTOON_V1: no avatar to check
        version = heygen_version(cfg)
        step(f"HeyGen (API {version})")
        hg = HeyGen(cfg["HEYGEN_API_KEY"], version)
        aid = cfg["HEYGEN_AVATAR_ID"]
        ctype = character_type(cfg)
        try:
            rq = hg.me()
            if rq.status_code == 200:
                log(f"  ✓ key accepted · {HeyGen.describe_balance(rq.json())}")
            else:
                log(f"  ✗ {explain_http('HeyGen', rq)}")
                ok = False
            if version == "v3":
                looks = hg.looks("private")
                lk = next((x for x in looks if x.get("id") == aid), None)
                if lk is None:
                    log(f"  ✗ HEYGEN_AVATAR_ID {aid} is not one of your {len(looks)} private avatar looks "
                        "(run --list-avatars)")
                    ok = False
                else:
                    at = lk.get("avatar_type")
                    engines = lk.get("supported_api_engines") or []
                    log(f"  ✓ avatar: {lk.get('name')}  type={at}  status={lk.get('status')}  "
                        f"{lk.get('image_width')}x{lk.get('image_height')}  engines={','.join(engines)}")
                    if (lk.get("status") or "").lower() != "completed":
                        log("  ✗ this avatar is not ready yet (status must be 'completed')")
                        ok = False
                    if at == "photo_avatar" and ctype != "talking_photo":
                        log("  ! this is a photo avatar — set HEYGEN_CHARACTER_TYPE=talking_photo")
                    if at in ("digital_twin", "studio_avatar") and ctype == "talking_photo":
                        log("  ! this is a video avatar — set HEYGEN_CHARACTER_TYPE=avatar")
                    eng = (cfg.get("HEYGEN_ENGINE") or "").lower()
                    if eng and engines and eng not in engines:
                        log(f"  ✗ HEYGEN_ENGINE={eng} is not supported by this avatar (supports {engines})")
                        ok = False
            else:
                data = hg.legacy_avatars()
                in_av = any(a.get("avatar_id") == aid for a in data.get("avatars") or [])
                in_tp = any(p.get("talking_photo_id") == aid for p in data.get("talking_photos") or [])
                if in_av:
                    log(f"  ✓ avatar {aid} found" + ("  ✗ but HEYGEN_CHARACTER_TYPE should be avatar" if ctype == "talking_photo" else ""))
                    ok &= ctype != "talking_photo"
                elif in_tp:
                    log(f"  ✓ photo avatar {aid} found" + ("" if ctype == "talking_photo" else "  ✗ set HEYGEN_CHARACTER_TYPE=talking_photo"))
                    ok &= ctype == "talking_photo"
                else:
                    log(f"  ✗ {aid} not found (run --list-avatars)")
                    ok = False
            log(f"  clips: {heygen_resolution(cfg)} · ≈ {est_s / 60:.1f} min of avatar video for a full run "
                f"(one clip per slide, billed per second of video)")
        except ApiError as e:
            log(f"  ✗ {e}")
            ok = False

    log("")
    log("  ✓ All checks passed." if ok else "  ✗ Some checks failed — fix api_keys.txt and run the check again.")
    return 0 if ok else 1


# ─── render (draft / final) ─────────────────────────────────────────────────


def output_name(args, subset: list[int] | None) -> str:
    name = ("draft_" if args.draft and not flpt_draft_final() else "") + "presentation" + ("_no_avatar" if args.no_avatar else "")
    if subset:
        name += f"_slides_{subset[0]:02d}-{subset[-1]:02d}"
    return name


def confirm(prompt: str) -> bool:
    if not sys.stdin.isatty():
        log(f"  {prompt} — no terminal to ask; re-run with --yes to proceed.")
        return False
    return input(f"  {prompt} (y/N) ").strip().lower() in ("y", "yes")


def make_engine_for_estimate(cfg: dict):
    """An engine instance just for tag translation / character counts (no keys needed)."""
    c = dict(cfg)
    for k in ("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "HEYGEN_API_KEY", "HEYGEN_VOICE_ID", "GEMINI_API_KEY",
              "FISH_AUDIO_API_KEY", "FISH_VOICE_ID"):  # FLPT_VOICES_V1: a Fish.audio voice counts without its key too
        c.setdefault(k, "")
    try:
        return make_engine(c)
    except PipelineError:
        return SayTTS("draft", 165)


def bubble_settings(cfg: dict, args) -> dict:
    """BUBBLE_* from CLI > api_keys.txt > keys.env > presenter.env > defaults."""
    def pick(flag, key, default):
        v = getattr(args, flag, None)
        return v if v not in (None, "") else (cfg.get(key) or default)
    pos = str(pick("bubble_position", "BUBBLE_POSITION", DEFAULT_POSITION)).strip().lower().replace("_", "-")
    shape = str(pick("bubble_shape", "BUBBLE_SHAPE", "circle")).strip().lower()
    shape = {"round": "circle", "square": "rounded", "rounded-square": "rounded", "squircle": "rounded"}.get(shape, shape)
    try:
        size = int(float(pick("bubble_size", "BUBBLE_SIZE", BUBBLE_D)))
        margin = int(float(pick("bubble_margin", "BUBBLE_MARGIN", MARGIN)))
    except ValueError:
        die("BUBBLE_SIZE / BUBBLE_MARGIN must be numbers (pixels)")
    if pos not in BUBBLE_POSITIONS:
        die(f"BUBBLE_POSITION={pos!r}: use one of {', '.join(BUBBLE_POSITIONS)}")
    if shape not in BUBBLE_SHAPES:
        die(f"BUBBLE_SHAPE={shape!r}: use circle or rounded")
    return {"position": pos, "shape": shape, "size": size, "margin": margin}


def pick_cutscenes(cuts: list[CutScene], chosen: list[int], all_numbers: list[int]) -> list[CutScene]:
    """A --slides preview includes a cut scene when the slides on both sides of it are chosen
    (or it opens / closes the deck next to a chosen slide)."""
    out = []
    for c in cuts:
        nxt = next((n for n in all_numbers if n > c.after), None)
        before_ok = c.after in chosen or (c.after < all_numbers[0] and nxt in chosen)
        after_ok = nxt is None or nxt in chosen
        if before_ok and after_ok:
            out.append(c)
    return out


def cmd_render(cfg: dict, paths, args) -> int:
    draft = args.draft
    t_start = time.time()
    step(f"{'DRAFT (free, offline)' if draft else 'FINAL (paid APIs)'} — load slides + script + media")
    try:
        slides, cuts, warnings = load_project(paths, draft)
    except PipelineError as e:
        die(str(e))
    all_slides = {s.n: s for s in slides}
    all_numbers = sorted(all_slides)
    chosen = parse_range(args.slides, all_numbers)
    subset = chosen if args.slides else None
    work_slides = [all_slides[n] for n in chosen]
    work_cuts = pick_cutscenes(cuts, chosen, all_numbers)
    items = sequence(work_slides, work_cuts)
    for s in slides:
        extra = f"  [video {s.video['label']}{'' if s.video['exists'] else ' — MISSING'}]" if s.video else ""
        extra += "" if s.bubble else "  [no bubble]"
        log(f"  {s.n:2d}  {s.sid or '':<22s} {len(s.text):5d} chars  {s.title[:50]}{extra}")
        for c in cuts:
            if c.after == s.n:
                log(f"  {c.id:>2s}  {'cut scene':<22s} {len(c.text):5d} chars  {c.label[:50]}"
                    f"  [{c.src_label}{'' if c.exists else ' — MISSING'}]")
    for w in warnings:
        log(f"  ! {w}")
    if subset:
        log(f"  → working on slides {chosen}" + (f" + cut scene(s) {[c.id for c in work_cuts]}" if work_cuts else ""))
    regen = set(chosen) if args.regen else set()
    regen_avatar = set(chosen) if (args.regen or args.regen_avatar) else set()
    if (args.regen or args.regen_avatar) and not args.slides and not draft:
        die("--regen/--regen-avatar in final mode needs --slides (so you never re-pay for everything by accident)")

    # Media: the final render needs every file; the draft shows a title card instead.
    missing = [s for s in work_slides if s.video and not s.video["exists"]] + [c for c in work_cuts if not c.exists]
    if missing and (not draft or flpt_draft_final()):  # FLPT_DRAFT_FINAL: a film never shows a placeholder
        die("Media files are missing (a --draft uses placeholder cards; the final render needs the real files):\n    "
            + "\n    ".join(f"slide {m.n}: {m.video['label']}" if m.kind == "slide" else f"cut scene {m.id}: {m.src_label}"
                            for m in missing))
    for m in missing:
        if m.kind == "slide":
            m.card = placeholder_card(paths.cache, f"Video slide {m.n}", m.title,
                                      f"{m.video['label']} — not made yet (placeholder)")
        else:
            secs = m.max_len or PLACEHOLDER_CUTSCENE_S
            m.card = placeholder_card(paths.cache, f"Cut scene {m.id}", m.title,
                                      f"{m.src_label} — not made yet · placeholder, {secs:g} s")

    # Engines
    if flpt_cartoon() and not draft:  # FLPT_CARTOON_V1: no avatar, so nothing is asked of HeyGen's look or (unless
        cfg.setdefault("HEYGEN_AVATAR_ID", "cartoon")  # it's the voice) of HeyGen's key: placeholders, never sent
        if tts_provider(cfg) != "heygen":
            cfg.setdefault("HEYGEN_API_KEY", "cartoon")
        for _s in work_slides:  # every slide is voice alone until the bubble: the estimate counts no clip (T4)
            _s.flpt_bubble, _s.bubble = _s.bubble, False
    if draft:
        engine = fixture_tts(SayTTS(pick_say_voice(args.say_voice), args.say_rate))  # FLPT_FIXTURE_TTS
        if flpt_draft_final():  # FLPT_DRAFT_FINAL: the film's narration, in its own folder
            engine = fixture_tts(FilmSayTTS(pick_say_voice(args.say_voice), args.say_rate))
        flpt_guests(items, engine, cfg, args, draft=True)  # FLPT_GUEST_VOICE_V1
    else:
        # FLPT patch: the app's filming estimate (FLPT_ESTIMATE_ONLY=1) gets no keys: placeholders stand in (the network
        # is blocked, and nothing is generated). Only when the app sets it.
        if os.environ.get("FLPT_ESTIMATE_ONLY") == "1":
            for k in provider_keys(tts_provider(cfg)) + ([] if args.no_avatar else ["HEYGEN_API_KEY"]):
                if is_secret(k) and not cfg.get(k):
                    cfg[k] = "estimate-only"
        provider = tts_provider(cfg)
        if os.environ.get("FLPT_CACHED_ONLY") == "1":  # FLPT patch: a cached-only run gets no keys (and no network)
            for k in provider_keys(provider) + ([] if args.no_avatar else ["HEYGEN_API_KEY"]):
                cfg.setdefault(k, "cached-only")
        need(cfg, provider_keys(provider) + ([] if args.no_avatar else ["HEYGEN_API_KEY", "HEYGEN_AVATAR_ID"]),
             paths.keys)
        try:
            engine = fixture_tts(make_engine(cfg))  # FLPT_FIXTURE_TTS
        except PipelineError as e:
            die(str(e))
        log(f"\n  Narration: {engine.describe()}")
        flpt_guests(items, engine, cfg, args, draft=False)  # FLPT_GUEST_VOICE_V1
        if provider == "elevenlabs":
            log(f"  ElevenLabs key {mask_key(cfg['ELEVENLABS_API_KEY'])}")
        elif provider == "gemini":
            log(f"  Gemini key {mask_key(cfg['GEMINI_API_KEY'])}")
        if not args.no_avatar and not flpt_cartoon():  # FLPT_CARTOON_V1: no avatar to film
            log(f"  HeyGen key {mask_key(cfg['HEYGEN_API_KEY'])} · API {heygen_version(cfg)} · "
                f"{character_type(cfg)} {cfg['HEYGEN_AVATAR_ID']} · {heygen_resolution(cfg)}")
        new_chars, clip_n, clip_s = estimate_paid(items, all_numbers, engine, cfg, paths.cache, args.tail,
                                                  regen, regen_avatar)
        if os.environ.get("FLPT_CACHED_ONLY") == "1" and (new_chars or clip_n):  # FLPT patch
            die(f"cached-only: this run would need paid generation ({new_chars:,} characters, {clip_n} avatar "
                f"clips), so it stopped. Nothing was generated.")
        flpt_guest_estimate(items, paths.cache, regen)  # FLPT_GUEST_VOICE_V1: in an estimate, the guests' line first
        if os.environ.get("FLPT_ESTIMATE_ONLY") == "1":  # FLPT patch: the paid work as one JSON line, then stop
            adir = paths.cache / "audio" / engine.tag
            voice_chars = 0  # narration still to synthesize with no avatar clip (hidden-bubble slides, voiceovers)
            for it in items:
                if not it.text or (it.kind == "slide" and it.bubble):
                    continue
                spoken = spoken_text(engine, it.text)
                rid = it.n if it.kind == "slide" else it.after
                if spoken and (rid in regen or not (adir / f"{narration_hash(engine, spoken)}.wav").exists()):
                    voice_chars += len(spoken)
            print(json.dumps({"flpt_estimate": {"chars": new_chars, "clips": clip_n, "clip_seconds": round(clip_s, 2),
                                                "clips_total": sum(1 for s in work_slides if s.bubble),
                                                "voice_chars": voice_chars}}), flush=True)
            return 0
        log("\n  Paid work in this run (anything already cached is free):")
        log(f"    {engine.label}: {new_chars:,} characters to synthesize")
        if not args.no_avatar and not flpt_cartoon():
            log(f"    HeyGen:     {clip_n} of {sum(1 for s in work_slides if s.bubble)} clips to render, "
                f"≈ {clip_s / 60:.1f} min of avatar video")
        if warnings:
            log("  ! There are script/slide warnings above — the draft (--draft) is the free way to check them.")
        if not args.yes and not confirm("Proceed with paid generation?"):
            log("  Stopped. Nothing was generated.")
            return 1

    # Narration (slides + optional cut-scene voiceovers)
    step(f"Narration — {engine.describe()}")
    failed = make_narration(items, engine, paths.cache, regen)
    if failed:
        die(f"Narration failed for {', '.join(failed)}. Fix the problem and re-run — finished parts are cached.")
    build_timeline(items, all_numbers, paths.cache, args.tail)
    make_item_audio(items, paths.cache)
    total = sum(it.duration for it in items)
    ncut = sum(1 for it in items if it.kind == "cutscene")
    log(f"\n  Timeline: {len(work_slides)} slides{f' + {ncut} cut scene(s)' if ncut else ''}, {fmt_t(total)} total "
        f"(narration + {args.tail:.1f}s tail each)")

    # Presenter bubble (slides only; cut scenes are full-screen)
    bs = bubble_settings(cfg, args)
    try:
        bubble = None if args.no_avatar else Bubble(paths.cache / "assets", bs["size"], bs["position"], bs["shape"],
                                                    bs["margin"])
    except PipelineError as e:
        die(str(e))
    zoom = args.bubble_zoom if args.bubble_zoom is not None else cfg_float(cfg, "BUBBLE_ZOOM", 1.6)
    focus = args.bubble_focus_y if args.bubble_focus_y is not None else cfg_float(cfg, "BUBBLE_FOCUS_Y", 0.40)
    global BUBBLE_FOCUS_X
    BUBBLE_FOCUS_X = cfg_float(cfg, "BUBBLE_FOCUS_X", 0.5)
    crop_for_clips = ""
    problems: dict[int, str] = {}
    if bubble:
        step(f"Presenter bubble — {bubble.describe()}")
        bubble.ensure_artwork()
        if flpt_cartoon():  # FLPT_CARTOON_V1: FLPT's own cartoon clips (or its still), never an avatar clip
            for _s in work_slides:
                _s.bubble = getattr(_s, "flpt_bubble", _s.bubble)
            crop_for_clips = cartoon_bubbles(work_slides, bubble, paths)
        elif draft:
            src, z, fy = placeholder_source(paths)
            key = sha_file(src)[:12]
            still = bubble.still_bubble(src, z, fy, bubble.still_name(f"still_{key}_{z}_{fy}"))
            for s in work_slides:
                if s.bubble:
                    s.avatar_kind, s.avatar_src, s.avatar_key = "still", still, sha_file(still)[:16]
            log(f"  placeholder: {src.name} → {still.name}")
        else:
            problems = make_avatar_clips([s for s in work_slides if s.bubble], cfg, paths.cache, regen_avatar,
                                         args.heygen_timeout)
            hidden = [s.n for s in work_slides if not s.bubble]
            if hidden:
                log(f"  no bubble (voice-over only, no clip): slides {hidden}")
            have = [s for s in work_slides if s.avatar_kind == "clip"]
            if have:
                w0, h0 = video_size(have[0].avatar_src)  # type: ignore[arg-type]
                crop_for_clips = crop_expr(w0, h0, zoom, focus)
                for s in have:
                    if video_size(s.avatar_src) != (w0, h0):  # type: ignore[arg-type]
                        log(f"  ! slide {s.n}: clip size differs from the others")
                    s.avatar_key = sha_file(s.avatar_src)[:16]  # type: ignore[arg-type]
                    s.clip_offset = clip_sync_offset(s.avatar_src, s.padded_wav)  # type: ignore[arg-type]
                    if s.clip_offset:
                        log(f"  slide {s.n:2d}  lip-sync: clip speech is {s.clip_offset:+.2f}s off → corrected")
                log(f"  bubble crop: {crop_for_clips} (BUBBLE_ZOOM={zoom}, BUBBLE_FOCUS_Y={focus}, BUBBLE_FOCUS_X={BUBBLE_FOCUS_X})")
            missing_clips = [s for s in work_slides if s.bubble and s.avatar_kind != "clip"]
            if missing_clips:
                still = fallback_still(missing_clips, have, bubble, paths, zoom, focus)
                for s in missing_clips:
                    s.avatar_kind, s.avatar_src, s.avatar_key = "still", still, sha_file(still)[:16]
                log(f"  ! {len(missing_clips)} slide(s) use a still placeholder bubble: {[s.n for s in missing_clips]}")

    # Composite
    step("Composite (one encode per slide / cut scene, then join)")
    enc = Encoder(draft and not flpt_draft_final())  # FLPT_DRAFT_FINAL: final quality
    paths.out.mkdir(parents=True, exist_ok=True)
    name = output_name(args, subset)
    out_mp4 = paths.out / f"{name}.mp4"
    t = 0.0
    for it in items:
        it.start, t = t, t + it.duration
    composite(items, all_slides, paths.cache, out_mp4, bubble, crop_for_clips, enc,
              "draft" if draft and not flpt_draft_final() else "final")
    write_timeline(paths.out / f"{name}.timeline.json", items, out_mp4, draft and not flpt_draft_final(),
                   {"narration": engine.describe(), "bubble": bs if bubble else None,
                    **({"draft_final": True} if draft and flpt_draft_final() else {}),  # FLPT_DRAFT_FINAL
                    "avatar_problems": {str(k): v for k, v in problems.items()},
                    **({"presenter": "cartoon"} if flpt_cartoon() else {})})  # FLPT_CARTOON_V1
    ok = verify(out_mp4, items)
    if problems:
        log("\n  Avatar problems (these slides show a still bubble; re-run to retry them):")
        for n, why in sorted(problems.items()):
            log(f"    slide {n}: {why}")
    if ok and (not draft or flpt_draft_final()) and not getattr(args, "no_edit_master", False):
        make_edit_master(out_mp4, cfg_float(cfg, "EDIT_NUDGE_MS", EDIT_NUDGE_MS))
    log(f"\n  Done in {fmt_t(time.time() - t_start)} → {out_mp4}")
    if not ok:
        return 1
    return 3 if problems else 0   # 3 = video made, but some slides have a still bubble


def estimate_paid(items: list, all_numbers: list[int], engine, cfg: dict, cache: Path, tail: float,
                  regen: set[int], regen_avatar: set[int]) -> tuple[int, int, float]:
    """(characters to synthesize, clips to render, seconds of avatar video) — exact where audio is cached."""
    main = engine  # FLPT_GUEST_VOICE_V1
    chars, clips, secs = 0, 0, 0.0
    jobs_file = cache / "avatar" / "jobs.json"
    jobs = json.loads(jobs_file.read_text()) if jobs_file.exists() else {}
    for s in items:
        engine = flpt_engine(s, main)  # FLPT_GUEST_VOICE_V1: a guest's slide, by its own engine
        adir = cache / "audio" / engine.tag
        if getattr(s, "flpt_engine", None) and s.flpt_voice["provider"] == "say":
            continue  # FLPT_GUEST_VOICE_V1: a Mac guest is free and made here (a cached-only run makes it too)
        spoken = spoken_text(engine, s.text) if s.text else ""
        wav = adir / f"{narration_hash(engine, spoken)}.wav" if spoken else None
        rid = s.n if s.kind == "slide" else s.after
        if s.kind == "cutscene":           # voiceover only: no avatar clip
            if spoken and (rid in regen or not wav.exists()):
                chars += len(spoken)
            continue
        if not s.bubble or flpt_cartoon():  # voice-over only: no avatar clip (FLPT_CARTOON_V1: FLPT draws it)
            if spoken and (rid in regen or not wav.exists()):
                chars += len(spoken)
            continue
        if spoken and (rid in regen or not wav.exists()):
            chars += len(spoken)
            clips += 1
            secs += len(spoken) / CHARS_PER_SEC + tail
            continue
        probe = s.probe_copy()
        probe.narration_wav = wav
        build_timeline([probe], all_numbers, cache, tail)
        k = clip_key(cfg, probe)
        pending = (jobs.get(k) or {}).get("video_id") and (jobs.get(k) or {}).get("status") not in ("failed", "regen")
        if s.n in regen_avatar or not ((cache / "avatar" / "clips" / f"{k}.mp4").exists() or pending):
            clips += 1
            secs += probe.duration
    return chars, clips, secs


# FLPT_CARTOON_V1: the cartoon's voice for this run only (FLPT_PRESENTER_SET: JSON of non-secret narration settings),
# laid over the profile in memory and never written to it
FLPT_PRESENTER_KEYS = ("TTS_PROVIDER", "HEYGEN_VOICE_ID", "HEYGEN_VOICE_ENGINE", "HEYGEN_VOICE_SPEED", "HEYGEN_VOICE_LANGUAGE",
                       "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL", "FISH_VOICE_ID", "FISH_MODEL")


def flpt_presenter_set() -> dict:
    if not flpt_cartoon():
        return {}
    try:
        raw = json.loads(os.environ.get("FLPT_PRESENTER_SET") or "{}")
    except ValueError:
        return {}
    if not isinstance(raw, dict):
        return {}
    return {k: v.strip() for k, v in raw.items()
            if k in FLPT_PRESENTER_KEYS and isinstance(v, str) and v.strip() and not is_secret(k)
            and (k != "TTS_PROVIDER" or v.strip().lower() in TTS_PROVIDERS)}


# FLPT_CARTOON_V1: FLPT's cartoon presenter (engine/tools/patches/30_cartoon.py). With FLPT_PRESENTER=cartoon no avatar
# clip is made, asked for or paid for: the narration is voice alone, and each bubble shows FLPT's own clip for that
# slide's padded narration (cache/cartoon/index.json: pad_key -> clip, drawn by FLPT in its own sandboxed pass), else
# the cartoon's still.
def flpt_cartoon() -> bool:
    return os.environ.get("FLPT_PRESENTER", "").strip().lower() == "cartoon"


def cartoon_bubbles(slides: list, bubble, paths) -> str:
    """Each bubble slide's cartoon clip, else the cartoon's still. Returns the crop for the clips (the whole frame)."""
    global BUBBLE_FOCUS_X
    cdir = paths.cache / "cartoon"
    try:
        idx = json.loads((cdir / "index.json").read_text())
    except (OSError, ValueError):
        idx = {}
    if not isinstance(idx, dict):
        idx = {}
    root = cdir.resolve()
    have = []
    for s in slides:
        if not s.bubble:
            continue
        rel = idx.get(s.pad_key)
        clip = (cdir / rel).resolve() if isinstance(rel, str) else None
        if clip is not None and root in clip.parents and clip.is_file():
            s.avatar_kind, s.avatar_src = "clip", clip
            have.append(s)
    crop = ""
    if have:
        BUBBLE_FOCUS_X = 0.5
        w0, h0 = video_size(have[0].avatar_src)
        crop = crop_expr(w0, h0, 1.0, 0.5)
        for s in have:
            if video_size(s.avatar_src) != (w0, h0):
                log(f"  ! slide {s.n}: cartoon clip size differs from the others")
            s.avatar_key = sha_file(s.avatar_src)[:16]
            s.clip_offset = clip_sync_offset(s.avatar_src, s.padded_wav)
            if s.clip_offset:
                log(f"  slide {s.n:2d}  lip-sync: cartoon speech is {s.clip_offset:+.2f}s off -> corrected")
        log(f"  cartoon presenter: {len(have)} clip(s) · crop {crop}")
    missing = [s for s in slides if s.bubble and s.avatar_kind != "clip"]
    if missing:
        own = cdir / "still.png"
        src, z, fy = (own, 1.0, 0.5) if own.is_file() else placeholder_source(paths)
        still = bubble.still_bubble(src, z, fy, bubble.still_name(f"still_{sha_file(src)[:12]}_{z}_{fy}"))
        for s in missing:
            s.avatar_kind, s.avatar_src, s.avatar_key = "still", still, sha_file(still)[:16]
        log(f"  cartoon presenter: still bubble on slide(s) {[s.n for s in missing]}")
    return crop


def placeholder_source(paths) -> tuple[Path, float, float]:
    for cand in (paths.presenter, VIDEO_DIR / "presenter.jpeg", VIDEO_DIR / "presenter.png"):
        if cand and cand.exists():
            return cand, 1.0, 0.42
    asset = VIDEO_DIR / "assets" / "ai_presenter_placeholder.png"
    if asset.exists():
        return asset, 1.0, 0.5
    return gradient_placeholder(paths.cache / "assets" / "gradient_placeholder.png"), 1.0, 0.5


def fallback_still(missing: list[Slide], have: list[Slide], bubble: Bubble, paths, zoom: float, focus: float) -> Path:
    """Still bubble for slides whose clip is missing: a frame of a real clip if any, else presenter/placeholder."""
    if have:
        src_clip = have[0].avatar_src
        frame = bubble.assets / f"frame_{sha_file(src_clip)[:12]}.png"  # type: ignore[arg-type]
        if not frame.exists():
            run([FFMPEG, "-y", "-v", "error", "-ss", "1.0", "-i", src_clip, "-frames:v", "1", frame],
                "grab still frame")
        return bubble.still_bubble(frame, zoom, focus, bubble.still_name(f"still_{frame.stem}_{zoom}_{focus}"))
    src, z, fy = placeholder_source(paths)
    return bubble.still_bubble(src, z, fy, bubble.still_name(f"still_{sha_file(src)[:12]}_{z}_{fy}"))


# ─── main ───────────────────────────────────────────────────────────────────


class Paths:
    pass


def main() -> int:
    ap = argparse.ArgumentParser(description="Narrated presentation video with an AI presenter bubble.",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    m = ap.add_mutually_exclusive_group()
    m.add_argument("--draft", action="store_true", help="free offline draft (macOS say + placeholder bubble)")
    m.add_argument("--final", action="store_true", help="paid final render (default)")
    m.add_argument("--check", action="store_true", help="validate keys and IDs (GET only)")
    m.add_argument("--list-voices", action="store_true",
                   help="list your voices: ElevenLabs, or Gemini when TTS_PROVIDER=gemini (GET only)")
    m.add_argument("--list-avatars", action="store_true", help="list HeyGen avatars (GET only)")
    m.add_argument("--profile", choices=["show", "save"],
                   help="show: merged settings + where each came from (keys masked); "
                        "save: copy this project's voice/avatar/bubble settings into presenter.env")
    ap.add_argument("--web", action="store_true",
                    help="make output/web/ parts from the draft (with --draft) or final video; does not render")
    ap.add_argument("--slides", help="subset, e.g. 3-5 or 2,7")
    ap.add_argument("--no-avatar", action="store_true", help="no presenter bubble")
    ap.add_argument("--regen", action="store_true", help="with --slides: regenerate audio + avatar")
    ap.add_argument("--regen-avatar", action="store_true", help="with --slides: regenerate avatar clips only")
    ap.add_argument("--yes", "-y", action="store_true", help="don't ask before paid generation")
    ap.add_argument("--all", action="store_true", help="with --list-avatars: also list stock avatars")
    ap.add_argument("--deck", type=Path, help="accepted for symmetry with render_slides.py; the video reads the "
                    "rendered PNGs from --slides-dir")
    ap.add_argument("--script", type=Path, help="narration script (default ../script.md)")
    ap.add_argument("--slides-dir", type=Path, help="folder with slide_NN.png (default ../slides)")
    ap.add_argument("--out", type=Path, help="output folder (default ./output)")
    ap.add_argument("--cache", type=Path, help="cache folder (default ./cache, or <out>/.cache with --out)")
    ap.add_argument("--keys", type=Path, help="api_keys.txt path (default ./api_keys.txt)")
    ap.add_argument("--media", type=Path, help="media.json for video slides / cut scenes "
                    "(default: media.json next to the script)")
    ap.add_argument("--config-dir", type=Path, help="folder with presenter.env + keys.env "
                    "(default ~/.config/avatar-presentation, or $AVATAR_PRESENTATION_CONFIG_DIR)")
    ap.add_argument("--presenter", type=Path, help="photo for the draft bubble (default ./presenter.jpg)")
    ap.add_argument("--edit-master", action="store_true",
                    help="make output/<name>_for_editing.mov (CapCut-safe copy) from an existing final; does not render")
    ap.add_argument("--no-edit-master", action="store_true", help="skip the automatic editing master after --final")
    ap.add_argument("--web-source", type=Path, help="with --web: explicit source video")
    ap.add_argument("--web-max-mb", type=float, default=14.0, help="with --web: max size per part in MB (14)")
    ap.add_argument("--say-voice", help="macOS voice for --draft (default: best installed English voice)")
    ap.add_argument("--say-rate", type=int, default=165, help="words per minute for --draft (default 165)")
    ap.add_argument("--tail", type=float, default=TAIL_S, help=f"seconds after each slide's narration ({TAIL_S})")
    ap.add_argument("--bubble-size", type=int, help=f"bubble size px (BUBBLE_SIZE, default {BUBBLE_D})")
    ap.add_argument("--bubble-position", choices=BUBBLE_POSITIONS,
                    help=f"bubble corner (BUBBLE_POSITION, default {DEFAULT_POSITION})")
    ap.add_argument("--bubble-shape", choices=BUBBLE_SHAPES, help="circle or rounded square (BUBBLE_SHAPE, default circle)")
    ap.add_argument("--bubble-margin", type=int, help=f"px from the frame edge (BUBBLE_MARGIN, default {MARGIN})")
    ap.add_argument("--bubble-zoom", type=float, help="zoom into the avatar clip (default BUBBLE_ZOOM or 1.6)")
    ap.add_argument("--bubble-focus-y", type=float, help="vertical face position 0..1 (default BUBBLE_FOCUS_Y or 0.40)")
    ap.add_argument("--heygen-timeout", type=float, default=60, help="minutes to wait per HeyGen clip (60)")
    args = ap.parse_args()

    if args.draft:
        block_network()
    # FLPT patch: FLPT_CACHED_ONLY=1 re-composites a final from the cache (after the moving slides are re-timed to
    # the real voice) with no network at all, so nothing can be generated or paid for. Only when the app sets it.
    if os.environ.get("FLPT_CACHED_ONLY") == "1" and not args.draft:
        block_network()
    init_tools()

    # FLPT patch: the app's filming estimate (FLPT_ESTIMATE_ONLY=1) never touches the network. Only when it's set.
    if os.environ.get("FLPT_ESTIMATE_ONLY") == "1":
        block_network()
    p = Paths()
    p.slides_dir = (args.slides_dir or PRES_DIR / "slides").expanduser().resolve()
    p.script = (args.script or PRES_DIR / "script.md").expanduser().resolve()
    p.out = (args.out or VIDEO_DIR / "output").expanduser().resolve()
    p.cache = (args.cache or (p.out / ".cache" if args.out else VIDEO_DIR / "cache")).expanduser().resolve()
    p.keys = (args.keys or VIDEO_DIR / "api_keys.txt").expanduser().resolve()
    p.presenter = (args.presenter or VIDEO_DIR / "presenter.jpg").expanduser().resolve()
    p.media = (args.media or p.script.parent / "media.json").expanduser().resolve()
    p.config_dir = config_dir(args.config_dir)
    if args.profile == "show":
        return cmd_profile_show(p.keys, p.config_dir)
    if args.profile == "save":
        return cmd_profile_save(p.keys, p.config_dir)
    p.cache.mkdir(parents=True, exist_ok=True)

    # presenter.env → keys.env → api_keys.txt (in --draft only the BUBBLE_* settings are used; no network)
    cfg, _src = load_merged_config(p.keys, p.config_dir)
    cfg.update(flpt_presenter_set())  # FLPT_CARTOON_V1: the cartoon's voice, this run only

    try:
        if args.list_voices:
            return cmd_list_voices(cfg, p.keys)
        if args.list_avatars:
            return cmd_list_avatars(cfg, p.keys, args.all)
        if args.check:
            return cmd_check(cfg, p, args)
        if args.edit_master:
            name = output_name(args, parse_range(args.slides, list(range(1, 1000))) if args.slides else None)
            src = p.out / f"{name}.mp4"
            if not src.exists():
                die(f"{src.name} not found — run --final first")
            return 0 if make_edit_master(src, cfg_float(cfg, "EDIT_NUDGE_MS", EDIT_NUDGE_MS)) else 1
        if args.web:
            name = output_name(args, parse_range(args.slides, list(range(1, 1000))) if args.slides else None)
            src = (args.web_source or p.out / f"{name}.mp4").expanduser().resolve()
            if not args.web_source and not src.exists() and not args.draft:
                alt = p.out / f"draft_{name}.mp4"
                hint = " (a draft exists: use --draft --web)" if alt.exists() else ""
                die(f"{src.name} not found{hint}")
            ok = make_web(src, src.with_suffix(".timeline.json"), p.out / "web", p.out, args.web_max_mb)
            return 0 if ok else 1
        return cmd_render(cfg, p, args)
    except PipelineError as e:
        die(str(e))
    except KeyboardInterrupt:
        log("\n  Interrupted. Everything finished so far is cached — run the same command again to resume.")
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
