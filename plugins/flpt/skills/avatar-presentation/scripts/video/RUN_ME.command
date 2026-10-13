#!/bin/bash
# ============================================================================
#  RUN_ME.command — make the FINAL narrated video (uses paid TTS + HeyGen)
#  Double-click this file. It checks everything for free first and asks you
#  before spending anything. Safe to double-click again: finished work is reused.
# ============================================================================

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

pause() { echo; read -r -p "  Press Enter to close this window..." _; }

echo ""
echo "================================================================"
echo "  Presentation video — final render"
echo "================================================================"
echo ""

# --- 1. Tools ---------------------------------------------------------------
PY=""
for c in /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
    if command -v "$c" >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
if [ -z "$PY" ]; then
    echo "  ✗ Python 3 is not installed. Get it from https://www.python.org/downloads/"
    pause; exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "  ✗ ffmpeg is not installed. Open Terminal and run:  brew install ffmpeg"
    pause; exit 1
fi
echo "  ✓ $("$PY" --version 2>&1) · $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3)"

# --- 2. Private Python environment (.venv) with 'requests' -------------------
if [ ! -x .venv/bin/python ]; then
    echo "  Setting up a private Python environment (one time)…"
    "$PY" -m venv .venv || { echo "  ✗ Could not create .venv"; pause; exit 1; }
fi
VPY=".venv/bin/python"
if ! "$VPY" -c "import requests" >/dev/null 2>&1; then
    echo "  Installing 'requests' (one time)…"
    "$VPY" -m pip install --quiet --disable-pip-version-check requests \
        || { echo "  ✗ Could not install 'requests' (are you online?)"; pause; exit 1; }
fi
echo "  ✓ Python environment ready"

# --- 3. Keys -------------------------------------------------------------------
# Settings come from ~/.config/avatar-presentation/{presenter.env,keys.env} (shared by all
# projects), then this project's api_keys.txt. With global keys, api_keys.txt can stay empty.
CFG="${AVATAR_PRESENTATION_CONFIG_DIR:-$HOME/.config/avatar-presentation}"
if [ ! -f api_keys.txt ]; then
    cp api_keys.example.txt api_keys.txt
    chmod 600 api_keys.txt
    if [ -f "$CFG/keys.env" ]; then
        echo "  ✓ Using your presenter profile + keys in $CFG"
        echo "    (api_keys.txt created empty, for per-project overrides only)"
    else
        echo ""
        echo "  I created api_keys.txt for you and will open it in TextEdit."
        echo "  Paste in your keys and IDs (see SETUP.md), save, close it,"
        echo "  then double-click RUN_ME.command again."
        echo "  (Or save keys once for every project:  python3 set_keys.py --global)"
        open -e api_keys.txt
        pause; exit 1
    fi
fi

# --- 4. Slides (free) ------------------------------------------------------------
if [ -f ../deck/project/deck.json ]; then
    echo ""
    "$VPY" render_slides.py || { echo "  ✗ Slide rendering failed (see above)."; pause; exit 1; }
fi

# --- 5. Free check -------------------------------------------------------------------
echo ""
if ! "$VPY" generate_presentation_video.py --check; then
    echo ""
    echo "  Fix the items marked ✗ (api_keys.txt, keys.env / presenter.env, or media files — see SETUP.md),"
    echo "  then double-click again."
    pause; exit 1
fi

# --- 6. Your OK ------------------------------------------------------------------------
echo ""
echo "  The next step uses your text-to-speech (ElevenLabs / HeyGen / Gemini) and HeyGen credits."
echo "  (Slides that were already generated in an earlier run are reused for free.)"
read -r -p "  Proceed with paid generation? (y/N) " ans
case "$ans" in
    y|Y|yes|Yes|YES) ;;
    *) echo "  OK — nothing was generated."; pause; exit 0 ;;
esac

# --- 7. Final render + web copies ------------------------------------------------------------
"$VPY" generate_presentation_video.py --final --yes
rc=$?
if [ $rc -eq 0 ] || [ $rc -eq 3 ]; then
    "$VPY" generate_presentation_video.py --web || rc=1
    [ $rc -ne 1 ] && { python3 ../player/build_player.py || rc=1; }
fi

echo ""
echo "================================================================"
if [ $rc -eq 0 ]; then
    echo "  ✓ Done."
    echo "    Full video:  output/presentation.mp4"
    echo "    Video page:  ../player/ is rebuilt with the final video."
    echo "    Next: ask Claude to \"publish the final video\" to update the same link."
    open output
elif [ $rc -eq 3 ]; then
    echo "  ✓ Video made, but some slides show a still photo instead of the"
    echo "    moving avatar (listed above). Double-click RUN_ME again later to"
    echo "    retry just those slides — the rest is reused at no cost."
    open output
else
    echo "  ✗ Something went wrong — scroll up for the message marked ✗."
    echo "    Double-clicking again resumes where it stopped (no double charges)."
fi
echo "================================================================"
pause
