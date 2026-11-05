'use strict';
// Harness for the Songbook's view modes and the question a take's delete asks.
//
// WHY THIS EXISTS
// From the Caroling book (2026-11-04):
//   - A song with no choir parts had no Choir view at all, so there was no
//     way in to making them. It has one now: the song's words, every line
//     sung by All, and Set up choir parts to make that its arrangement.
//   - "Both" showed the words with chords AND the choir score under them.
//     It is "Chords + Lyrics" now, the words alone; Choir is the score.
//   - Deleting a take asked with the browser's own confirm box, which says
//     the site's address and nothing about the take. It asks in the app's
//     own look now, naming the take.
//   - A musician could only move the whole song's key. Lines selected in
//     the words can now be moved on their own -- a verse that goes up a tone.
//
// USAGE
//   node tools/songbook-choir-view-harness.js                 # ../Index.html
//   node tools/songbook-choir-view-harness.js path/to/file.html
//   node tools/songbook-choir-view-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show a1bd9fa:Index.html > x`).
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

const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');
const has = re => re.test(SRC);

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

console.log('Choir, for every song');
check('the view modes offer Choir whenever the score can be drawn, not only to songs with parts',
  has(/\(V \? seg\('choir', 'Choir', view === 'choir' && !cols\) : ''\)/) && !has(/\(hasChoir \? seg\('choir', 'Choir'/));
check('...a song with none is shown its words, every line All, and the way to set them up',
  has(/if \(!hasChoir && view === 'choir'\) \{\r?\n\s*var seed = V \? V\.fromLyrics\(song\.customLyrics \|\| song\.lyrics \|\| ''\) : \[\];/) &&
  has(/onclick="WO\.sbmChoirStart\(\)"><i class="fa-solid fa-wand-magic-sparkles"><\/i>Set up choir parts<\/button>/) &&
  has(/sbmChoirStart: sbmChoirStart,/));
// The words become the starting arrangement: the real fromLyrics, run.
const vStart = lines.findIndex(l => /^window\.lhcVoiceLines = \{/.test(l));
const vEnd = vStart < 0 ? -1 : lines.findIndex((l, i) => i > vStart && l.replace(/\r$/, '') === '};');
if (vStart >= 0 && vEnd > vStart) {
  const V = new Function('var window = {};\n' + lines.slice(vStart, vEnd + 1).map(l => l.replace(/\r$/, '')).join('\n') + '\nreturn window.lhcVoiceLines;')();
  const seed = V.fromLyrics('[Verse 1]\nD    A    D\nJoy to the world\nthe Lord is come\n\n[Chorus]\nAnd heaven and nature sing', l => /^[\sA-G#bm7]+$/.test(l) && /[A-G]/.test(l));
  check('...every line of its words sung by All, in its sections, its chord lines left out',
    seed.length === 3 && seed.every(r => r.part === 'both') && seed[0].section === 'Verse 1' && seed[2].section === 'Chorus' &&
    seed[0].text === 'Joy to the world', JSON.stringify(seed));
} else check('...the choir parts module is there to seed from', false);
check('Set up writes that arrangement the way the parts editor saves one, and shows it in Choir',
  has(/function sbmChoirStart\(\) \{[^]*?if \(!_sbEditClaim\(song\)\) return;[^]*?_sbVoiceWrite\(base, song\.id, rows, \{ onlyIfEmpty: true \}\)\.then\(function\(\) \{[^]*?sbSetChoirView\(song\.id, 'choir'\);[^]*?_sbEditRelease\(base\);/) &&
  has(/_sbVoiceWrite\(ed\.base, ed\.sid, parsed, \{ openSig: ed\.openSig \}\)\.then\(function\(\) \{/));
check('...and in Choir, Edit edits the parts of any song',
  has(/if \(_sbSongHasChoir\(song\) \? _sbChoirView\(song\) === 'choir' : song\.sbmLyricsMode === 'choir'\) \{ sbmEditParts\(\); return; \}/) &&
  has(/\+ \(view === 'choir' \? 'Edit Parts' : 'Edit'\) \+/));

console.log('\nChords + Lyrics');
check('"Both" is "Chords + Lyrics", sized by its name so it is not cut short',
  has(/seg\('both', 'Chords \+ Lyrics', view === 'both' && !cols\)/) && !has(/seg\('both', 'Both'/) &&
  has(/\.sbm-seg--view \.sbm-seg__btn \{ flex: 1 1 auto; padding: 0 8px; \}/));
check('...it is the words alone: the score shows in Choir and nowhere else',
  has(/var showLyrics = view !== 'choir';\r?\n\s*var showScore = hasChoir && view === 'choir';/) && !has(/var showScore = hasChoir && view !== 'lyrics';/));
check('...a medley\'s following song too', has(/if \(hasChoir && view === 'choir'\) \{\r?\n\s*var score = _sbChoirBodyHtml\(s, false, !wide\);/));

console.log('\nDeleting a take');
check('the app asks, in its own look, naming what goes', has(/window\.lhcAskDelete = function\(o\) \{/) && has(/class="lhc-ask__yes"/) && has(/\.lhc-ask-backdrop \{/));
check('...Keep it, Escape and a tap outside all keep the take; Keep it is where the cursor starts',
  has(/bd\.querySelector\('\.lhc-ask__no'\)\.onclick = function\(\) \{ done\(false\); \};/) &&
  has(/var key = function\(e\) \{ if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); done\(false\); \} \};/) &&
  has(/bd\.addEventListener\('click', function\(e\) \{ if \(e\.target === bd\) done\(false\); \}\);/) &&
  has(/var b = bd\.querySelector\('\.lhc-ask__no'\); if \(b\) b\.focus\(\);/));
check('...from the take\'s own menu, a line\'s list of takes and the recordings panel alike',
  has(/window\.lhcAskDelete\(\{ title: 'Delete \\u201c' \+ _sbmTakeTitle\(h\.rec, h\.song, _sbmRecs\[h\.base\] \|\| \[\]\) \+ '\\u201d\?',/) &&
  has(/\? window\.lhcAskDelete\(\{ title: 'Delete \\u201c' \+ \(\(t && t\.name\) \|\| 'this take'\) \+ '\\u201d\?',/) &&
  has(/function sbDeleteRecording\(id, storagePath\) \{\r?\n\s*window\.lhcAskDelete\(/) &&
  !has(/if \(!confirm\('Delete "' \+ _sbmTakeTitle/) && !has(/if \(!confirm\('Delete this recording\?'\)\) return;/));
check('...and a line\'s list of takes stays open behind it, leaving Escape to it',
  has(/if \(e\.target\.closest && e\.target\.closest\('#lhcAsk'\)\) return;/) && has(/if \(document\.getElementById\('lhcAsk'\)\) return;/));

console.log('\nA few lines transposed on their own');
function extractFn(header) {
  const startIdx = lines.findIndex(l => l.indexOf(header) !== -1);
  if (startIdx < 0) return null;
  let depth = 0, started = false;
  const out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
    if (started && depth === 0) return out.join('\n');
  }
  return null;
}
const shiftSrc = extractFn('function _sbmXpShift(');
check('the lines are moved by a function of their own', !!shiftSrc);
if (shiftSrc) {
  // Stand-ins: a chord line is one with only chord names on it; moving one
  // moves each name up the scale.
  const SC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const X = new Function('SC', 'function isChordLineGlobal(l) { return /[A-G]/.test(l) && /^[\\sA-G#m7|]+$/.test(l); }\n' +
    'function _transposeChordRowKeepingColumns(l, d) { return l.replace(/[A-G]#?/g, function(n) { return SC[(SC.indexOf(n) + d + 120) % 12]; }); }\n' +
    shiftSrc + '\nreturn _sbmXpShift;')(SC);
  const song = ['[Verse 1]', 'C     F     C', 'It came upon a midnight clear', '', '[Verse 2]', 'C     G     C', 'Still through the cloven skies', 'F  G'];
  const out = X(song, 4, 7, 2);
  check('the chord lines chosen move, and only they',
    out[5] === 'D     A     D' && out[7] === 'G  A' && out[1] === 'C     F     C', JSON.stringify(out));
  check('...their words, the section names and the empty lines stay as they are',
    out[2] === song[2] && out[6] === song[6] && out[0] === song[0] && out[4] === song[4] && out[3] === '');
  check('...and back down again is where they were', JSON.stringify(X(out, 4, 7, -2)) === JSON.stringify(song));
}
check('a selection in the song\'s words offers the bar, for the lines it takes in (not one it only touches)',
  has(/document\.addEventListener\('selectionchange', function\(\) \{ if \(_sbmBookOpen\(\)\) _sbmXpOnSel\(\); \}\);/) &&
  has(/rg\.compareBoundaryPoints\(Range\.END_TO_START, er\) < 0 && rg\.compareBoundaryPoints\(Range\.START_TO_END, er\) > 0/) &&
  has(/onclick="WO\.sbmXpSel\(-1\)"/) && has(/onclick="WO\.sbmXpSel\(1\)"/) && has(/onclick="WO\.sbmXpSelUndo\(\)"/) && has(/onclick="WO\.sbmXpSelClose\(\)"/));
check('...which reads the words the card is drawn from, one block a line, and refuses rather than guess',
  has(/box\.innerHTML = song\.richLyrics \? _sbStripTrailingEmptyHtml\(song\.richLyrics\)/) &&
  has(/if \(els\.length !== _sbmXpBlocks\(ly\)\.length\) return null;/) &&
  has(/if \(!lines\) \{ showToast\('These words were reworked as formatted text/));
check('...saves them as the copy\'s words, as the Lyrics editor does, unless somebody else is editing the song',
  has(/if \(!_sbEditMayWrite\(song\)\) return;\r?\n\s*var lines = _sbmXpSource\(song, ly\);/) &&
  has(/_sbSetCopyWords\(song, _sbmXpShift\(lines, X\.a, X\.b, delta\)\.join\('\\n'\)\);/) &&
  has(/function _sbSetCopyWords\(song, lyrics\) \{/));
check('...keeps the lines it moves tinted, and Undo puts them back as they first were',
  has(/forEach\(function\(el\) \{ el\.classList\.add\('sbm-xp-on'\); \}\);/) && has(/var before = X\.before;\r?\n\s*X\.before = null; X\.net = 0; X\.after = null;\r?\n\s*_sbSetCopyWords\(song, before\);/));
check('...and the key control says it can be done', has(/Select some lines in the song to move only those/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
