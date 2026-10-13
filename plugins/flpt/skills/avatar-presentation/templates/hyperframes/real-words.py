#!/usr/bin/env python3
"""real-words.py: word timings for one slide's narration, aligned to the real voice (free, offline).

    python3 real-words.py <narration.wav> <narration.txt> <out words.json> [noise_db=-32] [min_sil=0.12]

The default aligner for expressive voices (elevenlabs_v3), where pseudo-words.py drifted 1.5-3.6 s because long
pauses and voiced laughs fooled it. retime.py calls it (`--aligner real`, the default).

How it works: ffmpeg silencedetect splits the WAV into voiced spans; a dynamic program assigns each span a
run of consecutive words (clause level), scoring each assignment by how far its speaking rate is from the
slide's average rate (spoken length: years count as ~16 letters, initialisms as ~3 per letter) and by whether
the pauses fall on punctuation and [pause] tags. Word times are then interpolated inside each span.
Pause-bounded cue words are exact to about 0.05 s; mid-span words are interpolated (within ~0.25 s).

It prints the span -> clause map: read it. Every voiced span must take at least one word, so a voiced
[laughs] or breath that forms its own span can steal a neighbouring word. If a line looks shifted, re-run
with a lower noise_db (e.g. -36) or a longer min_sil (e.g. 0.18) to merge it, and re-check.
A slow filler ("So, um.") can also pull the next clause into its span (seen 0.9 s early): fix those cue words
by hand against the loudness envelope.
Output is the [{text,start,end}] shape that align-beats.mjs reads.
(Promoted from The Shadow of the Future, Talk 1, slides 6-10, 2026-10-06.)
"""
import json, math, re, subprocess, sys

def voiced_spans(wav, noise_db=-40, min_sil=0.22):
    p = subprocess.run(["ffmpeg","-hide_banner","-nostats","-i",wav,"-af",f"silencedetect=noise={noise_db}dB:d={min_sil}","-f","null","-"],capture_output=True,text=True)
    dur = float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",wav]).strip())
    sil, st = [], None
    for line in p.stderr.splitlines():
        m = re.search(r"silence_start: ([\d.]+)", line)
        if m: st = float(m.group(1))
        m = re.search(r"silence_end: ([\d.]+)", line)
        if m and st is not None: sil.append((st, float(m.group(1)))); st = None
    if st is not None: sil.append((st, dur))
    spans, t = [], 0.0
    for a, b in sil:
        if a > t: spans.append((t, a))
        t = max(t, b)
    if t < dur: spans.append((t, dur))
    return [(a, b) for a, b in spans if b - a > 0.05]

def main():
    wav, txt, out_path = sys.argv[1:4]
    noise = float(sys.argv[4]) if len(sys.argv) > 4 else -32
    msil = float(sys.argv[5]) if len(sys.argv) > 5 else 0.12
    text = open(txt, encoding="utf-8").read()
    toks = re.findall(r"<[^>]+>|\[[^\]]+\]|\S+", text)
    words, strength = [], []
    for t in toks:
        if t.startswith("[") or t.startswith("<"):
            if words: strength[-1] = max(strength[-1], 3 if "pause" in t else 1)
            continue
        words.append(t)
        s = 0
        if re.search(r"[.?!]$", t): s = 3
        elif re.search(r"[,;:—]$", t): s = 2
        strength.append(s)
    N = len(words)
    def spoken_len(w):
        core = re.sub(r"[^\w$%]", "", w)
        if re.fullmatch(r"(1[0-9]|20)\d\d", core): return 16          # a year, said as "twenty twenty-six"
        if re.fullmatch(r"\d+(st|nd|rd|th)", core): return 7           # 12th -> "twelfth"
        if re.fullmatch(r"[\d.,$%]+", core): return 5 * len(re.sub(r"\D", "", core)) + 4
        if re.fullmatch(r"[A-Z]{2,4}", core): return 3 * len(core)      # spelled-out initialisms: AGI, CPO, METR-ish
        return len(re.sub(r"\W", "", w))
    chars = [spoken_len(w) + 1.2 for w in words]
    cum = [0.0]
    for c in chars: cum.append(cum[-1] + c)
    spans = voiced_spans(wav, noise, msil)
    M = len(spans)
    voiced = sum(b - a for a, b in spans)
    R = cum[-1] / voiced
    INF = float("inf")
    # boundary penalties
    def gap_cost(j):   # a gap right after word j-1 (boundary index j, 1..N-1)
        s = strength[j-1]
        return {3: 0.0, 2: 0.15, 1: 0.6, 0: 2.5}[s]
    def nogap_cost(j):  # punctuation boundary with no pause
        s = strength[j-1]
        return {3: 0.8, 2: 0.12, 1: 0.05, 0: 0.0}[s]
    nog = [0.0]*(N+1)
    for j in range(1, N): nog[j] = nogap_cost(j)
    cnog = [0.0]
    for j in range(1, N+1): cnog.append(cnog[-1] + (nog[j] if j < N else 0))
    def seg_cost(k, i, j):
        d = spans[k][1] - spans[k][0]
        exp = (cum[j] - cum[i]) / R
        r = math.log(d / exp)
        # interior unpaused boundaries i+1..j-1
        inner = cnog[j-1] - cnog[i] if j-1 > i else 0.0
        return 4.0 * r * r + inner
    D = [[INF]*(N+1) for _ in range(M+1)]
    P = [[None]*(N+1) for _ in range(M+1)]
    D[0][0] = 0.0
    for k in range(M):
        for i in range(N):
            if D[k][i] == INF: continue
            for j in range(i+1, N+1):
                if k == M-1 and j != N: continue
                c = D[k][i] + seg_cost(k, i, j) + (gap_cost(j) if j < N else 0.0)
                if c < D[k+1][j]: D[k+1][j] = c; P[k+1][j] = i
    # backtrack
    seg = []
    j = N
    for k in range(M, 0, -1):
        i = P[k][j]; seg.append((k-1, i, j)); j = i
    seg.reverse()
    out = [None]*N
    for k, i, j in seg:
        a, b = spans[k]
        tot = cum[j] - cum[i]
        for w in range(i, j):
            s = a + (cum[w] - cum[i]) / tot * (b - a)
            e = a + (cum[w+1] - cum[i]) / tot * (b - a)
            out[w] = (round(s, 3), round(e, 3))
    res = [{"text": words[w], "start": out[w][0], "end": out[w][1]} for w in range(N)]
    json.dump(res, open(out_path, "w"), indent=0)
    for k, i0, j0 in seg:
        print(f"[{spans[k][0]:6.2f}-{spans[k][1]:6.2f}] " + " ".join(words[w] for w in range(i0, j0)))
main()
