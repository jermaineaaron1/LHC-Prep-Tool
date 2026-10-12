'use strict';
// Regression harness for chord alignment in the songbook.
//
// WHY THIS EXISTS
// Chords are not attached to syllables. They are a separate line of text,
// positioned with leading spaces:
//
//             F            G
//   Oh let the Son of God enfold you
//
// That only lands on the right syllable if the chord line and the lyric line
// are rendered in the SAME fixed-width font at the SAME size. Nothing in the
// markup says so; it is held together entirely by CSS, in a rule that names
// both classes at once.
//
// Which makes it quiet to break. Give the lyric line a nicer proportional
// font -- Arial Black was asked for, and it is a reasonable thing to want --
// and every chord in 55 of the 65 songs slides off its word. Nothing errors,
// nothing looks obviously wrong in a screenshot, and the first person to find
// out is a musician on a Sunday.
//
// WHAT THIS CHECKS
//   - the rule that forces both lines to one font still names BOTH classes
//   - the stack is monospace end to end, with a monospace final fallback
//   - no rule gives the lyric line a proportional family inside the songbook
//
// It deliberately does NOT pin a particular font. Courier New was replaced
// with a modern stack and that was an improvement; the next one should be
// possible too, so long as it stays fixed-width.
//
// USAGE
//   node tools/chord-alignment-harness.js                 # ../Index.html
//   node tools/chord-alignment-harness.js path/to/file.html
//   node tools/chord-alignment-harness.js <file> --expect-broken
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

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label + (detail ? '  -- ' + detail : ''));
}

// Fonts that are definitely NOT fixed-width. A stack containing one of these
// before a monospace entry would move the chords.
const PROPORTIONAL = /\b(Arial Black|Arial|Helvetica|Georgia|Palatino|Times|Trebuchet|Verdana|Tahoma|Poppins|Lato|Cinzel|Playfair)\b/i;

// Finding CSS rules without catastrophic backtracking.
//
// The obvious pattern -- /[^{}]*A[^{}]*B[^{}]*\{([^}]*)\}/g -- took 127
// seconds over this 5MB file. That was 93% of the entire test suite, and the
// reason `npm run check` had grown to over two minutes: every position that
// fails to match re-walks those character classes.
//
// Scanning for a literal with indexOf and expanding to the braces around it
// is linear, and does the same job in milliseconds.
function rulesContaining(text, ...needles) {
  const seen = new Set();
  const out = [];
  // Scanned from EVERY needle, not just the first, so a selector listing them
  // in the other order is still found. Deduplicated by brace position.
  for (const needle of needles) {
    let i = 0;
    while ((i = text.indexOf(needle, i)) !== -1) {
      const open = text.indexOf('{', i);
      i += needle.length;
      if (open === -1) break;
      if (seen.has(open)) continue;
      // A selector begins after the nearest preceding brace or semicolon --
      // including an OPENING brace, because a rule inside @media { ... } has
      // no closing brace between it and the media query. Leaving '{' out of
      // this list sent `start` back past the @media line, blew the length
      // bound below, and silently skipped the rule: the mutation test caught
      // it by breaking that exact rule and watching the harness stay green.
      const start = Math.max(
        text.lastIndexOf('}', open - 1),
        text.lastIndexOf('{', open - 1),
        text.lastIndexOf(';', open - 1),
        0
      ) + 1;
      // A selector longer than this is not a selector -- the needle was in a
      // comment or a string, and the next brace belongs to something else.
      if (open - start > 600) continue;
      const close = text.indexOf('}', open);
      if (close === -1) break;
      const sel = text.slice(start, open);
      if (!needles.every(n => sel.includes(n))) continue;
      seen.add(open);
      out.push({
        sel: sel.replace(/\s+/g, ' ').trim(),
        body: text.slice(open + 1, close).replace(/\s+/g, ' ').trim()
      });
    }
  }
  return out;
}

// The rule that binds the two lines together: one selector list naming both
// classes, with one font-family for the pair.
const pairRules = rulesContaining(raw, 'wo-lyrics-chord-line', 'wo-lyrics-lyric-line');

console.log('Reading ' + path.basename(INDEX) + ':');
console.log('  rules naming BOTH the chord line and the lyric line: ' + pairRules.length + '\n');

console.log('the two lines are bound to one font');
check('at least one rule sets the pair together', pairRules.length > 0,
  pairRules.length + ' found');

const withFont = pairRules.filter(r => /font-family\s*:/.test(r.body));
check('  and at least one of those sets font-family', withFont.length > 0,
  withFont.length + ' of ' + pairRules.length);

withFont.forEach((r, i) => {
  const fam = (r.body.match(/font-family\s*:([^;]*)/) || [])[1] || '';
  const mono = /monospace/i.test(fam);
  const prop = PROPORTIONAL.test(fam);
  check('pair rule ' + (i + 1) + ' is monospace', mono && !prop,
    fam.trim().slice(0, 72) + (prop ? '  <-- contains a proportional family' : ''));
  check('  and ends in a monospace fallback', /monospace\s*!?\s*important?\s*$/i.test(fam.trim()),
    fam.trim().slice(-30));
});

