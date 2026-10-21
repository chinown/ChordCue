"""The analysis queue. Jobs run one at a time in a separate worker process
(see worker.py): it starts when a song needs analyzing and stops after a few
idle minutes, so the always-on server holds no models or GPU memory."""

import logging
import multiprocessing as mp
import os
import queue
import threading
import time
import uuid

from . import index

log = logging.getLogger(__name__)

WORKER_IDLE_S = float(os.environ.get("CHORDCUE_WORKER_IDLE", 300))


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
    def __init__(self, log_path=None):
        self.jobs = {}
        self.queue = queue.Queue()
        self.lock = threading.Lock()
        self.log_path = str(log_path) if log_path else None
        self.ctx = mp.get_context("spawn")
        self.proc = None
        self.conn = None
        self.thread = threading.Thread(target=self._run, name="analysis-queue", daemon=True)
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

    @property
    def worker_running(self):
        return bool(self.proc and self.proc.is_alive())

    # ------------------------------------------------------------ worker process

    def _start_worker(self):
        from .worker import worker_main
        parent, child = self.ctx.Pipe()
        proc = self.ctx.Process(target=worker_main, args=(child, self.log_path), name="chordcue-worker", daemon=True)
        proc.start()
        child.close()
        self.proc, self.conn = proc, parent
        log.info("started the analysis worker (pid %s)", proc.pid)

    def _stop_worker(self):
        if not self.proc:
            return
        try:
            self.conn.send(None)
        except (OSError, EOFError):
            pass
        self.proc.join(10)
        if self.proc.is_alive():
            self.proc.terminate()
            self.proc.join(5)
        self.conn.close()
        log.info("stopped the analysis worker")
        self.proc = self.conn = None

    # ------------------------------------------------------------ queue loop

    def _run(self):
        while True:
            try:
                # While the worker is up, wait only so long before letting it go.
                job_id = self.queue.get(timeout=WORKER_IDLE_S if self.proc else None)
            except queue.Empty:
                self._stop_worker()
                continue
            job = self.jobs.get(job_id)
            if job:
                self._run_job(job)
            self._prune()

    def _run_job(self, job):
        job.status = "running"
        job.message, job.updated = "Starting the analyzer", time.time()
        try:
            if not self.worker_running:
                self._stop_worker()
                self._start_worker()
            self.conn.send((job.request, job.force))
            while True:
                if not self.conn.poll(1.0):
                    if not self.proc.is_alive():
                        raise EOFError("worker exited")
                    continue
                kind, *rest = self.conn.recv()
                if kind == "progress":
                    p = rest[0]
                    job.step, job.message, job.progress, job.updated = p["step"], p["message"], p["progress"], time.time()
                elif kind == "done":
                    job.song_id = rest[0]
                    job.status, job.progress, job.message = "done", 1.0, "Done"
                    break
                elif kind == "error":
                    category, message = rest
                    job.status = "error"
                    job.error = message if category == "source" else f"Analysis failed: {message}"
                    break
        except (EOFError, OSError) as e:
            log.error("the analysis worker stopped unexpectedly: %s", e)
            job.status, job.error = "error", "The analyzer stopped unexpectedly. Try again."
            self._stop_worker()
        job.updated = time.time()

    def _prune(self, keep_s=3600):
        cutoff = time.time() - keep_s
        with self.lock:
            for jid in [j.id for j in self.jobs.values() if j.status in ("done", "error") and j.updated < cutoff]:
                del self.jobs[jid]
