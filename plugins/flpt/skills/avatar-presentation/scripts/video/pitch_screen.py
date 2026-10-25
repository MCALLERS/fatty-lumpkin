#!/usr/bin/env python3
"""pitch_screen.py <wav> [...]: flag narration phrases whose voice jumps out of the presenter's range.

Splits each take into phrases (voiced runs separated by >= 0.22 s of quiet), tracks F0 with YIN every 20 ms,
and keeps only clearly voiced frames (aperiodicity < 0.25, so consonant bursts, breath and a creaky vowel tail
can't pose as pitch). It flags a phrase whose median F0 is outside LO..HI (defaults 90..160 Hz, set for the
series' male voice, median about 125 Hz). Part 5's bad take read about 250 Hz on a whole phrase; the old
autocorrelation screen also flagged single words like "Yes." and "not tell." from their unvoiced tails, and
this one doesn't. Needs numpy.  Usage: pitch_screen.py [--lo 90] [--hi 160] take1.wav take2.wav ...
"""
import subprocess, sys
import numpy as np

SR, HOP, WIN = 16000, 320, 640
args = sys.argv[1:]
LO = float(args[args.index("--lo") + 1]) if "--lo" in args else 90.0
HI = float(args[args.index("--hi") + 1]) if "--hi" in args else 160.0
files = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] not in ("--lo", "--hi"))]


def load(p):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                       capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.int16).astype(np.float32) / 32768


def yin(fr, fmin=60, fmax=400, th=0.15):
    W = len(fr) // 2
    tmax, tmin = int(SR / fmin), int(SR / fmax)
    d = np.array([np.sum((fr[:W] - fr[t:t + W]) ** 2) for t in range(tmax + 1)])
    cm = np.ones_like(d)
    cs = np.cumsum(d[1:])
    cm[1:] = d[1:] * np.arange(1, len(d)) / np.maximum(cs, 1e-12)
    for t in range(tmin, tmax):
        if cm[t] < th:
            while t + 1 < tmax and cm[t + 1] < cm[t]:
                t += 1
            return SR / t, cm[t]
    t = tmin + int(np.argmin(cm[tmin:tmax]))
    return SR / t, cm[t]


flagged_total = 0
for p in files:
    x = load(p)
    span = 2 * int(SR / 60) + 10
    rms = np.array([np.sqrt(np.mean(x[i:i + WIN] ** 2)) for i in range(0, len(x) - span, HOP)])
    on = rms > 0.012
    phrases, i, n = [], 0, len(on)
    while i < n:
        if not on[i]:
            i += 1
            continue
        j, gap = i, 0
        while j < n and gap < int(0.22 * SR / HOP):
            gap = gap + 1 if not on[j] else 0
            j += 1
        phrases.append((i, j - gap))
        i = j
    print(f"== {p.split('/')[-1]}  ({len(x) / SR:.2f}s)")
    bad = 0
    for a, b in phrases:
        if (b - a) * HOP / SR < 0.3:
            continue
        f0s = []
        for k in range(a, b):
            if not on[k]:
                continue
            hz, ap = yin(x[k * HOP:k * HOP + span])
            if ap < 0.25:
                f0s.append(hz)
        if len(f0s) < 4:
            continue
        med = float(np.median(f0s))
        flag = "  <== high" if med > HI else ("  <== low" if med < LO else "")
        bad += bool(flag)
        print(f"   {a * HOP / SR:5.2f}–{b * HOP / SR:5.2f}s  median {med:6.1f} Hz  ({len(f0s)} voiced frames){flag}")
    print(f"   phrases outside {LO:.0f}–{HI:.0f} Hz: {bad}")
    flagged_total += bad
sys.exit(1 if flagged_total else 0)
