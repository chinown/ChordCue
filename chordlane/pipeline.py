"""The whole analysis: link -> audio -> beats + chords -> sheet.json."""

import hashlib
import json
import logging
import time
from datetime import datetime, timezone

import numpy as np
import requests

from . import audio, beats, config, index, sources, theory
from .chords import recognize

log = logging.getLogger(__name__)

SHEET_VERSION = 2


def song_dir(song_id):
    return config.SONGS_DIR / song_id


def load_sheet(song_id):
    path = song_dir(song_id) / "sheet.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if data.get("version") == SHEET_VERSION else None


def _write_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def ensure_models():
    """Download the BTC chord model on first run."""
    path = config.btc_weights_path()
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    log.info("downloading BTC chord model to %s", path)
    r = requests.get(config.BTC_URL, timeout=120)
    r.raise_for_status()
    digest = hashlib.sha256(r.content).hexdigest()
    if config.BTC_SHA256 and digest != config.BTC_SHA256:
        raise RuntimeError(f"BTC model checksum mismatch ({digest})")
    path.write_bytes(r.content)
    return path


class Progress:
    """Maps each step onto a slice of the overall 0-1 progress bar."""

    STEPS = [
        ("resolve", "Reading the link", 0.05),
        ("download", "Downloading audio", 0.30),
        ("separate", "Isolating the instruments", 0.35),
        ("beats", "Finding the beat", 0.15),
        ("chords", "Recognizing chords", 0.15),
    ]

    def __init__(self, callback):
        self.callback = callback or (lambda **kw: None)
        self.offsets, acc = {}, 0.0
        for name, _, weight in self.STEPS:
            self.offsets[name] = (acc, weight)
            acc += weight
        self.labels = {name: label for name, label, _ in self.STEPS}

    def step(self, name, fraction=0.0):
        start, weight = self.offsets[name]
        self.callback(step=name, message=self.labels[name], progress=min(0.999, start + weight * fraction))


def resolve_request(request):
    """Track for {"url": ...} or {"title", "artist", "duration"}."""
    if request.get("url"):
        return sources.resolve(request["url"])
    return sources.resolve_query(request.get("title", ""), request.get("artist", ""), request.get("duration", 0))


def analyze(request, on_progress=None, force=False):
    """Run the full pipeline for a link or a song name; returns the song id."""
    prog = Progress(on_progress)
    timings = {}
    t0 = time.perf_counter()

    def mark(name):
        nonlocal t0
        now = time.perf_counter()
        timings[name] = round(now - t0, 2)
        t0 = now

    prog.step("resolve")
    track = resolve_request(request)
    if track.duration and track.duration > config.MAX_DURATION_S:
        raise sources.SourceError(f"That's {track.duration / 60:.0f} minutes long; songs up to "
                                  f"{config.MAX_DURATION_S // 60} minutes are supported.")
    if load_sheet(track.song_id) and not force:
        index.put(track.aliases, track.song_id)
        return track.song_id
    out_dir = song_dir(track.song_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    ensure_models()
    mark("resolve")

    prog.step("download")
    src = sources.download_audio(track, out_dir, progress=lambda f: prog.step("download", f))
    mark("download")

    device = config.device()
    mix = audio.load(src, sr=44100)
    duration = mix.shape[1] / 44100
    if config.separate_enabled(device):
        prog.step("separate")
        stems = audio.separate(mix, device)
        # Bass + "other" (keys, guitars, synths) carry the harmony; drums and
        # vocals only blur the spectrum.
        harmonic = audio.to_mono(stems["bass"] + stems["other"])
        mark("separate")
    else:
        harmonic = audio.to_mono(mix)

    prog.step("beats")
    mix_22k = audio.resample(audio.to_mono(mix), 44100, 22050)
    beat_times, downbeat_times, bpm, per_bar = beats.track(mix_22k, 22050, device)
    mark("beats")

    prog.step("chords")
    timeline = recognize.recognize(audio.resample(harmonic, 44100, 22050), 22050,
                                   beat_times, downbeat_times, device)
    tonic, mode, key_conf = theory.detect_key(timeline)
    mark("chords")

    result = {
        "version": SHEET_VERSION,
        "song_id": track.song_id,
        "title": track.title,
        "artist": track.artist,
        "platform": track.platform,
        "source_url": track.url,
        "audio_source_url": track.audio_url or track.url,
        "thumbnail": track.thumbnail,
        "duration": round(duration, 2),
        "key": {"tonic": tonic, "mode": mode, "name": theory.key_name(tonic, mode),
                "confidence": round(key_conf, 2)},
        "bpm": round(bpm, 1),
        "beats_per_bar": per_bar,
        "capo_suggestion": theory.suggest_capo(timeline),
        "chords": [_round_seg(s) for s in timeline],
        "beats": [round(float(b), 3) for b in beat_times],
        "downbeats": [round(float(b), 3) for b in downbeat_times],
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "timings": timings,
    }
    _write_json(out_dir / "sheet.json", _plain(result))
    index.put(track.aliases, track.song_id)
    if not config.KEEP_AUDIO:
        src.unlink(missing_ok=True)
    log.info("analyzed %s in %.1fs: %s", track.song_id, sum(timings.values()), timings)
    return track.song_id


def _round_seg(seg):
    return {"start": round(seg["start"], 3), "end": round(seg["end"], 3), "chord": seg["chord"], "conf": seg["conf"]}


def _plain(obj):
    """Make numpy scalars JSON-serializable."""
    if isinstance(obj, dict):
        return {k: _plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_plain(v) for v in obj]
    if isinstance(obj, np.generic):
        return obj.item()
    return obj


def list_songs():
    songs = []
    if not config.SONGS_DIR.exists():
        return songs
    for path in config.SONGS_DIR.glob("*/sheet.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if data.get("version") != SHEET_VERSION:
            continue
        songs.append({k: data.get(k) for k in ("song_id", "title", "artist", "platform", "thumbnail",
                                                "duration", "created")} | {"key": data["key"]["name"]})
    songs.sort(key=lambda s: s.get("created") or "", reverse=True)
    return songs
