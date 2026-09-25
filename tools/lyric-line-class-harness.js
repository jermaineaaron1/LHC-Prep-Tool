'use strict';
// Regression harness for what the Songbook lyrics pad calls a "line".
//
// WHY THIS EXISTS
// The pad's contenteditable holds the song's line divs AND furniture that
// shares the same parent: A4 page-break markers, column guides, chord zones.
// The markers are empty divs. sbReclassifyLines walks every child and names it
// by its text content, so an empty marker classified as a line became
// `wo-lyrics-empty-line` -- a real blank line at the foot of the song. The next
// repagination appended a fresh marker, the next keystroke converted that one,
// and the page grew by a line (~37px) per keystroke. The blank lines were real
// enough to be saved: songs in the library had reached twenty of them.
//
// The whole defence is one list of class names in _sbLineClass. A class added
// to the pad without being added to that list re-opens the bug silently -- the
// screen still looks right for a keystroke or two -- so it needs a test.
//
// HOW IT WORKS
// It does not reimplement the functions. It slices their REAL source text out
// of Index.html by brace balance and runs that text against a small stub. So
// the code under test is the shipped code.
//
// USAGE
//   node tools/lyric-line-class-harness.js                 # checks ../Index.html
//   node tools/lyric-line-class-harness.js path/to/file.html
//   node tools/lyric-line-class-harness.js <file> --expect-broken
//
// --expect-broken is the negative control: it asserts the fix is ABSENT and is
// meant to be pointed at pre-fix source (`git show <rev>:Index.html > x`).
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

const lines = fs.readFileSync(INDEX, 'utf8').split('\n');

// Slice a top-level `  function NAME(` out of the WO IIFE by brace balance.
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

const NAMES = ['_sbLineClass', 'sbReclassifyLines'];
const fns = {};
for (const n of NAMES) fns[n] = extractFn(n);

console.log('Extracted from ' + path.basename(INDEX) + ':');
for (const n of NAMES) console.log('  ' + n + ' @ line ' + fns[n].line);

// The reclassifier must leave furniture alone. Without this guard the list in
// _sbLineClass would be decorative.
{
  const t = fns.sbReclassifyLines.text;
  const has = /if\s*\(k === 'pair' \|\| k === 'zone'\) return;/.test(t);
  if (!has) throw new Error('sbReclassifyLines no longer skips pair/zone children');
}
console.log('  (sbReclassifyLines skips pair/zone children)\n');

// A div is just a class list and some text as far as these two functions care.
function Div(cls, text) {
  const set = new Set(String(cls || '').split(/\s+/).filter(Boolean));
  return {
    nodeType: 1,
    tagName: 'DIV',
    textContent: text == null ? '' : text,
    classList: { contains: c => set.has(c) },
    get className() { return Array.from(set).join(' '); },
    set className(v) { set.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => set.add(c)); }
  };
}

function makeEnv(pad) {
  const env = {
    document: {
      getElementById: () => pad,
      createElement: tag => Div('', '')
    },
    Array, Object, RegExp, String,
    // A chord row is judged elsewhere; here anything that is only chord-ish
    // tokens counts, which is enough to tell a chord row from a lyric.
    isChordLineGlobal: t => /^[\s]*([A-G][#b♯♭]?(m|maj|min|sus|dim|aug|add)?\d*(\/[A-G][#b♯♭]?)?[\s]*)+$/.test(t || '') && /[A-G]/.test(t || ''),
    sbApplySectionBadges: undefined
  };
  const body = NAMES.map(n => fns[n].text).join('\n\n') +
    '\n; return { _sbLineClass, sbReclassifyLines };';
  const keys = Object.keys(env);
  return { env, api: new Function(...keys, body)(...keys.map(k => env[k])) };
}

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label);
  if (!ok) console.log('          expected ' + e + '\n          actual   ' + a);
}

// 1 - what each kind of child is called
console.log('Scenario 1 - _sbLineClass names every child of the pad');
{
  const { api } = makeEnv({ children: [], childNodes: [] });
  const c = api._sbLineClass;
  const furniture = ['sb-a4-marker', 'sb-a4-guide', 'sb-col-break-marker', 'wo-sb-chord-zone'];
  furniture.forEach(cls => {
    const got = c(Div(cls, ''));
    if (EXPECT_BROKEN && (cls === 'sb-a4-marker' || cls === 'sb-a4-guide')) {
      check(cls + ' is (still, pre-fix) mistaken for a lyric line', got, 'lyric');
    } else {
      check(cls + ' is furniture, not a line', got, 'zone');
    }
  });
  check('a chord pair is a pair', c(Div('wo-lyrics-chord-pair', '')), 'pair');
  check('a chord row is chords', c(Div('wo-lyrics-chord-line', 'G  C  D')), 'chord');
  check('a section header is a header', c(Div('wo-lyrics-section-header verse', '[Verse 1]')), 'section');
  check('a blank line is blank', c(Div('wo-lyrics-empty-line', '')), 'empty');
  check('anything else is a lyric', c(Div('wo-lyrics-lyric-line', 'Amazing grace')), 'lyric');
}

// 2 - the reported bug, end to end
console.log('\nScenario 2 - a page marker at the foot survives reclassification');
{
  const kids = [
    Div('wo-lyrics-section-header verse', '[Verse 1]'),
    Div('wo-lyrics-chord-line', 'G      C'),
    Div('wo-lyrics-lyric-line', 'Amazing grace how sweet'),
    Div('sb-a4-marker', '')
  ];
  const pad = { children: kids, childNodes: kids.slice(), insertBefore() {}, };
  const { api } = makeEnv(pad);

  api.sbReclassifyLines('sid');
  const marker = kids[3];
  if (EXPECT_BROKEN) {
    check('(pre-fix) the marker was turned into a blank line', marker.className, 'wo-lyrics-empty-line');
  } else {
    check('the marker is still a marker', marker.className, 'sb-a4-marker');
    check('no blank line was invented', kids.filter(k => k.className === 'wo-lyrics-empty-line').length, 0);
  }
  check('the header kept its badge class', kids[0].className, 'wo-lyrics-section-header verse');
  check('the chord row is still a chord row', kids[1].className, 'wo-lyrics-chord-line');
  check('the lyric is still a lyric', kids[2].className, 'wo-lyrics-lyric-line');
}

// 3 - a marker BETWEEN lines is equally untouchable (markers sit where the
//     page breaks, which is usually mid-song, not at the foot).
console.log('\nScenario 3 - a page marker mid-song is left alone too');
{
  const kids = [
    Div('wo-lyrics-lyric-line', 'Through many dangers'),
    Div('sb-a4-marker', ''),
    Div('wo-lyrics-empty-line', ''),
    Div('wo-lyrics-lyric-line', 'I have already come')
  ];
  const pad = { children: kids, childNodes: kids.slice(), insertBefore() {} };
  const { api } = makeEnv(pad);

  api.sbReclassifyLines('sid');
  if (EXPECT_BROKEN) {
    check('(pre-fix) the mid-song marker became a blank line', kids[1].className, 'wo-lyrics-empty-line');
  } else {
    check('the mid-song marker is untouched', kids[1].className, 'sb-a4-marker');
    check('the one real blank line is still one', kids.filter(k => k.className === 'wo-lyrics-empty-line').length, 1);
  }
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
