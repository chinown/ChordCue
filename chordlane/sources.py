"""Turn a YouTube, SoundCloud or Spotify link, or an "artist - title" from
the desktop, into song metadata and an audio file.

YouTube and SoundCloud audio comes straight from yt-dlp. Spotify streams are
DRM-protected, so for Spotify we read the track's title, artist and length
(from its public page, or from what the desktop app reports) and download the
matching recording from YouTube.
"""

import html
import logging
import os
import re
import sys
import unicodedata
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
import yt_dlp

from . import config, index

log = logging.getLogger(__name__)

# yt-dlp needs a JavaScript runtime for YouTube; the `deno` package installs
# one next to this Python, which isn't on PATH unless the venv is activated.
_scripts = os.path.dirname(sys.executable)
if _scripts not in os.environ.get("PATH", "").split(os.pathsep):
    os.environ["PATH"] = _scripts + os.pathsep + os.environ.get("PATH", "")

_UA ="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


class SourceError(Exception):
    """A link we can't handle, with a message fit to show the user."""


@dataclass
class Track:
    song_id: str
    platform: str
    url: str
    title: str = ""
    artist: str = ""
    duration: float = 0.0
    thumbnail: str = ""
    audio_url: str = ""  # the page the audio was actually downloaded from
    aliases: list = field(default_factory=list)  # index keys that should point at song_id

    def to_dict(self):
        return asdict(self)


def parse_link(url):
    """Return (platform, id, canonical_url) or raise SourceError."""
    url = url.strip()
    if url.startswith("spotify:track:"):
        tid = url.split(":")[-1]
        return "spotify", tid, f"https://open.spotify.com/track/{tid}"
    if not re.match(r"^https?://", url):
        url = "https://" + url
    p = urlparse(url)
    host = p.netloc.lower().removeprefix("www.").removeprefix("m.")

    if host in ("youtube.com", "music.youtube.com", "youtube-nocookie.com"):
        vid = parse_qs(p.query).get("v", [None])[0]
        if not vid:
            m = re.match(r"^/(?:shorts|embed|live|v)/([\w-]{11})", p.path)
            vid = m.group(1) if m else None
        if vid and re.fullmatch(r"[\w-]{11}", vid):
            return "youtube", vid, f"https://www.youtube.com/watch?v={vid}"
        raise SourceError("That YouTube link doesn't point to a video.")
    if host == "youtu.be":
        vid = p.path.strip("/").split("/")[0]
        if re.fullmatch(r"[\w-]{11}", vid):
            return "youtube", vid, f"https://www.youtube.com/watch?v={vid}"
        raise SourceError("That YouTube link doesn't point to a video.")

    if host == "open.spotify.com" or host == "play.spotify.com":
        m = re.search(r"/track/([A-Za-z0-9]{22})", p.path)
        if m:
            return "spotify", m.group(1), f"https://open.spotify.com/track/{m.group(1)}"
        raise SourceError("Only Spotify track links work (not albums, playlists or podcasts).")

    if host in ("soundcloud.com", "on.soundcloud.com", "api.soundcloud.com"):
        parts = [x for x in p.path.split("/") if x]
        if host == "soundcloud.com" and (len(parts) < 2 or parts[1] in ("sets", "albums", "tracks", "likes", "reposts")):
            raise SourceError("Only SoundCloud track links work (not profiles or playlists).")
        # Short links resolve to a track; the canonical id comes from yt-dlp.
        return "soundcloud", None, f"https://{host}{p.path}"

    raise SourceError("Paste a YouTube, Spotify or SoundCloud link.")


def _ydl_opts(**extra):
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 20,
        "retries": 3,
    }
    opts.update(extra)
    return opts


def alias_for_url(url):
    """Index key for a non-YouTube link, without touching the network (None for YouTube)."""
    platform, pid, canonical = parse_link(url)
    if platform == "spotify":
        return f"sp:{pid}"
    if platform == "soundcloud":
        return "sc:" + urlparse(canonical).path.lower().rstrip("/")
    return None


def song_id_for_url(url):
    """The song id a link maps to, if it's known without analysis."""
    platform, pid, _ = parse_link(url)
    if platform == "youtube":
        return f"yt-{pid}"
    return index.get(alias_for_url(url))


