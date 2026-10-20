"""Chord recognition: BTC frame probabilities, decoded on the beat grid."""

import logging
import threading

import librosa
import numpy as np
import torch

from .. import config
from ..theory import BTC_QUALITY
from .btc_model import CONFIG, NO_CHORD_IDX, QUALITIES, UNKNOWN_IDX, BTCModel

log = logging.getLogger(__name__)

# Small log-prior nudges toward the chords people expect to read on a sheet.
# BTC's large vocabulary is happy to call a passing melody note a 6th or 7th.
_QUALITY_PRIOR = {
    "maj": 0.0, "min": 0.0,
    "7": -0.25, "min7": -0.25, "maj7": -0.3,
    "sus2": -0.4, "sus4": -0.35, "dim": -0.5,
    "maj6": -0.6, "min6": -0.6, "aug": -0.7, "minmaj7": -0.8, "dim7": -0.6, "hdim7": -0.6,
}

_model = None
_model_lock = threading.Lock()


def _class_prior():
    prior = np.zeros(CONFIG["num_chords"])
    for i in range(168):
        prior[i] = _QUALITY_PRIOR[QUALITIES[i % 14]]
    prior[UNKNOWN_IDX] = -1.5
    prior[NO_CHORD_IDX] = -0.2
    return prior


