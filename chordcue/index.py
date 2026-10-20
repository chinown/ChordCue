"""Aliases from the ways a song gets identified to the analyzed song id.

A Spotify track, a SoundCloud URL or a desktop "artist - title" all end up
analyzed from one audio source (usually a YouTube upload, id "yt-..."). This
maps "sp:<track id>", "sc:<path>" and "q:<artist>|<title>" keys to that id so
the second lookup is instant.
"""

import json
import re
import threading
import unicodedata

from . import config

_lock = threading.Lock()
_cache = None


def _path():
    return config.DATA_DIR / "aliases.json"


def _load():
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _cache = {}
    return _cache


def get(key):
    with _lock:
        return _load().get(key)


def put(keys, song_id):
    keys = [k for k in keys if k]
    if not keys:
        return
    with _lock:
        data = _load()
        changed = False
        for k in keys:
            if data.get(k) != song_id:
                data[k] = song_id
                changed = True
        if changed:
            _path().parent.mkdir(parents=True, exist_ok=True)
            tmp = _path().with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")
            tmp.replace(_path())


def _norm(text):
    text = unicodedata.normalize("NFKC", text or "").lower()
    # Drop "(feat. X)", "- Remastered 2009" and similar decorations.
    text = re.sub(r"\s*[\(\[][^\)\]]*(feat|ft\.|with |remaster|version|edit|mix|live)[^\)\]]*[\)\]]", "", text)
    text = re.sub(r"\s+-\s+.*(remaster|version|edit|mix|live).*$", "", text)
    return re.sub(r"[^\w]+", " ", text).strip()


def query_key(title, artist):
    if not title:
        return None
    first_artist = re.split(r",|&| feat\.? | ft\.? | x ", artist or "")[0]
    return f"q:{_norm(first_artist)}|{_norm(title)}"
