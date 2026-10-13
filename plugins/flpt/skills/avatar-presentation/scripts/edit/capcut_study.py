#!/usr/bin/env python3
"""Study what the editor did to our master in CapCut (added 2026-10-12).

It reads a CapCut project's draft_info.json, which is plain JSON in CapCut for Mac v175. It never writes
inside the draft folder.

It writes three files:
  edit-list.md    every track and segment (source, in/out, speed, volume, transform, transitions, captions)
  run-sheet.md    the main track condensed into blocks, plus overlays, captions, stingers and beds
  study.json      the numbers below, plus every row

and prints a summary:
- how much of the final is our master versus the editor's own layer
- what comes before, inside and after the master
- trims and repeats inside the master
- hand gain changes over +3 dB
- the transitions and animations used

Use it in the retro step, after the user has finished their edit. It's the fastest way to learn what to build
next time.

Where the projects live (macOS): ~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<project name>/

Examples:
  python3 capcut_study.py "~/Movies/CapCut/User Data/Projects/com.lveditor.draft/Ep. 4 - Fog of War" --out study/ep4
  python3 capcut_study.py draft_info.json --label "Ep 2" --master "presentation_for_editing"
  python3 capcut_study.py <draft> --kinds my_kinds.json     # extra [["regex", "kind"], ...] pairs, checked first

Standard library only. Newer CapCut builds may encrypt the draft. If so, this says so and stops.
"""
import argparse
import collections
import json
import math
import os
import re
import sys

US = 1_000_000.0

# First match wins. Paths are matched as written in the draft.
DEFAULT_KINDS = [
    (r"presentation_for_editing|/output/presentation(_uncut)?\.mp4$", "MASTER"),
    (r"Screen Recording", "screen recording"),
    (r"(?i)cutaway", "reaction cutaway"),
    (r"(?i)bookend|full-set|before Part|after Part", "bookend"),
    (r"(?i)reel-runout|runout|transition", "transition"),
    (r"(?i)b-?roll", "B-roll"),
    (r"(?i)(title|flyer|flier|spacer|cover)[^/]*\.(png|jpe?g)$", "card"),
    (r"(?i)\.(png|jpe?g|gif|webp|heic)$", "still"),
    (r"(?i)openart-|/cgt-\d", "generated clip"),
    (r"ElevenLabs_|-20\d\d-\d\d-\d\d-\d\d-\d\d-", "voice stinger"),
    (r"/CapCut/.*/(music|sound)/|/Cache/(music|effect)/", "CapCut library audio"),
    (r"(?i)\.(mp3|wav|m4a|aiff?)$", "music / audio"),
]


def ts(us):
    if us is None:
        return "-"
    s = us / US
    return f"{int(s // 60)}:{s % 60:05.2f}"


def load(path):
    p = os.path.expanduser(path)
    f = os.path.join(p, "draft_info.json") if os.path.isdir(p) else p
    if not os.path.isfile(f):
        raise SystemExit(f"no draft_info.json at {p}")
    raw = open(f, "rb").read()
    try:
        return json.loads(raw.decode("utf-8")), os.path.dirname(os.path.abspath(f))
    except Exception:
        raise SystemExit("draft_info.json isn't plain JSON (this CapCut build encrypts drafts). "
                         "Study the export instead: scene detection plus loudness.")