def label_for(idx):
    """Model class index -> {"root", "q"} or None for no-chord/unknown."""
    if idx >= 168:
        return None
    return {"root": idx // 14, "q": BTC_QUALITY[QUALITIES[idx % 14]]}


def _load_model(device):
    global _model
    with _model_lock:
        if _model is None:
            path = config.btc_weights_path()
            ckpt = _load_checkpoint(path)
            model = BTCModel()
            model.load_state_dict(ckpt["model"])
            model.eval().to(device)
            _model = (model, float(ckpt["mean"]), float(ckpt["std"]), device)
        return _model


def _load_checkpoint(path):
    # weights_only keeps a tampered checkpoint from running code on load. The
    # BTC checkpoint stores its normalization stats as numpy scalars, which
    # need allowlisting.
    safe = [np.dtype, np.float64, np.float32, type(np.dtype("float64")), type(np.dtype("float32"))]
    core = getattr(np, "_core", None) or np.core
    # The file was pickled under numpy 1.x, so it names the old module path.
    safe += [core.multiarray.scalar, (core.multiarray.scalar, "numpy.core.multiarray.scalar")]
    with torch.serialization.safe_globals(safe):
        return torch.load(path, map_location="cpu", weights_only=True)


def compute_features(y, sr):
    """Log-magnitude CQT exactly as BTC was trained on: 10 s chunks at 22.05 kHz."""
    if sr != CONFIG["song_hz"]:
        y = librosa.resample(y, orig_sr=sr, target_sr=CONFIG["song_hz"])
        sr = CONFIG["song_hz"]
    chunk = int(sr * CONFIG["inst_len"])
    hop = CONFIG["hop_length"]
    feats, times = [], []
    for start in range(0, max(len(y), 1), chunk):
        seg = y[start:start + chunk]
        if len(seg) < hop:
            break
        cqt = librosa.cqt(seg, sr=sr, n_bins=CONFIG["n_bins"],
                          bins_per_octave=CONFIG["bins_per_octave"], hop_length=hop)
        feats.append(cqt)
        times.append(start / sr + np.arange(cqt.shape[1]) * hop / sr)
    feature = np.log(np.abs(np.concatenate(feats, axis=1)) + 1e-6).T  # (frames, 144)
    return feature.astype(np.float32), np.concatenate(times)


def frame_log_probs(feature, device):
    """Run BTC over overlapping windows and average, so no frame sits at a window edge alone."""
    model, mean, std, device = _load_model(device)
    n_t = CONFIG["timestep"]
    hop = n_t // 3
    x = (feature - mean) / std
    n = len(x)
    pad_front = n_t - hop
    total = pad_front + n + n_t
    padded = np.zeros((total, x.shape[1]), dtype=np.float32)
    padded[pad_front:pad_front + n] = x
    starts = list(range(0, total - n_t + 1, hop))
    windows = np.stack([padded[s:s + n_t] for s in starts])
    # Triangular weights: trust the middle of each window most.
    w = np.bartlett(n_t + 2)[1:-1].astype(np.float32)

    acc = np.zeros((total, CONFIG["num_chords"]), dtype=np.float64)
    wsum = np.zeros(total, dtype=np.float64)
    with torch.inference_mode():
        for b in range(0, len(windows), 64):
            batch = torch.from_numpy(windows[b:b + 64]).to(device)
            logp = torch.log_softmax(model(batch), dim=-1).float().cpu().numpy()
            for k, s in enumerate(starts[b:b + 64]):
                acc[s:s + n_t] += logp[k] * w[:, None]
                wsum[s:s + n_t] += w
    acc = acc[pad_front:pad_front + n] / np.maximum(wsum[pad_front:pad_front + n, None], 1e-9)
    return acc


def _viterbi(emissions, switch_cost):
    """Best label path where changing label at step i costs switch_cost[i]."""
    n, k = emissions.shape
    score = emissions[0].copy()
    back = np.zeros((n, k), dtype=np.int32)
    for i in range(1, n):
        best_prev = int(np.argmax(score))
        stay = score
        move = score[best_prev] - switch_cost[i]
        take_move = move > stay
        back[i] = np.where(take_move, best_prev, np.arange(k))
        score = np.where(take_move, move, stay) + emissions[i]
    path = np.zeros(n, dtype=np.int32)
    path[-1] = int(np.argmax(score))
    for i in range(n - 1, 0, -1):
        path[i - 1] = back[i, path[i]]
    return path


def _beat_grid(beats, downbeats, duration):
    """Beat boundaries covering the whole song, plus each beat's position in its bar."""
    beats = np.asarray(beats, dtype=float)
    beats = beats[(beats >= 0) & (beats < duration)]
    if len(beats) < 4:
        grid = np.arange(0.0, duration, 0.5)
        return np.append(grid, duration), np.zeros(len(grid), dtype=int), 4
    ibi = float(np.median(np.diff(beats)))
    # Extend the grid back to 0 and forward to the end with the median beat length.
    head = np.arange(beats[0] - ibi, -1e-6, -ibi)[::-1] if beats[0] > ibi * 0.5 else np.array([])
    tail = np.arange(beats[-1] + ibi, duration - ibi * 0.5, ibi)
    grid = np.concatenate([[0.0], head[head > 0.05], beats, tail, [duration]])
    grid = np.unique(np.round(grid, 4))

    downbeats = np.asarray(downbeats, dtype=float)
    if len(downbeats) >= 2:
        per_bar = int(round(np.median(np.diff(downbeats)) / ibi))
        per_bar = per_bar if per_bar in (2, 3, 4, 6) else 4
    else:
        per_bar = 4
    # Position in bar: count beats since the nearest preceding downbeat.
    pos = np.zeros(len(grid) - 1, dtype=int)
    if len(downbeats):
        for i, t in enumerate(grid[:-1]):
            prev = downbeats[downbeats <= t + ibi * 0.25]
            ref = prev[-1] if len(prev) else downbeats[0] - per_bar * ibi
            pos[i] = int(round((t - ref) / ibi)) % per_bar
    return grid, pos, per_bar


def recognize(y, sr, beats, downbeats, device, switch_penalty=2.2):
    """Return chord segments [{"start","end","chord","conf"}] covering the song."""
    duration = len(y) / sr
    feature, frame_times = compute_features(y, sr)
    logp = frame_log_probs(feature, device)
    probs = np.exp(logp)

    grid, bar_pos, per_bar = _beat_grid(beats, downbeats, duration)
    n_beats = len(grid) - 1
    frame_beat = np.clip(np.searchsorted(grid, frame_times, side="right") - 1, 0, n_beats - 1)

    emissions = np.zeros((n_beats, probs.shape[1]))
    counts = np.bincount(frame_beat, minlength=n_beats)
    np.add.at(emissions, frame_beat, probs)
    has = counts > 0
    emissions[has] /= counts[has, None]
    # A beat too short to hold a frame borrows its neighbour's evidence.
    for i in np.where(~has)[0]:
        j = i - 1 if i > 0 else min(i + 1, n_beats - 1)
        emissions[i] = emissions[j]
    beat_logp = np.log(emissions + 1e-8) + _class_prior()

    # Chords mostly change on the downbeat, often mid-bar, rarely elsewhere.
    switch = np.full(n_beats, switch_penalty)
    switch[bar_pos == 0] *= 0.45
    if per_bar == 4:
        switch[bar_pos == 2] *= 0.75
    path = _viterbi(beat_logp, switch)

    segments = []
    start = 0
    for i in range(1, n_beats + 1):
        if i == n_beats or path[i] != path[start]:
            idx = int(path[start])
            conf = float(emissions[start:i, idx].mean())
            segments.append({"start": float(grid[start]), "end": float(grid[i]),
                             "chord": label_for(idx), "conf": round(conf, 3)})
            start = i
    return _merge_no_chord(segments)


def _merge_no_chord(segments, min_gap=1.5):
    """Short no-chord blips inside a song are almost always misses: absorb them."""
    out = []
    for seg in segments:
        short_nc = seg["chord"] is None and seg["end"] - seg["start"] < min_gap
        if short_nc and out:
            out[-1]["end"] = seg["end"]
            continue
        if out and out[-1]["chord"] == seg["chord"]:
            out[-1]["end"] = seg["end"]
            continue
        out.append(dict(seg))
    return out
