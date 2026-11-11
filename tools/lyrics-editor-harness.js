'use strict';
// Regression harness for the Lyrics & Chords editor: the chords it
// recognises, the sheet it is drawn on, and the slide it promises.
//
// WHY THIS EXISTS
// The operator circled two chord lines in the Add Song editor that had
// not gone gold -- "A/C#" and "F#m", both written with the MUSIC SHARP
// SIGN -- and asked for the pad to read like the Songbook and the
// preview to read like the LCD.
//
// THE DANGEROUS DIRECTION
// A chord nobody can adjust is a nuisance. A chord that adjusts WRONGLY
// is worse: transposeChord reads "F<sharp>m" as the root F, so moving it up a
// semitone gave "G<sharp>m" -- a semitone out, in front of a band, with
// nothing on screen to say so. Detection and transposition must never
// disagree about what a chord is.
// And a preview that promises a slide the service will not keep is worse
// than no preview, so it is cut and drawn by the LCD's own functions
// rather than by a second copy of their rules.
//
// USAGE
//   node tools/lyrics-editor-harness.js                 # ../Index.html
//   node tools/lyrics-editor-harness.js path/to/file.html
//   node tools/lyrics-editor-harness.js <file> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}
const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log((ok ? '  ok    ' : '  FAIL  ') + label);
  if (!ok) {
    console.log('          got  ' + JSON.stringify(got));
    console.log('          want ' + JSON.stringify(want));
  }
}

