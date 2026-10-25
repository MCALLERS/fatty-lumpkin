# WORKED EXAMPLE (flpt-showcase, "A Curiosity Run", 2026-10-14): lift another presenter's FLPT bubble and voice
# frame-exact from their video and lay them over our own slide renders. Adapt ALEX / SPLITS / SLIDES / CARTOON paths.
# FLPT and this pipeline share the bubble geometry (rounded 300 px, 4 px ring, margin 48 -> avatar at 52,728); make the
# mask/ring/shadow PNGs with generate_presentation_video.Bubble(Path(...), shape="rounded").ensure_artwork().
#!/usr/bin/env python3
"""compose_alex_part.py — Alex's part of "A Curiosity Run": our slides 3–13 behind Alex's own bubble and voice.

    python3 compose_alex_part.py [--placeholders] [--out alex_part.mp4]

Inputs (paths relative to presentation/):
  media/slide_03.mp4 … slide_13.mp4   HyperFrames renders, each its slide's frames − 1 (the last frame is held)
  ../source/alex_presentation_v4.mp4  Alex's FLPT video (1080p30): his bubble and his audio, used untouched
  ../research/alex_v4_splits.json     slide bounds in his video (pause midpoints, frame-snapped)
  compose/bubble/*.png                the pipeline's own rounded-bubble mask and ring/shadow artwork (the same geometry
                                      as FLPT's, so his bubble lands pixel-for-pixel where it was: avatar 300×300 at 52,728)

What it does, matching the pipeline's look:
  * Background: each slide padded to its exact frame count (last frame held); from slide 4 on, the previous slide's
    last frame cross-fades out over the first 0.3 s (XFADE_S), as the pipeline does between slides.
  * Bubble: Alex's 300×300 avatar square cut from his video at the same time, masked with the pipeline's rounded
    mask, over the pipeline's ring + shadow. On the cartoon slides (4 and 8) it fades out over the last 0.4 s of the
    slide before and back in over the first 0.4 s of the slide after (BUBBLE_FADE_S), as "bubble": false does.
  * Sound: Alex's audio track, untouched.
--placeholders renders flat stand-in slides (for testing before the animations exist).
"""
import json, subprocess, sys, tempfile
from pathlib import Path

FPS = 30
P = Path(__file__).resolve().parent.parent                # presentation/
ALEX = P.parent / "source/alex_presentation_v4.mp4"
SPLITS = json.loads((P.parent / "research/alex_v4_splits.json").read_text())["bounds"]
SLIDES = list(range(3, 14))
CARTOON = {4, 8}
XFADE, BFADE = 0.3, 0.4
MASK = P / "compose/bubble/bubble_mask_rounded0.22_d300_r4_p30_v1.png"
DECOR = P / "compose/bubble/bubble_decor_rounded0.22_d300_r4_p30_v1.png"
AX, AY, D, DX, DY = 52, 728, 300, 22, 698


def run(cmd):
    subprocess.run([str(c) for c in cmd], check=True)


