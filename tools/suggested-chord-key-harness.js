'use strict';
// Regression harness for chords that were SUGGESTED in one key and a song
// that was then filed in another.
//
// WHY THIS EXISTS
// A hymn was scanned from a page with no printed chords. The model proposed
// a set in G and said so plainly, in the banner and in its notes. The key was
// then corrected by hand to F -- and the chords stayed in G.
//
// The song sits in the library filed as F with G, C, A7 and D written above
// the words. Nothing is flagged, every test passed, and the first person to
// find out is whoever plays from it, a tone out, on a Sunday.
//
// Found by reading a scan-correction record in production rather than by any
// check here, which is the point: the scan was right, the key was right, and
// the join between them was missing.
//
// WHAT THIS CHECKS
//
//   _keyDistance            semitones between two keys, the SHORTER way round
//   _transposeChordLinesOnly   moves chord rows and NOTHING else
//   the wiring              the key field is watched, and only suggested
//                           chords are ever offered for moving
//
// The second one carries the risk. transposeLine() shifts any token that
// begins A-G, which is exactly right for a chord row and ruinous for a
// lyric: "A mighty fortress is our God" becomes "G mighty fortress is our
// God", in the song's own words, saved. Most of the cases below are lyrics
// that look like chords for that reason.
//
// USAGE
//   node tools/suggested-chord-key-harness.js                 # ../Index.html
//   node tools/suggested-chord-key-harness.js path/to/file.html
//   node tools/suggested-chord-key-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const raw = fs.readFileSync(INDEX, 'utf8');

function fnSrc(opener) {
  const a = raw.indexOf(opener);
  if (a < 0) return null;
  let depth = 0, started = false;
  for (let i = a; i < raw.length; i++) {
    if (raw[i] === '{') { depth++; started = true; }
    else if (raw[i] === '}') { depth--; if (started && depth === 0) return raw.slice(a, i + 1); }
  }
  return null;
}

const parts = {
  CHORD_NOTES:   (raw.match(/var CHORD_NOTES = [^\n]+/) || [])[0],
  FLAT_TO_SHARP: (raw.match(/var FLAT_TO_SHARP = [^\n]+/) || [])[0],
  CHORD_TOKEN_RE:    (raw.match(/var CHORD_TOKEN_RE = [^\n]+/) || [])[0],
  isChordToken:      fnSrc('function isChordToken(tok) {'),
  isChordLineGlobal: fnSrc('function isChordLineGlobal(line, nextLine) {'),
  transposeChord:    fnSrc('function transposeChord(chord, semitones) {'),
  transposeLine:     fnSrc('function transposeLine(line, semitones) {'),
  keyDistance:       fnSrc('function _keyDistance(fromKey, toKey) {'),
  spellForKey:       fnSrc('function _spellChordsForKey(line, key) {'),
  SHARP_TO_FLAT:     (raw.match(/var SHARP_TO_FLAT = [^\n]+/) || [])[0],
  FLAT_KEY_ROOTS:    (raw.match(/var FLAT_KEY_ROOTS = [^\n]+/) || [])[0],
  keepColumns:       fnSrc('function _transposeChordRowKeepingColumns(line, semitones, targetKey) {'),
  transposeOnly:     fnSrc('function _transposeChordLinesOnly(text, semitones, targetKey) {'),
};

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

console.log('Extracted from ' + path.basename(INDEX) + ':');
for (const k of Object.keys(parts)) {
  console.log('  ' + k.padEnd(20) + (parts[k] ? 'found' : 'ABSENT'));
}
console.log('');

const missing = Object.keys(parts).filter(k => !parts[k]);
if (missing.length) {
  if (EXPECT_BROKEN) {
    console.log('Absent, as expected for pre-fix source: ' + missing.join(', '));
    process.exit(0);
  }
  console.error('Missing: ' + missing.join(', '));
  process.exit(1);
}

const api = new Function('window',
  Object.values(parts).join('\n') +
  '\nreturn { _keyDistance: _keyDistance, _transposeChordLinesOnly: _transposeChordLinesOnly,' +
  '          _spellChordsForKey: _spellChordsForKey };'
)({});

// ---- distance between keys ----------------------------------------------
console.log('how far it is from one key to the other');
check('G to F is two semitones DOWN, not ten up', api._keyDistance('G', 'F'), -2);
check('F to G is two up', api._keyDistance('F', 'G'), 2);
check('the same key is no distance at all', api._keyDistance('D', 'D'), 0);
check('C to F# is six either way; it settles on six', api._keyDistance('C', 'F#'), 6);
check('C to G is five down, not seven up', api._keyDistance('C', 'G'), -5);
console.log('  (five down and seven up are the same chord; the shorter one reads better)');
check('a flat is understood', api._keyDistance('Bb', 'C'), 2);
check('the picker spelling "G# / Ab" is understood', api._keyDistance('G# / Ab', 'A'), 1);
check('"D Major" is understood', api._keyDistance('D Major', 'E'), 2);
check('a key it cannot read gives null, not a guess', api._keyDistance('H', 'C'), null);
check('nothing at all gives null', api._keyDistance('', 'C'), null);

// ---- and this is the dangerous part -------------------------------------
console.log('\nchord rows move; the words do not');
const T = (t, n, k) => api._transposeChordLinesOnly(t, n, k);

