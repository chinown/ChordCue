# ChordLane

A browser extension that shows the chords of whatever you're playing, in time with the music. It shows the current chord and its diagram, the next chord counted in by beats, a lane of upcoming chords, and a bar chart of the whole song. You can transpose, set a capo, and switch between guitar, ukulele and piano diagrams.

It works on **YouTube**, **YouTube Music**, **Spotify** (web player and the desktop app) and **SoundCloud**, in any Chromium browser (Brave, Chrome, Edge, Opera).

The chord recognition runs on your own PC: a small Python server listens on `127.0.0.1:8765` and does the analysis on your GPU. A new song takes about 20 seconds; after that it opens instantly.

```
extension/        the browser extension (Manifest V3, no build step)
chordlane/        the analysis server (FastAPI)
tools/            icon generator
tests/            backend tests (extension tests live in extension/tests)
```

## Setup

You need Python 3.12, [ffmpeg](https://ffmpeg.org/) on your PATH, and ideally an NVIDIA GPU.

1. Double-click **`setup.bat`**. It creates `.venv` and installs PyTorch (CUDA 12.8) and the rest. It downloads about 3 GB once.
2. Double-click **`start-server.bat`** and leave the window open while you play. The first run downloads the chord, beat and separation models (about 150 MB).
3. Load the extension:
   - Open `brave://extensions` (or `chrome://extensions`, `edge://extensions`, `opera://extensions`).
   - Turn on **Developer mode**.
   - Click **Load unpacked** and pick the **`extension`** folder.
   - Pin ChordLane to the toolbar.

## Using it

- **In the browser:** play a song on YouTube, YouTube Music, open.spotify.com or SoundCloud and the panel appears. Music is analyzed automatically. For other YouTube videos you get a **Get chords** button (change this in the toolbar popup). Drag the panel by its header, shrink it to a pill with **–**, and toggle it with **Alt+Shift+C**.
- **Spotify desktop app:** click the toolbar icon, then **Open chords window**. The window follows the Spotify app through Windows' media controls, the same info shown in the volume flyout. Click the lane or a bar to seek Spotify.
- **Controls:**
  - **Transpose:** moves the song up or down by semitones.
  - **Capo:** shows shapes relative to the capo. **Try capo N** suggests the fret with the easiest open shapes.
  - **♯/♭:** spelling, where Auto follows the key.
  - **Simple chords:** reduces 7ths, 6ths and similar chords to plain major and minor.
  - **Sync:** nudges the chords earlier or later. Use it if a Spotify track's chords run early or late.
  - Click a diagram in **Chords in this song** to cycle through other shapes.

Transpose, capo and sync are remembered per song. Instrument, view and notation are remembered for all songs.

## How it works

1. **Find the audio.** YouTube and SoundCloud audio is downloaded with yt-dlp. Spotify audio is DRM-protected, so the server reads the track's title, artist and length and downloads the matching upload from YouTube. It prefers YouTube's official "Artist - Topic" uploads, which are the same master recording, so the timing lines up.
2. **Separate the instruments** with [Demucs](https://github.com/facebookresearch/demucs) (htdemucs). Chords are recognized from bass + "other" (guitars, keys, synths), without the vocals and drums. This step only runs when a GPU is present.
3. **Track beats and bars** with [Beat This!](https://github.com/CPJKU/beat_this).
4. **Recognize chords** with [BTC](https://github.com/jayg996/BTC-ISMIR19), a transformer that knows 170 chord types. Its frame-by-frame guesses are averaged per beat and smoothed with a Viterbi pass, so chords change on beats (mostly on downbeats) instead of flickering. The key and a capo suggestion come from the recognized chords.
5. The extension's background worker fetches the result, and the panel keeps it in sync with the page's own player.

Results are cached in `data/songs/<id>/sheet.json`. The downloaded audio is deleted after analysis unless `CHORDLANE_KEEP_AUDIO=1` is set.

### Server settings (environment variables)

| Variable | Default | |
|---|---|---|
| `CHORDLANE_SEPARATE` | `auto` | `1`/`0` to force stem separation on or off (`auto` = only with CUDA) |
| `CHORDLANE_DEVICE` | auto | `cuda` or `cpu` |
| `CHORDLANE_DATA` | `./data` | where analyzed songs are stored |
| `CHORDLANE_MAX_DURATION` | `900` | longest song accepted, in seconds |

`start-server.bat --port 9000` changes the port. If you do, also set the address under **Settings → Server address** in the popup.

## Tests

```bash
.venv/Scripts/python tests/test_backend.py
```

```bash
.venv/Scripts/deno run extension/tests/theory.test.js
```

The extension test checks that every guitar and ukulele shape it can draw sounds exactly its chord, for all 14 chord types in all 12 keys.

## Limits

- Chords are an estimate. Dense mixes, heavy distortion or unusual harmony can throw them off, so check by ear.
- Spotify sync depends on finding the same recording on YouTube. If a song's intro differs, use **Sync**.
- The Spotify web player and SoundCloud adapters read their players through the page. They haven't been tested logged in, so if either site changes its layout, the panel may not find the song.
- The server only accepts requests from the extension, or from tools that send no web origin, and only listens on localhost.

## Credits

BTC chord model © 2019 Jonggwon Park (MIT; model code adapted in `chordlane/chords/btc_model.py`). Beat This! © CPJKU (MIT). Demucs © Meta (MIT). yt-dlp (Unlicense). Inspired by the play-along view of anychord.net.
