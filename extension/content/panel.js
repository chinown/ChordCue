// The in-page panel: finds the song playing on this page, gets its chords from
// the local server (analyzing it first if needed) and runs the live view in
// step with the page's player.
(() => {
  if (window.top !== window || window.__chordcuePanel) return;
  window.__chordcuePanel = true;

  const CC = globalThis.CC;
  const site = CC.sites.current();
  if (!site) return;
  const clock = CC.sites.clockFor(site);

  const GLOBAL_KEYS = ["instrument", "notation", "simple", "view"];
  const SONG_KEYS = ["transpose", "capo", "offset"];

  const state = {
    info: null,       // what identify() returned for the current song
    songId: null,
    sheet: null,
    status: "idle",   // idle | offline | ask | analyzing | ready | error
    job: null,
    error: null,
    hidden: false,    // closed by the user for this page
    minimized: false,
    pos: null,
  };
  let token = 0; // bumps on every song change so stale async work can bail out

  // ------------------------------------------------------------ chrome APIs

  function alive() {
    try {
      return !!chrome.runtime.id;
    } catch {
      return false;
    }
  }

  async function api(method, path, body) {
    if (!alive()) return { ok: false, offline: true, error: "Extension was reloaded; refresh the page." };
    try {
      return await chrome.runtime.sendMessage({ type: "api", method, path, body });
    } catch (e) {
      return { ok: false, offline: true, error: String(e) };
    }
  }

  const store = {
    async get(keys) {
      if (!alive()) return {};
      try { return await chrome.storage.local.get(keys); } catch { return {}; }
    },
    async set(obj) {
      if (!alive()) return;
      try { await chrome.storage.local.set(obj); } catch { /* storage unavailable */ }
    },
  };

  // ------------------------------------------------------------ DOM

  const host = document.createElement("chordcue-panel");
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483000; top: 0; left: 0; width: 0; height: 0;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <link rel="stylesheet" href="${chrome.runtime.getURL("shared/view.css")}">
    <link rel="stylesheet" href="${chrome.runtime.getURL("content/panel.css")}">
    <section class="cc-theme cc-panel" hidden aria-label="ChordCue chords">
      <header class="cc-head">
        <span class="cc-logo" aria-hidden="true">${CC.ui.logo}</span>
        <span class="cc-song"><b class="cc-title"></b><span class="cc-artist"></span></span>
        <button type="button" class="cc-hbtn" data-act="min" title="Shrink to a pill" aria-label="Minimize">${CC.ui.icon("min")}</button>
        <button type="button" class="cc-hbtn" data-act="close" title="Hide on this page (Alt+Shift+C brings it back)" aria-label="Close">${CC.ui.icon("close")}</button>
      </header>
      <div class="cc-body">
        <div class="cc-status" hidden></div>
        <div class="cc-viewhost" hidden></div>
      </div>
    </section>
    <button type="button" class="cc-theme cc-pill" hidden title="Open ChordCue">
      <span class="cc-logo" aria-hidden="true">${CC.ui.logo}</span>
      <b class="cc-pill-now">—</b><span class="cc-pill-arrow">›</span><span class="cc-pill-next"></span>
    </button>`;

  const $ = (sel) => shadow.querySelector(sel);
  const panel = $(".cc-panel");
  const pill = $(".cc-pill");
  const statusEl = $(".cc-status");
  const viewHost = $(".cc-viewhost");
  const view = new CC.ChordView(viewHost, {
    onSeek: site.canSeek ? (t) => clock.seek(t) : null,
    onSettings: (patch) => saveSettings(patch),
  });

  function mount() {
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }
  document.addEventListener("fullscreenchange", mount);

  // ------------------------------------------------------------ layout & drag

  function placePanel() {
    const w = panel.offsetWidth || 372;
    const maxX = window.innerWidth - Math.min(w, window.innerWidth) - 8;
    const pos = state.pos || { x: window.innerWidth - w - 18, y: 70 };
    const x = Math.max(8, Math.min(pos.x, maxX));
    const y = Math.max(8, Math.min(pos.y, window.innerHeight - 80));
    panel.style.transform = `translate(${x}px, ${y}px)`;
    panel.style.maxHeight = `${window.innerHeight - y - 12}px`;
    pill.style.transform = `translate(${Math.max(8, Math.min(x + w - 150, window.innerWidth - 160))}px, ${y}px)`;
  }
  window.addEventListener("resize", placePanel);

  $(".cc-head").addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const head = e.currentTarget;
    const m = panel.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    const start = { x: e.clientX, y: e.clientY, px: m ? +m[1] : 0, py: m ? +m[2] : 0 };
    head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      state.pos = { x: start.px + ev.clientX - start.x, y: start.py + ev.clientY - start.y };
      placePanel();
    };
    const up = () => {
      head.removeEventListener("pointermove", move);
      head.removeEventListener("pointerup", up);
      store.set({ panelPos: state.pos });
    };
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up);
  });

  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "min") setMinimized(true);
    else if (act === "close") { state.hidden = true; render(); }
    else if (act === "analyze") analyze(false);
    else if (act === "reanalyze") analyze(true);
    else if (act === "retry") songChanged(state.info, true);
  });
  pill.addEventListener("click", () => setMinimized(false));

  function setMinimized(v) {
    state.minimized = v;
    store.set({ panelMinimized: v });
    render();
  }

  // ------------------------------------------------------------ rendering

  function render() {
    mount();
    const show = !!state.info && !state.hidden;
    panel.hidden = !show || state.minimized;
    pill.hidden = !show || !state.minimized;
    if (!show) return;

    const info = state.info;
    $(".cc-title").textContent = (state.sheet && state.sheet.title) || info.title || "Unknown song";
    $(".cc-artist").textContent = (state.sheet && state.sheet.artist) || info.artist || "";

    const ready = state.status === "ready";
    viewHost.hidden = !ready;
    statusEl.hidden = ready;
    if (!ready) statusEl.innerHTML = statusHtml();
    panel.dataset.state = state.status;
    placePanel();
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function statusHtml() {
    switch (state.status) {
      case "offline":
        return `<div class="cc-msg">
          <p><b>The ChordCue server isn't running.</b></p>
          <p>Start it by double-clicking <code>start-server.bat</code> in the project folder, then retry.</p>
          <button type="button" class="cc-btn" data-act="retry">Retry</button></div>`;
      case "ask":
        return `<div class="cc-msg">
          <p>Want the chords for this video?</p>
          <p class="cc-dim">Takes about 20 seconds the first time; after that it opens instantly.</p>
          <button type="button" class="cc-btn cc-btn-primary" data-act="analyze">Get chords</button></div>`;
      case "analyzing": {
        const job = state.job || {};
        const pct = Math.round((job.progress || 0) * 100);
        const queue = job.queue_position > 1 ? ` · ${job.queue_position - 1} ahead in line` : "";
        return `<div class="cc-msg">
          <p><b>${esc(job.message || "Starting")}</b><span class="cc-dim">${queue}</span></p>
          <div class="cc-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
          <p class="cc-dim">Listening for the chords. First songs take longer while models load.</p></div>`;
      }
      case "error":
        return `<div class="cc-msg">
          <p><b>Couldn't get the chords.</b></p>
          <p class="cc-dim">${esc(state.error || "Unknown error")}</p>
          <button type="button" class="cc-btn" data-act="retry">Try again</button></div>`;
      default:
        return `<div class="cc-msg"><p class="cc-dim">Looking up this song…</p></div>`;
    }
  }

  // ------------------------------------------------------------ settings

  async function loadSettings(songId) {
    const got = await store.get(["settings", `song:${songId}`, "panelPos", "panelMinimized"]);
    if (got.panelPos) state.pos = got.panelPos;
    if (typeof got.panelMinimized === "boolean") state.minimized = got.panelMinimized;
    return { ...(got.settings || {}), ...(got[`song:${songId}`] || {}) };
  }

  async function saveSettings(patch) {
    const all = view.settings;
    const globalPart = Object.fromEntries(GLOBAL_KEYS.map((k) => [k, all[k]]));
    const songPart = Object.fromEntries(SONG_KEYS.map((k) => [k, all[k]]));
    const toSet = { settings: globalPart };
    if (state.songId) toSet[`song:${state.songId}`] = songPart;
    if (Object.keys(patch).length) await store.set(toSet);
  }

  // ------------------------------------------------------------ song lifecycle

  async function songChanged(info, force = false) {
    const my = ++token;
    state.info = info;
    state.sheet = null;
    state.songId = info ? info.songId || null : null;
    state.job = null;
    state.error = null;
    if (!info) {
      state.status = "idle";
      render();
      return;
    }
    state.status = "idle";
    render();

    const res = await api("POST", "/api/lookup", info.request);
    if (my !== token) return;
    if (!res.ok) return fail(res);
    if (res.data.cached) return openSong(res.data.song_id, my);

    const prefs = (await store.get("autoAnalyze")).autoAnalyze || "music";
    const auto = prefs === "always" || (prefs === "music" && info.music === true);
    if (auto || force) return analyze(false);
    state.status = "ask";
    render();
  }

  function fail(res) {
    if (res.offline) {
      state.status = "offline";
    } else {
      state.status = "error";
      state.error = (res.data && res.data.detail) || `Server error ${res.status}`;
    }
    render();
  }

  async function analyze(force) {
    const my = token;
    state.status = "analyzing";
    state.job = { message: "Sending to the server", progress: 0 };
    render();
    let res = await api("POST", "/api/analyze", { ...state.info.request, force });
    while (my === token) {
      if (!res.ok) return fail(res);
      const job = res.data;
      if (job.status === "done") return openSong(job.song_id, my);
      if (job.status === "error") {
        state.status = "error";
        state.error = job.error;
        return render();
      }
      state.job = job;
      render();
      await new Promise((r) => setTimeout(r, 900));
      if (my !== token) return;
      res = await api("GET", `/api/jobs/${job.id}`);
    }
  }

  async function openSong(songId, my) {
    const res = await api("GET", `/api/songs/${songId}`);
    if (my !== token) return;
    if (!res.ok) return fail(res);
    state.songId = songId;
    state.sheet = res.data;
    const settings = await loadSettings(songId);
    if (my !== token) return;
    view.setSheet(res.data, settings);
    state.status = "ready";
    render();
  }

  // ------------------------------------------------------------ loops

  let lastKey = null;
  async function poll() {
    const info = site.identify();
    const key = info ? info.key : null;
    if (key !== lastKey) {
      lastKey = key;
      // A brand-new page view: forget a "closed" from the previous song.
      state.hidden = false;
      if (!state.pos) {
        const got = await store.get(["panelPos", "panelMinimized"]);
        if (got.panelPos) state.pos = got.panelPos;
        if (typeof got.panelMinimized === "boolean") state.minimized = got.panelMinimized;
      }
      songChanged(info);
    } else if (info && state.info) {
      // YouTube reports the category a moment after navigation.
      const wasUnknown = state.info.music == null && info.music != null;
      state.info = { ...state.info, ...info };
      if (wasUnknown && info.music && state.status === "ask") analyze(false);
    }
    panel.classList.toggle("is-ad", !!(info && info.ad));
  }
  setInterval(poll, 800);
  poll();

  function frame() {
    requestAnimationFrame(frame);
    if (state.status !== "ready" || state.hidden || document.hidden) return;
    const t = clock.time();
    if (!state.minimized) {
      view.setTime(t);
    } else {
      updatePill(t);
    }
  }
  requestAnimationFrame(frame);

  function updatePill(rawT) {
    const sheet = state.sheet;
    const st = view.settings;
    const t = rawT + st.offset;
    const tl = sheet.chords;
    let i = tl.length - 1;
    while (i >= 0 && tl[i].start > t) i--;
    let n = i + 1;
    while (n < tl.length && !tl[n].chord) n++;
    const flats = CC.theory.useFlats(sheet.key, st);
    const name = (c) => CC.theory.chordName(CC.theory.shape(c, st), flats);
    $(".cc-pill-now").textContent = i >= 0 && tl[i].chord ? name(tl[i].chord) : "—";
    $(".cc-pill-next").textContent = n < tl.length ? name(tl[n].chord) : "";
  }

  // Toolbar popup / keyboard shortcut.
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "toggle-panel") {
      if (state.hidden || state.minimized) {
        state.hidden = false;
        setMinimized(false);
      } else {
        state.hidden = true;
        render();
      }
      reply({ visible: !state.hidden });
    } else if (msg.type === "panel-status") {
      reply({
        site: site.label,
        song: state.info ? { title: state.info.title, artist: state.info.artist } : null,
        status: state.status,
        visible: !!state.info && !state.hidden,
      });
    }
  });
})();
