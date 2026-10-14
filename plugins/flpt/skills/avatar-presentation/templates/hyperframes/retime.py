#!/usr/bin/env python3
"""retime.py — re-time every HyperFrames slide to the real narration, then re-render it. Free and offline.

    python3 retime.py <presentation dir> [--slides 3,5-7] [--dry-run] [--no-render] [--aligner real|pseudo]

Run this after the final (or a --no-avatar) pipeline run has made the real narration. For each
`presentation/hyperframes/slide_NN/` it:
  1. finds slide N's narration WAV in video/cache/audio/<engine>/ (newest match)
  2. writes word timings → slide_NN/words.json with real-words.py (default; built for expressive voices)
     or pseudo-words.py (--aligner pseudo)
  3. runs align-beats.mjs --offset <lead> (0.5 s on the first slide and after a cut scene)
  4. sets the duration to the slide's real on-screen time (timeline) minus one frame, and stretches slow
     whole-slide moves (dur >= 8 s starting by 1 s: Ken Burns, push-ins) to end at duration - hold
  5. re-renders to presentation/media/slide_NN.mp4 with --check-frames
Then re-run the pipeline (--final again). Avatar clips are cached, so only the compositing is redone.
"""
import glob, json, os, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def parse_slides(spec, have):
    if not spec:
        return have
    out = set()
    for part in spec.split(","):
        a, _, b = part.partition("-")
        out.update(range(int(a), int(b or a) + 1))
    return [n for n in have if n in out]


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        raise SystemExit(__doc__)
    P = Path(args[0]).expanduser().resolve()
    dry, render = "--dry-run" in args, "--no-render" not in args
    spec = args[args.index("--slides") + 1] if "--slides" in args else None
    aligner = args[args.index("--aligner") + 1] if "--aligner" in args else "real"
    if aligner not in ("real", "pseudo"):
        raise SystemExit("--aligner must be real or pseudo")

    # FLPT patch: --draft re-times to the free draft's voice (macOS say) instead of the final narration.
    draft = "--draft" in args
    tls = [t for t in glob.glob(str(P / "video/output/*.timeline.json")) if ("draft" in Path(t).name) == draft]
    if not tls:
        raise SystemExit("no final timeline in video/output/ — run the pipeline (--final or --no-avatar) first")
    tl = json.load(open(max(tls, key=os.path.getmtime)))
    slides = {s["n"]: s for s in tl["slides"]}
    first = min(slides)
    after_cut = {c.get("after_slide") for c in tl.get("cutscenes", [])}
    script = open(P / "script.md", encoding="utf-8").read()

    failed = []
    have = sorted(int(d.name[6:]) for d in (P / "hyperframes").glob("slide_[0-9][0-9]") if (d / "beats.json").exists())
    for n in parse_slides(spec, have):
        d = P / "hyperframes" / f"slide_{n:02d}"
        s = slides.get(n)
        if not s:
            print(f"slide {n}: not in the timeline, skipped"); continue
        metas = []
        for j in glob.glob(str(P / "video/cache/audio/*/*.json")):
            if ("/say/" in j) != draft:  # FLPT patch: the draft's voice is macOS say
                continue
            m = json.load(open(j))
            if re.fullmatch(rf"slide\s+{n}", str(m.get("item", ""))):
                metas.append((m.get("created", ""), j))
        if not metas:
            print(f"slide {n}: no narration audio in the cache, skipped"); continue
        wav = max(metas)[1][:-5] + ".wav"
        sec = re.search(rf"^## SLIDE {n}\b[^\n]*\n(.*?)(?=^## |\Z)", script, re.S | re.M)
        text = "\n".join(l for l in sec.group(1).splitlines() if not l.startswith(">"))
        (d / "narration.txt").write_text(text, encoding="utf-8")
        lead = 0.5 if (n == first or (n - 1) in after_cut) else 0.0
        dur = round(s["duration"] - 1 / 30, 3)
        print(f"\n── slide {n}: lead {lead}s · on screen {s['duration']:.2f}s · narration {s.get('narration_seconds', 0):.1f}s")
        if aligner == "real":
            subprocess.run([sys.executable, str(HERE / "real-words.py"), wav, str(d / "narration.txt"),
                            str(d / "words.json")], check=True)
        else:
            subprocess.run([sys.executable, str(HERE / "pseudo-words.py"), wav, str(d / "narration.txt"),
                            "--out", str(d / "words.json")], check=True)
        cmd = ["node", str(HERE / "align-beats.mjs"), str(d), "--words", str(d / "words.json"), "--offset", str(lead)]
        subprocess.run(cmd + (["--dry-run"] if dry else []), check=True)
        if dry:
            continue
        bj = d / "beats.json"                          # slow whole-slide moves (Ken Burns, push-ins) span the slide
        beats = json.load(open(bj))
        hold = float(beats.get("hold", 1.5))
        for b in beats.get("beats", []):
            if float(b.get("dur", 0)) >= 8 and float(b.get("t", 99)) <= 1.0:
                b["dur"] = round(dur - hold - float(b["t"]) - 0.1, 2)
        json.dump(beats, open(bj, "w"), indent=1)
        subprocess.run(["node", str(HERE / "render.mjs"), str(d), "--duration", str(dur), "--sync"], check=True)
        if render:
            r = subprocess.run(["node", str(HERE / "render.mjs"), str(d), "--out", str(P / "media" / f"slide_{n:02d}.mp4"),
                                "--check-frames", str(d / "check")])
            if r.returncode != 0:                      # usually the hold test: motion runs into the final hold
                failed.append(n)
                print(f"  ✗ slide {n}: render/check failed. Most often the last beats now run into the hold. "
                      f"Tighten the final beats (shorter dur/after) or lower 'hold' in {bj.name}, then re-render.")
    if failed:
        print(f"\n✗ needs attention: slides {', '.join(map(str, failed))} (the others are re-timed and rendered)")
        sys.exit(2)


if __name__ == "__main__":
    main()
