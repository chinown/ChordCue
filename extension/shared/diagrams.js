// Chord diagrams as SVG strings: guitar, ukulele and piano.
(() => {
  const CC = (globalThis.CC = globalThis.CC || {});
  const { INTERVALS, mod12, notesOf } = CC.theory;

  // ---------------------------------------------------------------- guitar

  // Open-position shapes, low E to high e; -1 = muted. Keyed "root:quality".
  const OPEN = {
    "0:": [-1, 3, 2, 0, 1, 0], "0:7": [-1, 3, 2, 3, 1, 0], "0:maj7": [-1, 3, 2, 0, 0, 0],
    "0:6": [-1, 3, 2, 2, 1, 0], "0:sus2": [-1, 3, 0, 0, 1, 3], "0:sus4": [-1, 3, 3, 0, 1, 1],
    "2:": [-1, -1, 0, 2, 3, 2], "2:m": [-1, -1, 0, 2, 3, 1], "2:7": [-1, -1, 0, 2, 1, 2],
    "2:m7": [-1, -1, 0, 2, 1, 1], "2:maj7": [-1, -1, 0, 2, 2, 2], "2:sus2": [-1, -1, 0, 2, 3, 0],
    "2:sus4": [-1, -1, 0, 2, 3, 3], "2:6": [-1, -1, 0, 2, 0, 2], "2:m6": [-1, -1, 0, 2, 0, 1],
    "4:": [0, 2, 2, 1, 0, 0], "4:m": [0, 2, 2, 0, 0, 0], "4:7": [0, 2, 0, 1, 0, 0],
    "4:m7": [0, 2, 0, 0, 0, 0], "4:maj7": [0, 2, 1, 1, 0, 0], "4:sus4": [0, 2, 2, 2, 0, 0],
    "4:6": [0, 2, 2, 1, 2, 0], "4:m6": [0, 2, 2, 0, 2, 0], "4:aug": [0, 3, 2, 1, 1, 0],
    "4:mMaj7": [0, 2, 1, 0, 0, 0],
    "5:maj7": [-1, -1, 3, 2, 1, 0],
    "7:": [3, 2, 0, 0, 0, 3], "7:7": [3, 2, 0, 0, 0, 1], "7:maj7": [3, 2, 0, 0, 0, 2],
    "7:6": [3, 2, 0, 0, 0, 0], "7:sus4": [3, -1, 0, 0, 1, 3], "7:sus2": [3, 0, 0, 0, 3, 3],
    "9:": [-1, 0, 2, 2, 2, 0], "9:m": [-1, 0, 2, 2, 1, 0], "9:7": [-1, 0, 2, 0, 2, 0],
    "9:m7": [-1, 0, 2, 0, 1, 0], "9:maj7": [-1, 0, 2, 1, 2, 0], "9:sus2": [-1, 0, 2, 2, 0, 0],
    "9:sus4": [-1, 0, 2, 2, 3, 0], "9:6": [-1, 0, 2, 2, 2, 2], "9:m6": [-1, 0, 2, 2, 1, 2],
    "9:mMaj7": [-1, 0, 2, 1, 1, 0], "9:m7b5": [-1, 0, 1, 0, 1, -1],
    "11:7": [-1, 2, 1, 2, 0, 2], "11:m7": [-1, 2, 0, 2, 0, 2],
  };

  // Movable shapes as offsets from the barre fret.
  const E_SHAPE = {
    "": [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0],
    maj7: [0, -1, 1, 1, 0, -1], sus4: [0, 2, 2, 2, 0, 0], sus2: [0, 2, 4, 4, 0, 0],
    6: [0, 2, 2, 1, 2, 0], m6: [0, 2, 2, 0, 2, 0], dim: [0, 1, 2, 0, -1, -1],
    dim7: [0, 1, 2, 0, 2, 0], m7b5: [0, 1, 0, 0, -1, -1], aug: [0, 3, 2, 1, 1, 0], mMaj7: [0, 2, 1, 0, 0, 0],
  };
  const A_SHAPE = {
    "": [-1, 0, 2, 2, 2, 0], m: [-1, 0, 2, 2, 1, 0], 7: [-1, 0, 2, 0, 2, 0], m7: [-1, 0, 2, 0, 1, 0],
    maj7: [-1, 0, 2, 1, 2, 0], sus4: [-1, 0, 2, 2, 3, 0], sus2: [-1, 0, 2, 2, 0, 0],
    6: [-1, 0, 2, 2, 2, 2], m6: [-1, 0, 2, 2, 1, 2], dim: [-1, 0, 1, 2, 1, -1],
    dim7: [-1, 0, 1, 2, 1, 2], m7b5: [-1, 0, 1, 0, 1, -1], aug: [-1, 0, 3, 2, 2, 1], mMaj7: [-1, 0, 2, 1, 1, 0],
  };

  function barreFrom(offsets, fret) {
    const frets = offsets.map((o) => (o < 0 ? -1 : o + fret));
    const at = offsets.map((o, i) => (o === 0 ? i : -1)).filter((i) => i >= 0);
    const barre = fret > 0 && at.length >= 2 ? { fret, from: at[0], to: at[at.length - 1] } : null;
    return { frets, barre };
  }

  function withBase(v) {
    const fretted = v.frets.filter((f) => f > 0);
    const max = fretted.length ? Math.max(...fretted) : 0;
    const min = fretted.length ? Math.min(...fretted) : 1;
    return { ...v, base: max <= 4 ? 1 : min };
  }

  function guitarVoicings(chord) {
    if (!chord || !INTERVALS[chord.q]) return [];
    const out = [];
    const open = OPEN[`${chord.root}:${chord.q}`];
    if (open) out.push(withBase({ frets: open.slice(), barre: null }));
    const shapes = [
      [E_SHAPE[chord.q], mod12(chord.root - 4)],
      [A_SHAPE[chord.q], mod12(chord.root - 9)],
    ];
    const barres = [];
    for (const [offsets, fret] of shapes) {
      if (!offsets) continue;
      barres.push(withBase(barreFrom(offsets, fret === 0 && open ? 12 : fret)));
    }
    barres.sort((a, b) => Math.max(...a.frets) - Math.max(...b.frets));
    return out.concat(barres);
  }

  // ---------------------------------------------------------------- ukulele

  const UKE_STRINGS = [7, 0, 4, 9]; // G C E A (high G)

  function ukuleleVoicings(chord) {
    if (!chord || !INTERVALS[chord.q]) return [];
    const intervals = INTERVALS[chord.q];
    const tones = intervals.map((i) => mod12(chord.root + i));
    // The fifth may be left out; everything else must sound.
    const required = tones.filter((_, k) => !(intervals[k] === 7 && intervals.length > 3));
    const found = new Map();
    for (let start = 0; start <= 9; start++) {
      const options = UKE_STRINGS.map((open) => {
        const frets = [];
        for (let f = start; f <= start + 3; f++) if (tones.includes(mod12(open + f))) frets.push(f);
        if (start > 0 && tones.includes(open)) frets.unshift(0);
        return frets;
      });
      if (options.some((o) => !o.length)) continue;
      for (const a of options[0]) for (const b of options[1]) for (const c of options[2]) for (const d of options[3]) {
        const frets = [a, b, c, d];
        const notes = frets.map((f, i) => mod12(UKE_STRINGS[i] + f));
        if (!required.every((t) => notes.includes(t))) continue;
        const fretted = frets.filter((f) => f > 0);
        const max = fretted.length ? Math.max(...fretted) : 0;
        const min = fretted.length ? Math.min(...fretted) : 0;
        const missingFifth = !tones.every((t) => notes.includes(t));
        const cost = 0.5 * fretted.reduce((s, f) => s + f, 0) + 1.5 * (max - min) + 0.7 * max +
          0.3 * fretted.length + (missingFifth ? 0.5 : 0);
        const key = frets.join(",");
        if (!found.has(key) || found.get(key).cost > cost) found.set(key, { frets, cost });
      }
    }
    return [...found.values()].sort((x, y) => x.cost - y.cost).slice(0, 3).map(({ frets }) => {
      const fretted = frets.filter((f) => f > 0);
      const min = fretted.length ? Math.min(...fretted) : 0;
      const atMin = frets.map((f, i) => (f === min ? i : -1)).filter((i) => i >= 0);
      const barre = min > 0 && atMin.length >= 3 ? { fret: min, from: atMin[0], to: atMin[atMin.length - 1] } : null;
      return withBase({ frets, barre });
    });
  }

  // ---------------------------------------------------------------- drawing

  function fretboardSvg(v, strings, labels, { size = 1 } = {}) {
    const n = strings;
    const gap = 16, fretH = 20, rows = 5;
    const left = 22, top = 24;
    const width = left + gap * (n - 1) + 16;
    const height = top + fretH * rows + 22;
    const x = (i) => left + i * gap;
    const y = (row) => top + row * fretH;
    const parts = [];
    parts.push(`<svg class="cc-fb" viewBox="0 0 ${width} ${height}" width="${width * size}" height="${height * size}" role="img">`);
    // Nut or fret number.
    if (v.base === 1) {
      parts.push(`<rect x="${x(0) - 1}" y="${top - 4}" width="${gap * (n - 1) + 2}" height="4" rx="1" class="cc-fb-nut"/>`);
    } else {
      parts.push(`<text x="${x(0) - 7}" y="${y(0.5) + 4}" text-anchor="end" class="cc-fb-fretno">${v.base}</text>`);
    }
    for (let r = 0; r <= rows; r++) parts.push(`<line x1="${x(0)}" y1="${y(r)}" x2="${x(n - 1)}" y2="${y(r)}" class="cc-fb-fret"/>`);
    for (let i = 0; i < n; i++) parts.push(`<line x1="${x(i)}" y1="${top}" x2="${x(i)}" y2="${y(rows)}" class="cc-fb-string"/>`);
    // Open / muted markers.
    v.frets.forEach((f, i) => {
      if (f === 0) parts.push(`<circle cx="${x(i)}" cy="${top - 12}" r="4" class="cc-fb-open"/>`);
      if (f < 0) parts.push(`<path d="M${x(i) - 4} ${top - 16}l8 8m0 -8l-8 8" class="cc-fb-mute"/>`);
    });
    if (v.barre) {
      const row = v.barre.fret - v.base + 0.5;
      parts.push(`<rect x="${x(v.barre.from) - 6}" y="${y(row) - 6}" width="${x(v.barre.to) - x(v.barre.from) + 12}" height="12" rx="6" class="cc-fb-dot"/>`);
    }
    v.frets.forEach((f, i) => {
      if (f <= 0) return;
      if (v.barre && f === v.barre.fret && i >= v.barre.from && i <= v.barre.to) return;
      parts.push(`<circle cx="${x(i)}" cy="${y(f - v.base + 0.5)}" r="6" class="cc-fb-dot"/>`);
    });
    labels.forEach((l, i) => parts.push(`<text x="${x(i)}" y="${height - 6}" text-anchor="middle" class="cc-fb-label">${l}</text>`));
    parts.push("</svg>");
    return parts.join("");
  }

  function pianoSvg(chord, { size = 1 } = {}) {
    const notes = notesOf(chord);
    const whiteW = 13, whiteH = 54, blackW = 8, blackH = 33;
    const WHITE = [0, 2, 4, 5, 7, 9, 11];
    const BLACK = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // pitch class -> white key it follows
    // Root-position voicing from the root upward, across two octaves from C.
    const lit = new Set();
    if (chord) {
      const intervals = INTERVALS[chord.q];
      for (const i of intervals) lit.add(chord.root + i);
    }
    const width = whiteW * 14 + 1;
    const parts = [`<svg class="cc-piano" viewBox="0 0 ${width} ${whiteH + 2}" width="${width * size}" height="${(whiteH + 2) * size}" role="img">`];
    for (let o = 0; o < 2; o++) {
      WHITE.forEach((pc, k) => {
        const abs = o * 12 + pc;
        const on = lit.has(abs);
        const cls = on ? (chord && abs === chord.root ? "cc-key-w cc-key-root" : "cc-key-w cc-key-on") : "cc-key-w";
        parts.push(`<rect x="${(o * 7 + k) * whiteW + 0.5}" y="0.5" width="${whiteW}" height="${whiteH}" rx="2" class="${cls}"/>`);
      });
    }
    for (let o = 0; o < 2; o++) {
      for (const [pc, after] of Object.entries(BLACK)) {
        const abs = o * 12 + Number(pc);
        const on = lit.has(abs);
        const cls = on ? (chord && abs === chord.root ? "cc-key-b cc-key-root" : "cc-key-b cc-key-on") : "cc-key-b";
        const xPos = (o * 7 + after + 1) * whiteW - blackW / 2 + 0.5;
        parts.push(`<rect x="${xPos}" y="0.5" width="${blackW}" height="${blackH}" rx="1.5" class="${cls}"/>`);
      }
    }
    parts.push("</svg>");
    return notes.length ? parts.join("") : parts.join("").replace("cc-piano", "cc-piano cc-empty");
  }

  // One diagram for a chord on an instrument; `variant` cycles alternate shapes.
  function diagram(chord, instrument, { variant = 0, size = 1 } = {}) {
    if (!chord) return `<div class="cc-nc">No chord</div>`;
    if (instrument === "piano") return pianoSvg(chord, { size });
    if (instrument === "ukulele") {
      const vs = ukuleleVoicings(chord);
      return vs.length ? fretboardSvg(vs[variant % vs.length], 4, ["G", "C", "E", "A"], { size }) : `<div class="cc-nc">?</div>`;
    }
    const vs = guitarVoicings(chord);
    return vs.length ? fretboardSvg(vs[variant % vs.length], 6, ["E", "A", "D", "G", "B", "e"], { size }) : `<div class="cc-nc">?</div>`;
  }

  function variantCount(chord, instrument) {
    if (!chord || instrument === "piano") return 1;
    return (instrument === "ukulele" ? ukuleleVoicings(chord) : guitarVoicings(chord)).length || 1;
  }

  CC.diagrams = { guitarVoicings, ukuleleVoicings, diagram, variantCount };
})();
