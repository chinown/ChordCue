"""Paths and settings. Override with environment variables prefixed CHORDCUE_."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("CHORDCUE_DATA", ROOT / "data"))
SONGS_DIR = DATA_DIR / "songs"
MODELS_DIR = Path(os.environ.get("CHORDCUE_MODELS", ROOT / "models"))

DEMUCS_MODEL = os.environ.get("CHORDCUE_DEMUCS", "htdemucs")
# Run chord recognition on the separated instruments instead of the full mix:
# slightly more accurate, ~10 s per song on a GPU but minutes on a CPU, so
# "auto" only separates when CUDA is available.
SEPARATE = os.environ.get("CHORDCUE_SEPARATE", "auto")
# Keep the downloaded audio after analysis (only the chord sheet is needed).
KEEP_AUDIO = os.environ.get("CHORDCUE_KEEP_AUDIO", "0") == "1"
MAX_DURATION_S = int(os.environ.get("CHORDCUE_MAX_DURATION", 15 * 60))

BTC_URL = "https://github.com/jayg996/BTC-ISMIR19/raw/master/test/btc_model_large_voca.pt"
BTC_SHA256 = os.environ.get("CHORDCUE_BTC_SHA256", "")


def btc_weights_path():
    return MODELS_DIR / "btc_model_large_voca.pt"


def device():
    import torch
    forced = os.environ.get("CHORDCUE_DEVICE")
    if forced:
        return forced
    return "cuda" if torch.cuda.is_available() else "cpu"


def separate_enabled(dev):
    if SEPARATE == "auto":
        return dev.startswith("cuda")
    return SEPARATE != "0"
