#!/usr/bin/env python3
"""Make the Slack pack from a finished episode export (added 2026-10-12).

This reproduces what Michael posts for each episode of *The Shadow of the Future*, from the editor's final
export (CapCut: 1080p30, ~8 Mbps):

  "<Title> (vF).mp4"                  same length, x264 CRF 22, capped at 5 Mbps: small enough for Slack
  "<Title> - 1.25x for Slack.mp4"      the same recipe, sped up 1.25x (pitch kept), at 30 fps
  "<Title>.mp3"                       audio only, for listening on the go
  "<Title>-Cover.jpg"                 a still from the title card

Every audio output also passes an oversampled true-peak limiter (default ceiling -1 dBTP).
CapCut exports of the Shadow finals peaked at +0.4 to +1.2 dBTP, which can clip on some players.
The limiter does nothing to audio that is already under the ceiling.

It never overwrites a file unless --overwrite is given.
It needs ffmpeg and ffprobe on PATH, and nothing else (standard library only).

Examples:
  python3 slack_pack.py "~/Desktop/Ep. 4 - Fog of War/Ep. 4 - Fog of War.mp4"
  python3 slack_pack.py final.mp4 --title "Fog of War" --out ~/Desktop/Slack --cover-at 1.2
  python3 slack_pack.py final.mp4 --only fast --speed 1.5
  python3 slack_pack.py final.mp4 --seconds 20 --out /tmp/test     # quick test on the first 20 s
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

KINDS = ("vf", "fast", "mp3", "cover")


def sh(cmd, quiet=True):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        sys.stderr.write(p.stderr[-2000:] + "\n")
        raise SystemExit(f"ffmpeg failed: {' '.join(cmd[:6])} …")
    return p


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "format=duration,size:stream=codec_type,width,height,r_frame_rate,sample_rate",
                          "-of", "json", path], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"can't read {path}: {out.stderr.strip()[:300]}")
    return json.loads(out.stdout)


def loudness(path, seconds=None):
    """Integrated loudness and true peak via ebur128 (decodes the audio once)."""
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-vn"]
    if seconds:
        cmd += ["-t", str(seconds)]
    cmd += ["-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"]
    err = subprocess.run(cmd, capture_output=True, text=True).stderr
    summ = err[err.rfind("Summary:"):]
    i = re.search(r"I:\s*(-?[\d.]+) LUFS", summ)
    tp = re.search(r"Peak:\s*(-?[\d.]+|-inf) dBFS", summ)
    return (float(i.group(1)) if i else None,
            (float(tp.group(1)) if tp and tp.group(1) != "-inf" else None))


def aac_encoder():
    """Apple's AudioToolbox AAC when present (macOS): far fewer encoder overs after atempo."""
    encs = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    return ["-c:a", "aac_at"] if re.search(r"\baac_at\b", encs) else ["-c:a", "aac", "-cutoff", "18000"]


