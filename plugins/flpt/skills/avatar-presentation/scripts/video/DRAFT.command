#!/bin/bash
# ============================================================================
#  DRAFT.command — FREE preview. No accounts, no keys, no internet needed for
#  the video itself (fonts for the slides are fetched once). Uses your Mac's
#  built-in voice and a placeholder presenter bubble.
# ============================================================================

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
pause() { echo; read -r -p "  Press Enter to close this window..." _; }

PY=""
for c in /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
    if command -v "$c" >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
[ -z "$PY" ] && { echo "  ✗ Python 3 is not installed (https://www.python.org/downloads/)"; pause; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "  ✗ ffmpeg missing. In Terminal:  brew install ffmpeg"; pause; exit 1; }

if [ -f ../deck/project/deck.json ]; then
    "$PY" render_slides.py || { echo "  ✗ Slide rendering failed (see above)."; pause; exit 1; }
fi
"$PY" generate_presentation_video.py --draft && "$PY" generate_presentation_video.py --draft --web
if [ $? -eq 0 ]; then
    echo ""
    echo "  ✓ Draft ready: output/draft_presentation.mp4"
    open output/draft_presentation.mp4
else
    echo "  ✗ Something went wrong — scroll up for the message marked ✗."
fi
pause
