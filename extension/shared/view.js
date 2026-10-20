// The play-along view: current + next chord cards, a sliding chord lane, a
// bar chart of the whole song, and the transpose/capo/instrument controls.
//
//   const view = new CC.ChordView(element, { onSeek, onSettings });
//   view.setSheet(sheet, settings);   // settings: see DEFAULTS
//   view.setTime(seconds);            // call every animation frame
(() => {
  const CC = (globalThis.CC = globalThis.CC || {});
  const T = CC.theory;
  const D = CC.diagrams;

  const DEFAULTS = {
    instrument: "guitar", // guitar | ukulele | piano
    notation: "auto",     // auto | sharp | flat
    simple: false,
    view: "live",         // live | chart
    transpose: 0,
    capo: 0,
    offset: 0,            // seconds added to the player's time
  };
  const LANE_PX_PER_S = 46;
  const BARS_PER_ROW = 4;

  function bsearch(arr, t, key) {
    // Index of the last element whose key <= t, or -1.
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (key(arr[mid]) <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  class ChordView {
    constructor(el, { onSeek = null, onSettings = null } = {}) {
      this.el = el;
      this.onSeek = onSeek;
      this.onSettings = onSettings;
      this.settings = { ...DEFAULTS };
      this.sheet = null;
      this.cur = -2;
      this.beatIdx = -2;
      this.barIdx = -2;
      this.variants = {};
      this.lastUserScroll = 0;
      this.el.classList.add("cc-view");
      this.el.addEventListener("click", (e) => this._onClick(e));
      this.el.addEventListener("change", (e) => this._onChange(e));
    }

    setSheet(sheet, settings = {}) {
      this.sheet = sheet;
      this.settings = { ...DEFAULTS, ...settings };
      this.timeline = sheet.chords;
      this.beats = sheet.beats || [];
      this.bars = this._computeBars();
      this.cur = this.beatIdx = this.barIdx = -2;
      this._render();
    }

    updateSettings(patch, { silent = false } = {}) {
      this.settings = { ...this.settings, ...patch };
      if (!silent && this.onSettings) this.onSettings(patch, this.settings);
      this.cur = this.beatIdx = this.barIdx = -2;
      this._render();
      if (this.lastTime != null) this.setTime(this.lastTime);
    }

    // ------------------------------------------------------------ derived data

    _shape(chord) {
      return T.shape(chord, this.settings);
    }

    _flats() {
      return T.useFlats(this.sheet.key, this.settings);
    }

    _name(chord) {
      return T.chordName(this._shape(chord), this._flats());
    }

    _nameHtml(chord) {
      const p = T.chordParts(this._shape(chord), this._flats());
      return `<span class="cc-root">${p.root}</span><span class="cc-suffix">${p.suffix}</span>`;
    }

    _computeBars() {
      const s = this.sheet;
      let db = (s.downbeats || []).slice();
      const dur = s.duration;
      if (db.length < 2) {
        const step = (60 / (s.bpm || 100)) * (s.beats_per_bar || 4);
        db = [];
        for (let t = 0; t < dur; t += step) db.push(t);
      }
      const barLen = (db[db.length - 1] - db[0]) / Math.max(1, db.length - 1);
      const starts = [];
      for (let t = db[0] - barLen; t > -barLen * 0.5; t -= barLen) starts.unshift(Math.max(0, t));
      starts.push(...db);
      for (let t = db[db.length - 1] + barLen; t < dur; t += barLen) starts.push(t);
      const beatLen = barLen / (s.beats_per_bar || 4);
      const tl = this.timeline;
      const bars = [];
      for (let i = 0; i < starts.length; i++) {
        const start = starts[i], end = i + 1 < starts.length ? starts[i + 1] : Math.min(dur, start + barLen);
        const items = [];
        const first = bsearch(tl, start + 0.05, (x) => x.start);
        if (first >= 0) items.push(first);
        for (let k = Math.max(first + 1, 0); k < tl.length && tl[k].start < end - beatLen * 0.3; k++) {
          if (tl[k].start > start + 0.05) items.push(k);
        }
        bars.push({ start, end, items });
      }
      // Drop silent bars before the first chord and after the last one.
      const voiced = (b) => b.items.some((k) => tl[k].chord);
      while (bars.length && !voiced(bars[0])) bars.shift();
      while (bars.length && !voiced(bars[bars.length - 1])) bars.pop();
      return bars;
    }

    _distinct() {
      const seen = new Map();
      for (const seg of this.timeline) {
        if (!seg.chord) continue;
        const sh = this._shape(seg.chord);
        const k = `${sh.root}:${sh.q}`;
        if (!seen.has(k)) seen.set(k, { chord: seg.chord, time: 0 });
        seen.get(k).time += seg.end - seg.start;
      }
      return [...seen.values()];
    }

    // ------------------------------------------------------------ rendering

    _render() {
      const s = this.sheet;
      if (!s) return;
      const st = this.settings;
      const flats = this._flats();
      const soundingKey = T.keyName(T.mod12(s.key.tonic + st.transpose), s.key.mode, T.useFlats(s.key, { ...st, capo: 0 }));
      const shapeKey = T.keyName(T.mod12(s.key.tonic + st.transpose - st.capo), s.key.mode, flats);
      const suggestion = T.suggestCapo(this.timeline, st.transpose);
      const distinct = this._distinct();
      const changes = this.timeline.filter((x) => x.chord).length;
      const seekable = this.onSeek ? " cc-seekable" : "";

      const seg = (name, value, options) =>
        `<div class="cc-seg" role="radiogroup">${options.map(([v, label]) =>
          `<button type="button" data-set="${name}" data-value="${v}" class="${String(st[name]) === String(v) ? "is-on" : ""}" aria-pressed="${String(st[name]) === String(v)}">${label}</button>`).join("")}</div>`;

      this.el.innerHTML = `
        <div class="cc-meta">
          <span>Key <b>${soundingKey}</b>${st.capo ? ` · capo ${st.capo} (${shapeKey} shapes)` : ""}</span>
          <span>${s.bpm ? Math.round(s.bpm) + " BPM · " : ""}${distinct.length} chords · ${changes} changes</span>
        </div>
        ${st.view === "live" ? this._liveHtml(seekable) : this._chartHtml(seekable)}
        <div class="cc-controls">
          <div class="cc-row">
            ${seg("view", st.view, [["live", "Live"], ["chart", "Chart"]])}
            ${seg("instrument", st.instrument, [["guitar", "Guitar"], ["ukulele", "Uke"], ["piano", "Piano"]])}
          </div>
          <div class="cc-row">
            <div class="cc-stepper" title="Transpose (semitones)">
              <span class="cc-lbl">Transpose</span>
              <button type="button" data-act="transpose" data-d="-1" aria-label="Transpose down">−</button>
              <b>${st.transpose > 0 ? "+" : ""}${st.transpose}</b>
              <button type="button" data-act="transpose" data-d="1" aria-label="Transpose up">+</button>
            </div>
            <label class="cc-capo" title="Capo fret">
              <span class="cc-lbl">Capo</span>
              <select data-set="capo">${Array.from({ length: 10 }, (_, i) => `<option value="${i}" ${i === st.capo ? "selected" : ""}>${i === 0 ? "None" : i}</option>`).join("")}</select>
            </label>
            ${suggestion !== st.capo && st.instrument === "guitar" ? `<button type="button" class="cc-chip" data-set="capo" data-value="${suggestion}" title="Easiest shapes for this song">Try capo ${suggestion || "off"}</button>` : ""}
          </div>
          <div class="cc-row">
            ${seg("notation", st.notation, [["auto", "Auto"], ["sharp", "♯"], ["flat", "♭"]])}
            <button type="button" class="cc-toggle ${st.simple ? "is-on" : ""}" data-act="simple" aria-pressed="${st.simple}" title="Show plain major/minor chords">Simple chords</button>
            <div class="cc-stepper cc-offset" title="Shift the chords if they run early or late">
              <span class="cc-lbl">Sync</span>
              <button type="button" data-act="offset" data-d="-0.1" aria-label="Chords earlier">−</button>
              <b>${st.offset > 0 ? "+" : ""}${st.offset.toFixed(1)}s</b>
              <button type="button" data-act="offset" data-d="0.1" aria-label="Chords later">+</button>
            </div>
          </div>
        </div>
        <div class="cc-palette-wrap">
          <div class="cc-section-title">Chords in this song</div>
          <div class="cc-palette${st.instrument === "piano" ? " is-piano" : ""}">${distinct.sort((a, b) => b.time - a.time).map(({ chord }) => {
            const sh = this._shape(chord);
            const k = `${sh.root}:${sh.q}`;
            return `<button type="button" class="cc-pal" data-variant="${k}" title="Click for another shape">
              <span class="cc-pal-name">${this._nameHtml(chord)}</span>
              ${D.diagram(sh, st.instrument, { variant: this.variants[k] || 0, size: 0.72 })}
            </button>`;
          }).join("")}</div>
        </div>`;

      this.refs = {
        now: this.el.querySelector(".cc-now"),
        next: this.el.querySelector(".cc-next"),
        track: this.el.querySelector(".cc-lane-track"),
        lane: this.el.querySelector(".cc-lane"),
        chart: this.el.querySelector(".cc-chart"),
        clock: this.el.querySelector(".cc-clock"),
      };
      if (this.refs.chart) {
        this.refs.chart.addEventListener("wheel", () => (this.lastUserScroll = performance.now()), { passive: true });
        this.refs.chart.addEventListener("touchmove", () => (this.lastUserScroll = performance.now()), { passive: true });
      }
    }

    _liveHtml(seekable) {
      const per = this.sheet.beats_per_bar || 4;
      const blocks = this.timeline.map((seg, i) => {
        const w = Math.max(2, (seg.end - seg.start) * LANE_PX_PER_S - 2);
        const x = seg.start * LANE_PX_PER_S;
        return `<div class="cc-block ${seg.chord ? "" : "cc-block-nc"}" data-ci="${i}" data-t="${seg.start}" style="left:${x}px;width:${w}px">${seg.chord && w > 18 ? this._nameHtml(seg.chord) : ""}</div>`;
      }).join("");
      const ticks = this.bars.map((b) => `<i class="cc-tick" style="left:${b.start * LANE_PX_PER_S}px"></i>`).join("");
      return `
        <div class="cc-live">
          <div class="cc-cards">
            <div class="cc-card cc-now">
              <div class="cc-card-head"><span>Now</span><span class="cc-clock"></span></div>
              <div class="cc-name"></div>
              <div class="cc-diagram"></div>
              <div class="cc-beats">${"<i></i>".repeat(per)}</div>
            </div>
            <div class="cc-card cc-next">
              <div class="cc-card-head"><span>Next</span><span class="cc-count"></span></div>
              <div class="cc-name"></div>
              <div class="cc-diagram"></div>
              <div class="cc-countbar"><i></i></div>
            </div>
          </div>
          <div class="cc-lane${seekable}" title="${seekable ? "Click to jump" : ""}">
            <div class="cc-lane-track">${ticks}${blocks}</div>
            <div class="cc-playhead"></div>
          </div>
        </div>`;
    }

    _chartHtml(seekable) {
      const tl = this.timeline;
      const rows = [];
      for (let i = 0; i < this.bars.length; i += BARS_PER_ROW) {
        const cells = this.bars.slice(i, i + BARS_PER_ROW).map((b, j) => {
          const names = b.items
            .filter((k, n) => tl[k].chord || b.items.length === 1)
            .map((k) => `<span class="cc-bar-chord" data-ci="${k}">${tl[k].chord ? this._nameHtml(tl[k].chord) : "N.C."}</span>`)
            .join("");
          return `<div class="cc-bar${seekable}" data-bar="${i + j}" data-t="${b.start}">${names}</div>`;
        }).join("");
        rows.push(`<div class="cc-bar-row"><span class="cc-bar-time">${fmtTime(this.bars[i].start)}</span>${cells}</div>`);
      }
      return `<div class="cc-chart">${rows.join("")}</div>`;
    }

    // ------------------------------------------------------------ time updates

    setTime(rawT) {
      if (!this.sheet || !this.refs) return;
      this.lastTime = rawT;
      const t = rawT + this.settings.offset;
      const tl = this.timeline;
      const cur = bsearch(tl, t, (x) => x.start);
      if (this.refs.track) {
        const laneW = this.refs.lane.clientWidth;
        const x = laneW * 0.28 - t * LANE_PX_PER_S;
        this.refs.track.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
      }
      if (this.refs.clock) this.refs.clock.textContent = fmtTime(Math.max(0, rawT));
      if (cur !== this.cur) {
        this._setCurrent(cur);
        this.cur = cur;
      }
      this._updateBeats(t, cur);
      if (this.refs.chart) this._updateChart(t);
    }

    _setCurrent(cur) {
      const tl = this.timeline;
      const st = this.settings;
      const curSeg = tl[cur];
      // Next sounding chord (skip no-chord gaps).
      let nxt = cur + 1;
      while (nxt < tl.length && !tl[nxt].chord) nxt++;
      this.nextIdx = nxt < tl.length ? nxt : -1;
      if (this.refs.now) {
        const chord = curSeg && curSeg.chord;
        this.refs.now.querySelector(".cc-name").innerHTML = chord ? this._nameHtml(chord) : (cur < 0 ? "—" : "N.C.");
        this.refs.now.querySelector(".cc-diagram").innerHTML = chord ? this._diagramFor(chord, 1) : "";
        this.refs.now.classList.toggle("is-empty", !chord);
      }
      if (this.refs.next) {
        const n = this.nextIdx >= 0 ? tl[this.nextIdx].chord : null;
        this.refs.next.querySelector(".cc-name").innerHTML = n ? this._nameHtml(n) : "End";
        this.refs.next.querySelector(".cc-diagram").innerHTML = n ? this._diagramFor(n, 0.82) : "";
      }
      this.el.querySelectorAll(".is-current").forEach((e) => e.classList.remove("is-current"));
      if (cur >= 0) this.el.querySelectorAll(`[data-ci="${cur}"]`).forEach((e) => e.classList.add("is-current"));
    }

    _diagramFor(chord, size) {
      const sh = this._shape(chord);
      return D.diagram(sh, this.settings.instrument, { variant: this.variants[`${sh.root}:${sh.q}`] || 0, size });
    }

    _updateBeats(t, cur) {
      const beats = this.beats;
      const bi = bsearch(beats, t, (x) => x);
      if (this.refs.next) {
        const tl = this.timeline;
        const n = this.nextIdx;
        const count = this.refs.next.querySelector(".cc-count");
        const bar = this.refs.next.querySelector(".cc-countbar i");
        if (n >= 0) {
          const target = tl[n].start;
          // Beats from now until the change (the change's own beat included).
          const until = bsearch(beats, target - 0.08, (x) => x) - bi;
          const secs = target - t;
          count.textContent = until >= 1 ? `in ${until} beat${until === 1 ? "" : "s"}` : secs > 0.05 ? "now" : "";
          const from = cur >= 0 ? tl[cur].start : 0;
          const frac = Math.min(1, Math.max(0, (t - from) / Math.max(0.01, target - from)));
          bar.style.transform = `scaleX(${frac.toFixed(3)})`;
          this.refs.next.classList.toggle("is-soon", until <= 1 && secs < 1.5);
        } else {
          count.textContent = "";
          bar.style.transform = "scaleX(0)";
        }
      }
      if (bi === this.beatIdx || !this.refs.now) return;
      this.beatIdx = bi;
      const dots = this.refs.now.querySelectorAll(".cc-beats i");
      if (!dots.length) return;
      const db = this.sheet.downbeats || [];
      let pos = -1;
      if (bi >= 0) {
        const lastDown = bsearch(db, beats[bi] + 0.05, (x) => x);
        if (lastDown >= 0) {
          pos = bi - bsearch(beats, db[lastDown] - 0.05, (x) => x);
        } else {
          pos = bi;
        }
        pos = ((pos % dots.length) + dots.length) % dots.length;
      }
      dots.forEach((d, i) => d.classList.toggle("is-on", i === pos));
    }

    _updateChart(t) {
      const bi = bsearch(this.bars, t, (b) => b.start);
      if (bi === this.barIdx) return;
      this.barIdx = bi;
      const chart = this.refs.chart;
      chart.querySelectorAll(".cc-bar.is-now").forEach((e) => e.classList.remove("is-now"));
      const cell = chart.querySelector(`[data-bar="${bi}"]`);
      if (!cell) return;
      cell.classList.add("is-now");
      if (performance.now() - this.lastUserScroll > 4000) {
        const row = cell.parentElement;
        const target = row.offsetTop - chart.clientHeight * 0.35;
        chart.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
      }
    }

    // ------------------------------------------------------------ events

    _onClick(e) {
      const lane = e.target.closest(".cc-lane");
      if (lane && this.onSeek) {
        // Anywhere on the lane: jump to the time under the pointer.
        const rect = lane.getBoundingClientRect();
        const t = this.lastTime + (e.clientX - rect.left - rect.width * 0.28) / LANE_PX_PER_S;
        this.onSeek(Math.max(0, t));
        return;
      }
      const btn = e.target.closest("button, [data-t]");
      if (!btn || !this.el.contains(btn)) return;
      const st = this.settings;
      if (btn.dataset.set) {
        const raw = btn.dataset.value;
        const value = btn.dataset.set === "capo" ? Number(raw) : raw;
        this.updateSettings({ [btn.dataset.set]: value });
        return;
      }
      const act = btn.dataset.act;
      if (act === "transpose") {
        let v = st.transpose + Number(btn.dataset.d);
        if (v > 11) v -= 12;
        if (v < -11) v += 12;
        this.updateSettings({ transpose: v });
        return;
      }
      if (act === "offset") {
        const v = Math.round((st.offset + Number(btn.dataset.d)) * 10) / 10;
        this.updateSettings({ offset: Math.max(-5, Math.min(5, v)) });
        return;
      }
      if (act === "simple") {
        this.updateSettings({ simple: !st.simple });
        return;
      }
      if (btn.dataset.variant) {
        const k = btn.dataset.variant;
        const [root, q] = k.split(":");
        const count = D.variantCount({ root: Number(root), q }, st.instrument);
        this.variants[k] = ((this.variants[k] || 0) + 1) % count;
        this.updateSettings({}, { silent: true });
        return;
      }
      if (this.onSeek && btn.dataset.t != null) {
        this.onSeek(Math.max(0, Number(btn.dataset.t) - this.settings.offset + 0.02));
      }
    }

    _onChange(e) {
      const sel = e.target.closest("select[data-set]");
      if (sel) this.updateSettings({ [sel.dataset.set]: Number(sel.value) });
    }
  }

  ChordView.DEFAULTS = DEFAULTS;
  CC.ChordView = ChordView;
})();