// The columns are the point, so they are what is asserted -- a literal
// string would have to be recomputed by hand every time and says nothing
// about why it is that shape.
const cols = s => { const o = []; const re = /\S+/g; let m; while ((m = re.exec(s))) o.push(m.index); return o; };
const names = s => s.trim().split(/\s+/);
{
  const from = 'G           C        D';
  const to = T(from, -2, 'F');
  check('a plain chord row moves', names(to), ['F', 'Bb', 'C']);
  // C is one character and Bb is two. Replacing in place would push the last
  // chord a column right, and the words underneath do not move with it.
  check('  and every chord stays in its column', cols(to), cols(from));
}
check('a lyric that opens with a chord name is untouched',
  T('A mighty fortress is our God', -2), 'A mighty fortress is our God');
check('  and one that is mostly short words too',
  T('Am I a soldier of the cross', -2), 'Am I a soldier of the cross');
check('  "Be still, my soul"', T('Be still, my soul', -2), 'Be still, my soul');
check('  "C above all powers"', T('C above all powers', -2), 'C above all powers');
check('  "E is the note we start on"',
  T('E is the note we start on', -2), 'E is the note we start on');

const sheet = [
  '[Verse 1]',
  '      G        C       D',
  'The Lord\'s my shepherd, I\'ll not want',
  '      G        D       G',
  'He makes me down to lie',
].join('\n');
const movedSheet = T(sheet, -2, 'F');
check('a real verse: the chord rows moved',
  names(movedSheet.split('\n')[1]), ['F', 'Bb', 'C']);
check('  with their columns intact',
  cols(movedSheet.split('\n')[1]), cols(sheet.split('\n')[1]));
check('  and the second chord row too',
  cols(movedSheet.split('\n')[3]), cols(sheet.split('\n')[3]));
check('  the section header did not', movedSheet.split('\n')[0], '[Verse 1]');
check('  and not one word of the lyric changed',
  movedSheet.split('\n').filter((_, i) => i === 2 || i === 4),
  ['The Lord\'s my shepherd, I\'ll not want', 'He makes me down to lie']);

check('zero semitones changes nothing at all', T(sheet, 0), sheet);
check('empty text is safe', T('', -2), '');
check('null is safe', T(null, -2), null);
check('slash chords keep their bass note',
  T('G/B        C/E', -2, 'F').replace(/\s+/g, ' ').trim(), 'F/A Bb/D');

// ---- and the columns do not move ----------------------------------------
//
// A chord sheet positions chords with leading spaces, so a chord line that
// changes LENGTH slides every chord after it off its syllable. Both
// spellings of a black note are two characters, which is why respelling is
// safe at all -- and this is the check that keeps it true if the table is
// ever extended.
console.log('\nrespelling does not move the chords along the line');
{
  const rows = [
    '      G#       A#       C#',
    'C#m   D#7      F#sus4   G#/B#',
    '      A#m7     D#maj7',
  ];
  rows.forEach(row => {
    const flat = api._spellChordsForKey(row, 'F');
    check('same width: "' + row.trim().slice(0, 26) + '"', flat.length, row.length);
  });
  check('a sharp key is left spelled with sharps',
    api._spellChordsForKey('      G#       A#', 'D'), '      G#       A#');
  check('and C, which is neither, is left alone',
    api._spellChordsForKey('      A#', 'C'), '      A#');

  // Every entry in the table has to be the same width as what it replaces.
  const tbl = new Function('return ' + (parts.SHARP_TO_FLAT || 'null').replace(/^var SHARP_TO_FLAT = /, '').replace(/;$/, ''))();
  check('every spelling in the table is the same width as its sharp',
    Object.keys(tbl || {}).filter(k => k.length !== tbl[k].length), []);
}

// ---- the wiring ----------------------------------------------------------
console.log('\nand it is offered at the right moment, for the right chords');
// Chords READ off a sheet are evidence. A key typed over them does not make
// them wrong, so they are never offered for moving.
check('only SUGGESTED chords are remembered',
  /_asmSuggestedFromKey = d\.chordsSuggested \? \(d\.key \|\| null\) : null;/.test(raw), true);
check('the key field is watched',
  /_keyEl\.onchange = _asmCheckKeyAgainstChords;/.test(raw), true);
check('  assigned, not added, so re-scanning does not stack listeners',
  /addEventListener\('change', _asmCheckKeyAgainstChords\)/.test(raw), false);
check('the note offers a button rather than acting on its own',
  /onclick="_asmTransposeSuggestedChords\(\)"/.test(raw), true);
check('nothing is said when the keys agree',
  /if \(!_asmSuggestedFromKey \|\| !chosen \|\| steps === null \|\| steps === 0\)/.test(raw), true);
check('clearing the banner forgets the key too',
  /function _asmClearScanBanner\(\) \{\s*[\r\n]+\s*_asmSuggestedFromKey = null;/.test(raw), true);
check('moving the chords updates the lyrics the form will save',
  /_asmSetNewLyrics\(moved\);/.test(raw), true);

console.log('\n' + '='.repeat(60));
const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN) {
  if (pass === results.length) {
    console.log('\nBUT --expect-broken was given and everything passed.');
    process.exit(1);
  }
  console.log('\nFailures above are expected for pre-fix source.');
  process.exit(0);
}
if (pass === results.length) console.log('The chords follow the key, and the words stay put.');
process.exit(pass === results.length ? 0 : 1);
