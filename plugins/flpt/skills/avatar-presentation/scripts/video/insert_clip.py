#!/usr/bin/env python3
"""insert_clip.py — drop a clip into the MIDDLE of a slide in a finished (usually tightened) talk video.

    python3 insert_clip.py <talk dir> --clip <file> --at <seconds> [--trim-start s] [--title "…"] [--lufs -16] [--apply]

The pipeline only puts cut scenes between slides. This inserts one inside a slide, at master time --at (snapped to
a frame), with hard cuts both ways: picture and sound before --at, then the whole clip with its own sound, then the
rest of the master. Use it for a gag that has to land on a line, e.g. right after a quip and before the next sentence
(put --at inside the pause, a few tenths after the last word).

--trim-start skips the clip's first seconds (e.g. a flash frame left from the previous shot in a downloaded clip).
The clip is conformed to the master (1920×1080, 30 fps, yuv420p, 48 kHz stereo). Its sound is levelled to --lufs
(two-pass loudnorm, TP −1.5) with 10 ms fades at both ends so the joins don't click.

Run it after tighten.py --apply and before --edit-master / --web / build_player.py, which all read
output/presentation.mp4 + presentation.timeline.json. Without --apply it only plans. With --apply it keeps the
originals as presentation_noinsert.mp4 / presentation_noinsert.timeline.json (re-running starts from those), writes
the new presentation.mp4, and rewrites the timeline: the slide that contains --at grows by the clip's length, every
later item shifts, and the insert is recorded under "inserts" (it is not a chapter, so the player keeps showing the
slide's chapter and transcript across it). If tighten.py is ever re-run, re-apply the insert afterwards.
"""
import json, shutil, subprocess, sys
from pathlib import Path

FPS, SR = 30, 48000


def probe_duration(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                          "csv=p=0", str(p)]).strip())


def loudnorm_filter(clip, lufs, skip=0.0):
    """Measured (two-pass) loudnorm for the clip's sound."""
    r = subprocess.run(["ffmpeg", "-v", "info", "-ss", f"{skip:.6f}", "-i", str(clip), "-vn", "-af",
                        f"loudnorm=I={lufs}:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    txt = r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1]
    m = json.loads(txt)
    return (f"loudnorm=I={lufs}:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
            f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")


def main():
    a = sys.argv[1:]
    if not a or "--clip" not in a or "--at" not in a:
        sys.exit(__doc__)
    talk = Path(a[0])
    clip = Path(a[a.index("--clip") + 1]).resolve()
    at = float(a[a.index("--at") + 1])
    title = a[a.index("--title") + 1] if "--title" in a else clip.stem
    lufs = float(a[a.index("--lufs") + 1]) if "--lufs" in a else -16.0
    skip = float(a[a.index("--trim-start") + 1]) if "--trim-start" in a else 0.0
    out = talk / "presentation/video/output"

    src, src_tl = out / "presentation_noinsert.mp4", out / "presentation_noinsert.timeline.json"
    if not src.exists():
        src, src_tl = out / "presentation.mp4", out / "presentation.timeline.json"
    tl = json.loads(src_tl.read_text())
    total = probe_duration(src)

    T = round(at * FPS) / FPS                                   # snap to a frame
    host = next((s for s in tl["slides"] if s["start"] <= T < s["start"] + s["duration"]), None)
    if host is None:
        sys.exit(f"--at {T:.3f}s is not inside a slide (cut scenes and gaps are not allowed)")
    D = round((probe_duration(clip) - skip) * FPS) / FPS        # the clip's length in whole frames, after --trim-start
    print(f"insert '{title}' ({clip.name}, {D:.3f}s) at {T:.3f}s, inside slide {host['n']} "
          f"({host['start']:.3f}–{host['start'] + host['duration']:.3f}s); master {total:.2f}s → {total + D:.2f}s")
    if "--apply" not in a:
        print("(plan only; add --apply)")
        return

    if src.name == "presentation.mp4":                          # first application: keep the originals
        shutil.copy2(out / "presentation.mp4", out / "presentation_noinsert.mp4")
        shutil.copy2(out / "presentation.timeline.json", out / "presentation_noinsert.timeline.json")
        src, src_tl = out / "presentation_noinsert.mp4", out / "presentation_noinsert.timeline.json"

    ln = loudnorm_filter(clip, lufs, skip)
    f = 0.010
    graph = ";".join([
        f"[0:v]trim=end={T:.6f},setpts=PTS-STARTPTS[v0]",
        f"[0:a]atrim=end={T:.6f},asetpts=PTS-STARTPTS,afade=t=out:st={T - f:.6f}:d={f}[a0]",
        f"[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,"
        f"trim=start={skip:.6f},setpts=PTS-STARTPTS,fps={FPS},trim=end={D:.6f},setpts=PTS-STARTPTS,format=yuv420p[v1]",
        f"[1:a]atrim=start={skip:.6f},asetpts=PTS-STARTPTS,aresample={SR},aformat=channel_layouts=stereo,{ln},aresample={SR},atrim=end={D:.6f},"
        f"apad=whole_dur={D:.6f},afade=t=in:d={f},afade=t=out:st={D - f:.6f}:d={f},asetpts=PTS-STARTPTS[a1]",
        f"[0:v]trim=start={T:.6f},setpts=PTS-STARTPTS[v2]",
        f"[0:a]atrim=start={T:.6f},asetpts=PTS-STARTPTS,afade=t=in:d={f}[a2]",
        "[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]",
    ])
    dst = out / "presentation.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-i", str(clip), "-filter_complex", graph,
                    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                    "-pix_fmt", "yuv420p", "-r", str(FPS), "-colorspace", "bt709", "-color_primaries", "bt709",
                    "-color_trc", "bt709", "-c:a", "aac", "-b:a", "192k", "-ar", str(SR), "-movflags", "+faststart",
                    str(dst)], check=True)

    def shift(item):
        if item.get("kind") == "slide" or "n" in item and item.get("kind") != "cutscene":
            if item.get("n") == host["n"]:
                item["duration"] = round(item["duration"] + D, 3)
                if "frames" in item:
                    item["frames"] = int(round(item["duration"] * FPS))
                return
        if item["start"] > T - 1e-6:
            item["start"] = round(item["start"] + D, 3)

    for key in ("slides", "cutscenes", "chapters"):
        for item in tl.get(key, []):
            shift(item)
    tl["total_duration"] = round(tl["total_duration"] + D, 3)
    tl.setdefault("inserts", []).append({"title": title, "media": str(clip), "trim_start": skip, "at": round(T, 3), "duration": D,
                                         "inside_slide": host["n"], "lufs": lufs})
    (out / "presentation.timeline.json").write_text(json.dumps(tl, indent=1, ensure_ascii=False))
    got = probe_duration(dst)
    print(f"✓ {dst.name}: {got:.2f}s (timeline {tl['total_duration']:.2f}s)")


if __name__ == "__main__":
    main()
