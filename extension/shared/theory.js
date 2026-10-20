// Chord spelling, transposition, capo and simplification.
// A chord is {root: 0-11 (0 = C), q: quality}; null means no chord.
(() => {
  const CC = (globalThis.CC = globalThis.CC || {});

  const SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

  const INTERVALS = {
    "": [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
    6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11],
    m7: [0, 3, 7, 10], mMaj7: [0, 3, 7, 11], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10],
    sus2: [0, 2, 7], sus4: [0, 5, 7],
  };

  const SUFFIX = {
    "": "", m: "m", dim: "dim", aug: "aug", 6: "6", m6: "m6", 7: "7", maj7: "maj7",
    m7: "m7", mMaj7: "m(maj7)", dim7: "dim7", m7b5: "m7♭5", sus2: "sus2", sus4: "sus4",
  };

  // Major-key tonics written with flats: F, B♭, E♭, A♭, D♭.
  const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]);

  const mod12 = (n) => ((n % 12) + 12) % 12;

  function keyUsesFlats(tonic, mode) {
    return FLAT_MAJOR.has(mode === "minor" ? mod12(tonic + 3) : mod12(tonic));
  }

  function noteName(pc, flats) {
    return (flats ? FLAT : SHARP)[mod12(pc)];
  }

  function simplify(q) {
    if (["m", "m6", "m7", "mMaj7", "m7b5"].includes(q)) return "m";
    if (q === "dim" || q === "dim7") return "dim";
    if (q === "sus2" || q === "sus4" || q === "aug") return q;
    return "";
  }

  // What the player sees: the sounding chord moved by `transpose`, then
  // written as a shape relative to the capo.
  function shape(chord, { transpose = 0, capo = 0, simple = false } = {}) {
    if (!chord) return null;
    return { root: mod12(chord.root + transpose - capo), q: simple ? simplify(chord.q) : chord.q };
  }

  function chordName(chord, flats) {
    if (!chord) return "N.C.";
    return noteName(chord.root, flats) + SUFFIX[chord.q];
  }

  function chordParts(chord, flats) {
    if (!chord) return { root: "N.C.", suffix: "" };
    return { root: noteName(chord.root, flats), suffix: SUFFIX[chord.q] };
  }

  function notesOf(chord) {
    return chord ? INTERVALS[chord.q].map((i) => mod12(chord.root + i)) : [];
  }

  function keyName(tonic, mode, flats) {
    return noteName(tonic, flats) + (mode === "minor" ? "m" : "");
  }

  // Sharps or flats for a song shown with these settings ("auto" follows the key).
  function useFlats(key, settings) {
    if (settings.notation === "sharp") return false;
    if (settings.notation === "flat") return true;
    if (!key) return false;
    return keyUsesFlats(key.tonic + (settings.transpose || 0) - (settings.capo || 0), key.mode);
  }

  // Easy open-position guitar shapes, for picking a capo.
  const EASY = new Set([
    "0:", "2:", "4:", "7:", "9:", "9:m", "2:m", "4:m",
    "0:7", "2:7", "4:7", "7:7", "9:7", "11:7", "9:m7", "2:m7", "4:m7",
    "0:maj7", "5:maj7", "7:maj7", "9:maj7", "2:maj7", "4:maj7",
    "9:sus2", "9:sus4", "2:sus2", "2:sus4", "4:sus4",
  ]);
  const MEDIUM = new Set(["5:", "11:m", "5:m", "0:m", "7:m", "11:"]);

  function shapeCost(root, q) {
    if (EASY.has(`${root}:${q}`)) return 0;
    if (EASY.has(`${root}:${simplify(q)}`)) return 0.3;
    if (MEDIUM.has(`${root}:${simplify(q)}`)) return 1;
    return 2;
  }

  // Capo fret (0-7) whose shapes are easiest, weighted by how long each chord plays.
  function suggestCapo(timeline, transpose = 0) {
    const weights = new Map();
    for (const seg of timeline) {
      if (!seg.chord) continue;
      const k = `${mod12(seg.chord.root + transpose)}:${seg.chord.q}`;
      weights.set(k, (weights.get(k) || 0) + (seg.end - seg.start));
    }
    if (!weights.size) return 0;
    const total = [...weights.values()].reduce((a, b) => a + b, 0);
    let best = 0, bestCost = Infinity;
    for (let capo = 0; capo <= 7; capo++) {
      let cost = 0;
      for (const [k, w] of weights) {
        const [root, q] = k.split(":");
        cost += w * shapeCost(mod12(+root - capo), q);
      }
      cost = cost / total + 0.05 * capo;
      if (cost < bestCost - 1e-9) { best = capo; bestCost = cost; }
    }
    return best;
  }

  CC.theory = {
    INTERVALS, mod12, keyUsesFlats, noteName, simplify, shape, chordName, chordParts,
    notesOf, keyName, useFlats, suggestCapo,
  };
})();
