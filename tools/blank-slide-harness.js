'use strict';
// Regression harness for slides that can project nothing.
//
// WHY THIS EXISTS
// A song whose [Intro] section holds only chords turns into a slide with
// nothing on it. The chords are stripped on the way to a slide and there is
// no text left, so the slide is saved with no content, no header and no
// background -- a blank screen in the middle of a song.
//
// One of these reached the 11 October 2026 service. It was found by `npm run
// audit`, not by anyone looking at the projector, which is the whole problem
// with a blank slide: on screen it reads as the projector misbehaving rather
// than as something wrong with the order, so nobody reports it.
//
// WHAT THIS CHECKS
// The rule, and -- more importantly -- the two exceptions to it, because the
// obvious over-correction here is to drop every slide with no words.
//
//   a header and no words        KEPT. "Intro" before the band starts, or a
//                                card saying the arrangement changes, is a
//                                real slide that is meant to carry no lyric.
//   a background and no words    KEPT. That is a deliberate image.
//   none of the three            dropped. Nothing can appear.
//
// And that the surviving slides are renumbered, so removing one does not
// leave a gap in `index` that the projector rail counts through.
//
// USAGE
//   node tools/blank-slide-harness.js                 # ../Index.html
//   node tools/blank-slide-harness.js path/to/file.html
//   node tools/blank-slide-harness.js <file> --expect-broken
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
const lines = raw.split('\n');

function extractFunction(name) {
  const start = lines.findIndex(l => new RegExp('^\\s*function ' + name + '\\s*\\(').test(l));
  if (start < 0) return null;
  let depth = 0, started = false;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces in ' + name);
}

const fn = extractFunction('_slideShowsNothing');
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _slideShowsNothing  ' + (fn ? 'found' : 'ABSENT') + '\n');

if (!fn) {
  if (EXPECT_BROKEN) {
    console.log('Absent, as expected for pre-fix source.');
    process.exit(0);
  }
  console.error('_slideShowsNothing is missing.');
  process.exit(1);
}

const blank = new Function(fn + '\nreturn _slideShowsNothing;')();

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

console.log('what counts as showing nothing');
check('no words, no header, no background', blank('', '', ''), true);
check('whitespace only is still nothing', blank('   \n\t ', '  ', ''), true);
check('null and undefined are nothing', blank(null, undefined, null), true);
check('no arguments at all', blank(), true);

console.log('\nwhat must survive -- these are real slides');
check('a header with no words (the Intro card)', blank('', 'Intro', ''), false);
check('a background with no words (a deliberate image)', blank('', '', 'bg-dark.jpg'), false);
check('words with no header', blank('I just want to be where You are', '', ''), false);
check('all three present', blank('words', 'Chorus', 'bg.jpg'), false);
check('a single character counts as words', blank('.', '', ''), false);
check('a header of only whitespace does not save it', blank('', '   ', ''), true);

