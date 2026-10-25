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

# FLPT_CUE_SNAP_V1 (engine/tools/patches/43_cue_snap.py): each beat's cue word, snapped to faster-whisper's start for it
# when the two agree within FLPT_SNAP_S. Only with FLPT's own whisper (FLPT_WHISPER_PYTHON, FLPT_WHISPER_MODEL); offline.
import os  # noqa: E402
FLPT_SNAP_S = 0.3
FLPT_WHISPER = """
import json, os, sys, wave
os.environ["HF_HUB_OFFLINE"] = "1"
import numpy as np
from faster_whisper import WhisperModel
with wave.open(sys.argv[1], "rb") as f:
    pcm = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
m = WhisperModel(sys.argv[2], device="cpu", compute_type="int8")
segs, info = m.transcribe(pcm, language="en", word_timestamps=True, beam_size=5, condition_on_previous_text=False)
json.dump([{"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for s in segs for w in s.words], sys.stdout)
"""


def flpt_norm(t):
    return re.findall(r"[^\W_]+", str(t).lower().replace("’", "").replace("'", ""))


def flpt_cues(txt):
    """The cues of the beats.json beside the narration text, in order."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(txt)), "beats.json"), encoding="utf-8") as f:
            beats = json.load(f).get("beats") or []
    except (OSError, ValueError, AttributeError):
        return []
    return [b["cue"] for b in beats if isinstance(b, dict) and isinstance(b.get("cue"), str) and b["cue"].strip()]


def flpt_heard(wav):
    """The words faster-whisper hears in the narration ([{text, start, end}]), or (None, why not)."""
    import tempfile
    py, model = os.environ.get("FLPT_WHISPER_PYTHON", ""), os.environ.get("FLPT_WHISPER_MODEL", "")
    if not (os.path.isabs(py) and os.path.isfile(py) and os.path.isabs(model) and os.path.exists(model)):
        return None, "no whisper in FLPT's toolchain"
    env = {k: v for k, v in os.environ.items() if not re.search(r"KEY|TOKEN|SECRET|CREDENTIAL", k)}
    env.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"})
    with tempfile.TemporaryDirectory(prefix="flpt-snap-") as td:
        w16 = os.path.join(td, "16k.wav")
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", w16], capture_output=True)
        if r.returncode != 0:
            return None, "ffmpeg couldn't read the narration"
        try:
            r = subprocess.run([py, "-I", "-c", FLPT_WHISPER, w16, model], capture_output=True, text=True, timeout=900, env=env)
        except (OSError, subprocess.TimeoutExpired) as e:
            return None, f"whisper didn't run ({e.__class__.__name__})"
    if r.returncode != 0:
        last = (r.stderr or "").strip().splitlines()
        return None, f"whisper stopped ({last[-1][:120] if last else r.returncode})"
    try:
        heard = json.loads(r.stdout)
    except ValueError:
        return None, "whisper's answer wasn't readable"
    return [w for w in heard if isinstance(w, dict) and isinstance(w.get("text"), str)
            and isinstance(w.get("start"), (int, float))], None


def flpt_cue_snap(res, wav, txt):
    """real-words.py's words with each cue word at whisper's start, where they agree within FLPT_SNAP_S."""
    cues = flpt_cues(txt)
    if not cues or not res:
        return res
    heard, why = flpt_heard(wav)
    if heard is None:
        print(f"cue snap: skipped ({why})")
        return res
    st, so, ht, ho = [], [], [], []  # tokens, and for each (its word, whether it starts that word)
    for i, w in enumerate(res):
        for k, t in enumerate(flpt_norm(w["text"])):
            st.append(t)
            so.append((i, k == 0))
    for j, w in enumerate(heard):
        for k, t in enumerate(flpt_norm(w["text"])):
            ht.append(t)
            ho.append((j, k == 0))
    n, m = len(st), len(ht)
    D = [[0] * (m + 1) for _ in range(n + 1)]  # longest common subsequence: the script's tokens against what was heard
    for a in range(n - 1, -1, -1):
        Da, Dn = D[a], D[a + 1]
        for b in range(m - 1, -1, -1):
            Da[b] = Dn[b + 1] + 1 if st[a] == ht[b] else max(Dn[b], Da[b + 1])
    match, a, b = [-1] * n, 0, 0
    while a < n and b < m:
        if st[a] == ht[b]:
            match[a] = b
            a += 1
            b += 1
        elif D[a + 1][b] >= D[a][b + 1]:
            a += 1
        else:
            b += 1
    first = {}  # each word's first token
    for x, (i, starts) in enumerate(so):
        if starts:
            first.setdefault(i, x)

    def find(want, from_word):  # as align-beats.mjs finds a cue: its tokens in a row, from a word on
        start = next((x for x, (i, _s) in enumerate(so) if i >= from_word), n)
        return next((so[x][0] for x in range(start, n - len(want) + 1) if st[x:x + len(want)] == want), None)

    moved, far, unmatched, biggest, ptr = 0, 0, 0, 0.0, 0
    for cue in cues:
        want = flpt_norm(cue)
        i = find(want, ptr) if want else None
        if i is None and want:
            i = find(want, 0)  # out of order: align-beats.mjs looks again from the start
        if i is None:
            unmatched += 1
            continue
        ptr = i + 1
        hb = match[first[i]]
        # not heard, heard mid-word, or whisper's first word (it pins that one to the start of the audio): left as aligned
        if hb < 0 or not ho[hb][1] or ho[hb][0] == 0:
            unmatched += 1
            continue
        hs = float(heard[ho[hb][0]]["start"])
        if abs(hs - res[i]["start"]) > FLPT_SNAP_S:
            far += 1
            continue
        lo = res[i - 1]["start"] + 0.01 if i > 0 else 0.0
        hi = res[i + 1]["start"] - 0.01 if i + 1 < len(res) else max(res[i]["end"], hs + 0.05)
        if hi < lo:  # no room between its neighbours: as aligned
            continue
        new = round(min(max(hs, lo), hi), 3)
        if abs(new - res[i]["start"]) >= 0.0005:
            moved += 1
            biggest = max(biggest, abs(new - res[i]["start"]))
        res[i]["start"] = new
        if res[i]["end"] < new + 0.02:
            res[i]["end"] = round(min(new + 0.05, res[i + 1]["start"]) if i + 1 < len(res) else new + 0.05, 3)
        if i > 0 and res[i - 1]["end"] > new:
            res[i - 1]["end"] = new
    print(f"cue snap: {moved} of {len(cues)} cue words moved to the voice as heard (largest {round(biggest * 1000)} ms); "
          f"{far} heard over {round(FLPT_SNAP_S * 1000)} ms away, kept; {unmatched} not matched")
    return res


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
    res = flpt_cue_snap(res, wav, txt)  # FLPT_CUE_SNAP_V1
    json.dump(res, open(out_path, "w"), indent=0)
    for k, i0, j0 in seg:
        print(f"[{spans[k][0]:6.2f}-{spans[k][1]:6.2f}] " + " ".join(words[w] for w in range(i0, j0)))
main()
