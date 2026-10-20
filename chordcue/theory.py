"""Chord and key helpers shared by the analysis pipeline.

Chords are stored as {"root": 0-11, "q": "<quality>"} where root 0 is C and
quality is one of the keys of INTERVALS ("" is a major triad). Spelling with
sharps or flats is a display concern and happens in the browser, but the
backend picks the key so the sheet comes out spelled sensibly by default.
"""

import numpy as np

SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Semitone intervals from the root for each chord quality.
INTERVALS = {
    "": (0, 4, 7),
    "m": (0, 3, 7),
    "dim": (0, 3, 6),
    "aug": (0, 4, 8),
    "6": (0, 4, 7, 9),
    "m6": (0, 3, 7, 9),
    "7": (0, 4, 7, 10),
    "maj7": (0, 4, 7, 11),
    "m7": (0, 3, 7, 10),
    "mMaj7": (0, 3, 7, 11),
    "dim7": (0, 3, 6, 9),
    "m7b5": (0, 3, 6, 10),
    "sus2": (0, 2, 7),
    "sus4": (0, 5, 7),
}

# BTC's quality labels -> ours.
BTC_QUALITY = {
    "maj": "", "min": "m", "dim": "dim", "aug": "aug", "maj6": "6", "min6": "m6",
    "7": "7", "maj7": "maj7", "min7": "m7", "minmaj7": "mMaj7", "dim7": "dim7",
    "hdim7": "m7b5", "sus2": "sus2", "sus4": "sus4",
}

# Krumhansl-Kessler key profiles.
_MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Major-key tonics conventionally written with flats (F, Bb, Eb, Ab, Db).
_FLAT_MAJOR_TONICS = {5, 10, 3, 8, 1}


def chord_name(chord, flats=False):
    if chord is None:
        return "N.C."
    names = FLAT_NAMES if flats else SHARP_NAMES
    return names[chord["root"] % 12] + chord["q"]


def key_uses_flats(tonic, mode):
    major_tonic = tonic if mode == "major" else (tonic + 3) % 12
    return major_tonic in _FLAT_MAJOR_TONICS


def key_name(tonic, mode):
    flats = key_uses_flats(tonic, mode)
    name = (FLAT_NAMES if flats else SHARP_NAMES)[tonic % 12]
    return name + ("m" if mode == "minor" else "")


def pitch_class_histogram(segments):
    """Duration-weighted pitch-class content of a chord sequence."""
    hist = np.zeros(12)
    for seg in segments:
        chord = seg["chord"]
        if chord is None:
            continue
        dur = seg["end"] - seg["start"]
        for i, interval in enumerate(INTERVALS[chord["q"]]):
            # Root counts most, then the third, then the rest.
            weight = 1.5 if i == 0 else (1.2 if i == 1 else 1.0)
            hist[(chord["root"] + interval) % 12] += dur * weight
    return hist


def detect_key(segments):
    """Estimate (tonic, mode, confidence) from recognized chord segments.

    Correlates the chords' pitch content with Krumhansl-Kessler profiles, then
    breaks ties between relative keys using how much the tonic chord is
    actually played and whether the song starts or ends on it.
    """
    voiced = [s for s in segments if s["chord"] is not None]
    if not voiced:
        return 0, "major", 0.0
    hist = pitch_class_histogram(voiced)
    if hist.sum() == 0:
        return 0, "major", 0.0
    total = sum(s["end"] - s["start"] for s in voiced)

    def tonic_share(tonic, minor):
        dur = 0.0
        for s in voiced:
            c = s["chord"]
            if c["root"] != tonic:
                continue
            is_minor = c["q"] in ("m", "m6", "m7", "mMaj7")
            if is_minor == minor:
                dur += s["end"] - s["start"]
        return dur / total

    def is_tonic(seg, tonic, minor):
        c = seg["chord"]
        return c["root"] == tonic and (c["q"] in ("m", "m7", "m6", "mMaj7")) == minor

    scores = []
    for tonic in range(12):
        for mode, profile in (("major", _MAJOR_PROFILE), ("minor", _MINOR_PROFILE)):
            minor = mode == "minor"
            corr = np.corrcoef(np.roll(profile, tonic), hist)[0, 1]
            score = corr + 0.6 * tonic_share(tonic, minor)
            score += 0.08 * is_tonic(voiced[0], tonic, minor) + 0.12 * is_tonic(voiced[-1], tonic, minor)
            scores.append((score, tonic, mode))
    scores.sort(reverse=True)
    best, runner_up = scores[0], scores[1]
    confidence = float(max(0.0, min(1.0, (best[0] - runner_up[0]) * 4 + 0.5)))
    return best[1], best[2], confidence


# Open-position guitar shapes that beginners can play; used to suggest a capo.
_EASY_GUITAR = {
    (0, ""), (2, ""), (4, ""), (7, ""), (9, ""),            # C D E G A
    (9, "m"), (2, "m"), (4, "m"),                           # Am Dm Em
    (0, "7"), (2, "7"), (4, "7"), (7, "7"), (9, "7"), (11, "7"),
    (9, "m7"), (2, "m7"), (4, "m7"),
    (0, "maj7"), (5, "maj7"), (7, "maj7"), (9, "maj7"), (2, "maj7"), (4, "maj7"),
    (9, "sus2"), (9, "sus4"), (2, "sus2"), (2, "sus4"), (4, "sus4"),
}
# Chords that are playable but harder (F, Bm, barres); everything else costs most.
_MEDIUM_GUITAR = {(5, ""), (11, "m"), (5, "m"), (0, "m"), (7, "m"), (11, "")}


def _shape_cost(root, quality):
    simple_q = simplify_quality(quality)
    if (root, quality) in _EASY_GUITAR:
        return 0.0
    if (root, simple_q) in _EASY_GUITAR:
        return 0.3
    if (root, simple_q) in _MEDIUM_GUITAR:
        return 1.0
    return 2.0


def suggest_capo(segments, max_capo=7):
    """Capo fret whose chord shapes are easiest on guitar, weighted by time played."""
    weights = {}
    for s in segments:
        if s["chord"] is None:
            continue
        key = (s["chord"]["root"], s["chord"]["q"])
        weights[key] = weights.get(key, 0.0) + (s["end"] - s["start"])
    if not weights:
        return 0
    total = sum(weights.values())
    costs = []
    for capo in range(max_capo + 1):
        cost = sum(w * _shape_cost((root - capo) % 12, q) for (root, q), w in weights.items()) / total
        # Prefer no capo unless it really helps.
        costs.append(cost + 0.05 * capo)
    return int(np.argmin(costs))


def simplify_quality(quality):
    """Reduce a chord to a plain triad (or power-chord-like sus) for beginners."""
    if quality in ("m", "m6", "m7", "mMaj7", "m7b5"):
        return "m"
    if quality in ("dim", "dim7"):
        return "dim"
    if quality in ("sus2", "sus4"):
        return quality
    if quality == "aug":
        return "aug"
    return ""