console.log('\nthe three collectors all consult it');
// Songs, liturgy and scripture each build their own slide array from the DOM.
// A guard in one of them is a guard in one of them.
const guarded = (raw.match(/_slideShowsNothing\(/g) || []).length;
check('called from at least three places plus its definition', guarded >= 4, true);
check('the song collector guards', /_slideShowsNothing\(_c, _h, _bg\)/.test(raw), true);
check('the liturgy collector guards', /_slideShowsNothing\(_lc, _lh, _lbg\)/.test(raw), true);
check('the scripture collector guards', /_slideShowsNothing\(_sc, '', _sbg\)/.test(raw), true);

console.log('\nwhat is kept is renumbered, so the rail counts straight');
check('the collectors number from what has been kept',
  (raw.match(/index:\s*slides\.length/g) || []).length >= 3, true);

// ---- the write boundary --------------------------------------------------
//
// Guarding the collectors was not enough, and the way it failed is the reason
// this section exists. The blank slide was removed from the 11 October order;
// the collector guard went live twenty minutes later; the slide was back four
// minutes after that -- written by a page that still held it in memory, through
// a path none of the three collectors owns.
//
// Slides reach the database from a dozen places. There is one door out, and
// the guard has to be standing in it.
console.log('\nthe write boundary prunes, whatever built the slide');
const pruneFn = extractFunction('_prunedSlides');
if (!pruneFn) {
  check('_prunedSlides exists', false, true);
} else {
  const mk = (c, h, b) => ({ content: c, header: h, background: b, index: 0 });
  const prune = new Function('window', 'console',
    pruneFn + '\nreturn _prunedSlides;')({ LHC_slideShowsNothing: blank }, { warn() {} });

  check('a blank slide is dropped', prune([mk('', '', ''), mk('words', '', '')]).length, 1);
  check('a header-only slide is kept', prune([mk('', 'Intro', '')]).length, 1);
  check('a background-only slide is kept', prune([mk('', '', 'bg.jpg')]).length, 1);
  check('nothing to drop leaves the list alone', prune([mk('a', '', ''), mk('b', '', '')]).length, 2);

  const renum = prune([mk('', '', ''), mk('a', '', ''), mk('b', '', '')]);
  check('survivors are renumbered', renum.map(s => s.index), [0, 1]);
  check('  and keep their content in order', renum.map(s => s.content), ['a', 'b']);
  check('fields beyond the three survive renumbering',
    prune([mk('', '', ''), Object.assign(mk('a', '', ''), { richHtml: '<b>a</b>' })])[0].richHtml, '<b>a</b>');
  check('a non-array does not become one', prune(null), []);

  // Dropping slides because the predicate had not loaded would be far worse
  // than keeping a blank one, so that case saves what it was given.
  const noPredicate = new Function('window', 'console',
    pruneFn + '\nreturn _prunedSlides;')({}, { warn() {} });
  check('with no predicate loaded, nothing is dropped',
    noPredicate([mk('', '', ''), mk('a', '', '')]).length, 2);
}

// ---- the parser itself, run for real -------------------------------------
//
// This is where the bug actually came from. parseLyricsIntoSlides returns
// { header, lines }, and the fallback that turns those into slides used to
// keep only the lines -- so a section whose header was the only thing in it
// arrived as an empty string with nothing to redeem it.
//
// Checking the parser's output directly is worth more than grepping the
// mappers: if it never emits a section with neither a header nor a line,
// then no mapper can invent one.
const parseFn = extractFunction('parseLyricsIntoSlides');
console.log('\nthe parser never emits a section with neither header nor lines');
if (!parseFn) {
  check('parseLyricsIntoSlides found', false, true);
} else {
  // Its only dependency: a chord-line test. The real one lives elsewhere in
  // the file; this is the same judgement, narrowed to what these cases need.
  const isChord = l => {
    const t = String(l || '').trim();
    if (!t) return false;
    return t.split(/\s+/).every(w => /^[A-G](#|b)?(m|maj|min|dim|aug|sus|add)?[0-9]*(\/[A-G](#|b)?)?$/.test(w));
  };
  let parse;
  try {
    parse = new Function('isChordLineGlobal', parseFn + '\nreturn parseLyricsIntoSlides;')(isChord);
  } catch (e) {
    check('parseLyricsIntoSlides runs standalone', 'threw: ' + e.message, 'ok');
  }
  if (parse) {
    // The exact song that put a blank slide into the 11 October service.
    const REAL = [
      '[Intro]', '', 'G Am C D C G', 'G Am C D Eb F G', '', '',
      '[Verse 1]', '', '               Am                      C',
      'I just want to be where You are,', '          D              C   G',
      'dwelling daily in Your presence', ''
    ].join('\n');
    const out = parse(REAL);
    const nothing = out.filter(s => !String(s.header || '').trim() && !(s.lines || []).join('').trim());
    check('the real song parses with no empty section', nothing.length, 0);
    check('  and the Intro survives as a header', out.some(s => /intro/i.test(s.header || '')), true);

    [
      ['empty string', ''],
      ['only blank lines', '\n\n\n'],
      ['a header and nothing else', '[Intro]'],
      ['two headers in a row', '[Intro]\n[Verse 1]\nword'],
      ['only chords, no header', 'G Am C D'],
      ['trailing blank lines', 'word\n\n\n\n']
    ].forEach(([label, text]) => {
      const r = parse(text) || [];
      const empties = r.filter(s => !String(s.header || '').trim() && !(s.lines || []).join('').trim());
      check(label, empties.length, 0);
    });
  }
}

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
if (pass === results.length) console.log('A slide that could show nothing is no longer saved.');
process.exit(pass === results.length ? 0 : 1);
