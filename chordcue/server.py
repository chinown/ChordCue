"""Local HTTP API for the ChordCue browser extension.

    GET  /api/health
    POST /api/lookup     {"url"} or {"title","artist","duration"} -> {"song_id"} if already analyzed
    POST /api/analyze    same body + "force" -> a job, or the cached song
    GET  /api/jobs/{id}
    GET  /api/songs      / GET /api/songs/{id} / DELETE /api/songs/{id}
    GET  /api/now-playing           what the desktop (Spotify app) is playing
    POST /api/now-playing/seek      {"position": seconds}

Only listens on 127.0.0.1 by default. Browsers block web pages from calling
it; the extension's background worker can, because the manifest grants it
access to this origin. Start it with chordcue.service (see service.py); when
the browser starts it (native_host.py) it exits once the panel goes quiet.
"""

import logging
import re
import shutil
import threading
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import __version__, index, nowplaying, pipeline, sources
from .jobs import JobManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("chordcue")

app = FastAPI(title="ChordCue")

# Created when the server starts, not at import: the analysis worker process
# imports this package too and must not start a queue of its own.
_jobs = None
_jobs_lock = threading.Lock()
_log_path = None
_last_request = time.monotonic()


def jobs():
    global _jobs
    with _jobs_lock:
        if _jobs is None:
            _jobs = JobManager(log_path=_log_path)
        return _jobs

_SONG_ID = re.compile(r"^(yt|sc)-[\w-]{1,64}$")
_EXTENSION_ORIGIN = re.compile(r"^(chrome|moz)-extension://")


@app.middleware("http")
async def only_extension_or_local(request: Request, call_next):
    # Web pages can't read our responses (no CORS headers), but a page could
    # still fire a POST at localhost. Refuse anything sent with a web origin.
    origin = request.headers.get("origin")
    if origin and not _EXTENSION_ORIGIN.match(origin):
        return JSONResponse({"detail": "Forbidden origin"}, status_code=403)
    global _last_request
    _last_request = time.monotonic()
    return await call_next(request)


class SongRequest(BaseModel):
    url: str | None = None
    title: str | None = None
    artist: str | None = None
    duration: float | None = None
    force: bool = False

    def as_request(self):
        if self.url:
            return {"url": self.url.strip()}
        if self.title:
            return {"title": self.title, "artist": self.artist or "", "duration": self.duration or 0}
        raise HTTPException(400, "Send a url, or a title and artist.")


def _known_song_id(req: SongRequest):
    if req.url:
        try:
            return sources.song_id_for_url(req.url)
        except sources.SourceError as e:
            raise HTTPException(400, str(e)) from e
    return index.get(index.query_key(req.title or "", req.artist or ""))


def _check_id(song_id):
    if not _SONG_ID.match(song_id):
        raise HTTPException(404, "No such song")


@app.get("/api/health")
def health():
    # Deliberately cheap: no PyTorch here (the analysis worker has it).
    return {"ok": True, "version": __version__, "now_playing": nowplaying.available(),
            "analyzing": bool(_jobs and _jobs.worker_running)}


@app.post("/api/lookup")
def lookup(req: SongRequest):
    req.as_request()
    song_id = _known_song_id(req)
    if song_id and pipeline.load_sheet(song_id):
        return {"song_id": song_id, "cached": True}
    return {"song_id": None, "cached": False}


@app.post("/api/analyze")
def analyze(req: SongRequest):
    request = req.as_request()
    if not req.force:
        song_id = _known_song_id(req)
        if song_id and pipeline.load_sheet(song_id):
            return {"status": "done", "song_id": song_id, "cached": True, "progress": 1.0}
    job = jobs().submit(request, force=req.force)
    return job.to_dict(jobs().position(job))


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs().get(job_id)
    if not job:
        raise HTTPException(404, "No such job (the server may have restarted)")
    return job.to_dict(jobs().position(job))


@app.get("/api/songs")
def songs():
    return pipeline.list_songs()


@app.get("/api/songs/{song_id}")
def song(song_id: str):
    _check_id(song_id)
    data = pipeline.load_sheet(song_id)
    if not data:
        raise HTTPException(404, "No such song")
    return data


@app.delete("/api/songs/{song_id}")
def delete_song(song_id: str):
    _check_id(song_id)
    path = pipeline.song_dir(song_id)
    if path.exists():
        shutil.rmtree(path)
    return {"deleted": song_id}


@app.get("/api/now-playing")
def now_playing():
    state = nowplaying.now_playing()
    if not state or not state["title"]:
        return {"playing": False, "title": None}
    song_id = index.get(index.query_key(state["title"], state["artist"]))
    state["song_id"] = song_id if song_id and pipeline.load_sheet(song_id) else None
    return state


class SeekRequest(BaseModel):
    position: float


@app.post("/api/now-playing/seek")
def now_playing_seek(req: SeekRequest):
    return {"ok": nowplaying.seek(max(0.0, req.position))}


def _busy():
    j = _jobs
    return bool(j and any(job.status in ("queued", "running") for job in list(j.jobs.values())))


def _exit_when_idle(server, idle_s):
    """Stop the server once nothing has called it for idle_s seconds and no
    analysis is running. The panel calls every few seconds while it's open."""
    while not server.should_exit:
        time.sleep(5)
        if time.monotonic() - _last_request > idle_s and not _busy():
            log.info("no requests for %d s; shutting down", idle_s)
            server.should_exit = True


def run(host="127.0.0.1", port=8765, log_path=None, idle_exit_s=None):
    import uvicorn

    global _log_path
    _log_path = log_path
    pipeline.ensure_models()
    jobs()
    server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="warning"))
    if idle_exit_s:
        threading.Thread(target=_exit_when_idle, args=(server, idle_exit_s), name="idle-exit", daemon=True).start()
        log.info("ChordCue server on http://%s:%d (exits after %d s without requests)", host, port, idle_exit_s)
    else:
        log.info("ChordCue server on http://%s:%d", host, port)
    server.run()


if __name__ == "__main__":
    # Older shortcuts ran this module directly; the service adds the
    # single-copy check and background logging.
    from .service import main

    main()
