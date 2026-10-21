"""The analysis worker: a separate process that loads PyTorch and the models.

The server starts it when a song needs analyzing and stops it after a few
idle minutes, so the always-on server stays small and the GPU memory is
given back between sessions (important while gaming).

Protocol over a multiprocessing Pipe:
    server -> worker   (request, force)   or None to exit
    worker -> server   ("progress", {"step", "message", "progress"})
                       ("done", song_id)
                       ("error", "source" | "crash", message)
"""

import logging
import sys
import traceback


def worker_main(conn, log_path=None):
    if log_path and (sys.stdout is None or sys.stderr is None):
        # Started from pythonw: no console, so write to the server's log.
        stream = open(log_path, "a", buffering=1, encoding="utf-8")
        sys.stdout = sys.stderr = stream
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s worker %(name)s: %(message)s")
    log = logging.getLogger("chordcue.worker")

    from . import pipeline, sources

    log.info("analysis worker started")
    while True:
        try:
            msg = conn.recv()
        except EOFError:
            break
        if msg is None:
            break
        request, force = msg

        def progress(step, message, progress):
            conn.send(("progress", {"step": step, "message": message, "progress": progress}))

        try:
            song_id = pipeline.analyze(request, on_progress=progress, force=force)
            conn.send(("done", song_id))
        except sources.SourceError as e:
            conn.send(("error", "source", str(e)))
        except Exception as e:  # noqa: BLE001 - report to the server instead of dying
            log.error("analysis failed for %s\n%s", request, traceback.format_exc())
            conn.send(("error", "crash", f"{type(e).__name__}: {e}"))
    log.info("analysis worker exiting")
