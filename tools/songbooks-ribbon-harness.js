'use strict';
// Regression harness for the Songs page's layout: the way into the
// songbooks, and the shape of the catalogue above them.
//
// WHY THIS EXISTS
// The songbooks and service orders live at the FOOT of the Songs page,
// under the whole seventy-two-song catalogue. On a desktop nothing at
// the top of the page said they were there. The mobile layout has had a
// Songbooks tab the whole time, which is the thing that makes the one
// interesting branch here: on a phone, switching to that tab is a better
// answer than scrolling, because the tab HIDES the catalogue and there
// is nothing to scroll past.
//
// That branch asks the tab button whether it is on screen rather than
// testing a width. A width is a second copy of the breakpoint, and the
// two drift; the button is display:none on a desktop, so asking it
// follows the layout by construction.
//
// THE DANGEROUS DIRECTION
// Scrolling to a section that the mobile layout has hidden does nothing
// at all, and does it silently -- the same shape of failure as the
// contents taps that went nowhere. So the checks below assert WHICH of
// the two things happened, not merely that something did.
//
// USAGE
//   node tools/songbooks-ribbon-harness.js                 # ../Index.html
//   node tools/songbooks-ribbon-harness.js path/to/file.html
//   node tools/songbooks-ribbon-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');
const { El, makeDocument } = require('./minidom.js');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

function extract(pattern, name) {
  const startIdx = lines.findIndex(l => pattern.test(l));
  if (startIdx < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('no close for ' + name);
}

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log((ok ? '  ok    ' : '  FAIL  ') + label);
  if (!ok) {
    console.log('          got  ' + JSON.stringify(got));
    console.log('          want ' + JSON.stringify(want));
  }
}

