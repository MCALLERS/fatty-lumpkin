#!/usr/bin/env python3
"""measure_av_sync.py: how far the voice sits from the avatar's lips, per slide, in a finished talk's masters.

    python3 measure_av_sync.py <talk dir>     # the folder that holds presentation/  (needs numpy)

Each HeyGen clip's own audio track is what its lips were animated to, so for every slide with a bubble it
cross-correlates that track against the master's audio at the slide's start. It prints the offset for
presentation_for_editing.mov (CapCut) and presentation.mp4 (web). + = voice late, − = voice early. A frame is 33 ms.
Measured 2026-10-07 on all five *Shadow of the Future* talks (elevenlabs_v3 voice): the .mov at −3 ms, the .mp4 at
−23 ms (the 20 ms EDIT_NUDGE_MS is right). If the .mov is within ±10 ms and lips still look off in an editor, the
cause is the editor (preview lag, project frame rate), not the file.
"""
import json, pathlib, subprocess, sys
import numpy as np

SR = 16000
def pcm(path, ss, t):
    r = subprocess.run(["ffmpeg","-v","error","-ss",f"{ss:.3f}","-t",f"{t:.3f}","-i",str(path),"-vn","-ac","1","-ar",str(SR),"-f","s16le","-"], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.int16).astype(np.float64)
def lag_ms(ref, sig, maxlag_ms=300):
    # d such that sig[t + d] ≈ ref[t]; sig was cut starting 0.5 s before ref's start
    n = 1 << int(np.ceil(np.log2(len(ref) + len(sig))))
    c = np.fft.irfft(np.fft.rfft(sig, n) * np.conj(np.fft.rfft(ref, n)), n)
    pre = int(0.5 * SR); m = int(maxlag_ms * SR / 1000)
    lags = np.arange(pre - m, pre + m + 1); seg = c[lags]
    i = int(np.argmax(seg)); y0, y1, y2 = seg[max(i-1,0)], seg[i], seg[min(i+1,len(seg)-1)]
    frac = 0.5 * (y0 - y2) / (y0 - 2*y1 + y2) if (y0 - 2*y1 + y2) != 0 else 0.0
    d = (lags[i] + frac - pre) / SR * 1000
    peak = y1 / (np.linalg.norm(ref) * np.linalg.norm(sig[lags[i]:lags[i]+len(ref)]) + 1e-9)
    return d, peak
talk = pathlib.Path(sys.argv[1]); P = talk / "presentation/video"
tl = json.loads((P/"output/presentation.timeline.json").read_text()); start = {s["n"]: s["start"] for s in tl["slides"]}
jobs = json.loads((P/"cache/avatar/jobs.json").read_text())
# Pick each slide's clip by matching sound, not by the slide number stored in jobs.json: that number is the slide's
# number when the clip was made, and goes stale when slides are inserted and renumbered (2026-10-13).
clips = sorted({P/"cache/avatar/clips"/f"{k}.mp4" for k, v in jobs.items()
                if v.get("status") == "downloaded" and (P/"cache/avatar/clips"/f"{k}.mp4").exists()})
clip_pcm = {f: pcm(f, 0, 15) for f in clips}
best = {}
for n in sorted(start):
    m = pcm(P/"output"/"presentation_for_editing.mov", start[n] - 0.5, 16)
    scored = [(lag_ms(c, m)[1], f) for f, c in clip_pcm.items() if len(c) > SR]
    if scored:
        pk, f = max(scored, key=lambda x: x[0])
        if pk > 0.15:
            best[n] = (f, 0)
res = []
for n in sorted(best):
    f = best[n][0]; off = json.loads(f.with_suffix(".sync.json").read_text()).get("offset", 0) if f.with_suffix(".sync.json").exists() else 0
    clip = clip_pcm[f]
    for name in ["presentation_for_editing.mov", "presentation.mp4"]:
        m = pcm(P/"output"/name, start[n] - 0.5, 16)
        d, pk = lag_ms(clip, m)
        res.append((n, name, d, pk, off))
for n in sorted(best):
    row = [r for r in res if r[0] == n]
    print(f"slide {n:2d}  clip_offset {row[0][4]:+.3f}  editing .mov: voice {row[0][2]:+6.1f} ms vs lips (corr {row[0][3]:.2f})   web .mp4: {row[1][2]:+6.1f} ms")
mov = np.array([r[2] for r in res if r[1].endswith(".mov") and r[3] > 0.2]); mp4 = np.array([r[2] for r in res if r[1].endswith(".mp4") and r[3] > 0.2])
print(f"MEDIAN  editing .mov: {np.median(mov):+.1f} ms (range {mov.min():+.1f}…{mov.max():+.1f})   web .mp4: {np.median(mp4):+.1f} ms   (+ = voice late, − = voice early)")