def nframes(p):
    return int(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
                                        "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(p)]).strip())


def main():
    placeholders = "--placeholders" in sys.argv
    out = P / "compose" / (sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "alex_part.mp4")
    frames = {n: round(SPLITS[i + 1] * FPS) - round(SPLITS[i] * FPS) for i, n in enumerate(SLIDES)}
    total = sum(frames.values())
    tmp = Path(tempfile.mkdtemp(prefix="alexpart_"))
    segs, prev_last = [], None
    for n in SLIDES:
        N = frames[n]
        src = P / f"media/slide_{n:02d}.mp4"
        seg = tmp / f"s{n:02d}.mp4"
        if placeholders or not src.exists():
            if not placeholders:
                print(f"  ! slide {n}: {src.name} missing → placeholder")
            hue = ["0xF5F2EA", "0x8E2C48", "0xE9E2D2", "0x1E2A38"][n % 4]
            run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={hue}:s=1920x1080:r={FPS}",
                 "-frames:v", N, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "12", "-preset", "fast", seg])
        else:
            have = nframes(src)
            if have not in (N - 1, N):
                print(f"  ! slide {n}: {have} frames, expected {N - 1} (or {N}) — padding/trimming to {N}")
            vf = f"fps={FPS},tpad=stop_mode=clone:stop={max(0, N - have)},trim=end_frame={N},setpts=PTS-STARTPTS"
            inputs = ["-i", src]
            if prev_last is not None:                       # cross-fade the previous slide's last frame out
                inputs += ["-loop", "1", "-framerate", str(FPS), "-i", prev_last]
                fc = (f"[0:v]{vf},format=yuv420p[a];[1:v]format=rgba,trim=end_frame={int(XFADE * FPS)},"
                      f"fade=t=out:st=0:d={XFADE}:alpha=1,setpts=PTS-STARTPTS[b];[a][b]overlay=eof_action=pass,format=yuv420p[v]")
            else:
                fc = f"[0:v]{vf},format=yuv420p[v]"
            run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", fc, "-map", "[v]", "-frames:v", N,
                 "-c:v", "libx264", "-crf", "12", "-preset", "fast", "-pix_fmt", "yuv420p", seg])
        got = nframes(seg)
        assert got == N, f"slide {n}: segment has {got} frames, wanted {N}"
        prev_last = tmp / f"s{n:02d}_last.png"
        run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.1", "-i", seg, "-update", "1", "-frames:v", "1", prev_last])
        segs.append(seg)
    lst = tmp / "list.txt"
    lst.write_text("".join(f"file '{s}'\n" for s in segs))
    bg = tmp / "bg.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", bg])

    # bubble visibility: hidden on the cartoon slides, with the pipeline's 0.4 s fades
    hides = []
    for n in sorted(CARTOON):
        i = SLIDES.index(n)
        a, b = SPLITS[i], SPLITS[i + 1]
        hides.append(f"clip((T-{a - BFADE:.4f})/{BFADE},0,1)*(1-clip((T-{b:.4f})/{BFADE},0,1))")
    vis = f"(1-max({hides[0]},{hides[1]}))" if len(hides) == 2 else f"(1-{hides[0]})"
    fc = ";".join([
        f"[1:v]crop={D}:{D}:{AX}:{AY},format=rgba[av]",
        f"[2:v]format=gray,loop=-1:1:0,trim=end_frame={total},setpts=N/{FPS}/TB[msk]",
        "[av][msk]alphamerge[avm]",
        f"[avm]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*{vis}'[avf]",
        f"[3:v]format=rgba,loop=-1:1:0,trim=end_frame={total},setpts=N/{FPS}/TB[dec0]",
        f"[dec0]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*{vis}'[dec]",
        f"[0:v][dec]overlay={DX}:{DY}:format=auto[v0]",
        f"[v0][avf]overlay={AX}:{AY}:format=auto,format=yuv420p[v]",
    ])
    # Alex's sound, untouched apart from one constant gain: his FLPT mix sits at about -19.5 LUFS (true peak -4.2 dBTP),
    # the user's narration at about -15.4. A plain +3 dB brings him to about -16.5 with peaks near -1.2, so no limiter
    # or loudnorm (which would go dynamic) touches his voice.
    fc += ";[1:a]volume=3.0dB,aresample=48000[a]"
    run(["ffmpeg", "-v", "error", "-y", "-i", bg, "-i", ALEX, "-i", MASK, "-i", DECOR, "-filter_complex", fc,
         "-map", "[v]", "-map", "[a]", "-frames:v", total, "-r", FPS, "-c:v", "libx264", "-preset", "medium",
         "-crf", "16", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out])
    print(f"✓ {out}  ({total} frames = {total / FPS:.3f}s; slides {SLIDES[0]}–{SLIDES[-1]}; bubble hidden on {sorted(CARTOON)})")


if __name__ == "__main__":
    main()
