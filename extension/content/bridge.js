// Content script with no UI: while the ChordCue side panel is connected to
// this tab, report which song is playing and where playback is (four times a
// second), and carry out seek requests. Idle otherwise.
(() => {
  if (window.top !== window || window.__chordcueBridge) return;
  window.__chordcueBridge = true;

  const site = globalThis.CC.sites.current();
  if (!site) return;
  const clock = globalThis.CC.sites.clockFor(site);

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "chordcue") return;

    function send() {
      let info = null;
      try {
        info = site.identify();
      } catch {
        /* page is mid-navigation */
      }
      const raw = clock.state ? clock.state() : null;
      try {
        port.postMessage({
          type: "state",
          site: { id: site.id, label: site.label, canSeek: site.canSeek },
          info,
          playback: {
            t: clock.time(),
            playing: clock.playing(),
            ready: clock.ready(),
            rate: (raw && raw.rate) || 1,
            // Wall-clock time of this reading, so the panel can extrapolate.
            at: performance.timeOrigin + performance.now(),
          },
        });
      } catch {
        stop();
      }
    }

    const timer = setInterval(send, 250);
    const stop = () => clearInterval(timer);
    send();

    port.onMessage.addListener((msg) => {
      if (msg && msg.type === "seek" && site.canSeek && Number.isFinite(msg.t)) {
        clock.seek(msg.t);
        setTimeout(send, 80);
      }
    });
    port.onDisconnect.addListener(stop);
  });
})();
