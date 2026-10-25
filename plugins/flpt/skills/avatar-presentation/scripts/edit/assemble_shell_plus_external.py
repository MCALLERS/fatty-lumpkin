# WORKED EXAMPLE (flpt-showcase, 2026-10-14): build an intro "shell" through the pipeline (--script/--media/--slides-dir/--out
# overrides), join it to an externally composited part with sample-exact audio trims, and write a combined timeline so
# tighten.py, --edit-master, --web and build_player.py work unchanged. Adapt the paths before reuse.
#!/usr/bin/env python3
"""assemble_final.py — build "A Curiosity Run" end to end from finished parts (free: nothing paid runs here).

    python3 assemble_final.py [--skip-shell] [--skip-alex]

1. Cut scene C: the user's cowbell clip (0–9.6 s) then the 3 s title sting (media/sting.mp4), over the levelled cowbell
   audio (compose/cowbell_audio_lvl.wav, 12.6 s, fading out under the sting) → media/cutscene_C_cowbell_sting.mp4.
2. The shell (slides 1–2 + cut scenes H and C) through the pipeline, from cache (the user's HeyGen clips are cached),
   with the slide 1–2 animations as video backgrounds → video/output_shell/presentation.mp4 + timeline.
3. Alex's part (slides 3–13) with compose_alex_part.py → compose/alex_part.mp4.
4. Join them → video/output/presentation.mp4, and write video/output/presentation.timeline.json in the pipeline's
   format (slides, cutscenes, chapters), so tighten.py, --edit-master, --web and build_player.py work unchanged.
"""
import json, shutil, subprocess, sys
from pathlib import Path

FPS = 30
P = Path(__file__).resolve().parent.parent               # presentation/
V = P / "video"
PY = Path(sys.executable)  # the project's own presentation/video/.venv/bin/python
SPLITS = json.loads((P.parent / "research/alex_v4_splits.json").read_text())["bounds"]
DECK = json.loads((P / "deck/project/deck.json").read_text())["order"]


def run(cmd, cwd=None):
    print("  $", " ".join(str(c) for c in cmd)[:160])
    subprocess.run([str(c) for c in cmd], check=True, cwd=cwd)


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                          "csv=p=0", str(p)]).strip())


def titles():
    import re
    return {int(m.group(1)): m.group(2).strip() for m in re.finditer(r"(?m)^## SLIDE (\d+) — (.+)$", (P / "script.md").read_text())}


