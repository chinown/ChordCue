"""Audio decoding, stem separation (Demucs) and encoding for playback."""

import logging
import shutil
import subprocess
import threading

import numpy as np
import torch

from . import config

log = logging.getLogger(__name__)

_demucs = None
_demucs_lock = threading.Lock()


def ffmpeg_bin():
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg was not found on PATH; install it and restart the server.")
    return path


def load(path, sr=44100, mono=False):
    """Decode any audio file to float32, shape (channels, samples)."""
    channels = 1 if mono else 2
    cmd = [ffmpeg_bin(), "-v", "error", "-i", str(path), "-f", "f32le", "-acodec", "pcm_f32le",
           "-ac", str(channels), "-ar", str(sr), "-"]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).reshape(-1, channels).T.copy()


def encode(wave, sr, path, bitrate="128k"):
    """Encode (channels, samples) float audio to a compressed file for the browser."""
    wave = np.clip(wave, -1, 1).astype(np.float32)
    cmd = [ffmpeg_bin(), "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", str(wave.shape[0]),
           "-i", "-", "-c:a", "aac", "-b:a", bitrate, str(path)]
    subprocess.run(cmd, input=wave.T.tobytes(), check=True, capture_output=True)


def _get_demucs(device):
    global _demucs
    with _demucs_lock:
        if _demucs is None:
            from demucs.pretrained import get_model
            model = get_model(config.DEMUCS_MODEL)
            model.eval()
            _demucs = model
        return _demucs.to(device)


def separate(wave, device, progress=None):
    """Split a 44.1 kHz stereo mix into Demucs stems: {"drums","bass","other","vocals"}."""
    from demucs.apply import apply_model

    model = _get_demucs(device)
    if wave.shape[0] == 1:
        wave = np.repeat(wave, 2, axis=0)
    mix = torch.from_numpy(wave)
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    mix = (mix - mean) / std
    with torch.inference_mode():
        out = apply_model(model, mix[None], device=device, shifts=1, split=True, overlap=0.25,
                          progress=False, num_workers=0)[0]
    out = out * std + mean
    stems = {name: out[i].cpu().numpy() for i, name in enumerate(model.sources)}
    if device.startswith("cuda"):
        model.to("cpu")
        torch.cuda.empty_cache()
    return stems


def to_mono(wave):
    return wave.mean(axis=0) if wave.ndim == 2 else wave


def resample(y, orig_sr, target_sr):
    if orig_sr == target_sr:
        return y
    import librosa
    return librosa.resample(y, orig_sr=orig_sr, target_sr=target_sr, res_type="soxr_hq")
