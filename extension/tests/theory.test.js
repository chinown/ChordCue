// Run with: deno run extension/tests/theory.test.js   (deno ships in the server's .venv)
import "../shared/theory.js";
import "../shared/diagrams.js";

const { theory: T, diagrams: D } = globalThis.CL;
let failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.log(`FAIL ${label}: got ${a}, want ${e}`);
  }
}

// Spelling and transposition.
eq(T.chordName({ root: 6, q: "m7" }, false), "F♯m7", "sharp name");
eq(T.chordName({ root: 10, q: "" }, true), "B♭", "flat name");
eq(T.shape({ root: 7, q: "" }, { transpose: 2 }), { root: 9, q: "" }, "G up 2 is A");
eq(T.shape({ root: 2, q: "" }, { capo: 2 }), { root: 0, q: "" }, "D with capo 2 plays a C shape");
eq(T.shape({ root: 0, q: "" }, { transpose: -1 }), { root: 11, q: "" }, "C down 1 wraps to B");
eq(T.shape({ root: 9, q: "m7" }, { simple: true }), { root: 9, q: "m" }, "simple chords");
eq(T.useFlats({ tonic: 5, mode: "major" }, { notation: "auto" }), true, "F major uses flats");
eq(T.useFlats({ tonic: 2, mode: "minor" }, { notation: "auto" }), true, "D minor uses flats");
eq(T.useFlats({ tonic: 9, mode: "minor" }, { notation: "auto" }), false, "A minor uses sharps");
eq(T.useFlats({ tonic: 0, mode: "major" }, { notation: "auto", transpose: 3 }), true, "C up 3 is E♭: flats");

// Capo suggestion: E♭-B♭-Cm-A♭ becomes D-A-Bm-G at capo 1 (one barre, low on the neck).
const seg = (root, q, len = 4) => ({ chord: { root, q }, start: 0, end: len });
eq(T.suggestCapo([seg(3, ""), seg(10, ""), seg(0, "m"), seg(8, "")]), 1, "capo for E♭ B♭ Cm A♭");
// E-B-C♯m-A has two barre chords open; capo 2 makes it D-A-Bm-G (one barre).
eq(T.suggestCapo([seg(4, "", 8), seg(11, "", 8), seg(1, "m"), seg(9, "")]), 2, "capo 2 for E B C♯m A");
eq(T.suggestCapo([seg(0, ""), seg(7, ""), seg(9, "m"), seg(5, "")]), 0, "no capo for C G Am F");

// Every guitar and ukulele voicing sounds exactly the chord's notes.
const GUITAR = [4, 9, 2, 7, 11, 4], UKE = [7, 0, 4, 9];
for (const q of Object.keys(T.INTERVALS)) {
  for (let root = 0; root < 12; root++) {
    const chord = { root, q };
    const tones = new Set(T.notesOf(chord));
    for (const [name, strings, voicings] of [["guitar", GUITAR, D.guitarVoicings(chord)], ["uke", UKE, D.ukuleleVoicings(chord)]]) {
      if (!voicings.length) { failed++; console.log(`FAIL no ${name} voicing for ${T.chordName(chord)}`); continue; }
      for (const v of voicings) {
        const notes = v.frets.map((f, i) => (f < 0 ? null : T.mod12(strings[i] + f))).filter((n) => n !== null);
        const stray = notes.filter((n) => !tones.has(n));
        if (stray.length || !notes.includes(root)) {
          failed++;
          console.log(`FAIL ${name} ${T.chordName(chord)} ${v.frets.join(",")}: stray ${stray}, root ${notes.includes(root)}`);
        }
      }
    }
  }
}

console.log(failed ? `${failed} failure(s)` : "all theory and diagram checks passed");
if (failed) Deno.exit(1);