// The lyric line must never be given a proportional family inside the songbook.
// (The .sb-page-lyrics container may be proportional -- that is the setting
// that applies to songs with no chords at all, which is the point.)
console.log('\nno songbook rule hands the lyric line a proportional font');
const lyricRules = rulesContaining(raw, 'wo-lyrics-lyric-line', 'songbookLiveModal');
const offenders = lyricRules.filter(r => {
  const fam = (r.body.match(/font-family\s*:([^;]*)/) || [])[1];
  return fam && PROPORTIONAL.test(fam) && !/monospace/i.test(fam);
});
check('none found', offenders.length === 0,
  offenders.length ? offenders.map(o => o.sel.slice(0, 50)).join(' | ') : lyricRules.length + ' lyric-line rules inspected');

// ---- the Liturgy Book ----------------------------------------------------
//
// A second surface that draws chord charts, with its own CSS. Its comment
// claimed it mirrored the songbook exactly; it did not. The chord line was
// Courier at 0.82rem over a lyric line that inherited a proportional font at
// 0.97rem -- different family AND different size, so nothing in that view was
// ever actually aligned. Two surfaces, one rule, and only a test keeps the
// second one honest.
console.log('\nthe Liturgy Book draws chord charts too');
function ruleBody(sel) {
  const i = raw.indexOf(sel + ' {');
  if (i < 0) return null;
  return raw.slice(i + sel.length, raw.indexOf('}', i));
}
const famOf = s => ((s.match(/font-family\s*:([^;]*)/) || [])[1] || '').trim();
const sizeOf = s => ((s.match(/font-size\s*:([^;]*)/) || [])[1] || '').trim();
[['.lb2-song-chords-view .chord-line', '.lb2-song-chords-view .lyric-line', 'the chords view'],
 ['.lb2-chord-line', '.lb2-lyric-line', 'the legacy pair']].forEach(([cs, ls, label]) => {
  const c = ruleBody(cs), l = ruleBody(ls);
  if (!c || !l) { check(label + ' found', false, true); return; }
  check(label + ': both rows are monospace',
    /monospace/i.test(famOf(c)) && /monospace/i.test(famOf(l)), true);
  check('  neither names a proportional family',
    !PROPORTIONAL.test(famOf(c)) && !PROPORTIONAL.test(famOf(l)), true);
  check('  the same family on both', famOf(c) === famOf(l), true);
  // The same font at two sizes is still a misaligned chart.
  check('  the same size on both', sizeOf(c) === sizeOf(l), true);
});

// ---- the sheets must agree on the lyric colour ---------------------------
//
// Darkening the lyric line in the main stylesheet changed nothing on screen,
// because two later sheets -- sb-songbook-polish-css and
// sb-structural-makeover-css -- each set the colour again with !important,
// to two different values. Measured on a phone, the colour in force was
// #172b42 while the main sheet asked for #0f172a and the polish sheet asked
// for #24334a. Three answers, and the last one loaded won.
//
// The failure is silent: the CSS reads as though it worked. So the rule is
// not "use this colour" but "only say it once, or say the same thing".
console.log('\nnothing overrides the lyric colour with a different one');
{
  const bang = [];
  const re = /#songbookLiveModal\s+\.wo-lyrics-lyric-line\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(raw))) {
    const c = (m[1].match(/(^|[;{\s])color\s*:\s*([^;!}]+)(!important)?/) || []);
    if (c[2]) bang.push({ colour: c[2].trim().toLowerCase(), important: !!c[3] });
  }
  const colours = [...new Set(bang.map(b => b.colour))];
  // check() here is (label, ok, detail) -- passing an array as `ok` makes the
  // assertion vacuous, which is how the first version of this passed against
  // source holding three different colours.
  check('every rule that colours the lyric line agrees',
    colours.length === 1, colours.join('  vs  ') || 'no rule sets it');
  check('  and it is a dark one',
    colours.length === 1 && /^#(0[0-9a-f]|1[0-7])/.test(colours[0]),
    colours[0] || '(none)');
}

// And the songs WITHOUT chords are still free to use the chosen family --
// that is the whole reason the forcing rule is scoped with :has().
console.log('\nsongs with no chords still follow the family picker');
check('the forcing rule is scoped to pages that contain a chord line',
  /:has\(\s*\.wo-lyrics-chord-line\s*\)/.test(raw),
  ':has(.wo-lyrics-chord-line) present');
check('Arial Black is offered in the picker',
  /<option value="'Arial Black'/.test(raw));
check('and the picker says why a chord song ignores it',
  /fixed-width font whatever is chosen/i.test(raw));

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
if (pass === results.length) console.log('Chords stay over their syllables.');
process.exit(pass === results.length ? 0 : 1);
