"""Run the ChordCue server, from a console or started by the browser.

    python  -m chordcue.service                    with a console (start-server.bat)
    pythonw -m chordcue.service --exit-when-idle   no window, output in data/server.log;
                                                   what the browser starts (native_host.py)

With --exit-when-idle the server shuts itself down after CHORDCUE_IDLE_EXIT
seconds (default 300) without requests, i.e. a few minutes after the panel is
closed. Only one copy runs: if ChordCue already answers on the port, this exits.
"""

import argparse
import json
import os
import sys
import urllib.request

from . import config

LOG_LIMIT_BYTES = 2_000_000
IDLE_EXIT_S = int(os.environ.get("CHORDCUE_IDLE_EXIT", 300))


def _send_output_to_log(force=False):
    """No console (pythonw, or started by the browser with output discarded):
    keep a log file instead, with one old copy."""
    if not force and sys.stdout is not None and sys.stderr is not None:
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
    parser.add_argument("--exit-when-idle", action="store_true",
                        help="shut down after a few minutes without requests")
    args = parser.parse_args()

    # Started by the browser (--exit-when-idle): its output is discarded, so log to the file.
    log_path = _send_output_to_log(force=args.exit_when_idle)
    if _already_running(args.host, args.port):
        print(f"ChordCue is already running on http://{args.host}:{args.port}")
        return 0

    from . import server
    server.run(args.host, args.port, log_path=log_path,
               idle_exit_s=IDLE_EXIT_S if args.exit_when_idle else None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
