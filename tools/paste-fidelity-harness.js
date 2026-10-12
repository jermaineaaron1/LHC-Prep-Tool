'use strict';
// Regression harness for what happens to a chord sheet pasted into the Songbook.
//
// WHY THIS EXISTS
// The usual way a song gets into this app is a copy out of Ultimate Guitar or a
// site like it: a plain-text chart where the chords are placed by counting
// spaces, so column 12 of the chord row is meant to sit over column 12 of the
// lyric. Every space in that text is load-bearing, and the paste path used to
// take two liberties with it.
//
//   1. sbIsInlineChordLine treated "chord + one or two spaces + a word" as a
//      chord written inline with its lyric. "A  mighty fortress is our God"
//      fits that shape, and so do "Am I not still the same" and a good share
//      of every hymnal. The first word was torn off and called a chord.
//   2. sbExtractInlineChords then rebuilt the lyric from its word tokens and
//      dropped every space run on the way, so the line came back as
//      "mightyfortressisourGod".
//
// Together those two silently rewrote pasted lyrics into something unreadable.
// The functions are pure, so they can be tested directly on the shipped source.
//
// HOW IT WORKS
// It slices the REAL source text out of Index.html by brace balance and runs it
// against a small stub, so the code under test is the shipped code.
//
// USAGE
//   node tools/paste-fidelity-harness.js                 # checks ../Index.html
//   node tools/paste-fidelity-harness.js path/to/file.html
//   node tools/paste-fidelity-harness.js <file> --expect-broken
//
// --expect-broken is the negative control: it asserts the old behaviour is
// still there, and is meant to be pointed at pre-fix source
// (`git show a16ccb7:Index.html > x`).
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

const src = fs.readFileSync(INDEX, 'utf8');
const lines = src.split('\n');

