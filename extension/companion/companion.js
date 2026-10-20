// Companion window: follows whatever the Spotify desktop app is playing, using
// the server's /api/now-playing (Windows media controls), and shows its chords.
(() => {
  const GLOBAL_KEYS = ["instrument", "notation", "simple", "view"];
  const SONG_KEYS = ["transpose", "capo", "offset"];
  const POLL_MS = 1000;

  const $ = (id) => document.getElementById(id);
  $("logo").innerHTML = CC.ui.logo;

  const api = (method, path, body) => chrome.runtime.sendMessage({ type: "api", method, path, body });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const view = new CC.ChordView($("view"), {
    onSeek: (t) => {
      clock.set(t, clock.playing);
      api("POST", "/api/now-playing/seek", { position: t });
    },
    onSettings: () => saveSettings(),
  });

  const state = { key: null, np: null, songId: null, sheet: null, status: "waiting" };
  let token = 0;

  // Position between polls: extrapolate locally, and only jump when the app
  // reports something clearly different (a seek, or drift).
  const clock = {
    base: 0, at: performance.now(), playing: false,
    now() {
      return this.playing ? this.base + (performance.now() - this.at) / 1000 : this.base;
    },
    set(t, playing) {
      this.base = t;
      this.at = performance.now();
      this.playing = playing;
    },
    sync(t, playing) {
      if (playing !== this.playing || Math.abs(this.now() - t) > 0.4) this.set(t, playing);
    },
  };

  function setStatus(status, html = "") {
    state.status = status;
    $("view").hidden = status !== "ready";
    $("status").hidden = status === "ready";
    $("status").innerHTML = html;
  }

  async function saveSettings() {
    const all = view.settings;
    const toSet = { settings: Object.fromEntries(GLOBAL_KEYS.map((k) => [k, all[k]])) };
    if (state.songId) toSet[`song:${state.songId}`] = Object.fromEntries(SONG_KEYS.map((k) => [k, all[k]]));
    await chrome.storage.local.set(toSet);
  }

  async function openSong(songId, my) {
    const res = await api("GET", `/api/songs/${songId}`);
    if (my !== token) return;
    if (!res.ok) return setStatus("error", `<div class="cc-msg"><p>Couldn't load the chords.</p></div>`);
    state.songId = songId;
    state.sheet = res.data;
    const got = await chrome.storage.local.get(["settings", `song:${songId}`]);
    view.setSheet(res.data, { ...(got.settings || {}), ...(got[`song:${songId}`] || {}) });
    setStatus("ready");
  }

  async function analyze(np, my) {
    const request = { title: np.title, artist: np.artist, duration: np.duration };
    let res = await api("POST", "/api/analyze", request);
    while (my === token) {
      if (!res.ok) return setStatus("error", `<div class="cc-msg"><p class="cc-dim">${esc((res.data && res.data.detail) || "Server error")}</p></div>`);
      const job = res.data;
      if (job.status === "done") return openSong(job.song_id, my);
      if (job.status === "error") {
        return setStatus("error", `<div class="cc-msg"><p><b>Couldn't get the chords.</b></p><p class="cc-dim">${esc(job.error)}</p></div>`);
      }
      const pct = Math.round((job.progress || 0) * 100);
      setStatus("analyzing", `<div class="cc-msg">
        <p><b>${esc(job.message || "Starting")}</b></p>
        <div class="cc-progress"><i style="width:${pct}%"></i></div>
        <p class="cc-dim">Finding this song on YouTube and listening for the chords.</p></div>`);
      await new Promise((r) => setTimeout(r, 900));
      if (my !== token) return;
      res = await api("GET", `/api/jobs/${job.id}`);
    }
  }

  async function trackChanged(np) {
    const my = ++token;
    state.songId = null;
    state.sheet = null;
    $("title").textContent = np.title;
    $("artist").textContent = np.artist || "";
    if (np.song_id) return openSong(np.song_id, my);
    setStatus("analyzing", `<div class="cc-msg"><p class="cc-dim">Looking up this song…</p></div>`);
    analyze(np, my);
  }

  async function poll() {
    const res = await api("GET", "/api/now-playing");
    if (!res.ok) {
      state.key = null;
      $("state").textContent = "";
      setStatus("offline", `<div class="cc-msg"><p><b>The ChordCue server isn't running.</b></p>
        <p>Start it by double-clicking <code>start-server.bat</code> in the ChordCue folder. This window reconnects by itself.</p></div>`);
      return;
    }
    const np = res.data;
    if (!np.title) {
      state.key = null;
      $("title").textContent = "ChordCue";
      $("artist").textContent = "Waiting for the Spotify app…";
      $("state").textContent = "";
      setStatus("waiting", `<div class="cc-msg"><p>Play a song in the Spotify desktop app and its chords show up here.</p></div>`);
      return;
    }
    clock.sync(np.position, np.playing);
    $("state").textContent = np.playing ? "Playing" : "Paused";
    $("state").className = "cp-state" + (np.playing ? " is-playing" : "");
    const key = `${np.artist}|${np.title}`;
    if (key !== state.key) {
      state.key = key;
      trackChanged(np);
    }
  }

  function frame() {
    requestAnimationFrame(frame);
    if (state.status === "ready" && !document.hidden) view.setTime(clock.now());
  }

  poll();
  setInterval(poll, POLL_MS);
  requestAnimationFrame(frame);
})();
