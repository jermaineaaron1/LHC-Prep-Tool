'use strict';
// Harness for the home cards' colours and the Songbooks list's rows, as the
// operator marked them up on 2026-11-11.
//
// WHY THIS EXISTS
//   - On a phone (and any screen up to 768px) every songbook row put its
//     buttons on a line of their own under the name, so each row was twice
//     the height it needed and the buttons sat apart from the book they act
//     on. Asked: the buttons and the title aligned, and half the spacing.
//   - Songs / Songbooks was faintly blue, the Roster faintly teal and the
//     Liturgy Library faintly green: asked for Songs green, the Roster blue
//     and the Liturgy Library purple, all faint.
//   - "Sunday Bulletin" is "Bulletin".
//
// WHAT IS EASY TO GET WRONG
//   One of My Songbooks carries six buttons. On a narrow phone there is no
//   room for its name beside them, so that row -- and only that row -- puts
//   them under the name, the name kept BESIDE its icon (flex-basis 0) rather
//   than dropped onto a line of its own.
//
// USAGE
//   node tools/home-look-harness.js [path/to/Index.html] [--expect-broken]
// --expect-broken is the negative control (`git show efe6b64:Index.html > x`).

const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const SRC = fs.readFileSync(INDEX, 'utf8');

let passed = 0, failed = 0;
function check(label, ok) {
  if (ok) { passed++; console.log('  ok    ' + label); }
  else { failed++; console.log('  FAIL  ' + label); }
}
const has = re => re.test(SRC);

console.log('the Songbooks list\'s rows');
check('a row keeps its buttons on its name\'s line on a phone, at half the old height of padding',
  has(/\.sb-list-item \{ flex-wrap: nowrap; gap: 10px; align-items: center; padding: 5px 10px; \}/) &&
  !has(/\.sb-list-item \{ flex-wrap: wrap; gap: 6px 12px; align-items: flex-start; padding: 10px 12px; \}/));
check('  and on a desk', has(/\.sb-list-item \{\r?\n\s*display: flex; align-items: center; gap: 12px;\r?\n\s*padding: 6px 14px;/));
check('  a row of six buttons (one of My Songbooks) is marked so',
  has(/return '<div class="sb-list-item' \+ \(isOrder \? '' : ' sb-list-item--many'\) \+ '" onclick="' \+ openFn \+ '">' \+/));
check('  and puts them under its name only on a narrow phone, the name kept beside its icon',
  has(/@media \(max-width: 479px\) \{\r?\n\s*\.sb-list-item\.sb-list-item--many \{ flex-wrap: wrap; row-gap: 4px; \}\r?\n\s*\.sb-list-item\.sb-list-item--many \.sb-list-body \{ flex: 1 1 0; min-width: 0; \}/));
check('  each button a tile in its action\'s colour, Open included',
  has(/\.sb-list-btn \{\r?\n\s*width: 30px; height: 30px;/) && has(/class="sb-list-btn open"/) &&
  ['add-songs', 'play', 'open', 'rename', 'delete'].every(k => new RegExp('\\.sb-list-btn\\.' + k + ':hover \\{ color: #fff;').test(SRC)));

// From a check after #433 (2026-11-11): a name with an apostrophe broke Add
// Songs and Rename (the attribute decodes &#039; back to ' and ends the JS
// string), and on a desk the two columns left a row of six a 60px name.
console.log('\na name in a row\'s buttons, and a narrow column');
const lines = SRC.split('\n').map(l => l.replace(/\r$/, ''));
const jAt = lines.findIndex(l => /^\s*var jsq = function\(v\) \{$/.test(l));
let jsq = null;
if (jAt >= 0) {
  const body = lines.slice(jAt, jAt + 4).join('\n');
  const escapeHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  try { jsq = new Function('escapeHtml', body + '\nreturn jsq;')(escapeHtml); } catch (e) { jsq = null; }
}
// What the browser does with onclick="f('<value>')": decode the attribute,
// then run the JS. The name must come out whole, and nothing else must run.
const decode = s => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const roundTrip = name => { try { return new Function("return '" + decode(jsq(name)) + "';")(); } catch (e) { return 'THREW ' + e.message; } };
const NAMES = ["Mother's Day 2026", 'Back\\slash', 'Say "Amen"', '<b>Carols</b> & more', "two\nlines", "it's a 'test'"];
check('a name with an apostrophe, a backslash, quotes, tags or a new line reaches the handler whole',
  !!jsq && NAMES.every(n => roundTrip(n) === n));
check('  every handler in the row takes its values through jsq',
  !/ename\.replace\(/.test(SRC) && /openAddSongsModal\(\\'' \+ \(isOrder \? 'order' : 'songbook'\) \+ '\\',\\'' \+ \(isOrder \? jsq\(item\.orderId\) : jsq\(item\.id\)\) \+ '\\',\\'' \+ jsq\(item\.name\) \+ '\\'\)/.test(SRC) &&
  /renameSongbook\(\\'' \+ jsq\(item\.id\) \+ '\\',\\'' \+ jsq\(item\.name\) \+ '\\'\)/.test(SRC));
check('a row of six puts its buttons under its name wherever its column is narrow, a desk\'s included',
  /\.sb-two-col > div \{ container-type: inline-size; container-name: sbcol; \}/.test(SRC) &&
  /@container sbcol \(max-width: 459px\) \{\r?\n\s*\.sb-list-item\.sb-list-item--many \{ flex-wrap: wrap; row-gap: 4px; \}/.test(SRC));
check('a name may take two lines rather than be cut', /\.sb-list-name \{\r?\n[^}]*-webkit-line-clamp: 2;/.test(SRC));

console.log('\nthe home cards');
check('Songs / Songbooks faintly green', has(/\.home-nav-songs \{ background: linear-gradient\(145deg, #ffffff 0%, #eaf8ef 100%\); \}/));
check('the Roster faintly blue, its icon blue', has(/\.home-nav-roster \{ background: linear-gradient\(145deg, #ffffff 0%, #eaf3ff 100%\); \}/) &&
  has(/\.home-nav-roster \.home-nav-icon \{ color: #2563eb;/));
check('the Liturgy Library faintly purple, its icon purple', has(/\.home-nav-liturgy \{ background: linear-gradient\(145deg, #ffffff 0%, #f3eefd 100%\); \}/) &&
  has(/\.home-nav-liturgy \.home-nav-icon \{ color: #7c3aed;/));
check('"Bulletin", not "Sunday Bulletin"', has(/<div class="home-nav-label font-cinzel">Bulletin<\/div>/) && !has(/<div class="home-nav-label font-cinzel">Sunday Bulletin<\/div>/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  console.log(failed ? 'negative control: failed as expected' : 'negative control: everything PASSED against source expected to be broken');
  process.exit(failed ? 0 : 1);
}
process.exit(failed ? 1 : 0);