def main():
    T = titles()
    # 1. cut scene C = cowbell + sting
    sting = P / "media/sting.mp4"
    c_out = P / "media/cutscene_C_cowbell_sting.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-t", "9.6", "-i", P.parent / "source/g-cowbell.mp4", "-i", sting,
         "-i", P / "compose/cowbell_audio_lvl.wav", "-filter_complex",
         f"[0:v]scale=1440:1080:flags=lanczos,pad=1920:1080:240:0:black,setsar=1,fps={FPS},trim=end_frame=288,setpts=PTS-STARTPTS[a];"
         f"[1:v]fps={FPS},scale=1920:1080,setsar=1,trim=end_frame=90,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0,format=yuv420p[v]",
         "-map", "[v]", "-map", "2:a:0", "-frames:v", "378", "-c:v", "libx264", "-crf", "16", "-preset", "slow",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", c_out])
    print(f"  cut scene C: {dur(c_out):.3f}s")

    # 2. the shell through the pipeline (cached HeyGen clips; free)
    if "--skip-shell" not in sys.argv:
        sm = json.loads((P / "shell_media.json").read_text())
        sm["slides"] = {str(n): {"video": f"media/slide_{n:02d}.mp4", "fit": "cover", "pad": "freeze", "audio": "mute"}
                        for n in (1, 2)}
        for c in sm["cutscenes"]:
            if c["id"] == "C":
                c.update({"video": "media/cutscene_C_cowbell_sting.mp4", "duration": round(378 / FPS, 3)})
        (P / "shell_media.json").write_text(json.dumps(sm, indent=2, ensure_ascii=False) + "\n")
        sd = P / "slides_shell"
        sd.mkdir(exist_ok=True)
        for n in (1, 2):
            shutil.copy2(P / f"slides/slide_{n:02d}.png", sd / f"slide_{n:02d}.png")
        run([PY, "generate_presentation_video.py", "--final", "--yes", "--no-edit-master", "--script", "../shell_script.md",
             "--media", "../shell_media.json", "--slides-dir", "../slides_shell", "--out", "output_shell",
             "--cache", "cache"], cwd=V)

    # 3. Alex's part
    if "--skip-alex" not in sys.argv:
        run(["python3", P / "compose/compose_alex_part.py"])

    # 4. join + timeline
    shell_mp4, shell_tl = V / "output_shell/presentation.mp4", json.loads((V / "output_shell/presentation.timeline.json").read_text())
    alex_mp4 = P / "compose/alex_part.mp4"
    out = V / "output"
    out.mkdir(exist_ok=True)
    master = out / "presentation.mp4"
    # Trim each part's sound to its picture, sample-exact, before joining: a decoded AAC track is padded out to whole
    # 1024-sample frames, and concat appends the next part after that padding (it put Alex 9.7 ms late, 2026-10-14).
    shell_frames = round(shell_tl["total_duration"] * FPS)
    alex_frames = round(SPLITS[-1] * FPS)
    s0, s1 = shell_frames * 48000 // FPS, alex_frames * 48000 // FPS
    run(["ffmpeg", "-v", "error", "-y", "-i", shell_mp4, "-i", alex_mp4, "-filter_complex",
         f"[0:v]fps=30,format=yuv420p,setsar=1,trim=end_frame={shell_frames},setpts=PTS-STARTPTS[v0];"
         f"[1:v]fps=30,format=yuv420p,setsar=1,trim=end_frame={alex_frames},setpts=PTS-STARTPTS[v1];"
         f"[0:a]aresample=48000,apad,atrim=end_sample={s0},asetpts=N/SR/TB[a0];"
         f"[1:a]aresample=48000,apad,atrim=end_sample={s1},asetpts=N/SR/TB[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]",
         "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
         "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-c:a", "aac", "-b:a", "192k",
         "-ar", "48000", "-movflags", "+faststart", master])
    off = shell_tl["total_duration"]
    tl = dict(shell_tl)
    slides = [dict(s) for s in shell_tl["slides"]]
    cuts = [dict(c) for c in shell_tl["cutscenes"]]
    chapters = [dict(c) for c in shell_tl["chapters"]]
    for i, n in enumerate(range(3, 14)):
        a, b = SPLITS[i], SPLITS[i + 1]
        fr = round(b * FPS) - round(a * FPS)
        s = {"n": n, "id": DECK[n - 1], "title": T[n], "start": round(off + round(a * FPS) / FPS, 3),
             "duration": round(fr / FPS, 3), "frames": fr, "narration_seconds": round(b - a, 3),
             "avatar": "none" if n in (4, 8) else "alex", "video": f"media/slide_{n:02d}.mp4"}
        slides.append(s)
        chapters.append({"kind": "slide", "label": f"{n}. {T[n]}", **s})
    tl.update({"video": "presentation.mp4", "slides": slides, "cutscenes": cuts, "chapters": chapters,
               "total_duration": round(off + round(SPLITS[-1] * FPS) / FPS, 3),
               "assembly": "shell (pipeline, the user's avatar) + Alex's part (compose_alex_part.py: his bubble and voice "
                           "from source/alex_presentation_v4.mp4 over slides 3–13)"})
    tl.pop("tightened", None)
    (out / "presentation.timeline.json").write_text(json.dumps(tl, indent=1, ensure_ascii=False))
    print(f"✓ {master}: {dur(master):.3f}s (timeline {tl['total_duration']:.3f}s; shell {off:.3f}s + Alex {SPLITS[-1]:.3f}s)")


if __name__ == "__main__":
    main()
