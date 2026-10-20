# ChordCue

**Live chords for whatever you're playing.** Play a song on YouTube, YouTube Music, Spotify or SoundCloud and click the ChordCue icon. A side panel opens next to the page, shows the chord being played right now, and counts you in to the next one. It stays in step with the music, so you can play along on guitar, ukulele or piano.

![The ChordCue side panel in three live views: guitar, piano transposed up two semitones, and ukulele](docs/screenshots/hero.png)

## What it does

- **One click, one panel.** Clicking the ChordCue icon opens the side panel, and it starts working straight away. Nothing appears on any page until you open it.
- **Follows what's playing.** The panel picks up the song in your tab and stays in sync with the page's own player: pause, seek or skip, and the chords follow. While an ad plays, the chords wait.
- **Shows the next chord before it arrives.** The **Next** card counts down the beats to the change, and a lane of upcoming chords slides past a playhead.
- **Diagrams for three instruments.** Guitar (open and barre shapes), ukulele and piano, for all 14 chord types it recognizes in every key. Click a diagram to see another shape.
- **Transpose and capo.** Move the song into a key that suits your voice, or set a capo and see which shapes to play. It also suggests the capo fret that gives the easiest open chords.
- **Chart of the whole song.** Every bar with its chords. The current bar is highlighted, and clicking any bar jumps the song there.
- **Spotify desktop app too.** When no tab is playing a song, the same panel follows the Spotify app on Windows, and can seek it.
- **Runs on your own PC.** A local server finds the chords with AI models on your GPU. A new song takes about 20 seconds, and after that it opens instantly.

| Live view | Chart view |
|:---:|:---:|
| <img src="docs/screenshots/panel-live.png" width="280" alt="Live view: the current chord F with its barre diagram, the next chord C in one beat, the chord lane, the controls, and every chord in the song"> | <img src="docs/screenshots/panel-chart.png" width="280" alt="Chart view: four bars per row with the chords in each bar and the current bar highlighted"> |

## Set it up in 5 steps

You only do this once. It takes about 15 minutes, mostly waiting for downloads. You need **Windows 10 or 11** and **Brave, Chrome, Edge or Opera**.

### 1. Download ChordCue

Click the green **Code** button at the top of this page, then **Download ZIP**. Unzip it somewhere you'll keep it, like your Documents folder.

### 2. Double-click `setup.bat`

It's in the ChordCue folder. If Windows asks whether to run it, click **Run** (or **More info → Run anyway**).

If Python or ffmpeg is missing, it asks to install them: type **Y** and press Enter. Then it downloads everything else (up to 3 GB). Wait until it says **Setup finished**.

### 3. Double-click `start-server.bat`

A black window opens. Keep it open while you play music; you can minimize it. It's ready when it says `ChordCue server on http://127.0.0.1:8765`.

### 4. Add the extension to your browser

