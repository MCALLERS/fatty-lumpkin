"""Map every finished HyperFrames clip (presentation/media/slide_NN.mp4) into media.json, keeping
"bubble": false flags, notes and the cut-scene list. Usage: python3 research/map_media.py <talk-dir> [...]"""
import json, sys
from pathlib import Path
for talk in sys.argv[1:]:
    P = Path(talk) / "presentation"
    mj = P / "media.json"
    m = json.loads(mj.read_text())
    slides = m.setdefault("slides", {})
    added = []
    for f in sorted((P / "media").glob("slide_[0-9][0-9].mp4")):
        n = str(int(f.stem[6:]))
        spec = slides.get(n, {})
        if isinstance(spec, str):
            spec = {"video": spec}
        if spec.get("video") != f"media/{f.name}":
            spec["video"] = f"media/{f.name}"
            added.append(n)
        spec.setdefault("fit", "cover"); spec.setdefault("pad", "freeze"); spec.setdefault("audio", "mute")
        slides[n] = spec
    m["slides"] = dict(sorted(slides.items(), key=lambda kv: int(kv[0])))
    mj.write_text(json.dumps(m, indent=2))
    have = [k for k, v in m["slides"].items() if v.get("video")]
    print(f"{talk}: mapped {len(have)} video slides {have}; newly added {added}; hidden bubble on "
          f"{[k for k, v in m['slides'].items() if v.get('bubble') is False]}")
