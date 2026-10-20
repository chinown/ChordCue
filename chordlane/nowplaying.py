"""What the desktop is playing, via Windows' media controls (SMTC).

Spotify's desktop app publishes its track, position and play state there,
which is how the extension follows songs that aren't playing in a browser tab.
Windows-only; elsewhere `available()` is False.
"""

import asyncio
import logging
import sys
import threading
import time
from datetime import datetime, timezone

log = logging.getLogger(__name__)

# GlobalSystemMediaTransportControlsSessionPlaybackStatus
_PLAYING = 4


class _Bridge:
    """Runs WinRT calls on one thread with its own event loop."""

    def __init__(self):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, name="smtc", daemon=True)
        self.thread.start()
        self.manager = None

    def run(self, coro, timeout=3.0):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(timeout)


_bridge = None
_lock = threading.Lock()


def available():
    if sys.platform != "win32":
        return False
    try:
        import winrt.windows.media.control  # noqa: F401
    except ImportError:
        return False
    return True


def _get_bridge():
    global _bridge
    with _lock:
        if _bridge is None:
            _bridge = _Bridge()
        return _bridge


async def _manager(bridge):
    from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as Manager
    if bridge.manager is None:
        bridge.manager = await Manager.request_async()
    return bridge.manager


def _pick_session(manager, prefer):
    sessions = list(manager.get_sessions())
    for s in sessions:
        if prefer and prefer.lower() in (s.source_app_user_model_id or "").lower():
            return s
    return manager.get_current_session() or (sessions[0] if sessions else None)


async def _read(bridge, prefer):
    manager = await _manager(bridge)
    session = _pick_session(manager, prefer)
    if session is None:
        return None
    props = await session.try_get_media_properties_async()
    timeline = session.get_timeline_properties()
    playback = session.get_playback_info()
    playing = playback.playback_status == _PLAYING
    position = timeline.position.total_seconds()
    updated = timeline.last_updated_time
    if playing and updated and updated.year > 2000:
        # Apps only report position now and then; project it to now.
        position += max(0.0, (datetime.now(timezone.utc) - updated).total_seconds())
    duration = timeline.end_time.total_seconds()
    return {
        "app": session.source_app_user_model_id,
        "title": props.title or "",
        "artist": props.artist or props.album_artist or "",
        "album": props.album_title or "",
        "duration": round(duration, 3),
        "position": round(min(position, duration) if duration else position, 3),
        "playing": playing,
        "at": time.time(),
    }


async def _seek(bridge, prefer, seconds):
    manager = await _manager(bridge)
    session = _pick_session(manager, prefer)
    if session is None:
        return False
    # WinRT TimeSpan ticks are 100 ns.
    return await session.try_change_playback_position_async(int(seconds * 10_000_000))


def now_playing(prefer="Spotify"):
    if not available():
        return None
    bridge = _get_bridge()
    try:
        return bridge.run(_read(bridge, prefer))
    except Exception:  # noqa: BLE001 - SMTC can fail transiently while apps switch tracks
        log.debug("SMTC read failed", exc_info=True)
        bridge.manager = None
        return None


def seek(seconds, prefer="Spotify"):
    if not available():
        return False
    bridge = _get_bridge()
    try:
        return bool(bridge.run(_seek(bridge, prefer, seconds)))
    except Exception:  # noqa: BLE001
        log.debug("SMTC seek failed", exc_info=True)
        return False
