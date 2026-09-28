'use strict';
// Regression harness for what the Songbook lyrics pad calls a "line".
//
// WHY THIS EXISTS
// The pad's contenteditable holds the song's line divs AND furniture that
// shares the same parent: A4 page-break markers, column-break markers, A4
// guides, chord zones. Three separate readers each decided for themselves
// which children were lines, and each got it wrong in its own way.
//
//   naming them     sbReclassifyLines named every child by its text content,
//                   so an empty A4 marker became `wo-lyrics-empty-line` -- a
//                   real blank line at the foot of the song. Repagination
//                   appended a fresh marker, the next keystroke converted that
//                   one, and the page grew a line (~37px) per keystroke.
//   saving them     sbExtractLyricsText ran every child through textContent,
//                   so each marker wrote a blank line at the foot and a column
//                   break wrote the literal words "Column Break" into the
//                   middle of the verse, where it stayed.
//   pasting them    _sbDocText read the same phantom lines and paste rebuilt
//                   the pad from that text, making the phantoms real.
//
// The whole defence is now one predicate, _sbIsPadFurniture, and one list,
// _sbPadLines. A class added to the pad without being added to that list
// re-opens all three quietly -- the screen still looks right for a keystroke
// or two -- so it needs a test. The marker-placement code maps source line
// indices back onto _sbPadLines as well, so a reader that disagrees with it
// also puts every page break on the wrong line.
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
// --expect-broken is the negative control: it asserts the rule is ABSENT and is
// meant to be pointed at source from before any of it existed
// (`git show eb423fe:Index.html > x`). Source with only part of the rule fails
// both ways, which is the right answer for a half-applied fix.
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

const NAMES = ['_sbLineClass', 'sbReclassifyLines', '_sbIsPadFurniture', '_sbPadLines',
               'sbExtractLyricsText', '_sbBlockPlainText', '_sbDocText'];
// The two helpers that name the furniture did not exist before the fix. Their
// absence IS the pre-fix state, so stand in for them with what the old code
// effectively did -- treat every child as a line -- rather than failing to
// build. Anywhere but --expect-broken, missing means broken.
const OPTIONAL = { _sbIsPadFurniture: '  function _sbIsPadFurniture() { return false; }',
                   _sbPadLines: '  function _sbPadLines(el) { return Array.prototype.slice.call(el.children); }' };
const fns = {};
for (const n of NAMES) {
  try {
    fns[n] = extractFn(n);
  } catch (e) {
    if (!EXPECT_BROKEN || !OPTIONAL[n]) throw e;
    fns[n] = { text: OPTIONAL[n], line: 0 };
  }
}

console.log('Extracted from ' + path.basename(INDEX) + ':');
for (const n of NAMES) console.log('  ' + n + (fns[n].line ? ' @ line ' + fns[n].line : '  (absent - stood in for)'));

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
    Array, Object, RegExp, String, Math,
    // A chord row is judged elsewhere; here anything that is only chord-ish
    // tokens counts, which is enough to tell a chord row from a lyric.
    isChordLineGlobal: t => /^[\s]*([A-G][#b♯♭]?(m|maj|min|sus|dim|aug|add)?\d*(\/[A-G][#b♯♭]?)?[\s]*)+$/.test(t || '') && /[A-G]/.test(t || ''),
    sbApplySectionBadges: undefined
  };
  const body = NAMES.map(n => fns[n].text).join('\n\n') +
    '\n; return { _sbLineClass, sbReclassifyLines, _sbIsPadFurniture, _sbPadLines,' +
    ' sbExtractLyricsText, _sbDocText };';
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

// 4 - the save path. sbExtractLyricsText is what writes song.lyrics, seeds the
//     canonical text, feeds pagination and feeds the printed page.
console.log('\nScenario 4 - reading the pad as text steps over the furniture');
{
  const kids = [
    Div('wo-lyrics-section-header verse', '[Verse 1]'),
    Div('wo-lyrics-lyric-line', 'Amazing grace how sweet the sound'),
    Div('sb-col-break-marker', 'Column Break✕'),
    Div('wo-lyrics-lyric-line', 'That saved a wretch like me'),
    Div('sb-a4-marker', '')
  ];
  const pad = { children: kids, childNodes: kids.slice(), insertBefore() {} };
  const { api } = makeEnv(pad);
  const lines = api.sbExtractLyricsText(pad).split('\n');

  if (EXPECT_BROKEN) {
    check('(pre-fix) the column break was saved as a line of the song',
      lines.some(l => /Column Break/.test(l)), true);
    check('(pre-fix) the page marker left a blank line at the foot',
      lines[lines.length - 1], '');
  } else {
    check('the saved text is exactly the song',
      lines, ['[Verse 1]', 'Amazing grace how sweet the sound', 'That saved a wretch like me']);
    check('no "Column Break" in the saved lyrics', lines.some(l => /Column Break/.test(l)), false);
    check('no blank line left at the foot', lines[lines.length - 1] === '', false);
  }
}

// 5 - copy / cut / paste read the pad through _sbDocText, and paste rebuilds the
//     pad from what it read, so a phantom line there becomes a real one.
console.log('\nScenario 5 - the paste text matches the saved text');
{
  const kids = [
    Div('wo-lyrics-lyric-line', 'Through many dangers'),
    Div('sb-a4-marker', ''),
    Div('wo-lyrics-empty-line', ''),
    Div('wo-lyrics-lyric-line', 'I have already come')
  ];
  const pad = { children: kids, childNodes: kids.slice(), insertBefore() {} };
  const { api } = makeEnv(pad);
  const doc = api._sbDocText(pad).split('\n');

  if (EXPECT_BROKEN) {
    check('(pre-fix) the paste text carried the marker as a blank line', doc.length, 4);
  } else {
    check('the paste text is the three real lines', doc.length, 3);
    check('the one real blank line is still one', doc.filter(l => l === '').length, 1);
    check('paste and save read the pad the same way',
      doc.join('|'), api.sbExtractLyricsText(pad).split('\n').join('|'));
  }
}

// 6 - a chord zone looks like furniture and is not: a tap makes it editable and
//     the operator types the chords straight into it.
console.log('\nScenario 6 - a chord zone keeps its chords');
{
  const kids = [
    Div('wo-lyrics-chord-line wo-sb-chord-zone', 'G      C      D'),
    Div('wo-lyrics-lyric-line', 'Amazing grace')
  ];
  const pad = { children: kids, childNodes: kids.slice(), insertBefore() {} };
  const { api } = makeEnv(pad);
  check('a chord zone is not furniture', api._sbIsPadFurniture(kids[0]), false);
  check('its chords are saved', api.sbExtractLyricsText(pad).split('\n')[0], 'G      C      D');
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