let goSrc, jumpSrc, countSrc;
try {
  goSrc = extract(/^  function sfGoToSongbooks\(/, 'sfGoToSongbooks');
  jumpSrc = extract(/^  function sfJumpSongbookCol\(/, 'sfJumpSongbookCol');
  countSrc = extract(/^  function _sfSetSongbookCounts\(/, '_sfSetSongbookCounts');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}

// ---------------------------------------------------------------------------
// A page with the pieces these functions reach for.
// ---------------------------------------------------------------------------
function makePage(tabOnScreen) {
  const doc = makeDocument();
  const tab = new El('button', 'mobile-songs-tab', { id: 'mobileTabBooks' });
  // offsetParent is null for a display:none element, which is exactly how
  // the mobile tab strip is switched off on a desktop.
  tab.offsetParent = tabOnScreen ? doc.root : null;
  const card = new El('div', 'lhc-card', { id: 'sfSongbooksCard' });
  const booksHdr = new El('div', 'sb-col-header songs-col');
  const ordersHdr = new El('div', 'sb-col-header orders-col');
  card.appendChild(booksHdr);
  card.appendChild(ordersHdr);
  ['sfSongbooksJumpCount', 'sfSbCountBooks', 'sfSbCountOrders'].forEach(function (id) {
    doc.root.appendChild(new El('span', '', { id: id }));
  });
  doc.root.appendChild(tab);
  doc.root.appendChild(card);
  const log = { scrolled: [], tab: null };
  [card, booksHdr, ordersHdr].forEach(function (el) {
    el.scrollIntoView = o => log.scrolled.push((el.getAttribute('id') || el.className) + ':' + o.block);
  });
  card.offsetWidth = 1;   // the reflow the flash restart reads
  return { doc, card, tab, log };
}

function run(page) {
  return new Function('document', 'switchMobileSongsTab', 'window',
    goSrc + '\n' + jumpSrc + '\n' + countSrc +
    '\nreturn { go: sfGoToSongbooks, jump: sfJumpSongbookCol, counts: _sfSetSongbookCounts };'
  )(page.doc, t => { page.log.tab = t; }, {});
}

// ---------------------------------------------------------------------------
console.log('\ngetting to the songbooks from the top of the page');
{
  const page = makePage(false);               // desktop: no tab strip
  const S = run(page);
  S.go();
  check('on a desktop it scrolls to the section', page.log.scrolled, ['sfSongbooksCard:start']);
  check('  and does not reach for a tab that is not there', page.log.tab, null);
  // Landing at the foot of a long page with no acknowledgement reads as a
  // button that did nothing.
  check('  and says you have arrived',
    page.card.classList.contains('sf-sb-landed'), true);
}
{
  const page = makePage(true);                // phone: the tab strip is up
  const S = run(page);
  S.go();
  check('on a phone it switches to the Songbooks tab', page.log.tab, 'songbooks');
  // The tab hides the catalogue, so there is nothing to scroll past and
  // scrolling the hidden section would do nothing, silently.
  check('  instead of scrolling a section the tab had hidden', page.log.scrolled, []);
}
{
  const page = makePage(false);
  const S = run(page);
  S.jump('orders');
  S.jump('songs');
  check('the ribbon jumps to either list',
    page.log.scrolled, ['sb-col-header orders-col:center', 'sb-col-header songs-col:center']);
  S.jump('nonsense');
  check('  and an unknown one lands on the songbooks, not nowhere',
    page.log.scrolled[2], 'sb-col-header songs-col:center');
}

console.log('\nthe counts, which say it is a place and not a verb');
{
  const page = makePage(false);
  const S = run(page);
  const read = () => ['sfSongbooksJumpCount', 'sfSbCountBooks', 'sfSbCountOrders']
    .map(id => page.doc.getElementById(id).textContent);
  S.counts(3, 8);
  check('the pill totals both lists, the chips count their own', read(), ['11', '3', '8']);
  S.counts(0, 0);
  // An empty badge is hidden by CSS rather than drawn as a grey zero.
  check('nothing to count, nothing written', read(), ['', '', '']);
  S.counts(2, 0);
  check('one empty list still leaves the other counted', read(), ['2', '2', '']);
}

console.log('\nthe markup and the band');
check('the pill is in the catalogue header',
  /<button class="lhc-pill-button" id="sfSongbooksJump" onclick="sfGoToSongbooks\(\)"/.test(raw), true);
// Navigation first, then the view controls, then the one button that
// creates something.
check('  ahead of the view controls',
  raw.indexOf('id="sfSongbooksJump"') < raw.indexOf('id="allSongsBtn"'), true);
check('  and ahead of Add Song',
  raw.indexOf('id="sfSongbooksJump"') < raw.indexOf('id="openAddSongBtn"'), true);
check('the section is headed by the ribbon, not a bare title',
  /<div id="sfSongbooksCard"[^>]*>\s*\r?\n\s*<div class="sf-sb-ribbon">/.test(raw), true);

const css = raw.replace(/\r/g, '');
const rule = sel => {
  const i = css.indexOf(sel + ' {');
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
};
// .lhc-card declares no padding at all on a desktop and 10px on a phone,
// so a guessed inset overhung the card by 17px each side. Measured.
check('the band does not guess the card its padding',
  /margin:\s*-/.test(rule('.sf-sb-ribbon')), false);
check('an empty count badge is not drawn as a grey zero',
  /\.sf-jump-count:empty.*\{ display: none; \}/.test(css.replace(/\s*\n\s*/g, ' ')), true);
check('the arrival flash respects prefers-reduced-motion',
  /@media \(prefers-reduced-motion: reduce\) \{\s*#sfSongbooksCard\.sf-sb-landed \{ animation: none; \}/
    .test(css), true);

console.log('\nthe catalogue in two columns');
// Asked of the LIST's width, not the window's -- and that is the whole
// point, not a style preference. The window is the wrong question twice
// over: the sidebar takes 340px of it, and when a song is opened the
// catalogue becomes a 400px rail beside the workspace. A viewport rule
// would still say "wide" there and split a rail down the middle.
const CQ = /@container sfcatalogue \(min-width: (\d+)px\) \{([\s\S]{0,900}?)\n  \}/.exec(css);
check('the split is a container query', !!CQ, true);
check('  and the catalogue card is the container it asks about',
  /#songFinderView #sfSongListCard \{ container-type:inline-size;container-name:sfcatalogue; \}/.test(css), true);
check('  no viewport rule splits the list behind its back',
  /@media[^@]{0,400}#songListContainer \{[^}]*grid-template-columns/.test(css), false);
check('two columns, evenly',
  /grid-template-columns:1fr 1fr/.test(CQ ? CQ[2] : ''), true);
// The A-Z letters are wayfinding for the whole list, not for one column.
check('the A-Z letters span both',
  /#songListContainer > \.song-atlas-section-header \{ grid-column:1 \/ -1; \}/.test(CQ ? CQ[2] : ''), true);
// 307px of every item goes on the monogram, the row of actions, the gaps
// and the padding whatever the width. Below ~1120 the title is the part
// that gives, and an ellipsis where the song's name should be is worse
// than a long page.
check('the threshold leaves a title room to be read',
  CQ && parseInt(CQ[1], 10) >= 1100, true);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN && passed === results.length) {
  console.log('\nBUT --expect-broken was given and everything passed.');
  process.exit(1);
}
process.exit(passed === results.length ? 0 : 1);