def resolve(url):
    """Metadata for a link, without downloading audio."""
    platform, pid, canonical = parse_link(url)
    if platform == "spotify":
        return _resolve_spotify(pid, canonical)
    try:
        with yt_dlp.YoutubeDL(_ydl_opts()) as ydl:
            info = ydl.extract_info(canonical, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise SourceError(_friendly_ydl_error(e)) from e
    if info.get("_type") == "playlist":
        raise SourceError("That link is a playlist; paste a link to a single song.")

    title, artist = _title_artist(info)
    if platform == "youtube":
        song_id, aliases = f"yt-{info['id']}", []
    else:
        song_id, aliases = f"sc-{info['id']}", [alias_for_url(url)]
    return Track(
        song_id=song_id, platform=platform, url=canonical,
        title=title, artist=artist, duration=float(info.get("duration") or 0),
        thumbnail=info.get("thumbnail") or "", audio_url=info.get("webpage_url") or canonical,
        aliases=aliases,
    )


def resolve_query(title, artist, duration=0.0):
    """A song known only by name (e.g. from the Spotify desktop app): match it on YouTube."""
    if not title:
        raise SourceError("Nothing is playing.")
    track = Track(song_id="", platform="search", url="", title=title, artist=artist, duration=float(duration or 0))
    return _attach_youtube_match(track, [index.query_key(title, artist)])


def _attach_youtube_match(track, aliases):
    vid, thumb = find_youtube_match(track)
    track.song_id = f"yt-{vid}"
    track.audio_url = f"https://www.youtube.com/watch?v={vid}"
    track.thumbnail = track.thumbnail or thumb
    track.aliases = aliases + [index.query_key(track.title, track.artist)]
    return track


def _friendly_ydl_error(e):
    msg = str(e)
    if "Private video" in msg or "private" in msg.lower():
        return "That video is private."
    if "Sign in to confirm your age" in msg:
        return "That video is age-restricted, so it can't be downloaded without signing in."
    if "not available" in msg.lower() or "404" in msg:
        return "That song isn't available (removed, region-locked, or the link is wrong)."
    return "Couldn't read that link: " + re.sub(r"^ERROR:\s*", "", msg)[:200]


_NOISE = re.compile(
    r"\s*[\(\[](?:official|lyric|lyrics|audio|video|music video|mv|hd|hq|4k|visualizer|remaster(?:ed)?|live|"
    r"color coded|legendado|tradução|traducao|letra|歌詞|字幕)[^\)\]]*[\)\]]",
    re.IGNORECASE,
)


def _strip_artist(text, artist):
    """Drop a leading "Artist - " (some uploads repeat it, even twice)."""
    changed = True
    while changed and artist:
        changed = False
        for sep in (" - ", " – ", " — "):
            if text.lower().startswith(artist.lower() + sep):
                text = text[len(artist) + len(sep):].strip()
                changed = True
    return text


def _title_artist(info):
    """Best guess at (title, artist) from yt-dlp metadata."""
    track = info.get("track")
    artist = info.get("artist") or info.get("creator")
    if not artist and info.get("artists"):
        artist = ", ".join(info["artists"])
    if track and artist:
        artist = artist.split(",")[0].strip()
        track = _strip_artist(track, artist)
        return _NOISE.sub("", track).strip() or track, artist
    title = info.get("title") or ""
    uploader = (info.get("uploader") or info.get("channel") or "").removesuffix(" - Topic").strip()
    clean = _NOISE.sub("", title).strip()
    for sep in (" - ", " – ", " — ", " | ", "「"):
        if sep in clean:
            left, right = clean.split(sep, 1)
            left = left.strip()
            right = _strip_artist(right.rstrip("」").strip(), left)
            return _NOISE.sub("", right).strip() or clean, left
    return clean or title, uploader


def _resolve_spotify(tid, canonical):
    try:
        r = requests.get(canonical, headers={"User-Agent": _UA, "Accept-Language": "en"}, timeout=15)
        r.raise_for_status()
    except requests.RequestException as e:
        raise SourceError("Couldn't reach Spotify to read that track.") from e
    page = r.text

    def meta(name):
        m = re.search(r'<meta (?:property|name)="%s" content="([^"]*)"' % re.escape(name), page)
        return html.unescape(m.group(1)) if m else ""

    title = meta("og:title")
    artist = meta("music:musician_description")
    if not artist:
        # og:description reads "Artist · Album · Song · Year"
        artist = meta("og:description").split("·")[0].strip()
    duration = float(meta("music:duration") or 0)
    if not title:
        raise SourceError("Couldn't find that track on Spotify.")
    track = Track(song_id="", platform="spotify", url=canonical,
                  title=title, artist=artist, duration=duration, thumbnail=meta("og:image"))
    return _attach_youtube_match(track, [f"sp:{tid}"])


_PENALIZE = ("cover", "karaoke", "instrumental", "remix", "sped up", "slowed", "nightcore", "8d", "reverb",
             "live", "acoustic", "tutorial", "lesson", "reaction", "1 hour", "loop", "bass boosted")


def _key(text):
    """Lowercase letters and digits only, in any script."""
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", text or "").lower())


def find_youtube_match(track):
    """Pick the YouTube upload that best matches a track known by name and length.

    Returns (video_id, thumbnail_url). Official "Artist - Topic" uploads are
    preferred because they're the same master Spotify streams, so the chord
    timing lines up with what's playing.
    """
    query = f"{track.artist} - {track.title}" if track.artist else track.title
    try:
        with yt_dlp.YoutubeDL(_ydl_opts(extract_flat="in_playlist")) as ydl:
            res = ydl.extract_info(f"ytsearch8:{query} audio", download=False)
    except yt_dlp.utils.DownloadError as e:
        raise SourceError("Couldn't search YouTube for that song.") from e
    wanted_title, wanted_artist = _key(track.title), _key(track.artist)
    best, best_score = None, -1e9
    for e in res.get("entries") or []:
        raw_title = (e.get("title") or "").lower()
        title, channel = _key(raw_title), _key(e.get("channel") or e.get("uploader") or "")
        dur = float(e.get("duration") or 0)
        score = 0.0
        title_match = bool(wanted_title) and wanted_title in title
        if track.duration and dur:
            diff = abs(dur - track.duration)
            score -= diff / 4 if diff > 2 else 0
            if diff > 30:
                score -= 20
        if title_match:
            score += 6
        if wanted_artist and (wanted_artist in title or wanted_artist in channel):
            score += 4
        if (e.get("channel") or "").endswith(" - Topic"):
            score += 5
        for word in _PENALIZE:
            if word in raw_title and word not in track.title.lower():
                score -= 8
        if not title_match and score < 5:
            continue
        if score > best_score:
            best, best_score = e, score
    if not best:
        raise SourceError(f"Couldn't find \"{query}\" on YouTube.")
    return best["id"], f"https://i.ytimg.com/vi/{best['id']}/hqdefault.jpg"


def download_audio(track, dest_dir, progress=None):
    """Download the track's audio into dest_dir; returns the file path."""
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    source = track.audio_url or track.url

    def hook(d):
        if progress and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                progress(min(1.0, d.get("downloaded_bytes", 0) / total))

    opts = _ydl_opts(
        format="bestaudio[ext=m4a]/bestaudio[acodec^=opus]/bestaudio/best",
        outtmpl=str(dest_dir / "original.%(ext)s"),
        progress_hooks=[hook],
        overwrites=True,
    )
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(source, download=True)
    except yt_dlp.utils.DownloadError as e:
        raise SourceError(_friendly_ydl_error(e)) from e
    path = Path(ydl.prepare_filename(info))
    if not path.exists():
        matches = sorted(dest_dir.glob("original.*"))
        if not matches:
            raise SourceError("The download finished but no audio file was written.")
        path = matches[0]
    if not track.duration:
        track.duration = float(info.get("duration") or 0)
    if not track.thumbnail:
        track.thumbnail = info.get("thumbnail") or ""
    if track.duration > config.MAX_DURATION_S:
        raise SourceError(f"That's {track.duration / 60:.0f} minutes long; songs up to "
                          f"{config.MAX_DURATION_S // 60} minutes are supported.")
    return path