function fnAt(name, indent) {
  const re = new RegExp('^' + indent + 'function ' + name + '\\s*\\(');
  const i = lines.findIndex(l => re.test(l));
  if (i < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let k = i; k < lines.length; k++) {
    out.push(lines[k].replace(/\r$/, ''));
    for (const ch of lines[k]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('no close for ' + name);
}
const topFn = n => fnAt(n, '');
const modFn = n => fnAt(n, '  ');

const SHARP = '♯';
const FLAT = '♭';

let asciiSrc;
try {
  asciiSrc = topFn('lhcChordAscii');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the chord normaliser is present.');
  process.exit(1);
}

// ── 1. a chord written with the musical signs ──────────────────────────
console.log('\na chord is a chord however its sharp is written');
const lineRe = lines.find(l => /^var CHORD_TOKEN_RE = /.test(l)).replace(/\r$/, '');
const notesRe = lines.find(l => /^(var|const) CHORD_NOTES\b/.test(l));
const flatsRe = lines.find(l => /^(var|const) FLAT_TO_SHARP\b/.test(l));
check('the chord constants are still at the top level', !!(notesRe && flatsRe), true);

const chord = new Function('window', [
  lineRe, (notesRe || '').replace(/\r$/, ''), (flatsRe || '').replace(/\r$/, ''),
  asciiSrc, topFn('isChordToken'), topFn('isChordLineGlobal'),
  topFn('transposeChord'), topFn('transposeLine'),
  'return { ascii: lhcChordAscii, tok: isChordToken, line: isChordLineGlobal, up: transposeLine, one: transposeChord };'
].join('\n'))({});

check('the sharp sign reads as #', chord.ascii('F' + SHARP + 'm'), 'F#m');
check('  and the flat sign as b', chord.ascii('B' + FLAT), 'Bb');
check('  nothing at all does not throw', chord.ascii(null), '');
// The two the operator circled.
check('"A/C' + SHARP + '" is a chord token', chord.tok('A/C' + SHARP), true);
check('"F' + SHARP + 'm" is a chord token', chord.tok('F' + SHARP + 'm'), true);
check('a line of them is a chord line',
  chord.line('A/C' + SHARP + '  -  D  -  E'), true);
check('  and so is one on its own', chord.line('F' + SHARP + 'm'), true);
// The dashes were the obvious suspect and were never the problem.
check('dashes between chords never mattered',
  chord.line('A/C#  -  D  -  E'), true);
// What must NOT become a chord line, now that more tokens qualify.
check('"You are the Great I Am" is still a lyric',
  chord.line('You are the Great I Am'), false);
check('  and so is "Am I not still the same"',
  chord.line('Am I not still the same'), false);
check('  and so is any ordinary line', chord.line('Glory to God'), false);

console.log('\nand it moves to the right place');
// The silent one: read raw, "F<sharp>m" has the root F, so up a semitone gave
// "G<sharp>m" -- a semitone sharp of the truth with nothing to show for it.
check('F' + SHARP + 'm up a semitone is Gm', chord.up('F' + SHARP + 'm', 1), 'Gm');
check('  not G' + SHARP + 'm', chord.up('F' + SHARP + 'm', 1) === 'G' + SHARP + 'm', false);
check('A/C' + SHARP + ' up a semitone is A#/D',
  chord.up('A/C' + SHARP + '  -  D  -  E', 1), 'A#/D  -  D#  -  F');
check('the ASCII spelling is unchanged by all this',
  chord.up('F#m    D    A    E', 1), 'Gm    D#    A#    F');
// Reached directly: through transposeLine the normalisation there used to
// mask this one, so the mutation that took it out of transposeChord went
// uncaught. One chord, one call.
check('transposeChord itself reads the sign', chord.one('F' + SHARP + 'm', 1), 'Gm');
check('  and a slash chord\'s bass with it', chord.one('C' + SHARP, 2), 'D#');
check('nought semitones moves nothing',
  chord.up('F' + SHARP + 'm', 0), 'F' + SHARP + 'm');
// Spacing is the chord sheet's grid (gotcha 38): it must survive.
check('the spacing of a chord line is kept exactly',
  chord.up('A/C' + SHARP + '  -  D  -  E', 1).indexOf('A#/D  -  D#'), 0);

// ── 2. the pad ─────────────────────────────────────────────────────────
console.log('\nthe pad is the Songbook\'s sheet, whichever way in');
// --sb was doing two jobs: the look, and hiding the preview. The song
// form wants the first without losing the second.
check('the look lives on --sheet', /\.lyrics-editor-modal--sheet \.lyrics-rich-editor/.test(SRC), true);
check('  and no look rule is left on --sb',
  /\.lyrics-editor-modal--sb \.lyrics-rich-editor/.test(SRC), false);
check('--sb still hides the preview, which only the Songbook wants',
  /\.lyrics-editor-modal--sb \.lyrics-editor-right/.test(SRC), true);
const openEd = topFn('openLyricsEditor');
check('the song form takes the look',
  /classList\.add\('lyrics-editor-modal--sheet'\)/.test(openEd), true);
check('  and does not take the hiding',
  /classList\.remove\('lyrics-editor-modal--sb'\)/.test(openEd), true);
const sbOpen = SRC.slice(SRC.indexOf("modal.classList.add('lyrics-editor-modal--sb');"));
check('the Songbook takes both',
  /--sb'\);[\s\S]{0,120}--sheet'\);/.test(sbOpen), true);

// ── 3. the preview ─────────────────────────────────────────────────────
console.log('\nand the preview is the wall, not a second opinion');
const fromLcd = topFn('_lyrSlidesFromLcd');
check('the slides are cut by the LCD\'s own splitter',
  /WO\.parseLyricsIntoSlides/.test(fromLcd), true);
// Nothing asserted that the preview actually ASKS it; the checks only read
// the function's own source, so cutting the call out went unnoticed.
check('  and the preview actually asks it',
  /var fromLcd = _lyrSlidesFromLcd\(text, getSectionType\);/.test(topFn('updateLyricsLivePreview')), true);
check('  and the editor falls back rather than showing nothing',
  /return null;/.test(fromLcd), true);
const render = topFn('renderCurrentSlide');
check('the words are drawn by the projector\'s own renderer',
  /WO\.projectionHtml\(words\)/.test(render), true);
// It returns escaped HTML; escaping it again would show the markup.
check('  and are not escaped twice',
  /esc\(slide\.lines\.join/.test(render), false);
check('the projection\'s own markup carries them',
  /wo-preview-content|wo-preview-inner/.test(render), true);
// A heading is never projected (gotcha 73), so it is not in the slide.
const screen = render.slice(render.indexOf('wo-preview-content'));
check('no heading is drawn inside the slide', /slide-header/.test(screen), false);
check('  though it is still emitted above it',
  /slide-header/.test(render), true);
// Both have to be lent out, or the preview silently keeps its own rules.
check('the LCD exports its splitter',
  /\n    parseLyricsIntoSlides: parseLyricsIntoSlides,/.test(SRC), true);
check('  and its renderer', /\n    projectionHtml: _projectionHtml,/.test(SRC), true);
// Measured in the browser: the preview's HTML came back byte-identical to
// WO.projectionHtml for the same slide, with "(2x)" gone and chords gone.
check('the preview screen can hold a long word without clipping it',
  /\.lyr-preview-screen \.wo-preview-inner \{[^}]*max-width: 100%/.test(SRC), true);
check('  and wraps it rather than running off the edge',
  /\.lyr-preview-screen \.wo-preview-inner \{[^}]*overflow-wrap: break-word/.test(SRC), true);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