function extractFn(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('function not found in ' + path.basename(INDEX) + ': ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

// sbIsChordLine is declared twice in the file (two scopes). The paste path uses
// the one that sits with _CHORD_TOKEN_RE, so take the LAST declaration.
function extractLastFn(name) {
  let idx = -1;
  lines.forEach((l, i) => { if (new RegExp('^  function ' + name + '\\s*\\(').test(l)) idx = i; });
  if (idx < 0) throw new Error('function not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = idx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: idx + 1 };
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

const CHORD_RE_LINE = lines.find(l => /^\s*var _CHORD_TOKEN_RE\s*=/.test(l));
if (!CHORD_RE_LINE) throw new Error('_CHORD_TOKEN_RE not found');

const fns = {
  sbIsChordLine: extractLastFn('sbIsChordLine'),
  sbIsInlineChordLine: extractFn('sbIsInlineChordLine'),
  sbExtractInlineChords: extractFn('sbExtractInlineChords')
};

console.log('Extracted from ' + path.basename(INDEX) + ':');
Object.keys(fns).forEach(n => console.log('  ' + n + ' @ line ' + fns[n].line));
console.log('');

const body = CHORD_RE_LINE + '\n' + Object.keys(fns).map(n => fns[n].text).join('\n\n') +
  '\n; return { sbIsChordLine, sbIsInlineChordLine, sbExtractInlineChords };';
const api = new Function('RegExp', 'String', body)(RegExp, String);

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label);
  if (!ok) console.log('          expected ' + e + '\n          actual   ' + a);
}

// 0 - the classifier underneath, tested directly
//
// WHY THIS SECTION EXISTS, given everything below already passes
//
// sbIsChordLine was extracted by this harness and never called. It came
// along only because sbIsInlineChordLine needs it, and that turns out to
// hide it completely: the first thing sbIsInlineChordLine does is
//
//     if (sbIsChordLine(line)) return false;   // already a pure chord line
//
// Every lyric assertion below expects false. So a lyric WRONGLY judged to be
// a pure chord line still produces false, and every one of those checks goes
// green for entirely the wrong reason. Mutation testing proved it: the
// density threshold and the prose-word veto could both be deleted and this
// file noticed nothing.
//
// That matters because sbIsChordLine decides, on paste, which lines are
// words and which are chords. Get it wrong in this direction and a verse is
// filed as a chord row -- the words are not shown, and nobody is told.
//
// The expected values here were read off the running function, not off the
// regex, so they record what it does rather than what it looks like it does.
console.log('Scenario 0 - chord rows and lyric rows are told apart');
{
  [
    ['G           G7        C        G', true],
    ['D  A  Bm  G', true],
    ['E', true],
  ].forEach(([line, want]) =>
    check('chords: "' + line.slice(0, 30) + '"', api.sbIsChordLine(line), want));

  [
    // Real hymn lines, each with at least one chord-shaped word in it.
    ['Am I a soldier of the cross', false],
    ['A mighty fortress is our God', false],
    ['A wretch like me', false],
    ['C above all powers', false],
    ['Come, now is the time to worship', false],
    ['Be still, my soul', false],
    ['Great is Thy faithfulness', false],
    ['Holy holy holy', false],
    ['   ', false],
  ].forEach(([line, want]) =>
    check('words:  "' + line.slice(0, 30) + '"', api.sbIsChordLine(line), want));

  // Two guards decide this, and the lines above are rejected by BOTH, so
  // either one could be deleted without a single check moving. These four
  // separate them. Do not tidy them away for looking like the ones above --
  // they are the only reason this section has any teeth.
  //
  //   density      at least 0.6 of the words must be chord-shaped
  //   prose veto   no word over four letters that is plainly not a chord
  //
  // Every word here is four letters or fewer, so the prose veto never fires
  // and the density threshold is the only thing saying "these are words".
  [
    ['A day in the sun', false],
    ['Am I to go', false],
    ['E am I to go', false],
  ].forEach(([line, want]) =>
    check('density alone rejects: "' + line + '"', api.sbIsChordLine(line), want));

  // And the other way round: three chords out of four words clears the
  // density threshold comfortably, so only the prose veto rejects it.
  check('the prose veto alone rejects: "G C D repeat"',
    api.sbIsChordLine('G C D repeat'), false);
}

// 1 - lines that must be left exactly as they were typed
console.log('Scenario 1 - an ordinary lyric is never mistaken for inline chords');
{
  // Lines the old rule tore apart: a chord-shaped first word, one or two
  // spaces, then prose.
  const USED_TO_BREAK = [
    'A  mighty fortress is our God',
    'Am I not still the same',
    'E  is the note we start on',
    'A  wretch like me',
    'C  above all powers'
  ];
  USED_TO_BREAK.forEach(l => {
    const got = api.sbIsInlineChordLine(l);
    if (EXPECT_BROKEN) check('(pre-fix) "' + l.slice(0, 26) + '" was split', got, true);
    else check('left alone: "' + l.slice(0, 30) + '"', got, false);
  });

  // Lines that were always safe. They are here so a future rewrite that goes
  // the other way -- splitting more, not less -- is caught too.
  ['Be still, my soul', 'Great is Thy faithfulness', 'How deep the Father\'s love for us']
    .forEach(l => check('always left alone: "' + l.slice(0, 30) + '"', api.sbIsInlineChordLine(l), false));
}

// 2 - lines that genuinely interleave chords with the words
console.log('\nScenario 2 - a real interleaved chart is still recognised');
{
  check('"G  Away in a C  manger" is inline chords',
    api.sbIsInlineChordLine('G  Away in a C  manger'), true);
  check('a pure chord row is not inline chords',
    api.sbIsInlineChordLine('G           G7        C        G'), false);
  check('a blank line is not inline chords', api.sbIsInlineChordLine('   '), false);
}

// 3 - the split itself must not eat the spaces
console.log('\nScenario 3 - splitting a line keeps the words apart');
{
  const got = api.sbExtractInlineChords('G  Away in a C  manger');
  check('the chords come out', got.chords, 'G  C');
  if (EXPECT_BROKEN) {
    check('(pre-fix) the lyric lost its spaces', got.lyrics, 'Awayinamanger');
  } else {
    check('the lyric keeps its spaces', got.lyrics, 'Away in a manger');
  }

  const two = api.sbExtractInlineChords('D  Praise Him all G  creatures here below');
  check('chords from a longer line', two.chords, 'D  G');
  if (EXPECT_BROKEN) {
    check('(pre-fix) the longer lyric was glued too', two.lyrics, 'PraiseHimallcreatureshere below'.replace(/ /g, ''));
  } else {
    check('the longer lyric reads as English', two.lyrics, 'Praise Him all creatures here below');
  }
}

// 4 - a column-aligned chart survives the paste normaliser untouched. This is
//     the shape the paste path runs every pasted line through.
console.log('\nScenario 4 - a column-aligned chart passes through unchanged');
{
  const CHART = [
    '[Verse 1]',
    '     F              Bb/F       F',
    'Amazing Grace, how sweet the sound,',
    '                         C7',
    'that saved a wretch like me.',
    '     Dm        C7     F   Bb/C',
    'was blind, but now I see.'
  ];
  const out = CHART.map(line => {
    if (!api.sbIsInlineChordLine(line)) return line;
    const ex = api.sbExtractInlineChords(line);
    return (ex.chords ? ex.chords + '\n' : '') + ex.lyrics;
  });
  check('every line comes through byte for byte', out, CHART);
  check('the indents are still there',
    out.filter(l => /^ {5,}/.test(l)).length, 3);
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