Type `brave://extensions` in the address bar and press Enter (in Chrome it's `chrome://extensions`, in Edge `edge://extensions`). Then:

1. Turn on **Developer mode**, top right.
2. Click **Load unpacked** and choose the **`extension`** folder inside the ChordCue folder.
3. ChordCue appears in the list.

![The browser's extensions page: 1 marks the Developer mode switch, 2 the Load unpacked button, 3 the ChordCue card that appears](docs/screenshots/load-unpacked.png)

Last, click the puzzle-piece icon in the browser's toolbar and pin ChordCue, so its icon is always visible.

### 5. Play a song and click the ChordCue icon

Open a song on YouTube, YouTube Music, Spotify or SoundCloud, then click the ChordCue icon. The chords panel opens next to the page. A song's first play takes about 20 seconds to work out the chords. After that, it's instant.

**From then on,** just double-click `start-server.bat` and click the icon.

### If something isn't working

- **Red dot in the panel, or "The ChordCue server isn't running":** double-click `start-server.bat` and keep its window open.
- **"Reload this tab to connect ChordCue":** refresh the page (F5).
- **The chords run early or late:** nudge them with **Sync** in the panel.

## Using it

Click the **ChordCue icon** (or press **Alt+Shift+C**) and the side panel opens beside the page. It decides what to follow by itself:

1. **The song in the tab you're looking at:** YouTube, YouTube Music, open.spotify.com or SoundCloud.
2. **Otherwise, the last tab that had a song**, so you can switch tabs while the music keeps playing.
3. **Otherwise, the Spotify desktop app.** It reads Windows' media controls, the same info shown in the volume flyout.

A song it hasn't seen before is analyzed as soon as it's picked up. The source shows in the panel's header (YouTube, Spotify app, and so on). Click the lane or a bar in the chart to jump there; this works on YouTube, YouTube Music, SoundCloud and the Spotify app. The **gear** opens settings: the server address, and **Analyze this song again**.

If your browser has no side panel, the icon opens the same panel in a small window that follows the tab you clicked from.

- **Controls:**
  - **Transpose:** moves the song up or down by semitones.
  - **Capo:** shows shapes relative to the capo. **Try capo N** suggests the fret with the easiest open shapes.
  - **♯/♭:** spelling, where Auto follows the key.
  - **Simple chords:** reduces 7ths, 6ths and similar chords to plain major and minor.
  - **Sync:** nudges the chords earlier or later. Use it if a Spotify track's chords run early or late.
  - Click a diagram in **Chords in this song** to cycle through other shapes.

Transpose, capo and sync are remembered per song. Instrument, view and notation are remembered for all songs.

## More setup details

- **What `setup.bat` installs:** Python 3.12 and ffmpeg through winget (only if missing, and only after you say yes), then a private Python environment in `.venv` with PyTorch and the packages in `requirements.txt`, and the chord model. The beat and separation models (about 150 MB) download the first time the server analyzes a song and are cached in your user folder (`.cache`). Everything else stays inside the ChordCue folder.
- **Graphics card:** with an NVIDIA card, setup installs the GPU build of PyTorch and the server also separates instruments from vocals before finding chords, which is slightly more accurate. Without one it installs the much smaller CPU build and skips that step; a song still takes about 20 seconds on a 6-core CPU.
- **Disk space:** about 5 GB with an NVIDIA card, much less without.
- **Using git instead of the ZIP:**

  ```bash
  git clone https://github.com/chinown/ChordCue.git
  ```

- **Updating:** run `git pull` (or download the ZIP again), run `setup.bat` again, then click the reload icon on ChordCue in your browser's extensions page.

### Other systems

The server should also run on macOS and Linux, but this hasn't been tested. Install ffmpeg with your package manager, then from the ChordCue folder:

```bash
python3.12 -m venv .venv
```

```bash
.venv/bin/pip install torch==2.11.0 torchaudio==2.11.0
```

```bash
.venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python -m chordcue.server
```

On Linux with an NVIDIA GPU, add `--index-url https://download.pytorch.org/whl/cu128` to the torch install. The Spotify desktop app support needs Windows; everything else works the same.

### What's in this repo

```
extension/   the browser extension (Manifest V3, no build step)
chordcue/    the analysis server (FastAPI)
docs/        README screenshots
tools/       icon generator
tests/       backend tests (extension tests live in extension/tests)
```

## How it works

1. **Find the audio.** YouTube and SoundCloud audio is downloaded with yt-dlp. Spotify audio is DRM-protected, so the server reads the track's title, artist and length and downloads the matching upload from YouTube. It prefers YouTube's official "Artist - Topic" uploads, which are the same master recording, so the timing lines up.
2. **Separate the instruments** with [Demucs](https://github.com/facebookresearch/demucs) (htdemucs). Chords are recognized from bass + "other" (guitars, keys, synths), without the vocals and drums. This step only runs when a GPU is present.
3. **Track beats and bars** with [Beat This!](https://github.com/CPJKU/beat_this).
4. **Recognize chords** with [BTC](https://github.com/jayg996/BTC-ISMIR19), a transformer that knows 170 chord types. Its frame-by-frame guesses are averaged per beat and smoothed with a Viterbi pass, so chords change on beats (mostly on downbeats) instead of flickering. The key and a capo suggestion come from the recognized chords.
5. The extension's background worker fetches the result, and the panel keeps it in sync with the page's own player.

Results are cached in `data/songs/<id>/sheet.json`. The downloaded audio is deleted after analysis unless `CHORDCUE_KEEP_AUDIO=1` is set.

### Server settings (environment variables)

| Variable | Default | |
|---|---|---|
| `CHORDCUE_SEPARATE` | `auto` | `1`/`0` to force stem separation on or off (`auto` = only with CUDA) |
| `CHORDCUE_DEVICE` | auto | `cuda` or `cpu` |
| `CHORDCUE_DATA` | `./data` | where analyzed songs are stored |
| `CHORDCUE_MAX_DURATION` | `900` | longest song accepted, in seconds |

`start-server.bat --port 9000` changes the port. If you do, also set the address under the panel's **gear → Server address**.

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

## License

ChordCue is released under the [MIT License](LICENSE) © 2026 Davi Chen. You can use, copy, change and share it, as long as you keep the copyright notice.

`chordcue/chords/btc_model.py` is adapted from BTC and keeps its own MIT notice (© 2019 Jonggwon Park).

## Credits

BTC chord model © 2019 Jonggwon Park (MIT; model code adapted in `chordcue/chords/btc_model.py`). Beat This! © CPJKU (MIT). Demucs © Meta (MIT). yt-dlp (Unlicense). Inspired by the play-along view of anychord.net.
