// Site adapters: which song is playing on this page, and where playback is.
//
// Each adapter's identify() returns null (no song here) or
//   {key, request, songId?, title, artist, duration, music}
// where `request` is what the server's /api/analyze takes and `music` says
// whether to analyze without asking. Playback comes from media-hook.js,
// which posts the page player's state about four times a second.
(() => {
  const CC = (globalThis.CC = globalThis.CC || {});
  const TAG = "__chordcue__";

  // ------------------------------------------------------------ clock

  const hook = { state: null, receivedAt: 0 };
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data[TAG] !== "state") return;
    hook.state = e.data;
    hook.receivedAt = performance.now();
  });

  const clock = {
    // Seconds into the track, extrapolated between hook updates.
    time() {
      const s = hook.state;
      if (!s) return 0;
      if (s.paused) return s.t;
      return s.t + ((performance.now() - s.at) / 1000) * (s.rate || 1);
    },
    playing() {
      return !!(hook.state && !hook.state.paused);
    },
    ready() {
      return !!(hook.state && hook.state.hasMedia) && performance.now() - hook.receivedAt < 2000;
    },
    seek(t) {
      window.postMessage({ [TAG]: "seek", t }, location.origin);
    },
    state() {
      return hook.state;
    },
  };

  const text = (sel, root = document) => {
    const el = root.querySelector(sel);
    return el ? el.textContent.trim() : "";
  };

  const parseClock = (s) => {
    const parts = (s || "").trim().split(":").map(Number);
    if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  };

  // ------------------------------------------------------------ YouTube

  function youtubeVideoId() {
    const u = new URL(location.href);
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/);
    return m ? m[1] : null;
  }

  const youtube = {
    id: "youtube",
    label: "YouTube",
    canSeek: true,
    matches: () => /^(www|m)\.youtube\.com$/.test(location.hostname),
    identify() {
      const s = hook.state;
      const yt = s && s.yt;
      const vid = youtubeVideoId();
      if (!vid) return null;
      // The player can lag behind the URL right after navigating.
      const fresh = yt && yt.videoId === vid;
      return {
        key: `yt:${vid}`,
        songId: `yt-${vid}`,
        request: { url: `https://www.youtube.com/watch?v=${vid}` },
        title: (fresh && yt.title) || text("ytd-watch-metadata h1") || document.title.replace(/ - YouTube$/, ""),
        artist: (fresh && yt.author) || text("ytd-watch-metadata ytd-channel-name a"),
        music: fresh ? yt.category === "Music" : null,
        ad: !!(fresh && yt.ad),
      };
    },
  };

  // ------------------------------------------------------------ YouTube Music

  const ytmusic = {
    id: "ytmusic",
    label: "YouTube Music",
    canSeek: true,
    matches: () => location.hostname === "music.youtube.com",
    identify() {
      const s = hook.state;
      const yt = s && s.yt;
      // The URL only carries the id while the full player is open, so prefer the player's own data.
      const vid = (yt && yt.videoId) || youtubeVideoId();
      if (!vid) return null;
      const bar = document.querySelector("ytmusic-player-bar");
      const byline = bar ? text(".byline", bar).split("•")[0].trim() : "";
      return {
        key: `yt:${vid}`,
        songId: `yt-${vid}`,
        request: { url: `https://www.youtube.com/watch?v=${vid}` },
        title: (bar && text(".title", bar)) || (yt && yt.title) || "",
        artist: byline || (yt && yt.author) || "",
        music: true,
        ad: !!(yt && yt.ad),
      };
    },
  };

  // ------------------------------------------------------------ Spotify Web Player

  function spotifyTrackId() {
    const widget = document.querySelector('[data-testid="now-playing-widget"]') || document.querySelector("footer");
    if (!widget) return null;
    for (const a of widget.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      let m = href.match(/\/track\/([A-Za-z0-9]{22})/);
      if (m) return m[1];
      m = href.match(/spotify(?::|%3A)track(?::|%3A)([A-Za-z0-9]{22})/);
      if (m) return m[1];
    }
    return null;
  }

  const spotify = {
    id: "spotify",
    label: "Spotify",
    canSeek: false, // Spotify's player doesn't follow outside seeks
    matches: () => location.hostname === "open.spotify.com",
    identify() {
      const meta = hook.state && hook.state.meta;
      const widget = document.querySelector('[data-testid="now-playing-widget"]');
      const title = (meta && meta.title) || (widget && text('[data-testid="context-item-link"]', widget)) || "";
      const artist = (meta && meta.artist) || (widget && text('[data-testid="context-item-info-artist"]', widget)) || "";
      if (!title) return null;
      const duration = parseClock(text('[data-testid="playback-duration"]')) || (hook.state && hook.state.duration) || 0;
      const tid = spotifyTrackId();
      return {
        key: tid ? `sp:${tid}` : `q:${artist}|${title}`,
        request: tid ? { url: `https://open.spotify.com/track/${tid}` } : { title, artist, duration },
        title, artist, duration,
        music: true,
      };
    },
  };

  // Spotify sometimes plays through an element we can't see; fall back to its
  // on-screen position, which ticks once a second.
  const spotifyDomClock = {
    last: null, base: 0, baseAt: 0,
    time() {
      const shown = parseClock(text('[data-testid="playback-position"]'));
      const now = performance.now();
      if (shown == null) return this.base;
      if (shown !== this.last) {
        // The display just ticked: we're at the start of that second.
        this.last = shown;
        this.base = shown;
        this.baseAt = now;
      }
      return this.playing() ? this.base + Math.min(1, (now - this.baseAt) / 1000) : this.base;
    },
    playing() {
      const btn = document.querySelector('[data-testid="control-button-playpause"]');
      const label = btn ? (btn.getAttribute("aria-label") || "").toLowerCase() : "";
      return label.includes("pause") || label.includes("pausar");
    },
    ready: () => !!document.querySelector('[data-testid="playback-position"]'),
    seek() {},
  };

  // ------------------------------------------------------------ SoundCloud

  const soundcloud = {
    id: "soundcloud",
    label: "SoundCloud",
    canSeek: true,
    matches: () => location.hostname === "soundcloud.com",
    identify() {
      const link = document.querySelector("a.playbackSoundBadge__titleLink");
      if (!link) return null;
      const path = new URL(link.getAttribute("href"), location.origin).pathname.replace(/\/$/, "");
      const meta = hook.state && hook.state.meta;
      return {
        key: `sc:${path.toLowerCase()}`,
        request: { url: `https://soundcloud.com${path}` },
        title: (meta && meta.title) || link.getAttribute("title") || text("span[aria-hidden]", link),
        artist: (meta && meta.artist) || text("a.playbackSoundBadge__lightLink"),
        music: true,
      };
    },
  };

  const ALL = [youtube, ytmusic, spotify, soundcloud];

  CC.sites = {
    current: () => ALL.find((s) => s.matches()) || null,
    clockFor(site) {
      if (site.id !== "spotify") return clock;
      // Prefer the real media element; use the on-screen clock if the hook can't see one.
      return {
        time: () => (clock.ready() ? clock.time() : spotifyDomClock.time()),
        playing: () => (clock.ready() ? clock.playing() : spotifyDomClock.playing()),
        ready: () => clock.ready() || spotifyDomClock.ready(),
        seek() {},
      };
    },
  };
})();
