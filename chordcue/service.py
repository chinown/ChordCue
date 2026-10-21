"""Run the ChordCue server, from a console or in the background.

    python  -m chordcue.service    with a console (start-server.bat)
    pythonw -m chordcue.service    no window; output goes to data/server.log
                                   (what the Startup and desktop shortcuts run)

Only one copy runs: if ChordCue already answers on the port, this exits.
"""

import argparse
import json
import sys
import urllib.request

from . import config

LOG_LIMIT_BYTES = 2_000_000


def _send_output_to_log():
    """pythonw has no console; keep a log file instead (one old copy kept)."""
    if sys.stdout is not None and sys.stderr is not None:
        return None
    path = config.DATA_DIR / "server.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if path.stat().st_size > LOG_LIMIT_BYTES:
            path.replace(path.with_suffix(".log.1"))
    except FileNotFoundError:
        pass
    stream = open(path, "a", buffering=1, encoding="utf-8")
    sys.stdout = sys.stderr = stream
    return path


def _already_running(host, port):
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/api/health", timeout=2) as r:
            return json.loads(r.read()).get("ok") is True
    except Exception:  # noqa: BLE001 - nothing there, or not ChordCue
        return False


def main():
    parser = argparse.ArgumentParser(description="Run the ChordCue server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    log_path = _send_output_to_log()
    if _already_running(args.host, args.port):
        print(f"ChordCue is already running on http://{args.host}:{args.port}")
        return 0

    from . import server
    server.run(args.host, args.port, log_path=log_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
