'use strict';
// Tests for the scanner's text handling: the parts that run on every scan and
// have no business getting a different answer twice.
//
// WHY THIS EXISTS
// The other two scan tools talk to the network. scan-eval runs sheets through
// production and scan-audit checks them against what is printed on the page --
// both need an API key, both cost Gemini calls, both are slow, and both give
// slightly different answers each run because the model does. None of that is
// true of the code in here. Joining a split syllable, wrapping a long line,
// deciding whether a row is chords or words, working a key out from a chord
// set: all of it is arithmetic on strings, and arithmetic can be pinned down
// exactly.
//
// So this runs offline, in about a second, and belongs with the other repo
// checks rather than with the scanning tools.
//
// HOW IT WORKS
// The functions are lifted out of route.ts and compiled by the project's own
// TypeScript. Nothing is reimplemented here: a test that carries its own copy
// of the thing it tests passes happily while the real code rots. If an anchor
// stops matching, this fails loudly rather than quietly testing nothing.
//
// WHAT IS COVERED
//   1. the pipeline loses no letter and no chord, over 1000 generated verses
//   2. the faults that have actually bitten, kept as named cases
//   3. isChordLine tells chords from lyrics, including the awkward real ones
//   4. a suggested chord is checked against the key it claims
//   5. a key is worked out from a chord set, or honestly refused
//
// USAGE
//   node tools/scan-text-tests.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ROUTE = path.join(ROOT, 'app/api/parse-song-sheet/route.ts');
const SRC = fs.readFileSync(ROUTE, 'utf8');
const ts = require(path.join(ROOT, 'node_modules', 'typescript'));

// route.ts is stored CRLF; a function ends at the first close-brace in column 0.
const CLOSE = SRC.includes('\r\n') ? '\r\n}' : '\n}';

function grab(start, end) {
  const a = SRC.indexOf(start);
  if (a < 0) throw new Error('anchor missing from route.ts: ' + start + '\n(has the function been renamed? fix the anchor rather than deleting the test)');
  const b = SRC.indexOf(end, a);
  if (b < 0) throw new Error('no end found for: ' + start);
  return SRC.slice(a, b + end.length);
}

const PARTS = [
  grab('const CHORD_ACCIDENTAL', "CHORD_ONE + ')*$');"),
  grab('const NEARLY_A_CHORD', CLOSE),          // carries isChordLine with it
  grab('const PITCH:', '};'),
  grab('const MAJOR_STEPS', '];'),
  grab('const MINOR_STEPS', '];'),
  grab('function chordRoot(', CLOSE),
  grab('function outOfKeyChords(', CLOSE),
  grab('const PITCH_NAMES', '];'),
  grab('function inferKeyFromChords(', CLOSE),
  grab('const STANDALONE_AFTER_DASH', ']);'),
  grab('const KEEP_HYPHEN', ']);'),
  grab('function hyphenRanges(', CLOSE),
  grab('function shiftChordLine(', CLOSE),
  grab('function joinSyllables(', CLOSE),
  grab('function tokensOf(', CLOSE),
  grab('function render(', CLOSE),
  grab('const ENDS_A_LINE', CLOSE),             // carries mergeBrokenLines
  grab('const MAX_WORDS', ';'),
  grab('function breakAfter(', CLOSE),
  grab('function reflowLines(', CLOSE),
  grab('function tidy(', CLOSE),
];

