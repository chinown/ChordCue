// Runs in the page's own JavaScript world (manifest "world": "MAIN") so it can
// see players the page creates without adding them to the DOM (SoundCloud,
// Spotify) and YouTube's player API. It posts the playback state to the
// extension's content script and obeys seek requests. It reads only playback
// state and track metadata.
(() => {
  if (window.__chordcueHook) return;
  window.__chordcueHook = true;

  const TAG = "__chordcue__";
  const tracked = new Set();
  const isYouTube = /(^|\.)youtube\.com$/.test(location.hostname);

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    track(this);
    return origPlay.apply(this, args);
  };

  function track(el) {
    if (tracked.has(el)) return;
    tracked.add(el);
    for (const ev of ["play", "pause", "seeked", "ratechange", "loadedmetadata", "emptied"]) {
      el.addEventListener(ev, report, { passive: true });
    }
  }

  function ytPlayer() {
    return isYouTube ? document.getElementById("movie_player") : null;
  }

  function pickMedia() {
    const yt = ytPlayer();
    if (yt) {
      const v = yt.querySelector("video");
      if (v) return v;
    }
    document.querySelectorAll("video, audio").forEach(track);
    let best = null;
    for (const el of tracked) {
      if (!el.isConnected && el.paused && el.currentTime === 0) continue;
      const score = (el.paused ? 0 : 1000) + (Number.isFinite(el.duration) ? Math.min(el.duration, 900) : 0);
      if (!best || score > best.score) best = { el, score };
    }
    return best && best.el;
  }

  function ytInfo() {
    const p = ytPlayer();
    if (!p || typeof p.getVideoData !== "function") return null;
    try {
      const d = p.getVideoData();
      let category = null;
      if (typeof p.getPlayerResponse === "function") {
        const r = p.getPlayerResponse();
        category = r && r.microformat && r.microformat.playerMicroformatRenderer
          ? r.microformat.playerMicroformatRenderer.category : null;
      }
      return {
        videoId: d.video_id || null, title: d.title || "", author: d.author || "", category,
        ad: p.classList.contains("ad-showing"),
      };
    } catch {
      return null;
    }
  }

  function sessionMeta() {
    const m = navigator.mediaSession && navigator.mediaSession.metadata;
    return m ? { title: m.title || "", artist: m.artist || "", album: m.album || "" } : null;
  }

  function report() {
    const el = pickMedia();
    window.postMessage({
      [TAG]: "state",
      hasMedia: !!el,
      t: el ? el.currentTime : 0,
      paused: el ? el.paused : true,
      rate: el ? el.playbackRate : 1,
      duration: el && Number.isFinite(el.duration) ? el.duration : 0,
      at: performance.now(),
      meta: sessionMeta(),
      yt: ytInfo(),
    }, location.origin);
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data[TAG] !== "seek") return;
    const t = Number(e.data.t);
    if (!Number.isFinite(t)) return;
    const yt = ytPlayer();
    if (yt && typeof yt.seekTo === "function") {
      yt.seekTo(t, true);
    } else {
      const el = pickMedia();
      if (el) el.currentTime = t;
    }
    setTimeout(report, 50);
  });

  setInterval(report, 250);
})();