def text_of(m):
    c = m.get("content") or ""
    try:
        return json.loads(c).get("text", c)
    except Exception:
        return re.sub(r"<[^>]+>", "", c)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("draft", help="CapCut project folder, or its draft_info.json")
    ap.add_argument("--out", help="output folder (default: ./capcut-study-<project>)")
    ap.add_argument("--label", help="title for the reports (default: project folder name)")
    ap.add_argument("--master", help="regex that identifies our master in source paths")
    ap.add_argument("--kinds", help="JSON file of extra [regex, kind] pairs, checked before the defaults")
    a = ap.parse_args()

    d, draft_dir = load(a.draft)
    label = a.label or os.path.basename(draft_dir)
    out = os.path.abspath(a.out or f"capcut-study-{re.sub(r'[^A-Za-z0-9._-]+', '-', label)}")
    if out == draft_dir or out.startswith(draft_dir + os.sep):
        raise SystemExit("refusing to write inside the CapCut project folder; pick another --out")
    kinds = list(DEFAULT_KINDS)
    if a.master:
        kinds.insert(0, (a.master, "MASTER"))
    if a.kinds:
        kinds = [tuple(x) for x in json.load(open(os.path.expanduser(a.kinds)))] + kinds
    kinds = [(re.compile(rx), k) for rx, k in kinds]

    def random_id(path):
        """Downloads named by a 22-character random job id (e.g. Higgsfield), not a human name."""
        stem = os.path.splitext(os.path.basename(path))[0]
        return (len(stem) == 22 and re.fullmatch(r"[A-Za-z0-9_-]{22}", stem) is not None
                and re.search(r"[A-Z]", stem) and re.search(r"[a-z]", stem) and re.search(r"\d", stem)
                and not re.search(r"(?i)_v\d|\d{3,4}p|final|edit|intro|outro", stem))

    def kind_of(path, track_type):
        for rx, k in kinds:
            if path and rx.search(path):
                return k
        if path and track_type == "video" and random_id(path):
            return "generated clip"
        return "insert" if track_type == "video" else "audio"

    m = d.get("materials") or {}
    by_id = {}
    for kind, items in m.items():
        if isinstance(items, list):
            for it in items:
                if isinstance(it, dict) and "id" in it:
                    by_id[it["id"]] = (kind, it)

    rows = []
    for ti, tr in enumerate(d.get("tracks") or []):
        for si, sg in enumerate(tr.get("segments") or []):
            mk, mat = by_id.get(sg.get("material_id"), ("?", {}))
            tt, st = sg.get("target_timerange") or {}, sg.get("source_timerange") or {}
            refs = []
            for rid in sg.get("extra_material_refs") or []:
                rk, r = by_id.get(rid, ("?", {}))
                if rk == "transitions":
                    refs.append(f"transition:{r.get('name')}@{(r.get('duration') or 0)/US:.2f}s")
                elif rk == "audio_fades" and (r.get("fade_in_duration") or r.get("fade_out_duration")):
                    refs.append(f"fade {r.get('fade_in_duration',0)/US:.2f}/{r.get('fade_out_duration',0)/US:.2f}s")
                elif rk == "material_animations":
                    for an in r.get("animations") or []:
                        refs.append(f"anim-{an.get('type')}:{an.get('name')}")
                elif rk in ("video_effects", "effects"):
                    refs.append(f"effect:{r.get('name')}")
                elif rk == "audio_effects":
                    refs.append(f"voice-fx:{r.get('name')}")
                elif rk == "common_mask":
                    refs.append(f"mask:{r.get('name') or ''}")
            clip = sg.get("clip") or {}
            path = mat.get("path") or ""
            row = dict(track=ti, track_type=tr.get("type"), mkind=mk, path=path,
                       name=mat.get("material_name") or mat.get("name") or os.path.basename(path),
                       start=tt.get("start") or 0, dur=tt.get("duration") or 0,
                       src_start=st.get("start"), src_dur=st.get("duration"), mat_dur=mat.get("duration"),
                       speed=sg.get("speed", 1.0), volume=sg.get("volume"), visible=sg.get("visible", True),
                       scale=(clip.get("scale") or {}).get("x"), alpha=clip.get("alpha"),
                       pos=((clip.get("transform") or {}).get("x"), (clip.get("transform") or {}).get("y")),
                       refs=refs, text=text_of(mat) if mk == "texts" else "")
            row["kind"] = ("caption" if mk == "texts" else
                           f"CapCut {mk.rstrip('s')}" if mk in ("effects", "video_effects", "stickers", "filters") else
                           kind_of(path, tr.get("type")))
            rows.append(row)

    total = (d.get("duration") or max((r["start"] + r["dur"] for r in rows), default=0)) / US
    main_rows = sorted([r for r in rows if r["track"] == 0], key=lambda r: r["start"])
    master = [r for r in main_rows if r["kind"] == "MASTER"]
    stats = dict(label=label, timeline_s=round(total, 2), fps=d.get("fps"),
                 canvas=(d.get("canvas_config") or {}).get("width"), tracks=len(d.get("tracks") or []))
    if master:
        mlen = max((r["mat_dur"] or 0) for r in master) / US
        used = sum(r["dur"] for r in master) / US
        first = min(r["start"] for r in master) / US
        last = max(r["start"] + r["dur"] for r in master) / US
        spans = sorted(((r["src_start"] or 0) / US, ((r["src_start"] or 0) + (r["src_dur"] or 0)) / US) for r in master)
        trims, repeats, pos = [], 0, 0.0
        for s0, s1 in spans:
            if s0 > pos + 0.05:
                trims.append((round(pos, 2), round(s0, 2)))
            if s0 < pos - 0.05:
                repeats += 1
            pos = max(pos, s1)
        if mlen - pos > 0.05:
            trims.append((round(pos, 2), round(mlen, 2)))
        inside = [r for r in main_rows if r["kind"] != "MASTER" and first <= r["start"] / US < last]
        stats.update(master_s=round(mlen, 2), master_used_s=round(used, 2), master_segments=len(master),
                     editor_layer_s=round(total - used, 2), editor_layer_share=round((total - used) / total, 3),
                     before_master_s=round(first, 2), after_master_s=round(total - last, 2),
                     inside_master_s=round(sum(r["dur"] for r in inside) / US, 2), inside_inserts=len(inside),
                     trims=[{"from": a_, "to": b_, "s": round(b_ - a_, 2)} for a_, b_ in trims],
                     trimmed_s=round(sum(b_ - a_ for a_, b_ in trims), 2), repeated_segments=repeats)
    boosts = []
    for r in rows:
        v = r["volume"]
        if v and v > 1.41 and r["track_type"] in ("video", "audio"):
            boosts.append(dict(at=ts(r["start"]), kind=r["kind"], name=r["name"][:60], gain_db=round(20 * math.log10(v), 1)))
    stats["boosts_over_3db"] = sorted(boosts, key=lambda b: -b["gain_db"])
    stats["captions"] = [dict(at=ts(r["start"]), text=r["text"].replace("\n", " / ")[:120]) for r in rows if r["kind"] == "caption"]
    count = collections.Counter
    stats["transitions"] = count(x.split("@")[0].split(":", 1)[1] for r in rows for x in r["refs"] if x.startswith("transition:"))
    stats["animations"] = count(x.split(":", 1)[1] for r in rows for x in r["refs"] if x.startswith("anim-"))
    stats["voice_fx"] = count(x.split(":", 1)[1] for r in rows for x in r["refs"] if x.startswith("voice-fx:"))
    stats["kinds_on_main_track_s"] = {k: round(sum(r["dur"] for r in main_rows if r["kind"] == k) / US, 1)
                                      for k in sorted({r["kind"] for r in main_rows})}

    os.makedirs(out, exist_ok=True)
    json.dump(dict(stats=stats, rows=rows), open(os.path.join(out, "study.json"), "w"), indent=1, default=list)

    # edit-list.md
    L = [f"# CapCut edit list · {label}", "", f"{ts(total*US)} · {stats['fps']} fps · {stats['tracks']} tracks", ""]
    for ti, tr in enumerate(d.get("tracks") or []):
        seg = [r for r in rows if r["track"] == ti]
        L += [f"## Track {ti} · {tr.get('type')} · {len(seg)} segments", "",
              "| in | len | kind | source | src in | speed | vol | xform | notes |", "|---|---|---|---|---|---|---|---|---|"]
        for r in seg:
            xf = []
            if r["scale"] not in (None, 1.0): xf.append(f"scale {r['scale']:.2f}")
            if r["alpha"] not in (None, 1.0): xf.append(f"alpha {r['alpha']:.2f}")
            if r["pos"] and any(v not in (None, 0, 0.0) for v in r["pos"]): xf.append(f"@({r['pos'][0]:.2f},{r['pos'][1]:.2f})")
            if not r["visible"]: xf.append("hidden")
            note = "; ".join(r["refs"]) + (f" “{r['text'][:100]}”" if r["text"] else "")
            vol = "" if r["volume"] is None else f"{r['volume']:.2f}"
            L.append(f"| {ts(r['start'])} | {r['dur']/US:.2f} | {r['kind']} | {r['name'][:56]} | {ts(r['src_start'])} | {r['speed']:g} | {vol} | {' '.join(xf)} | {note.replace('|','/')} |")
        L.append("")
    open(os.path.join(out, "edit-list.md"), "w").write("\n".join(L))

    # run-sheet.md
    blocks = []
    for r in main_rows:
        if blocks and blocks[-1]["name"] == r["name"]:
            b = blocks[-1]; b["end"] = r["start"] + r["dur"]; b["n"] += 1; b["refs"] |= set(r["refs"])
        else:
            blocks.append(dict(name=r["name"], kind=r["kind"], start=r["start"], end=r["start"] + r["dur"], n=1, refs=set(r["refs"])))
    R = [f"# Run-sheet · {label}", ""]
    if master:
        R += [f"- **Timeline** {ts(total*US)}. **Master** {stats['master_s']/60:.1f} min, of which {stats['master_used_s']/60:.1f} min used "
              f"in {stats['master_segments']} pieces ({stats['trimmed_s']:.1f} s trimmed, {stats['repeated_segments']} repeats).",
              f"- **The editor's layer: {100*stats['editor_layer_share']:.0f} %** of the final: "
              f"{stats['before_master_s']/60:.1f} min before the master, {stats['inside_master_s']/60:.1f} min inside it "
              f"({stats['inside_inserts']} inserts), {stats['after_master_s']/60:.1f} min after.", ""]
    R += ["## Main track", "", "| in | out | len | kind | source | pieces | how it's cut in |", "|---|---|---|---|---|---|---|"]
    for b in blocks:
        how = "; ".join(sorted(x for x in b["refs"] if x.startswith(("transition", "anim", "voice-fx", "fade"))))
        R.append(f"| {ts(b['start'])} | {ts(b['end'])} | {(b['end']-b['start'])/US:.1f} s | {b['kind']} | {b['name'][:56]} | {b['n']} | {how} |")
    R += ["", "## Layered on top", "", "| at | len | kind | what | treatment |", "|---|---|---|---|---|"]
    last = None
    for r in sorted([r for r in rows if r["track"] != 0], key=lambda r: r["start"]):
        if r["kind"] in ("CapCut library audio",) or r["kind"].startswith("CapCut effect") or r["kind"].startswith("CapCut video_effect"):
            continue
        if r["kind"] == "music / audio" and last == (r["path"], r["track"]):
            continue
        last = (r["path"], r["track"])
        what = f"“{r['text'][:70]}”" if r["kind"] == "caption" else r["name"][:56]
        tr = []
        if r["track_type"] == "video" and r["scale"] not in (None, 1.0): tr.append(f"scale {r['scale']:.2f}")
        if r["volume"] not in (None, 1.0): tr.append(f"vol {r['volume']:.2f}")
        tr += r["refs"]
        R.append(f"| {ts(r['start'])} | {r['dur']/US:.1f} s | {('PIP ' if r['track_type']=='video' else '') + r['kind']} | {what.replace('|','/')} | {'; '.join(tr).replace('|','/')} |")
    open(os.path.join(out, "run-sheet.md"), "w").write("\n".join(R) + "\n")

    # summary
    print(f"{label}: {ts(total*US)} on {stats['tracks']} tracks → {out}")
    if master:
        print(f"  master {stats['master_s']/60:.1f} min, used {stats['master_used_s']/60:.1f} min; editor's layer "
              f"{100*stats['editor_layer_share']:.0f} % (before {stats['before_master_s']/60:.1f} · inside "
              f"{stats['inside_master_s']/60:.1f} · after {stats['after_master_s']/60:.1f} min)")
        print(f"  trims {len(stats['trims'])} ({stats['trimmed_s']:.1f} s), repeats {stats['repeated_segments']}, "
              f"boosts over +3 dB {len(boosts)}, captions {len(stats['captions'])}")
    else:
        print("  no master found: pass --master <regex> matching our presentation file's path")
    print(f"  main track by kind (s): {stats['kinds_on_main_track_s']}")


if __name__ == "__main__":
    main()
