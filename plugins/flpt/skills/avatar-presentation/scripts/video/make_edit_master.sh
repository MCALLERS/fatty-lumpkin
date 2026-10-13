#!/bin/zsh
# make_edit_master.sh — an editor-friendly copy of the final video, for CapCut, Premiere, Resolve and the like.
#
#   zsh make_edit_master.sh [input=output/presentation.mp4] [nudge_ms=20]
#
# Why: the pipeline's MP4 carries edit lists (video +66.7 ms from B-frame reordering, audio +21.3 ms of AAC
# priming). Browsers apply them, but some editors (CapCut, seen 2026-09-29) don't, so the voice drifts a
# frame or two off the lips. This copy has:
#   - H.264 with no B-frames and constant 30 fps → no video edit list
#   - PCM audio (no priming) in a .mov → no audio edit list
#   - the voice nudged +nudge_ms. The master's voice measured ~15–25 ms ahead of HeyGen's lips on the Games run,
#     and 20 ms brought it to ±5 ms (cross-correlated against the cached HeyGen clip audio).
# Output: output/presentation_for_editing.mov (about 35 MB per minute).
set -e
cd "${0:A:h}"
IN=${1:-output/presentation.mp4}
NUDGE=${2:-20}
OUT=${IN:h}/presentation_for_editing.mov
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
ffmpeg -v error -y -i "$IN" -map 0:v -map 0:a \
  -c:v libx264 -preset slow -crf 14 -bf 0 -g 30 -pix_fmt yuv420p -r 30 -fps_mode cfr \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -af "adelay=${NUDGE}:all=1,atrim=0:${D},asetpts=PTS-STARTPTS" -c:a pcm_s16le -ar 48000 \
  -use_editlist 0 -t "$D" "$OUT"
echo "✓ $OUT"
ffprobe -v error -show_entries stream=codec_name,avg_frame_rate,start_time,duration -of compact "$OUT"
