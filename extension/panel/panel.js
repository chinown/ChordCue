// The ChordCue side panel: the extension's only interface. It follows the song
// in the active tab (or the last tab that had one), falling back to the
// Spotify desktop app through the local server, and analyzes whatever it
// finds straight away.
(() => {
  const CC = globalThis.CC;
  const GLOBAL_KEYS = ["instrument", "notation", "simple", "view"];
  const SONG_KEYS = ["transpose", "capo", "offset"];
  const DEFAULT_SERVER = "http://127.0.0.1:8765";
  const SUPPORTED = /^https:\/\/((www|m|music)\.youtube\.com|open\.spotify\.com|soundcloud\.com)\//;
  // Opened as a window (browsers without a side panel, and tests): follow one tab.
  const params = new URLSearchParams(location.search);
  const pinnedTab = params.has("tab") ? Number(params.get("tab")) : null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const api = (method, path, body) => chrome.runtime.sendMessage({ type: "api", method, path, body });
  const now = () => performance.timeOrigin + performance.now();

  $("logo").innerHTML = CC.ui.logo;
  $("gear").innerHTML = CC.ui.icon("gear");

  const view = new CC.ChordView($("view"), { onSettings: () => saveSettings() });

  // ------------------------------------------------------------ state

  const links = new Map(); // tabId -> {tabId, port, alive, site, info, playback}
  let windowId = null;
  let activeTabId = pinnedTab;
  let lastSongTabId = null;
  let desktop = null;          // last /api/now-playing reply with a title
  let serverUp = null;
  const song = { key: null, source: null, songId: null, sheet: null, status: "idle", request: null };
  let token = 0;

  // Desktop clock: the app reports position about once a second.
  const deskClock = {
    base: 0, at: now(), playing: false,
    time() { return this.playing ? this.base + (now() - this.at) / 1000 : this.base; },
    sync(t, playing) {
      if (playing !== this.playing || Math.abs(this.time() - t) > 0.4) {
        this.base = t;
        this.at = now();
        this.playing = playing;
      }
    },
  };

  // ------------------------------------------------------------ tab links

  async function injectInto(tabId) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return false;
    }
    if (!tab.url || !SUPPORTED.test(tab.url)) return false;
    try {
      // The tab was open before ChordCue was installed or reloaded.
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content/media-hook.js"], world: "MAIN" });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content/sites.js", "content/bridge.js"] });
      return true;
    } catch {
      return false;
    }
  }

  function openPort(link) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      let port;
      try {
        port = chrome.tabs.connect(link.tabId, { name: "chordcue" });
      } catch {
        return done(false);
      }
      port.onMessage.addListener((msg) => {
        if (!msg || msg.type !== "state") return;
        Object.assign(link, { port, alive: true, site: msg.site, info: msg.info, playback: msg.playback });
        if (msg.info) lastSongTabId = link.tabId;
        done(true);
        reselect();
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        const wasAlive = link.alive;
        link.alive = false;
        link.port = null;
        done(false);
        if (wasAlive) {
          links.delete(link.tabId);
          reselect();
        }
      });
      setTimeout(() => done(false), 1500);
    });
  }

  async function connect(tabId) {
    if (tabId == null) return;
    const existing = links.get(tabId);
    if (existing && (existing.alive || existing.connecting)) return;
    const link = { tabId, port: null, alive: false, connecting: true, site: null, info: null, playback: null };
    links.set(tabId, link);
    let ok = await openPort(link);
    if (!ok && (await injectInto(tabId))) ok = await openPort(link);
    link.connecting = false;
    if (!ok) {
      link.unsupported = true;
      link.supportedUrl = await isSupportedUrl(tabId);
    }
    reselect();
  }

  async function isSupportedUrl(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      return !!(tab.url && SUPPORTED.test(tab.url));
    } catch {
      return false;
    }
  }

  function dropUnusedLinks() {
    for (const [id, link] of links) {
      if (id !== activeTabId && id !== lastSongTabId) {
        if (link.port) link.port.disconnect();
        links.delete(id);
      }
    }
  }

  // ------------------------------------------------------------ what to follow

  function pickSource() {
    const active = links.get(activeTabId);
    if (active && active.alive && active.info) return { kind: "tab", link: active };
    const last = links.get(lastSongTabId);
    if (!pinnedTab && last && last.alive && last.info) return { kind: "tab", link: last };
    if (!pinnedTab && desktop && desktop.title) return { kind: "desktop" };
    return { kind: "none", link: active };
  }

  function sourceKey(src) {
    if (src.kind === "tab") return `tab:${src.link.tabId}:${src.link.info.key}`;
    if (src.kind === "desktop") return `desk:${desktop.artist}|${desktop.title}`;
    return "none";
  }

  function reselect() {
    const src = pickSource();
    const key = sourceKey(src);
    song.source = src;
    renderHeader();
    if (key !== song.key) {
      song.key = key;
      startSong(src);
    } else if (src.kind === "none") {
      showIdle(src);
    }
    $("view").classList.toggle("is-ad", src.kind === "tab" && !!src.link.info.ad);
  }

  // ------------------------------------------------------------ song lifecycle

  async function startSong(src) {
    const my = ++token;
    song.sheet = null;
    song.songId = null;
    view.onSeek = null;
    renderHeader();
    if (src.kind === "none") return showIdle(src);

    if (src.kind === "tab") {
      song.request = src.link.info.request;
      view.onSeek = src.link.site.canSeek ? (t) => seek(t) : null;
    } else {
      song.request = { title: desktop.title, artist: desktop.artist, duration: desktop.duration };
      view.onSeek = (t) => seek(t);
    }
    setStatus("loading", `<p class="cc-dim">Looking up this song…</p>`);
    const res = await api("POST", "/api/lookup", song.request);
    if (my !== token) return;
    if (!res.ok) return fail(res, my);
    if (res.data.cached) return openSong(res.data.song_id, my);
    analyze(false, my);
  }

  async function analyze(force, my = token) {
    setStatus("analyzing", progressHtml({ message: "Sending to the server", progress: 0 }));
    let res = await api("POST", "/api/analyze", { ...song.request, force });
    while (my === token) {
      if (!res.ok) return fail(res, my);
      const job = res.data;
      if (job.status === "done") return openSong(job.song_id, my);
      if (job.status === "error") {
        return setStatus("error", `<p><b>Couldn't get the chords.</b></p><p class="cc-dim">${esc(job.error)}</p>
          <button type="button" class="cc-btn" data-act="retry">Try again</button>`);
      }
      setStatus("analyzing", progressHtml(job));
      await new Promise((r) => setTimeout(r, 900));
      if (my !== token) return;
      res = await api("GET", `/api/jobs/${job.id}`);
    }
  }

  async function openSong(songId, my) {
    const res = await api("GET", `/api/songs/${songId}`);
    if (my !== token) return;
    if (!res.ok) return fail(res, my);
    song.songId = songId;
    song.sheet = res.data;
    const got = await chrome.storage.local.get(["settings", `song:${songId}`]);
    if (my !== token) return;
    view.setSheet(res.data, { ...(got.settings || {}), ...(got[`song:${songId}`] || {}) });
    setStatus("ready");
    renderHeader();
  }

  function fail(res, my) {
    if (my !== token) return;
    if (res.offline) {
      serverUp = false;
      renderDot();
      return startServer();
    }
    setStatus("error", `<p><b>Couldn't get the chords.</b></p><p class="cc-dim">${esc((res.data && res.data.detail) || `Server error ${res.status}`)}</p>
      <button type="button" class="cc-btn" data-act="retry">Try again</button>`);
  }

  // ------------------------------------------------------------ starting the server

  // The browser starts ChordCue through native messaging (chordcue/native_host.py)
  // the first time the panel needs it; it exits by itself once the panel closes.
  const NATIVE_HOST = "com.chordcue.launcher";
  let starting = false;
  let lastStart = 0;
  let startError = null;

  async function startServer({ force = false } = {}) {
    if (starting || (!force && Date.now() - lastStart < 15000)) {
      if (!starting && song.status !== "ready") setStatus("offline", offlineHtml());
      return;
    }
    starting = true;
    lastStart = Date.now();
    if (song.status !== "ready") {
      setStatus("starting", `<p><b>Starting ChordCue…</b></p><p class="cc-dim">This takes a few seconds.</p>`);
    }
    let reply;
    try {
      reply = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { cmd: "start" });
    } catch (e) {
      reply = { ok: false, error: String((e && e.message) || e) };
    }
    starting = false;
    if (reply && reply.ok) {
      startError = null;
      await checkServer();
      song.key = null;
      reselect();
      return;
    }
    startError = (reply && reply.error) || "Unknown error";
    if (song.status !== "ready") setStatus("offline", offlineHtml());
  }

  async function saveSettings() {
    const all = view.settings;
    const toSet = { settings: Object.fromEntries(GLOBAL_KEYS.map((k) => [k, all[k]])) };
    if (song.songId) toSet[`song:${song.songId}`] = Object.fromEntries(SONG_KEYS.map((k) => [k, all[k]]));
    await chrome.storage.local.set(toSet);
  }

  function seek(t) {
    const src = song.source;
    if (src.kind === "tab" && src.link.port) {
      src.link.port.postMessage({ type: "seek", t });
    } else if (src.kind === "desktop") {
      deskClock.base = t;
      deskClock.at = now();
      api("POST", "/api/now-playing/seek", { position: t });
    }
  }

  function playbackTime() {
    const src = song.source;
    if (src.kind === "desktop") return deskClock.time();
    if (src.kind !== "tab" || !src.link.playback) return 0;
    const p = src.link.playback;
    return p.playing ? p.t + ((now() - p.at) / 1000) * (p.rate || 1) : p.t;
  }

  // ------------------------------------------------------------ rendering

  function setStatus(status, html = "") {
    song.status = status;
    const ready = status === "ready";
    $("view").hidden = !ready;
    $("status").hidden = ready;
    if (!ready) $("status").innerHTML = `<div class="cc-msg">${html}</div>`;
  }

  function progressHtml(job) {
    const pct = Math.round((job.progress || 0) * 100);
    const queue = job.queue_position > 1 ? ` · ${job.queue_position - 1} ahead in line` : "";
    return `<p><b>${esc(job.message || "Starting")}</b><span class="cc-dim">${queue}</span></p>
      <div class="cc-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <p class="cc-dim">Listening for the chords. A new song takes about 20 seconds; after that it opens instantly.</p>`;
  }

  function offlineHtml() {
    const notSetUp = startError && /not found|not registered|forbidden/i.test(startError);
    if (notSetUp) {
      return `<p><b>ChordCue isn't set up on this computer yet.</b></p>
        <p>Run <code>Install-ChordCue.bat</code> (or <code>setup.bat</code> in the ChordCue folder) once, then click Retry.</p>
        <button type="button" class="cc-btn" data-act="start">Retry</button>`;
    }
    return `<p><b>ChordCue couldn't start.</b></p>
      ${startError ? `<p class="cc-dim">${esc(startError)}</p>` : ""}
      <p>Click Retry, or start it by hand with <code>start-server.bat</code> in the ChordCue folder.</p>
      <button type="button" class="cc-btn" data-act="start">Retry</button>`;
  }

  function showIdle(src) {
    const link = src && src.link;
    if (link && link.unsupported && link.supportedUrl) {
      return setStatus("idle", `<p>Reload this tab to connect ChordCue to it.</p>`);
    }
    if (serverUp === false) return startServer();
    setStatus("idle", `<p><b>Play a song and its chords show up here.</b></p>
      <p class="cc-dim">Works on YouTube, YouTube Music, Spotify and SoundCloud in this window, and with the Spotify desktop app.</p>`);
  }

  function renderHeader() {
    const src = song.source || { kind: "none" };
    let title = "ChordCue", sub = "", chip = "";
    if (song.sheet) {
      title = song.sheet.title;
      sub = song.sheet.artist;
    } else if (src.kind === "tab") {
      title = src.link.info.title || "Unknown song";
      sub = src.link.info.artist || "";
    } else if (src.kind === "desktop") {
      title = desktop.title;
      sub = desktop.artist;
    }
    if (src.kind === "tab") chip = src.link.site.label;
    if (src.kind === "desktop") chip = "Spotify app";
    $("title").textContent = title;
    $("subtitle").textContent = sub;
    $("source").textContent = chip;
    $("source").hidden = !chip;
  }

  function renderDot() {
    const dot = $("server-dot");
    dot.className = "pn-dot" + (serverUp === true ? " is-up" : serverUp === false ? " is-down" : "");
    dot.title = serverUp === true ? "Server running" : serverUp === false ? "Server not running" : "Checking server";
    $("server-line").textContent = serverUp === true ? "Running" : serverUp === false ? "Not running" : "Checking…";
  }

  // ------------------------------------------------------------ settings drawer

  $("gear").addEventListener("click", () => {
    const open = $("settings").hidden;
    $("settings").hidden = !open;
    $("gear").setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "retry") {
      song.key = null;
      reselect();
    } else if (btn.dataset.act === "start") {
      startServer({ force: true });
    } else if (btn.dataset.act === "reanalyze" && song.request) {
      token++;
      analyze(true, token);
    }
  });

  $("save-url").addEventListener("click", async () => {
    const note = $("url-note");
    let url;
    try {
      url = new URL($("server-url").value.trim());
    } catch {
      note.textContent = "That isn't a valid address.";
      return;
    }
    const isDefault = url.origin === new URL(DEFAULT_SERVER).origin;
    const granted = isDefault || (await chrome.permissions.request({ origins: [`${url.protocol}//${url.host}/*`] }).catch(() => false));
    if (!granted) {
      note.textContent = "Permission to reach that address was not granted.";
      return;
    }
    await chrome.storage.local.set({ serverUrl: url.origin });
    note.textContent = "Saved.";
    checkServer();
  });

  chrome.storage.local.get("serverUrl").then((got) => {
    $("server-url").value = got.serverUrl || DEFAULT_SERVER;
  });

  // ------------------------------------------------------------ polling & events

  async function checkServer() {
    const res = await api("GET", "/api/health");
    const up = !!res.ok;
    const changed = up !== serverUp;
    serverUp = up;
    renderDot();
    if (!up) return startServer();
    if (changed && (song.status === "offline" || song.status === "starting")) {
      song.key = null;
      reselect();
    }
  }

  async function pollDesktop() {
    const src = song.source;
    // Only ask the desktop when no tab is playing a song.
    if (pinnedTab || serverUp === false || (src && src.kind === "tab")) return;
    const res = await api("GET", "/api/now-playing");
    if (!res.ok) return;
    const np = res.data;
    desktop = np.title ? np : null;
    if (desktop) deskClock.sync(np.position, np.playing);
    reselect();
  }

  async function init() {
    if (pinnedTab == null) {
      const win = await chrome.windows.getCurrent();
      windowId = win.id;
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      activeTabId = tab ? tab.id : null;
      chrome.tabs.onActivated.addListener(({ tabId, windowId: w }) => {
        if (w !== windowId) return;
        activeTabId = tabId;
        dropUnusedLinks();
        connect(tabId);
        reselect();
      });
    }
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      if (change.status !== "complete" || (tabId !== activeTabId && tabId !== lastSongTabId)) return;
      const link = links.get(tabId);
      if (!link || !link.alive) {
        links.delete(tabId);
        connect(tabId);
      }
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
      links.delete(tabId);
      if (tabId === lastSongTabId) lastSongTabId = null;
      reselect();
    });

    renderDot();
    await checkServer();
    await connect(activeTabId);
    reselect();
    setInterval(checkServer, 5000);
    setInterval(pollDesktop, 1000);
    pollDesktop();
  }

  function frame() {
    requestAnimationFrame(frame);
    if (song.status === "ready" && !document.hidden) view.setTime(playbackTime());
  }

  init();
  requestAnimationFrame(frame);
})();
