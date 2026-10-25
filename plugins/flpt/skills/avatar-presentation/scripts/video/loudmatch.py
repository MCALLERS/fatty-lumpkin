#!/usr/bin/env python3
"""Level the episode's extras to the presentation master (added 2026-10-12).

Why: in *The Shadow of the Future* finals, the master sat at -13.8 LUFS, but the extras arrived quieter and uneven:
- bookends and shorts around -16
- reaction clips -21 (range -34 to -11)
- voice stingers about -20
- screen recordings -31

So the editor boosted 18 spots by hand, by up to +17 dB, and the exports peaked over 0 dBTP.
Run this before handing extras over, so every piece drops into the timeline at the right level.

What it does:
- Measures each file (EBU R128 integrated loudness and true peak).
- Applies one gain to hit the target, then an oversampled true-peak limiter.
- Copies the picture untouched and writes the result to --out.
- Never touches the original.

Targets:
- default --target -14 LUFS: matches the master, for dialogue, shorts, bookends, stingers and reaction clips
- --bed writes two copies of each music file:
  - "<name>.bed": -26 LUFS by default, to sit under narration (about 12 LU below the voice)
  - "<name>.full": -16 LUFS by default, for end cards, montages and sign-offs

Containers:
- mp4 and m4a get AAC; mov gets PCM (the CapCut-safe choice); wav gets 24-bit PCM; mp3 gets 192 kbps MP3.
- The picture is stream-copied.

Examples:
  python3 loudmatch.py ~/Desktop/Karl-759 --out ~/Desktop/Karl-759/levelled
  python3 loudmatch.py stingers/*.mp3 --out levelled/stingers
  python3 loudmatch.py beds/ --bed --out levelled/beds
  python3 loudmatch.py clip.mp4 --target -16 --out /tmp/x --dry-run

Needs ffmpeg and ffprobe on PATH; standard library only.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

MEDIA = (".mp4", ".mov", ".m4v", ".m4a", ".mp3", ".wav", ".aif", ".aiff")


def media_files(paths):
    for p in paths:
        p = os.path.abspath(os.path.expanduser(p))
        if os.path.isdir(p):
            for root, _, files in os.walk(p):
                for f in sorted(files):
                    if f.lower().endswith(MEDIA) and not f.startswith("."):
                        yield os.path.join(root, f)
        elif os.path.isfile(p) and p.lower().endswith(MEDIA):
            yield p


def has_audio(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                          "-of", "json", path], capture_output=True, text=True).stdout
    try:
        return bool(json.loads(out).get("streams"))
    except Exception:
        return False


def has_video(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                          "stream=index,codec_name:stream_disposition=attached_pic", "-of", "json", path],
                         capture_output=True, text=True).stdout
    try:
        streams = json.loads(out).get("streams") or []
    except Exception:
        return False
    return any(not (s.get("disposition") or {}).get("attached_pic") for s in streams)


def measure(path):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-vn", "-af", "ebur128=peak=true",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    summ = err[err.rfind("Summary:"):]
    i = re.search(r"I:\s*(-?[\d.]+) LUFS", summ)
    tp = re.search(r"Peak:\s*(-?[\d.]+|-inf) dBFS", summ)
    I = float(i.group(1)) if i else None
    if I is not None and I <= -69.9:  # gated out: too short or silent
        I = None
    return I, (float(tp.group(1)) if tp and tp.group(1) != "-inf" else None)


def aac():
    encs = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    return ["-c:a", "aac_at"] if re.search(r"\baac_at\b", encs) else ["-c:a", "aac", "-cutoff", "18000"]


def audio_codec(ext):
    ext = ext.lower()
    if ext in (".mov",):
        return ["-c:a", "pcm_s16le", "-ar", "48000"], False
    if ext in (".wav", ".aif", ".aiff"):
        return ["-c:a", "pcm_s24le", "-ar", "48000"], False
    if ext == ".mp3":
        return ["-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000"], True
    return aac() + ["-b:a", "256k", "-ar", "48000"], True


def level(src, dst, gain_db, tp_db, lossy):
    ceiling = tp_db - (0.3 if lossy else 0.05)
    lin = 10 ** (ceiling / 20.0)
    af = (f"volume={gain_db:.2f}dB,aresample=192000,"
          f"alimiter=limit={lin:.4f}:attack=1:release=50:level=disabled:latency=1,aresample=48000")
    ext = os.path.splitext(dst)[1]
    acodec, _ = audio_codec(ext)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src]
    if has_video(src) and ext.lower() in (".mp4", ".mov", ".m4v"):
        cmd += ["-map", "0:v:0", "-c:v", "copy"]
    cmd += ["-map", "0:a:0", "-af", af] + acodec
    if ext.lower() in (".mp4", ".m4v", ".m4a"):
        cmd += ["-movflags", "+faststart"]
    cmd += [dst]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.strip()[-400:])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", help="files or folders (folders are searched recursively)")
    ap.add_argument("--out", required=True, help="output folder (must not be an input folder)")
    ap.add_argument("--target", type=float, default=-14.0, help="integrated loudness, LUFS (default -14, the master)")
    ap.add_argument("--tp", type=float, default=-1.0, help="true-peak ceiling, dBTP (default -1)")
    ap.add_argument("--bed", action="store_true", help="music beds: write a .bed and a .full copy")
    ap.add_argument("--bed-target", type=float, default=-26.0)
    ap.add_argument("--full-target", type=float, default=-16.0)
    ap.add_argument("--max-gain", type=float, default=20.0, help="refuse gains above this many dB (noise)")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"{tool} not found on PATH (brew install ffmpeg)")
    out = os.path.abspath(os.path.expanduser(a.out))
    for raw in a.inputs:
        r = os.path.abspath(os.path.expanduser(raw))
        if (os.path.isdir(r) and r == out) or (os.path.isfile(r) and os.path.dirname(r) == out):
            raise SystemExit("--out must be a separate folder; originals are never replaced")
    files = list(dict.fromkeys(media_files(a.inputs)))
    files = [f for f in files if not f.startswith(out + os.sep)]
    if not files:
        raise SystemExit("no media files found")
    in_dirs = {os.path.dirname(f) for f in files}
    if out in in_dirs:
        raise SystemExit("--out must be a separate folder; originals are never replaced")
    os.makedirs(out, exist_ok=True)

    print(f"{'file':52s} {'in LUFS':>8s} {'in TP':>6s} {'gain':>7s} -> {'out LUFS':>8s} {'out TP':>6s}")
    for src in files:
        name = os.path.basename(src)
        if not has_audio(src):
            print(f"{name[:52]:52s}  no audio, skipped")
            continue
        I, tp = measure(src)
        if I is None:
            print(f"{name[:52]:52s}  too short or silent to measure (under ~0.4 s), skipped")
            continue
        stem, ext = os.path.splitext(name)
        rel = os.path.relpath(os.path.dirname(src), os.path.commonpath(list(in_dirs)) if len(in_dirs) > 1 else os.path.dirname(src))
        dst_dir = os.path.normpath(os.path.join(out, rel))
        os.makedirs(dst_dir, exist_ok=True)
        plans = [(f"{stem}.bed{ext}", a.bed_target), (f"{stem}.full{ext}", a.full_target)] if a.bed else [(name, a.target)]
        for dst_name, target in plans:
            dst = os.path.join(dst_dir, dst_name)
            gain = target - I
            warn = ""
            if gain > a.max_gain:
                print(f"{dst_name[:52]:52s} {I:8.1f} {tp if tp is not None else float('nan'):6.1f} {gain:+7.1f}   refused: above --max-gain (very quiet source)")
                continue
            if gain > 12:
                warn = "  (big boost: listen for noise)"
            if os.path.exists(dst) and not a.overwrite:
                print(f"{dst_name[:52]:52s}  exists, skipped (use --overwrite)")
                continue
            if a.dry_run:
                print(f"{dst_name[:52]:52s} {I:8.1f} {tp if tp is not None else float('nan'):6.1f} {gain:+7.1f}   (dry run)")
                continue
            _, lossy = audio_codec(ext)
            try:
                level(src, dst, gain, a.tp, lossy)
            except RuntimeError as e:
                print(f"{dst_name[:52]:52s}  ffmpeg failed: {e}")
                continue
            oI, otp = measure(dst)
            # One corrective pass: the limiter shaves peaks after the gain, so peaky speech lands short.
            if oI is not None and target - oI > 0.5 and target - oI <= 3.0:
                gain += target - oI
                try:
                    level(src, dst, gain, a.tp, lossy)
                    oI, otp = measure(dst)
                except RuntimeError as e:
                    print(f"{dst_name[:52]:52s}  second pass failed: {e}")
            # FLPT_EXTRAS_TP_V1: a lossy encoder that put the true peak back over the ceiling: once more, the limiter's
            # ceiling lowered by the overshoot (ffmpeg's own AAC on Linux; Apple's stays inside the 0.3 dB margin)
            if lossy and otp is not None and otp > a.tp:
                try:
                    level(src, dst, gain, a.tp - (otp - a.tp) - 0.1, lossy)
                    oI, otp = measure(dst)
                except RuntimeError as e:
                    print(f"{dst_name[:52]:52s}  true-peak pass failed: {e}")
            fmt = lambda v: f"{v:6.1f}" if v is not None else "   n/a"
            print(f"{dst_name[:52]:52s} {I:8.1f} {fmt(tp)} {gain:+7.1f} -> {fmt(oI):>8s} {fmt(otp)}{warn}")
    print(f"\nLevelled copies are in {out}. The limiter can only pull peaks down, so a very dynamic clip may land a little under target.")


if __name__ == "__main__":
    main()
