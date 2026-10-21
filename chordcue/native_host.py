"""The program the browser runs when the ChordCue panel needs the server.

The extension calls chrome.runtime.sendNativeMessage("com.chordcue.launcher",
{"cmd": "start"}); the browser starts native/chordcue-host.bat, which runs
this. If ChordCue isn't answering yet, it starts the server with no window
(pythonw -m chordcue.service --exit-when-idle), waits until it answers, and
replies. The server then shuts itself down a few minutes after the panel
stops talking to it, so nothing keeps running when you're not using it.

Native messaging framing: each message is a 4-byte little-endian length
followed by that many bytes of UTF-8 JSON, on stdin/stdout.
"""

import json
import os
import struct
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HEALTH = "http://127.0.0.1:8765/api/health"
START_TIMEOUT_S = 40

# Start the server outside the browser's job object, so it outlives this
# short-lived process, and with no console.
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_BREAKAWAY_FROM_JOB = 0x01000000


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("<I", header)
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def server_up():
    try:
        with urllib.request.urlopen(HEALTH, timeout=1.5) as r:
            return json.loads(r.read()).get("ok") is True
    except Exception:  # noqa: BLE001 - not running yet
        return False


def start_server():
    pythonw = ROOT / ".venv" / "Scripts" / "pythonw.exe"
    if not pythonw.exists():
        raise RuntimeError(f"ChordCue isn't set up in {ROOT} (run setup.bat).")
    cmd = [str(pythonw), "-m", "chordcue.service", "--exit-when-idle"]
    kwargs = dict(cwd=str(ROOT), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                  stderr=subprocess.DEVNULL, close_fds=True)
    flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    try:
        subprocess.Popen(cmd, creationflags=flags | CREATE_BREAKAWAY_FROM_JOB, **kwargs)
    except OSError:
        # The browser's job doesn't allow breakaway: start it inside the job.
        subprocess.Popen(cmd, creationflags=flags, **kwargs)


def handle(msg):
    if not msg or msg.get("cmd") != "start":
        return {"ok": False, "error": "Unknown request"}
    if server_up():
        return {"ok": True, "started": False}
    start_server()
    deadline = time.time() + START_TIMEOUT_S
    while time.time() < deadline:
        time.sleep(0.4)
        if server_up():
            return {"ok": True, "started": True}
    return {"ok": False, "error": "ChordCue didn't start in time; see data/server.log."}


def main():
    os.chdir(ROOT)
    msg = read_message()
    try:
        reply = handle(msg)
    except Exception as e:  # noqa: BLE001 - always answer the browser
        reply = {"ok": False, "error": str(e)}
    send_message(reply)


if __name__ == "__main__":
    main()