const js = ts.transpileModule(PARTS.join('\n\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

const mod = { exports: {} };
new Function('module', 'exports', js +
  '\nmodule.exports = { isChordLine, CHORD_TOKEN, joinSyllables, mergeBrokenLines, reflowLines, tidy, outOfKeyChords, inferKeyFromChords };'
)(mod, mod.exports);

const { isChordLine, CHORD_TOKEN, joinSyllables, mergeBrokenLines, reflowLines, tidy,
        outOfKeyChords, inferKeyFromChords } = mod.exports;

// The pipeline exactly as the route runs it, second join included.
const run = (t) => tidy(reflowLines(joinSyllables(mergeBrokenLines(joinSyllables(t)))));

let failures = 0;
const ok = (name) => console.log('  ok    ' + name);
const bad = (name, detail) => { failures++; console.log('  FAIL  ' + name); if (detail) console.log('        ' + detail); };
const is = (name, got, want) => (got === want ? ok(name) : bad(name, 'wanted ' + JSON.stringify(want) + ', got ' + JSON.stringify(got)));
const has = (name, hay, needle) => (String(hay).includes(needle) ? ok(name) : bad(name, 'wanted ' + JSON.stringify(needle) + ' in ' + JSON.stringify(hay)));

// ── 1. nothing is lost ─────────────────────────────────────────────────────
// Words are the wrong unit: joining a split syllable changes the word count on
// purpose. Letters are not. No letter of a lyric may vanish or swap places, and
// no chord may be dropped, welded to its neighbour or mangled.
console.log('');
console.log('the pipeline loses no letter and no chord');

const WORDS = ['grace', 'lead', 'eth', 'me', 'O', 'blessed', 'thought', 'holy', 'praise',
  'Lord', 'God', 'sing', 'my', 'soul', 'the', 'of', 'and', 'to', 'with', 'joy', 'peace'];
const CHORDS = ['C', 'G', 'Am', 'F', 'D7', 'Em', 'Bm', 'G/B', 'Csus4', 'Fmaj7', 'A', 'Dm', 'E7'];
let seed = 20260822;                                    // fixed, so a failure reproduces
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];

function makeVerse() {
  const lines = ['[Verse ' + (1 + Math.floor(rnd() * 3)) + ']'];
  for (let i = 0, n = 2 + Math.floor(rnd() * 4); i < n; i++) {
    let lyric = '';
    const cols = [];
    for (let w = 0, wc = 3 + Math.floor(rnd() * 12); w < wc; w++) {
      if (rnd() < 0.18) cols.push(lyric.length);
      lyric += (rnd() < 0.15 ? pick(WORDS) + ' - ' + pick(WORDS) : pick(WORDS));
      if (rnd() < 0.12) lyric += ',';
      lyric += ' ';
    }
    lyric = lyric.replace(/\s+$/, '');
    if (cols.length) {
      let cl = '';
      for (const c of cols) {
        if (c > cl.length) cl += ' '.repeat(c - cl.length);
        else if (cl.length) cl += ' ';                  // two chords must never touch
        cl += pick(CHORDS);
      }
      lines.push(cl);
    }
    lines.push(lyric);
  }
  return lines.join('\n');
}

const lettersOf = (t) => t.split(/\r?\n/)
  .filter((l) => l.trim() && !isChordLine(l) && !/^\[.*\]$/.test(l.trim()))
  .join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '');
const chordsOf = (t) => (t.split(/\r?\n/).filter(isChordLine).join(' ').match(/\S+/g) || []);

let lost = 0;
const N = 1000;
for (let i = 0; i < N; i++) {
  const src = makeVerse();
  const out = run(src);
  const sameLetters = lettersOf(src) === lettersOf(out);
  const sameChords = chordsOf(src).sort().join('|') === chordsOf(out).sort().join('|');
  if (!sameLetters || !sameChords) {
    lost++;
    if (lost === 1) {
      console.log('        first failing verse (seed ' + 20260822 + ', case ' + i + '):');
      console.log('        IN  ' + JSON.stringify(src));
      console.log('        OUT ' + JSON.stringify(out));
    }
  }
}
if (lost) bad(N - lost + '/' + N + ' verses survived intact');
else ok(N + '/' + N + ' verses kept every letter and every chord');

// ── 2. the faults that actually bit ────────────────────────────────────────
console.log('');
console.log('regressions, each one a bug that shipped once');
has('a punctuation dash is not a syllable join', run('Holy - Holy - Holy'), 'Holy - Holy - Holy');
has('a spaced syllable hyphen joins', run('He lead - eth me'), 'He leadeth me');
has('a tight syllable hyphen joins too', run('He lead-eth me'), 'He leadeth me');
has('a hyphen split across a line ending joins', run('Grace un-\nknown! And love beyond'), 'unknown!');
has('a real compound keeps its hyphen', run('A well-known hymn we sing'), 'well-known');
has('a compound survives a line-break merge', run('A well-\nknown hymn we sing'), 'well-known');
has('two chords are never welded', run('Am F\nlead - eth me now'), 'Am F');
has('a chord above a section header survives', run('G\n[BRIDGE]\nPray'), 'G');
has('a direction on a chord line keeps it a chord line', run('E7 (x2)\nthis is the day'), 'E7 (x2)');
is('a comma still ends a line', run('He leadeth me,\nO blessed thought'), 'He leadeth me,\nO blessed thought');
is('a full stop still ends a line', run('with my soul.\nIt is well'), 'with my soul.\nIt is well');
is('a one-word fragment rejoins even with a comma', run('O,\nthe bliss of this glorious thought'), 'O, the bliss of this glorious thought');
is('a mid-phrase break is closed up', run('and did my\nSovereign die?'), 'and did my Sovereign die?');
is('nothing merges across a section header',
   run('and did my\n\n[Verse 2]\nWas it for crimes'), 'and did my\n\n[Verse 2]\nWas it for crimes');

