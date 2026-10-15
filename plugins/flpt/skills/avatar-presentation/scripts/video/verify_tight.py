#!/usr/bin/env python3
"""verify_tight.py <talk dir>: check a tightened presentation.mp4 against presentation_uncut.mp4 (needs numpy).

Maps every Scribe word (output/tighten/scribe.json, uncut times) through the cut plan (tighten/plan.json) and
cross-correlates 1.5 s of uncut sound around it with the tight sound at the mapped time (±30 ms search; |lag| > 2 ms
is flagged), then compares about 40 sampled frames (PSNR < 30 dB is flagged). A 0.3 s MSE check used before this
cried wolf at 7–10 ms on short words next to silence; the longer cross-correlation reads 0–0.3 ms for those.
Run it after tighten.py --apply and before any insert_clip.py (inserts move the timeline it maps through).
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np

out = Path(sys.argv[1]) / "presentation/video/output"
plan = json.loads((out / "tighten/plan.json").read_text())
fps = plan.get("fps", 30)
cuts = sorted((c[0] / fps, c[1] / fps) for c in plan["cuts"])      # plan cuts are [start frame, end frame, why, jump]
SR, W = 8000, 1.5


def mp(t):
    sh = 0.0
    for a, b in cuts:
        if t >= b:
            sh += b - a
        elif t > a:
            return None
    return t - sh


def audio(p):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                       capture_output=True)
    return np.frombuffer(r.stdout, np.int16).astype(np.float64)


U, T = audio(out / "presentation_uncut.mp4"), audio(out / "presentation.mp4")
words = [w for w in json.loads((out / "tighten/scribe.json").read_text())["words"] if w.get("type") == "word"]
pre, m = int(0.05 * SR), int(0.03 * SR)
errs = []
for w in words:
    t2 = mp(w["start"])
    if t2 is None:
        errs.append(("word inside a cut", w["text"], w["start"]))
        continue
    i, j = int((w["start"] - 0.25) * SR), int((t2 - 0.30) * SR)
    ref, sig = U[max(0, i):max(0, i) + int(W * SR)], T[max(0, j):max(0, j) + int((W + 0.1) * SR)]
    if len(ref) < SR // 2 or len(sig) < len(ref) or not np.any(ref):
        continue
    n = 1 << int(np.ceil(np.log2(len(ref) + len(sig))))
    c = np.fft.irfft(np.fft.rfft(sig, n) * np.conj(np.fft.rfft(ref, n)), n)
    lags = np.arange(pre - m, pre + m + 1)
    lag_ms = (lags[int(np.argmax(c[lags]))] - pre) / SR * 1000
    if abs(lag_ms) > 2:
        errs.append(("audio lag ms", w["text"], w["start"], round(lag_ms, 1)))


def frame(p, t):
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.4f}", "-i", str(p), "-frames:v", "1", "-vf",
                        "scale=320:180,format=gray", "-f", "rawvideo", "-"], capture_output=True)
    return np.frombuffer(r.stdout, np.uint8).astype(np.float32)


vbad, checked = [], 0
for k in range(0, len(words), max(1, len(words) // 40)):
    t = words[k]["start"] + 0.05
    t2 = mp(t)
    if t2 is None:
        continue
    fa, fb = frame(out / "presentation_uncut.mp4", t), frame(out / "presentation.mp4", t2)
    if len(fa) != len(fb) or not len(fa):
        continue
    mse = np.mean((fa - fb) ** 2)
    psnr = 99 if mse == 0 else 10 * np.log10(255 ** 2 / mse)
    checked += 1
    if psnr < 30:
        vbad.append((round(t, 2), round(t2, 2), round(psnr, 1)))
print(f"{len(words)} words, {len(cuts)} cuts; audio problems: {len(errs)}; frames checked {checked}, mismatches: {len(vbad)}")
for e in errs[:10]:
    print("  ", e)
for v in vbad[:10]:
    print("   frame", v)
sys.exit(1 if errs or vbad else 0)
