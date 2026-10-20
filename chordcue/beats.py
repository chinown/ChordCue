"""Beat and downbeat tracking with Beat This! (CPJKU), falling back to librosa."""

import logging
import threading

import numpy as np

log = logging.getLogger(__name__)

_tracker = None
_lock = threading.Lock()


def _get_tracker(device):
    global _tracker
    with _lock:
        if _tracker is None:
            from beat_this.inference import Audio2Beats
            _tracker = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)
        return _tracker


def track(y, sr, device):
    """Return (beats, downbeats, bpm, beats_per_bar) for mono audio y."""
    try:
        beats, downbeats = _get_tracker(device)(y.astype(np.float32), sr)
        beats, downbeats = np.asarray(beats, float), np.asarray(downbeats, float)
    except Exception:
        log.exception("Beat This! failed; falling back to librosa beat tracking")
        import librosa
        _, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
        beats = librosa.frames_to_time(frames, sr=sr)
        downbeats = beats[::4]

    if len(beats) < 2:
        return beats, downbeats, 0.0, 4
    ibi = float(np.median(np.diff(beats)))
    bpm = 60.0 / ibi if ibi > 0 else 0.0
    per_bar = 4
    if len(downbeats) >= 2:
        est = int(round(np.median(np.diff(downbeats)) / ibi))
        if est in (2, 3, 4, 6):
            per_bar = est
    return beats, downbeats, bpm, per_bar
