#!/usr/bin/env python3
"""tighten.py — shorten over-long pauses and cut laughs in a FINISHED talk video, keeping picture and sound in sync.

    python3 tighten.py <talk dir> [--laughs t1-t2,...] [--apply]

Input: <talk>/presentation/video/output/presentation.mp4 + presentation.timeline.json, and tighten/scribe.json
(ElevenLabs Scribe word timings of the narration, made from that mp4's audio). Needs numpy.

Rules (2026-10-08, the user's ask: "dead space that's silent for just a bit too long", "cut any time the narrator laughs"):
  - Pauses between words inside one slide longer than GAP_MIN (1.1 s) shrink to KEEP_SENT (0.75 s) after a sentence
    end / "Hmm.", or KEEP_MID (0.6 s) otherwise. Pauses spanning two slides shrink to KEEP_X (1.0 s), cut inside the
    first slide's tail only.
  - Laughs: the given ranges (found from Scribe audio events + the loudness envelope) are removed with the silence
    around them trimmed so the sentence gap left is about 0.5–0.65 s.
  - Never cut in cut scenes, in a slide's first 0.4 s (the crossfade) or its last frame. Cuts snap to whole frames
    (30 fps) so audio and video drop exactly the same time; each cut slides within its pause to where the slide (not
    the bubble) changes least.
Without --apply it only plans and prints. With --apply it keeps the originals as presentation_uncut.mp4 /
presentation_uncut.timeline.json / presentation_for_editing_uncut.mov, renders the tight presentation.mp4, rewrites
the timeline (chapters shifted), and leaves --web, --edit-master and the player to the caller.
"""
import json, math, re, shutil, subprocess, sys
from pathlib import Path
import numpy as np

FPS, SR = 30, 16000
GAP_MIN, KEEP_SENT, KEEP_MID, KEEP_X = 1.1, 0.75, 0.6, 1.0
XFADE_GUARD, EDGE_GUARD = 0.4, 0.04
DISSOLVE_S = 0.2                          # a cut that must stay (a laugh) over moving content gets this video+audio dissolve
JUMP_MAX = 3.0                            # mean |Δ| (0–255) of the slide area across a cut; above it the cut is shortened or skipped
PRE_KEEP, POST_KEEP = 0.25, 0.2          # minimum silence kept after the previous word / before the next
W, H = 192, 108                           # analysis frame size


def frames_gray(mp4, a, b):
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(mp4), "-vf",
                        f"fps={FPS},scale={W}:{H},format=gray", "-f", "rawvideo", "-"], capture_output=True)
    n = len(r.stdout) // (W * H)
    return np.frombuffer(r.stdout[: n * W * H], dtype=np.uint8).reshape(n, H, W).astype(np.int16)


def envelope_db(mp4, a, b):
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(mp4), "-vn",
                        "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True)
    x = np.frombuffer(r.stdout, dtype=np.int16).astype(float); hop = SR // 100      # 10 ms
    n = len(x) // hop
    return 20 * np.log10(np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(1)) / 32768 + 1e-9)