def limiter(ceiling_db, headroom_db=0.3):
    # Limit a little under the target: lossy encoders add ~0.1-0.3 dB of intersample peak.
    lin = 10 ** ((ceiling_db - headroom_db) / 20.0)
    # 4x oversampled sample-peak limiting approximates a BS.1770 true-peak ceiling.
    return (f"aresample=192000,alimiter=limit={lin:.4f}:attack=1:release=50:level=disabled:latency=1,"
            f"aresample=48000")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("final", help="the editor's final export (mp4 or mov)")
    ap.add_argument("--title", help="base name for the outputs (default: the input's file name)")
    ap.add_argument("--out", help="output folder (default: next to the input)")
    ap.add_argument("--only", nargs="+", choices=KINDS, help="make only these (default: all four)")
    ap.add_argument("--speed", type=float, default=1.25, help="speed of the fast cut (default 1.25)")
    ap.add_argument("--crf", type=int, default=22)
    ap.add_argument("--maxrate", default="5M", help="x264 maxrate (bufsize is twice this)")
    ap.add_argument("--preset", default="medium")
    ap.add_argument("--audio-kbps", type=int, default=192)
    ap.add_argument("--mp3-kbps", type=int, default=128)
    ap.add_argument("--true-peak", type=float, default=-1.0, help="dBTP ceiling for every audio output")
    ap.add_argument("--no-limit", action="store_true", help="skip the true-peak limiter")
    ap.add_argument("--cover-at", type=float, default=1.0, help="seconds into the video for the cover still")
    ap.add_argument("--seconds", type=float, help="process only the first N seconds (for a quick test)")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--verify", action="store_true", help="measure loudness and true peak of every output")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and the ffmpeg commands only")
    a = ap.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"{tool} not found on PATH (brew install ffmpeg)")
    src = os.path.abspath(os.path.expanduser(a.final))
    if not os.path.isfile(src):
        raise SystemExit(f"not found: {src}")
    info = probe(src)
    dur = float(info["format"]["duration"])
    has_audio = any(s["codec_type"] == "audio" for s in info["streams"])
    title = a.title or os.path.splitext(os.path.basename(src))[0]
    title = re.sub(r"\s*\(vF\)$", "", title)
    out = os.path.abspath(os.path.expanduser(a.out)) if a.out else os.path.dirname(src)
    os.makedirs(out, exist_ok=True)
    kinds = a.only or list(KINDS)
    lim = "" if (a.no_limit or not has_audio) else limiter(a.true_peak)
    t = ["-t", str(a.seconds)] if a.seconds else []
    bufsize = re.sub(r"(\d+(?:\.\d+)?)", lambda m: str(float(m.group(1)) * 2).rstrip("0").rstrip("."), a.maxrate, 1)
    venc = ["-c:v", "libx264", "-preset", a.preset, "-crf", str(a.crf), "-maxrate", a.maxrate, "-bufsize", bufsize,
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart"]
    aenc = aac_encoder() + ["-b:a", f"{a.audio_kbps}k", "-ar", "48000", "-ac", "2"]

    jobs = []
    if "vf" in kinds:
        dst = os.path.join(out, f"{title} (vF).mp4")
        cmd = ["ffmpeg", "-hide_banner", "-y", *t, "-i", src, "-map", "0:v:0"]
        if has_audio:
            cmd += ["-map", "0:a:0"] + (["-af", lim] if lim else []) + aenc
        jobs.append(("vF (same length)", dst, cmd + venc + [dst]))
    if "fast" in kinds:
        sp = a.speed
        label = f"{sp:g}x"
        dst = os.path.join(out, f"{title} - {label} for Slack.mp4")
        # atempo accepts 0.5–100 per instance in ffmpeg 8; one instance covers sensible speeds.
        fc = f"[0:v]setpts=PTS/{sp},fps=30[v]"
        if has_audio:
            fc += f";[0:a]atempo={sp}" + (f",{lim}" if lim else "") + "[a]"
        cmd = ["ffmpeg", "-hide_banner", "-y", *([] if not a.seconds else ["-t", str(a.seconds)]), "-i", src,
               "-filter_complex", fc, "-map", "[v]"] + (["-map", "[a]"] + aenc if has_audio else [])
        jobs.append((f"{label} for Slack", dst, cmd + venc + [dst]))
    if "mp3" in kinds and has_audio:
        dst = os.path.join(out, f"{title}.mp3")
        cmd = ["ffmpeg", "-hide_banner", "-y", *t, "-i", src, "-vn"] + (["-af", lim] if lim else []) + \
              ["-c:a", "libmp3lame", "-b:a", f"{a.mp3_kbps}k", "-ar", "48000", dst]
        jobs.append(("mp3", dst, cmd))
    if "cover" in kinds:
        dst = os.path.join(out, f"{title}-Cover.jpg")
        cmd = ["ffmpeg", "-hide_banner", "-y", "-ss", str(min(a.cover_at, max(dur - 0.1, 0))), "-i", src,
               "-frames:v", "1", "-q:v", "2", dst]
        jobs.append(("cover", dst, cmd))

    clash = [d for _, d, _ in jobs if os.path.exists(d)]
    if clash and not a.overwrite and not a.dry_run:
        raise SystemExit("these already exist (use --overwrite or --out):\n  " + "\n  ".join(clash))
    if os.path.abspath(src) in [os.path.abspath(d) for _, d, _ in jobs]:
        raise SystemExit("an output would replace the input; use --title or --out")

    print(f"Slack pack for: {src}\n  {dur/60:.1f} min · out: {out}" + (f" · first {a.seconds:g} s only" if a.seconds else ""))
    if lim:
        print(f"  audio: true-peak ceiling {a.true_peak:g} dBTP (4x oversampled limiter)")
    for name, dst, cmd in jobs:
        if a.dry_run:
            print(f"\n[{name}] " + " ".join(f'"{c}"' if " " in c else c for c in cmd))
            continue
        t0 = time.time()
        print(f"  … {name}: {os.path.basename(dst)}", flush=True)
        sh(cmd)
        size = os.path.getsize(dst) / 1e6
        line = f"    done in {time.time()-t0:.0f} s, {size:.1f} MB"
        if a.verify and not dst.endswith(".jpg"):
            i, tp = loudness(dst)
            ok = "" if (lim == "" or tp is None or tp <= a.true_peak + 0.05) else "  ← OVER the ceiling"
            line += f", {i} LUFS, true peak {tp} dBTP{ok}"
        print(line)
    if not a.dry_run:
        print("Done. Post the (vF) and the 1.25x cut; the flyer says a 1.25x version exists.")


if __name__ == "__main__":
    main()
