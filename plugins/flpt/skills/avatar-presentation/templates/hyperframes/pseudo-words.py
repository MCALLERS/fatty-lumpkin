#!/usr/bin/env python3
"""pseudo-words.py — approximate word timestamps for a slide's narration, free and offline.

    python3 pseudo-words.py <narration.wav> <text.txt | -> [--out words.json] [--noise -40] [--min-sil 0.22]

Use it when no transcriber is installed (whisper-cpp) and the TTS gave no timestamps.
It finds the voiced stretches of the audio with ffmpeg `silencedetect`, then spreads the
words across *voiced* time only, in proportion to their character length, so pauses cost no text.
It also anchors the text to the audio: a small monotonic alignment (DTW-style) matches the detected pauses
to the script's punctuation and [pause] tags, and the words are interpolated between those anchors.
Accuracy is usually within a few tenths of a second, which is plenty for beats that enter
0.2 s ahead of their word.

The output is [{text, start, end}], the shape align-beats.mjs reads:
    node align-beats.mjs <slide-dir> --words words.json --offset <slide lead>

Text: the slide's narration with [tags] and <break/> markup removed (the script strips both).
"""
import json, re, subprocess, sys


def voiced_spans(wav: str, noise_db: float, min_sil: float):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", wav, "-af",
                        f"silencedetect=noise={noise_db}dB:d={min_sil}", "-f", "null", "-"],
                       capture_output=True, text=True)
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                         "-of", "csv=p=0", wav]).strip())
    sil, start = [], None
    for line in p.stderr.splitlines():
        m = re.search(r"silence_start: ([\d.]+)", line)
        if m:
            start = float(m.group(1))
        m = re.search(r"silence_end: ([\d.]+)", line)
        if m and start is not None:
            sil.append((start, float(m.group(1))))
            start = None
    if start is not None:
        sil.append((start, dur))
    spans, t = [], 0.0
    for a, b in sil:
        if a > t:
            spans.append((t, a))
        t = max(t, b)
    if t < dur:
        spans.append((t, dur))
    return [(a, b) for a, b in spans if b - a > 0.05]


def main():
    args = [a for a in sys.argv[1:]]
    opt = {"--out": None, "--noise": "-40", "--min-sil": "0.22"}
    pos = []
    i = 0
    while i < len(args):
        if args[i] in opt:
            opt[args[i]] = args[i + 1]; i += 2
        else:
            pos.append(args[i]); i += 1
    if len(pos) != 2:
        raise SystemExit(__doc__)
    wav, src = pos
    text = sys.stdin.read() if src == "-" else open(src, encoding="utf-8").read()
    toks = re.findall(r"<[^>]+>|\[[^\]]+\]|\S+", text)
    words, brk = [], set()                              # brk: index of a word followed by a likely pause
    for t in toks:
        if t.startswith("<") or t.startswith("["):
            if words:
                brk.add(len(words) - 1)
            continue
        words.append(t)
        if re.search(r"[,.;:?!\u2014\u2026]$|\.\.\.$", t):
            brk.add(len(words) - 1)
    spans = voiced_spans(wav, float(opt["--noise"]), float(opt["--min-sil"]))
    voiced = sum(b - a for a, b in spans)
    weights = [len(re.sub(r"\W", "", w)) + 1 for w in words]   # +1: the gap after each word
    total = float(sum(weights))
    cum = [0.0]
    for k in weights:
        cum.append(cum[-1] + k / total)                 # cum[i] = text fraction at the start of word i

    # Anchors: match inner pauses (voiced fraction where each gap sits) to punctuation boundaries.
    gaps, acc_v = [], 0.0
    for a, b in spans[:-1]:
        acc_v += b - a
        gaps.append(acc_v / voiced)
    bnds = sorted(i for i in brk if i < len(words) - 1)
    bpos = [cum[i + 1] for i in bnds]                   # text fraction just after word i
    SKIP_B, SKIP_G = 0.012, 0.03                       # unpaused comma is cheap; unexplained pause costs more
    n, m = len(bpos), len(gaps)
    INF = float("inf")
    D = [[INF] * (m + 1) for _ in range(n + 1)]
    P = [[None] * (m + 1) for _ in range(n + 1)]
    D[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            if i == j == 0:
                continue
            best, arg = INF, None
            if i and D[i - 1][j] + SKIP_B < best:
                best, arg = D[i - 1][j] + SKIP_B, (i - 1, j, False)
            if j and D[i][j - 1] + SKIP_G < best:
                best, arg = D[i][j - 1] + SKIP_G, (i, j - 1, False)
            if i and j and D[i - 1][j - 1] + abs(bpos[i - 1] - gaps[j - 1]) < best:
                best, arg = D[i - 1][j - 1] + abs(bpos[i - 1] - gaps[j - 1]), (i - 1, j - 1, True)
            D[i][j], P[i][j] = best, arg
    anchors, i, j = [], n, m
    while (i, j) != (0, 0):
        pi, pj, matched = P[i][j]
        if matched:
            anchors.append((bpos[i - 1], gaps[j - 1]))
        i, j = pi, pj
    anchors = [(0.0, 0.0)] + sorted(anchors) + [(1.0, 1.0)]

    def to_voiced(c):                                   # text fraction -> voiced fraction (piecewise linear)
        for (c0, v0), (c1, v1) in zip(anchors, anchors[1:]):
            if c <= c1:
                return v0 if c1 == c0 else v0 + (c - c0) / (c1 - c0) * (v1 - v0)
        return 1.0

    def at(frac, start=False):                      # voiced fraction -> clock time
        need = frac * voiced                        # a start on a span boundary belongs to the next span
        for a, b in spans:
            if need < b - a - 1e-9 or (not start and need <= b - a + 1e-9):
                return a + need
            need -= b - a
        return spans[-1][1]

    out = []
    for w_i, w in enumerate(words):
        s_ = at(to_voiced(cum[w_i]), start=True)
        e_ = at(to_voiced(cum[w_i + 1] - 1 / total))
        out.append({"text": w, "start": round(s_, 3), "end": round(max(e_, s_ + 0.05), 3)})
    matched_n = len(anchors) - 2
    js = json.dumps(out, indent=0)
    if opt["--out"]:
        open(opt["--out"], "w").write(js)
        print(f"{len(out)} words over {voiced:.1f}s voiced; {matched_n} of {len(gaps)} pauses anchored "
              f"to punctuation -> {opt['--out']}")
    else:
        print(js)


if __name__ == "__main__":
    main()
