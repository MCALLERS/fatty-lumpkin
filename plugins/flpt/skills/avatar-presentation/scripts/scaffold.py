#!/usr/bin/env python3
"""Set up <project>/presentation/ with the talk-studio pipeline.

usage: python3 scaffold.py "<project dir>" [--force]

Creates:
  presentation/deck/project/slides/   Slides-artifact files (built by deck/build_deck.py)
  presentation/slides/                rendered 1920x1080 PNGs (video/render_slides.py)
  presentation/video/                 narration + avatar + compositing pipeline
  presentation/player/                Loom-style player page builder
Also creates presentation/video/.venv with requests (needed for --check and --final).
Existing files are left alone unless --force (never overwrites api_keys.txt).
"""
import os, shutil, stat, subprocess, sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent


def copy(src: Path, dst: Path, force: bool):
    if dst.exists() and not force:
        print(f"  = {dst} (kept)")
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    if dst.suffix in (".command", ".py"):
        dst.chmod(dst.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    print(f"  + {dst}")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    if not args:
        raise SystemExit(__doc__)
    pres = Path(args[0]).expanduser().resolve() / "presentation"
    for d in ("deck/project/slides", "slides", "video", "player"):
        (pres / d).mkdir(parents=True, exist_ok=True)
    for f in (SCRIPTS / "video").rglob("*"):
        if f.is_file() and f.name != "api_keys.txt" and "__pycache__" not in f.parts:
            copy(f, pres / "video" / f.relative_to(SCRIPTS / "video"), force)
    copy(SCRIPTS / "player" / "build_player.py", pres / "player" / "build_player.py", force)
    copy(SCRIPTS / "deck" / "build_deck_example.py", pres / "deck" / "build_deck.py", False)
    venv = pres / "video" / ".venv"                   # --check / --final need 'requests'
    if not (venv / "bin" / "python").exists():
        try:
            subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)
            subprocess.run([str(venv / "bin" / "pip"), "install", "-q", "requests"], check=True)
            print(f"  + {venv} (requests)")
        except (OSError, subprocess.CalledProcessError) as e:
            print(f"  ! venv not created ({e}); RUN_ME.command sets it up on first run")
    print(f"\n  Ready: {pres}\n  Next: write presentation/script.md and presentation/deck/build_deck.py (see references/3-deck-and-script.md)")


if __name__ == "__main__":
    main()
