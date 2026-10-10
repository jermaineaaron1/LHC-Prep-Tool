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

// The rule that binds the two lines together: one selector list naming both
// classes, with one font-family for the pair.
const pairRules = [];
const re = /([^{}]*wo-lyrics-chord-line[^{}]*wo-lyrics-lyric-line[^{}]*)\{([^}]*)\}/g;
let m;
while ((m = re.exec(raw))) pairRules.push({ sel: m[1].replace(/\s+/g, ' ').trim(), body: m[2].replace(/\s+/g, ' ').trim() });

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
const lyricRules = [];
const re2 = /([^{}]*songbookLiveModal[^{}]*wo-lyrics-lyric-line[^{}]*)\{([^}]*)\}/g;
let m2;
while ((m2 = re2.exec(raw))) lyricRules.push({ sel: m2[1].replace(/\s+/g, ' ').trim(), body: m2[2].replace(/\s+/g, ' ').trim() });
const offenders = lyricRules.filter(r => {
  const fam = (r.body.match(/font-family\s*:([^;]*)/) || [])[1];
  return fam && PROPORTIONAL.test(fam) && !/monospace/i.test(fam);
});
check('none found', offenders.length === 0,
  offenders.length ? offenders.map(o => o.sel.slice(0, 50)).join(' | ') : lyricRules.length + ' lyric-line rules inspected');

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
