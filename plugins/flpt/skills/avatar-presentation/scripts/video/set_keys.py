#!/usr/bin/env python3
"""Ask for the API keys in hidden macOS dialogs and save them.

The keys are written only to the key file and are never printed (only masked, like 0dd6…e094).
Usage: python3 set_keys.py                     (asks for each key → this project's api_keys.txt)
       python3 set_keys.py heygen              (asks for one: heygen | elevenlabs | gemini)
       python3 set_keys.py --global [heygen]   (saves to ~/.config/avatar-presentation/keys.env instead,
                                                shared by every project; chmod 600)
       python3 set_keys.py --profile show      (merged settings with keys masked, and where each came from)
Settings are read presenter.env → keys.env → api_keys.txt; a project's non-blank value wins.
The folder can be moved with AVATAR_PRESENTATION_CONFIG_DIR.
"""
import os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = os.path.join(HERE, "api_keys.txt")
EXAMPLE = os.path.join(HERE, "api_keys.example.txt")

FIELDS = {
    "heygen": ("HEYGEN_API_KEY", "HeyGen API key", "HeyGen > Settings > API > API token"),
    "elevenlabs": ("ELEVENLABS_API_KEY", "ElevenLabs API key", "elevenlabs.io > Developers > API Keys"),
    "gemini": ("GEMINI_API_KEY", "Gemini API key", "aistudio.google.com > Get API key"),
}
GLOBAL_HEADER = [
    "# keys.env — API keys shared by every presentation project. Private: chmod 600, never share it.",
    "# Written by: python3 set_keys.py --global. A project's api_keys.txt can override any key.",
    "",
]


def config_dir():
    env = os.environ.get("AVATAR_PRESENTATION_CONFIG_DIR", "").strip()
    return os.path.abspath(os.path.expanduser(env)) if env else os.path.expanduser("~/.config/avatar-presentation")


def mask(v):
    return v[:4] + "…" + v[-4:] if len(v) > 10 else "…" * 3


def ask(label, hint, where):
    """Return the pasted text, or None if skipped/cancelled/timed out."""
    lines = [
        f'set r to display dialog "Paste your {label}, then click Save." & return & return & '
        f'"Where to find it: {hint}" & return & return & "It is saved only to {where} on this Mac." '
        'default answer "" with hidden answer with title "Presentation video: API keys" '
        'buttons {"Skip", "Save"} default button "Save" giving up after 600',
        'if gave up of r then return "SKIP"',
        'if button returned of r is "Skip" then return "SKIP"',
        'return "OK" & linefeed & (text returned of r)',
    ]
    args = ["osascript"]
    for l in lines:
        args += ["-e", l]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:  # Esc / Cancel, or no GUI session
        return None
    out = r.stdout.rstrip("\n")
    if not out.startswith("OK\n"):
        return None
    return out[3:].strip().strip('"').strip("'").strip()


def save(name, value, path=KEYS, template=EXAMPLE):
    """Set NAME=value in a KEY=VALUE file (creating it from the template/header), then chmod 600."""
    if not os.path.exists(path):
        d = os.path.dirname(path)
        if d and not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
            os.chmod(d, 0o700)
        if template and os.path.exists(template):
            shutil.copy(template, path)
        else:
            with open(path, "w", encoding="utf-8") as f:
                f.write("\n".join(GLOBAL_HEADER) + "\n")
    with open(path, encoding="utf-8-sig") as f:
        lines = f.read().splitlines()
    for i, l in enumerate(lines):
        if l.strip().startswith(name + "="):
            lines[i] = f"{name}={value}"
            break
    else:
        lines.append(f"{name}={value}")
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, path)
    os.chmod(path, 0o600)


def main():
    args = sys.argv[1:]
    keys_path = KEYS
    if "--keys" in args:
        i = args.index("--keys")
        keys_path = os.path.abspath(os.path.expanduser(args[i + 1]))
        del args[i:i + 2]
    if "--profile" in args:
        sys.path.insert(0, HERE)
        from pathlib import Path
        import generate_presentation_video as g
        return g.cmd_profile_show(Path(keys_path), None)
    is_global = "--global" in args
    which = [a for a in args if not a.startswith("--")] or list(FIELDS)
    unknown = [w for w in which if w not in FIELDS]
    if unknown:
        raise SystemExit(f"  ✗ unknown key name(s) {unknown}; use {', '.join(FIELDS)}")
    if is_global:
        path, template, where = os.path.join(config_dir(), "keys.env"), None, "keys.env"
    else:
        path, template, where = keys_path, EXAMPLE, "api_keys.txt"
    for w in which:
        name, label, hint = FIELDS[w]
        v = ask(label, hint, where)
        if not v:
            print(f"  – {name}: skipped")
            continue
        if any(c.isspace() for c in v) or len(v) < 16:
            print(f"  ✗ {name}: that doesn't look like an API key (length {len(v)}); not saved")
            continue
        save(name, v, path, template)
        print(f"  ✓ {name} saved to {path} ({mask(v)})")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