def main():
    talk = Path(sys.argv[1]); apply = "--apply" in sys.argv
    laughs = []
    if "--laughs" in sys.argv:
        for part in sys.argv[sys.argv.index("--laughs") + 1].split(","):
            a, b = part.split("-"); laughs.append((float(a), float(b)))
    out = talk / "presentation/video/output"
    mp4 = out / ("presentation_uncut.mp4" if (out / "presentation_uncut.mp4").exists() else "presentation.mp4")
    tlp = out / ("presentation_uncut.timeline.json" if (out / "presentation_uncut.timeline.json").exists() else "presentation.timeline.json")
    tl = json.loads(tlp.read_text()); total = tl["total_duration"]
    words = [w for w in json.loads((out / "tighten/scribe.json").read_text())["words"] if w.get("type") == "word"]
    segs = sorted([("S", s["n"], s["start"], s["start"] + s["duration"], s.get("avatar") != "none") for s in tl["slides"]]
                  + [("C", c["id"], c["start"], c["start"] + c["duration"], False) for c in tl["cutscenes"]], key=lambda x: x[2])

    def seg_at(t):
        for s in segs:
            if s[2] <= t < s[3]:
                return s
        return None

    cuts = []   # (a_frame, b_frame, why)

    def place(lo, hi, length, bubble, why):
        """Choose a frame-aligned window [x, x+length) inside [lo, hi] minimising the slide-area jump."""
        f_lo, f_hi = math.ceil(lo * FPS), math.floor(hi * FPS); n = int(round(length * FPS))
        if n < 3 or f_hi - f_lo < n:
            return None
        fr = frames_gray(mp4, (f_lo - 1) / FPS, (f_hi + 1) / FPS)          # frame k ↔ f_lo - 1 + k
        mask = np.ones((H, W), bool)
        if bubble:
            mask[int(H * 0.62):, : int(W * 0.21)] = False
        best = None
        for x in range(f_lo, f_hi - n + 1):
            i0, i1 = x - 1 - (f_lo - 1), x + n - (f_lo - 1)
            if i1 >= len(fr):
                break
            d = float(np.abs(fr[i0] - fr[i1])[mask].mean())
            if best is None or d < best[0] - 1e-9:
                best = (d, x)
        if best is None:
            return None
        return (best[1], best[1] + n, why, best[0])

    # 1) laughs (explicit ranges in master time)
    for a, b in laughs:
        s = seg_at(a); assert s and s[0] == "S", f"laugh at {a} is not inside a slide"
        fa, fb = round(a * FPS), round(b * FPS)
        fr = frames_gray(mp4, (fa - 1) / FPS, (fb + 1) / FPS)
        cuts.append((fa, fb, f"laugh in slide {s[1]}", float(np.abs(fr[0] - fr[-1]).mean())))

    def overlaps(fa, fb):
        return any(not (fb <= c[0] or fa >= c[1]) for c in cuts)

    # 2) long pauses between words
    for w0, w1 in zip(words, words[1:]):
        g = w1["start"] - w0["end"]
        if g < GAP_MIN:
            continue
        s0, s1 = seg_at(w0["end"]), seg_at(w1["start"])
        if not s0 or not s1 or s0[0] != "S" or s1[0] != "S":
            continue
        if s0 is not s1 and segs.index(s1) != segs.index(s0) + 1:   # a cut scene sits between them
            continue
        if any(not (w1["start"] <= a or w0["end"] >= b) for a, b in laughs):
            continue
        sent = bool(re.search(r"[.?!]\W*$", w0["text"])) or w1["text"].lower().startswith("hmm")
        if s0 is s1:
            keep = KEEP_SENT if sent else KEEP_MID
            lo = max(w0["end"] + PRE_KEEP, s0[2] + XFADE_GUARD); hi = min(w1["start"] - POST_KEEP, s0[3] - EDGE_GUARD)
            why = f"pause {g:.2f}s → {keep:.2f}s, slide {s0[1]} ('{w0['text']}' … '{w1['text']}')"
        else:
            keep = KEEP_X
            lo = w0["end"] + PRE_KEEP; hi = s0[3] - EDGE_GUARD
            why = f"pause {g:.2f}s → {keep:.2f}s across slides {s0[1]}→{s1[1]}"
        length = g - keep
        if length <= 0.1:
            continue
        # keep the cut inside real silence (envelope < -45 dB) where possible
        e = envelope_db(mp4, lo, hi) if hi > lo else np.array([])
        if len(e):
            quiet = np.where(e < -45)[0]
            if len(quiet):
                lo, hi = lo + quiet[0] / 100, lo + (quiet[-1] + 1) / 100
        length = min(length, hi - lo)
        c = place(lo, hi, length, s0[4], why)
        while c and c[3] > JUMP_MAX and length > 0.35:          # moving content: try a shorter cut
            length = round(length - 0.1, 3)
            c = place(lo, hi, length, s0[4], why + f" (shortened to {length:.2f}s: motion)")
        if c and c[3] > JUMP_MAX:
            print(f"   skip  {why}: the slide is moving there (jump {c[3]:.1f})"); c = None
        if c and not overlaps(c[0], c[1]):
            cuts.append(c)

    cuts.sort()
    removed = sum(c[1] - c[0] for c in cuts) / FPS + sum(DISSOLVE_S for c in cuts if c[3] > JUMP_MAX)
    print(f"{talk.name}: {len(cuts)} cuts, {removed:.1f}s removed of {total:.1f}s → {total - removed:.1f}s "
          f"({sum(1 for c in cuts if c[2].startswith('laugh'))} laughs)")
    for c in cuts:
        flag = f"  ← softened with a {DISSOLVE_S:.1f}s dissolve" if c[3] > JUMP_MAX else ""
        print(f"   {c[0] / FPS:8.3f}–{c[1] / FPS:8.3f}  −{(c[1] - c[0]) / FPS:.2f}s  jump {c[3]:4.1f}  {c[2]}{flag}")
    plan = {"source": str(mp4.name), "fps": FPS, "cuts": [[c[0], c[1], c[2], round(c[3], 2)] for c in cuts],
            "removed_s": round(removed, 3), "rules": dict(GAP_MIN=GAP_MIN, KEEP_SENT=KEEP_SENT, KEEP_MID=KEEP_MID, KEEP_X=KEEP_X)}
    (out / "tighten/plan.json").write_text(json.dumps(plan, indent=1))
    if not apply:
        return

    # --- apply ---
    if not (out / "presentation_uncut.mp4").exists():
        shutil.move(out / "presentation.mp4", out / "presentation_uncut.mp4")
        shutil.move(out / "presentation.timeline.json", out / "presentation_uncut.timeline.json")
        if (out / "presentation_for_editing.mov").exists():
            shutil.move(out / "presentation_for_editing.mov", out / "presentation_for_editing_uncut.mov")
    src = out / "presentation_uncut.mp4"
    nframes = int(round(total * FPS))
    keep, f = [], 0
    for a, b, *_ in cuts:
        if a > f:
            keep.append((f, a))
        f = max(f, b)
    if f < nframes:
        keep.append((f, nframes))
    spf = 48000 // FPS
    dis_frames = int(round(DISSOLVE_S * FPS))
    dissolve_after = {i for i in range(len(keep) - 1) for c in cuts if c[3] > JUMP_MAX and c[0] == keep[i][1]}
    parts, n = [], len(keep)
    graph = [f"[0:v]split={n}" + "".join(f"[v{i}]" for i in range(n)), f"[0:a]aresample=48000,asplit={n}" + "".join(f"[a{i}]" for i in range(n))]
    for i, (a, b) in enumerate(keep):
        dur = (b - a) / FPS
        fades = []
        if i > 0 and (i - 1) not in dissolve_after:
            fades.append("afade=t=in:st=0:d=0.008")
        if i < n - 1 and i not in dissolve_after:
            fades.append(f"afade=t=out:st={max(0.0, dur - 0.008):.6f}:d=0.008")
        graph.append(f"[v{i}]trim=start_frame={a}:end_frame={b},setpts=PTS-STARTPTS[vv{i}]")
        graph.append(f"[a{i}]atrim=start_sample={a * spf}:end_sample={b * spf},asetpts=PTS-STARTPTS"
                     + ("," + ",".join(fades) if fades else "") + f"[aa{i}]")
    cur_v, cur_a, cur_f = "vv0", "aa0", keep[0][1] - keep[0][0]
    for i in range(1, n):
        nf = keep[i][1] - keep[i][0]
        if (i - 1) in dissolve_after:          # soften this join: picture and sound cross over DISSOLVE_S
            graph.append(f"[{cur_v}][vv{i}]xfade=transition=fade:duration={dis_frames / FPS:.6f}:offset={(cur_f - dis_frames) / FPS:.6f}[vx{i}]")
            graph.append(f"[{cur_a}][aa{i}]acrossfade=d={dis_frames / FPS:.6f}[ax{i}]")
            cur_v, cur_a, cur_f = f"vx{i}", f"ax{i}", cur_f + nf - dis_frames
        else:
            parts.append(f"[{cur_v}][{cur_a}]")
            cur_v, cur_a, cur_f = f"vv{i}", f"aa{i}", nf
    parts.append(f"[{cur_v}][{cur_a}]")
    graph.append("".join(parts) + f"concat=n={len(parts)}:v=1:a=1[v][a]")
    gpath = out / "tighten/filter.txt"; gpath.write_text(";\n".join(graph))
    dst = out / "presentation.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-filter_complex_script", str(gpath), "-map", "[v]",
                    "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                    "-r", str(FPS), "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(dst)], check=True)

    eff = [(a, b + (dis_frames if c3 > JUMP_MAX else 0)) for a, b, _, c3 in cuts]   # a dissolve removes DISSOLVE_S more

    def fmap(t):
        fr = t * FPS; rem = 0.0
        for a, b in eff:
            if fr >= b:
                rem += b - a
            elif fr > a:
                rem += fr - a
        return (fr - rem) / FPS

    def remap(item):
        s0, e0 = item["start"], item["start"] + item["duration"]
        item["start"] = round(fmap(s0), 3); item["duration"] = round(fmap(e0) - fmap(s0), 3)
        if "frames" in item:
            item["frames"] = int(round(item["duration"] * FPS))

    for key in ("slides", "cutscenes", "chapters"):
        for item in tl.get(key, []):
            remap(item)
    tl["total_duration"] = round(fmap(total), 3)
    tl["tightened"] = {"date": "2026-10-08", "removed_s": round(removed, 3), "cuts": len(cuts), "plan": "tighten/plan.json"}
    (out / "presentation.timeline.json").write_text(json.dumps(tl, indent=1, ensure_ascii=False))
    got = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(dst)]).strip())
    print(f"✓ {dst.name}: {got:.2f}s (timeline {tl['total_duration']:.2f}s)")


if __name__ == "__main__":
    main()