// ── 3. chords or words ─────────────────────────────────────────────────────
console.log('');
console.log('a chord line is told from a lyric line');
for (const tok of ['Ab', 'Ab/G', '/G', '/F#', 'Db-Ab', 'C-G', 'Bbm', 'G7', 'Csus4', 'F#m7b5', 'A♭'])
  (CHORD_TOKEN.test(tok) ? ok : (n) => bad(n))('accepts ' + tok);
for (const tok of ['A-men', 'well-known', 'Amazing', 'the', 'Sa-vior', '-G', 'G/', 'Hallelujah'])
  (!CHORD_TOKEN.test(tok) ? ok : (n) => bad(n))('rejects ' + tok);

is('a misread chord does not cost the whole line',
   isChordLine('Bbn     Eb Ab (Cm)Db  Ab/Eb   Ab'), true);
is('a handwritten dash and bracket line reads as chords',
   isChordLine('Ab      Db-Ab       Eb      Ab      (Cm)'), true);
is('a split slash bass reads as chords', isChordLine('        (Fm)            Ab   /G  Fm'), true);
is('"A men" is lyrics', isChordLine('A men'), false);
is('"Do Re Mi" is lyrics', isChordLine('Do Re Mi'), false);
is('"Be still my soul" is lyrics', isChordLine('Be still my soul'), false);
is('a lyric opening on a capital A is lyrics', isChordLine('Alas! and did my Savior bleed,'), false);
is('a genuine chord row is chords', isChordLine('C G A B'), true);

// ── 4. a suggested chord must belong to the key it claims ──────────────────
console.log('');
console.log('suggested chords are checked against their key');
const outOf = (text, key) => outOfKeyChords(text, key).sort().join(',');
is('diatonic in G passes', outOf('G        Am   Bm  C\nHe leadeth me O bless', 'G'), '');
is('a V7 at the cadence is fine', outOf('G     D7    G\nend of the verse', 'G'), '');
is('slash chords judged on both halves', outOf('G/B   C/E   D\nover the bass line', 'G'), '');
is('a borrowed Eb is caught', outOf('G     Eb    C\nthis one is wrong', 'G'), 'Eb');
is('a bad bass note is caught', outOf('C     F/Ab  G\nthe bass is out', 'C'), 'F/Ab');
is('minor keys use the minor scale', outOf('Am    Dm    E7   F\nin the minor', 'Am'), '');
is('flat keys work', outOf('Bb    Eb    F7   Gm\nflat key', 'Bb'), '');
is('an unknown key judges nothing', outOf('G     Eb    C\ncannot judge', null), '');
is('lyrics are never mistaken for chords here',
   outOf('[Verse 1]\nA mighty fortress is our God', 'G'), '');

// ── 5. working the key out from the chords ─────────────────────────────────
console.log('');
console.log('a key is deduced, or honestly refused');
is('the Alas chord set reads as A-flat',
   inferKeyFromChords('Ab      Db  Eb      Ab\nAlas and did my Savior bleed\nBbm   Eb  Ab  Cm  Db  Ab/Eb  Ab\nsacred head for sinners such as I'), 'Ab');
is('He Leadeth Me reads as C',
   inferKeyFromChords('C   G7  C   F   C\nHe leadeth me O blessed thought\nC   Am  G7  C\ntis Gods hand that leadeth me'), 'C');
is('a plain three-chord song in G', inferKeyFromChords('G  C  D  G\nsome words here to anchor it'), 'G');
is('two chords is not enough to tell', inferKeyFromChords('C   G\nnot enough information'), null);
is('a chord set fitting no key is refused', inferKeyFromChords('Ab  Db  E  Bbm  Cm\nimpossible set'), null);
is('an ambiguous pair is settled by the closing chord',
   inferKeyFromChords('F  Bb  C  Dm  Gm  F\na line of words beneath them'), 'F');

console.log('');
console.log('================================');
console.log(failures ? failures + ' failure(s)' : 'scan text handling holds');
process.exit(failures ? 1 : 0);
