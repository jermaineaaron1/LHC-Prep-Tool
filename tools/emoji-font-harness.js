'use strict';
// Regression harness for the emoji font on shared pictures.
//
// WHY THIS EXISTS
// Every duty label on a shared roster starts with an icon -- the church, the
// dove, the open book. The pictures are drawn by headless Chrome on the
// server, which has no emoji font, and nothing in the page asked for one, so
// all of them came out as empty boxes. Measured 2026-10-01: 10 broken glyphs
// on a service card, 22 on the monthly roster PDF.
//
// It had gone unnoticed for a simple reason: the operator's own phone has the
// glyphs. The card looked right on screen and only the copy that reached the
// congregation was broken.
//
// WHY "text=" AND NOT JUST THE FAMILY
// Asking for the family plainly returns ELEVEN @font-face rules, each covering
// a slice of the emoji block, which Chrome fetches lazily. Some slices arrived
// before the page was photographed and some did not, so a few icons appeared
// and the rest stayed boxes -- which is exactly what the first attempt at this
// fix produced. Naming the characters returns ONE rule and one file.
//
// It is also what makes the font safe to put FIRST in the stack: the rule
// comes back with a unicode-range covering only those characters. Put first
// WITHOUT that, Noto Color Emoji claims the digits too (it carries them for
// keycaps) and every date and verse number renders as "Psalm 8 0 : 7 - 1 9".
// That was measured too, which is why both halves are asserted here.
//
// USAGE
//   node tools/emoji-font-harness.js                 # checks ../Index.html
//   node tools/emoji-font-harness.js path/to/file.html
//   node tools/emoji-font-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show 4751344:Index.html > x`).
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

function extractMethod(name, optional) {
  const startIdx = lines.findIndex(l => new RegExp('^    ' + name + ':\\s*function\\s*\\(').test(l));
  if (startIdx < 0) {
    if (optional) return null;
    throw new Error('method not found in ' + path.basename(INDEX) + ': ' + name);
  }
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n').replace(/,\s*$/, ''), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

const linkFn = extractMethod('_emojiFontLink', true);
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _emojiFontLink @ ' + (linkFn ? 'line ' + linkFn.line : 'ABSENT') + '\n');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

let emojiFontLink = null;
if (linkFn) {
  const api = new Function('return {' + linkFn.text + '};')();
  emojiFontLink = html => api._emojiFontLink(html);
}

// ---------------------------------------------------------------------------
console.log('the stylesheet names the characters it needs');
if (!emojiFontLink) {
  if (EXPECT_BROKEN) check('(pre-fix) there is no emoji stylesheet at all', true, true);
  else check('_emojiFontLink exists', false, true);
} else {
  check('a document with no icons asks for nothing', emojiFontLink('<p>Preacher</p>'), '');
  check('empty input asks for nothing', emojiFontLink(''), '');
  check('null input asks for nothing', emojiFontLink(null), '');

  const one = emojiFontLink('<div>⛪ Preacher</div>');
  check('one icon produces one stylesheet', (one.match(/<link/g) || []).length, 1);
  check('it names the character', one.indexOf(encodeURIComponent('⛪')) !== -1, true);
  check('it asks by text, not for the whole family', /[?&]text=/.test(one), true);
  check('it waits for the font rather than painting boxes first',
    /display=block/.test(one), true);
  check('it does not use display=swap', /display=swap/.test(one), false);

  // Repeats must collapse, or the URL grows with the roster.
  const many = emojiFontLink('⛪ a ⛪ b ⛪ c 🕊 d 🕊');
  const q = decodeURIComponent((many.match(/text=([^&"]*)/) || [])[1] || '');
  // Counted in code points, not UTF-16 units: a dove is a surrogate pair, so
  // two icons measure three by .length.
  check('repeats collapse to one of each', Array.from(q).length, 2);
  check('both distinct icons are named',
    q.indexOf('⛪') !== -1 && q.indexOf('🕊') !== -1, true);

  // A realistic card: every icon the roster actually uses.
  const realLabels = '🏠🎼📅⛪🕊🚪' +
    '📖📜🎵✝🍞🕯' +
    '🎹🎸🥁🎤🎬💻' +
    '📹🔊📚🌸';
  const all = emojiFontLink('<table><td>' + realLabels + '</td></table>');
  const got = decodeURIComponent((all.match(/text=([^&"]*)/) || [])[1] || '');
  check('every icon on a real roster is requested', Array.from(got).length, 22);

  // Digits must never be requested: that is what breaks the dates.
  check('no digits are requested', /[0-9]/.test(got), false);
  check('ordinary letters are not requested',
    /[A-Za-z]/.test(decodeURIComponent((emojiFontLink('<div>⛪ Preacher</div>')
      .match(/text=([^&"]*)/) || [])[1] || '')), false);
}

// ---------------------------------------------------------------------------
console.log('\nboth shared pictures ask for it');
{
  const rosterUses = /_buildRosterPrintFullHtml:[\s\S]{0,600}?_emojiFontLink\(/.test(raw);
  const cardUses = /Poppins:wght@400;600;700;800[\s\S]{0,400}?_emojiFontLink\(/.test(raw);
  if (EXPECT_BROKEN) {
    check('(pre-fix) the roster PDF asked for no emoji font', rosterUses, false);
    check('(pre-fix) the service card asked for no emoji font', cardUses, false);
  } else {
    check('the roster PDF asks for it', rosterUses, true);
    check('the service card asks for it', cardUses, true);
  }
}

// ---------------------------------------------------------------------------
console.log('\nthe font is reached before Arial, not after it');
{
  const rosterFirst = /font-family: "Noto Color Emoji", Arial, sans-serif/.test(raw);
  const cardFirst = /font-family:"Noto Color Emoji","Poppins",Arial,sans-serif/.test(raw);
  if (EXPECT_BROKEN) {
    check('(pre-fix) the roster stack had no emoji font', rosterFirst, false);
    check('(pre-fix) the card stack had no emoji font', cardFirst, false);
  } else {
    check('the roster stack reaches it first', rosterFirst, true);
    check('the card stack reaches it first', cardFirst, true);
  }
}

// ---------------------------------------------------------------------------
console.log('\nthe whole-family form is never used');
{
  // family=Noto+Color+Emoji WITHOUT text= is the form that races.
  const bad = /family=Noto\+Color\+Emoji(?![^"']*text=)/.test(raw);
  check('no request for the family without naming the characters', bad, false);
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
