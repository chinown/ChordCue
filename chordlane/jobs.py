"""A single background worker: analyses share one GPU, so they run one at a time."""

import logging
import queue
import threading
import time
import traceback
import uuid

from . import index, pipeline, sources

log = logging.getLogger(__name__)


def request_key(request):
    if request.get("url"):
        return "url:" + request["url"].strip()
    return index.query_key(request.get("title", ""), request.get("artist", ""))


class Job:
    def __init__(self, request, force):
        self.id = uuid.uuid4().hex[:12]
        self.request = request
        self.key = request_key(request)
        self.force = force
        self.status = "queued"  # queued | running | done | error
        self.step = None
        self.message = "Waiting in line"
        self.progress = 0.0
        self.song_id = None
        self.error = None
        self.created = time.time()
        self.updated = self.created

    def to_dict(self, position=None):
        d = {k: getattr(self, k) for k in ("id", "status", "step", "message", "song_id", "error")}
        d["progress"] = round(self.progress, 3)
        if position is not None:
            d["queue_position"] = position
        return d


class JobManager:
    def __init__(self):
        self.jobs = {}
        self.queue = queue.Queue()
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._run, name="analysis-worker", daemon=True)
        self.thread.start()

    def submit(self, request, force=False):
        key = request_key(request)
        with self.lock:
            for job in self.jobs.values():
                if job.key == key and job.status in ("queued", "running"):
                    return job
            job = Job(request, force)
            self.jobs[job.id] = job
        self.queue.put(job.id)
        return job

    def get(self, job_id):
        return self.jobs.get(job_id)

    def position(self, job):
        if job.status != "queued":
            return None
        with self.lock:
            return sum(1 for j in self.jobs.values() if j.status == "queued" and j.created <= job.created)

    def _run(self):
        while True:
            job = self.jobs.get(self.queue.get())
            if not job:
                continue
            job.status = "running"

            def update(step, message, progress):
                job.step, job.message, job.progress, job.updated = step, message, progress, time.time()

            try:
                job.song_id = pipeline.analyze(job.request, on_progress=update, force=job.force)
                job.status, job.progress, job.message = "done", 1.0, "Done"
            except sources.SourceError as e:
                job.status, job.error = "error", str(e)
            except Exception as e:  # noqa: BLE001 - report anything to the user rather than dying
                log.error("analysis failed for %s\n%s", job.request, traceback.format_exc())
                job.status, job.error = "error", f"Analysis failed: {type(e).__name__}: {e}"
            job.updated = time.time()
            self._prune()

    def _prune(self, keep_s=3600):
        cutoff = time.time() - keep_s
        with self.lock:
            for jid in [j.id for j in self.jobs.values() if j.status in ("done", "error") and j.updated < cutoff]:
                del self.jobs[jid]
