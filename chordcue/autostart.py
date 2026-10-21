"""Start ChordCue when you sign in to Windows.

A shortcut in your Startup folder runs the background service
(`pythonw -m chordcue.service`), which has no window. The same shortcut on
the desktop starts it by hand. No admin rights needed.

    python -m chordcue.autostart on       start with Windows
    python -m chordcue.autostart off      don't
    python -m chordcue.autostart status
    python -m chordcue.autostart desktop  add the desktop shortcut
"""

import os
import subprocess
import sys
from pathlib import Path

from . import config

SHORTCUT = "ChordCue.lnk"
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def available():
    return sys.platform == "win32"


def startup_dir():
    override = os.environ.get("CHORDCUE_STARTUP_DIR")
    if override:
        return Path(override)
    return Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def _pythonw():
    """The windowless Python next to the one running now (the project's .venv)."""
    exe = Path(sys.executable)
    windowless = exe.with_name("pythonw.exe")
    return windowless if windowless.exists() else exe


def _write_shortcut(path, description):
    # WScript.Shell is the stock way to write a .lnk; values go through the
    # environment so paths with quotes or spaces need no escaping.
    script = (
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:CC_LNK);"
        "$s.TargetPath = $env:CC_TARGET; $s.Arguments = $env:CC_ARGS;"
        "$s.WorkingDirectory = $env:CC_DIR; $s.IconLocation = $env:CC_ICON;"
        "$s.Description = $env:CC_DESC; $s.Save()"
    )
    env = dict(os.environ, CC_LNK=str(path), CC_TARGET=str(_pythonw()), CC_ARGS="-m chordcue.service",
               CC_DIR=str(config.ROOT), CC_ICON=str(config.ROOT / "tools" / "chordcue.ico"), CC_DESC=description)
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                   env=env, check=True, capture_output=True, creationflags=_NO_WINDOW)


def enabled():
    return available() and (startup_dir() / SHORTCUT).exists()


def enable():
    folder = startup_dir()
    folder.mkdir(parents=True, exist_ok=True)
    _write_shortcut(folder / SHORTCUT, "Starts ChordCue in the background when you sign in")


def disable():
    (startup_dir() / SHORTCUT).unlink(missing_ok=True)


def add_desktop_shortcut():
    desktop = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"],
        capture_output=True, text=True, check=True, creationflags=_NO_WINDOW).stdout.strip()
    _write_shortcut(Path(desktop) / SHORTCUT, "Start ChordCue")


def main(argv=None):
    cmd = (argv or sys.argv[1:] or ["status"])[0]
    if not available():
        print("Starting with Windows is only available on Windows.")
        return 1
    if cmd == "on":
        enable()
        print("ChordCue will start by itself when you sign in to Windows.")
    elif cmd == "off":
        disable()
        print("ChordCue will no longer start with Windows.")
    elif cmd == "desktop":
        add_desktop_shortcut()
        print("Added a ChordCue shortcut to the desktop.")
    elif cmd == "status":
        print("on" if enabled() else "off")
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
