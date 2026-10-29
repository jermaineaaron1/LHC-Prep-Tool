'use strict';
// Regression harness for the phone songbook: folding a song away, and
// landing on the song you tapped in the contents.
//
// WHY THIS EXISTS
// Tapping a song in the contents did nothing for the first two songs of
// the Caroling book and worked for the other three. The two were the two
// with choir arrangements.
//
// A song showing its choir parts keeps its LYRICS page in the document
// with display:none -- deliberately, because pagination, the annotation
// canvas and the lyrics editor all look that page up by id, and skipping
// it would send half the songbook looking for something that was never
// written. sbScrollToSong looked up the same id and measured it:
//
//   getBoundingClientRect() on a display:none element is all zeros
//   nextTop = scrollTop + 0 - bodyTop - 18       -> negative
//   Math.max(0, negative)                        -> 0
//
// So the book scrolled to the top and sat there. Nothing threw, nothing
// was logged, and three songs out of five behaved perfectly -- which is
// why it read as "the first two songs are broken" rather than as a bug in
// how a hidden page measures.
//
// THE DANGEROUS DIRECTION
// Landing somewhere WRONG is worse than not moving: a singer who is sent
// to the wrong song does not know they were sent anywhere. So the checks
// here assert the destination, not merely that the scroll happened.
//
// The folding is the other half. On a phone each song is a full A4 sheet,
// so five songs is five screenfuls to reach the third; each one now folds
// down to its control bar and starts folded. Folded by CLIPPING and not
// by display:none, because sbPaginateAll places the A4 page-break markers
// from the live children's offsetTop and every one of those reads 0
// inside a hidden page -- that part is CSS and out of reach here, so what
// is guarded below is the state: closed to begin with, open once opened,
// and still open after a re-render.
//
// USAGE
//   node tools/songbook-fold-harness.js                 # ../Index.html
//   node tools/songbook-fold-harness.js path/to/file.html
//   node tools/songbook-fold-harness.js <file> --expect-broken
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

// Brace-matched slice of one function, the way the other harnesses do it.
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

// ---------------------------------------------------------------------------
// The sliced source.
// ---------------------------------------------------------------------------
const WANTED = [
  [/^  function _sbFoldPhone\(/, '_sbFoldPhone'],
  [/^  function _sbUnitFolded\(/, '_sbUnitFolded'],
  [/^  function _sbFoldBtnHtml\(/, '_sbFoldBtnHtml'],
  [/^  function _sbSetFolded\(/, '_sbSetFolded'],
  [/^  function sbToggleSongFold\(/, 'sbToggleSongFold'],
  [/^  function sbExpandSong\(/, 'sbExpandSong'],
  [/^  function _sbVisiblePage\(/, '_sbVisiblePage'],
  [/^  function sbScrollBodyToElement\(/, 'sbScrollBodyToElement'],
  [/^  function sbScrollToSong\(/, 'sbScrollToSong']
];

let sliced;
try {
  if (!lines.some(l => /^  var _sbFolded = \{\};/.test(l))) {
    throw new Error('not found: var _sbFolded');
  }
  sliced = WANTED.map(([re, name]) => extract(re, name)).join('\n');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}

// ---------------------------------------------------------------------------
// A document shaped like the Caroling book: two songs, the first showing
// its choir parts so its lyrics page is in the tree but hidden.
// ---------------------------------------------------------------------------
const doc = makeDocument();

// Geometry is the harness's to supply -- minidom has no layout, which is
// the honest position for a shim: it cannot know what is on screen.
function at(el, top) {
  el.getBoundingClientRect = () => ({ top: top, bottom: top + 40, left: 0, right: 794 });
  el.getClientRects = () => [{ top: top }];
  return el;
}
function hide(el) {
  el.style.display = 'none';
  el.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
  el.getClientRects = () => [];   // what a display:none element reports
  return el;
}

const scrolls = [];
const body = new El('div', 'sb-body', { id: 'sbBody' });
body.scrollTop = 0;
body.scrollTo = o => scrolls.push(Math.round(o.top));
at(body, 100);                     // the modal header sits above it
doc.root.appendChild(body);

function buildUnit(sid, unitTop, folded) {
  const unit = new El('div', 'sb-song-unit' + (folded ? ' sb-unit--collapsed' : ''),
    { id: 'sbUnit-' + sid });
  at(unit, unitTop);
  const bar = new El('div', 'sb-page-controls-bar', { 'data-song-id': sid });
  const fold = new El('button', 'sb-unit-fold', {
    id: 'sbFold-' + sid, 'aria-expanded': folded ? 'false' : 'true',
    title: folded ? 'Open this song' : 'Fold this song away'
  });
  const ico = new El('i', 'fa-solid fa-chevron-' + (folded ? 'right' : 'down'));
  fold.appendChild(ico);
  bar.appendChild(fold);
  unit.appendChild(bar);
  body.appendChild(unit);
  return unit;
}

// Song 1 -- in choir view. Lyrics page present and hidden; choir page shown.
const unit1 = buildUnit('s1', 500, true);
const lyr1 = new El('div', 'sb-song-page', { id: 'sbPage-s1', 'data-song-id': 's1' });
hide(lyr1);
unit1.appendChild(lyr1);
const choir1 = new El('div', 'sb-song-page sb-song-page--choir', { id: 'sbChoirPage-s1' });
at(choir1, 544);
unit1.appendChild(choir1);

// Song 2 -- an ordinary song, lyrics page on screen.
const unit2 = buildUnit('s2', 1600, true);
const lyr2 = new El('div', 'sb-song-page', { id: 'sbPage-s2', 'data-song-id': 's2' });
at(lyr2, 1644);
unit2.appendChild(lyr2);

// Song 6 -- hidden by a STYLESHEET rule rather than an inline style, so
// there is nothing on el.style to read and only the absence of layout
// boxes gives it away.
const unit6 = buildUnit('s6', 2600, false);
const lyr6 = new El('div', 'sb-song-page', { id: 'sbPage-s6' });
lyr6.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
lyr6.getClientRects = () => [];
unit6.appendChild(lyr6);
const choir6 = at(new El('div', 'sb-song-page sb-song-page--choir', { id: 'sbChoirPage-s6' }), 2644);
unit6.appendChild(choir6);

// Song 7 -- the whole modal is not laid out yet, so NOTHING has a layout
// box and the rect test cannot tell the pages apart. The inline
// display:none still can, which is why both tests are there.
const unit7 = buildUnit('s7', 3600, false);
const lyr7 = new El('div', 'sb-song-page', { id: 'sbPage-s7' });
lyr7.style.display = 'none';
lyr7.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
lyr7.getClientRects = () => [];
unit7.appendChild(lyr7);
const choir7 = new El('div', 'sb-song-page sb-song-page--choir', { id: 'sbChoirPage-s7' });
choir7.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
choir7.getClientRects = () => [];
unit7.appendChild(choir7);

// ---------------------------------------------------------------------------
const calls = { zoom: 0, redraw: [] };
let PHONE = true;
const win = { matchMedia: () => ({ matches: PHONE }) };

const S = new Function(
  'document', 'window', '$', 'sbApplyZoom', 'sbRedrawSong',
  sliced + '\nvar _sbFolded = {};\n' +
  'return { _sbFolded: _sbFolded, phone: _sbFoldPhone, unitFolded: _sbUnitFolded,' +
  ' btn: _sbFoldBtnHtml, setFolded: _sbSetFolded, toggle: sbToggleSongFold,' +
  ' expand: sbExpandSong, visiblePage: _sbVisiblePage, scrollToSong: sbScrollToSong };'
)(doc, win, id => doc.getElementById(id),
  () => { calls.zoom++; }, sid => { calls.redraw.push(sid); });

// Seed both songs the way a render does.
S.unitFolded('s1');
S.unitFolded('s2');

// ---------------------------------------------------------------------------
console.log('\nwhich page the reader can actually see');
// The bug, stated as the thing it broke: a song in choir view has a lyrics
// page in the document that nobody can see.
check('a song in choir view offers its choir page',
  (S.visiblePage('s1') || {}).id, 'sbChoirPage-s1');
check('  and not the hidden lyrics page beside it',
  (S.visiblePage('s1') || {}).id === 'sbPage-s1', false);
check('an ordinary song offers its lyrics page',
  (S.visiblePage('s2') || {}).id, 'sbPage-s2');
check('a song with neither page offers nothing', S.visiblePage('nope'), null);
// Two tests, because neither one covers the other. A page hidden by a
// stylesheet rule has nothing on el.style to read; a page in a modal that
// has not been laid out yet has no layout box EITHER way, so only the
// inline display:none separates them.
check('a page hidden by a rule is passed over too',
  (S.visiblePage('s6') || {}).id, 'sbChoirPage-s6');
check('and before the modal is laid out, display:none still decides',
  (S.visiblePage('s7') || {}).id, 'sbChoirPage-s7');

console.log('\ntapping a song in the contents');
scrolls.length = 0;
S.scrollToSong('s1');
// unit top 500, body top 100, 18px of air above = 382.
check('the choir song scrolls to where the choir song is', scrolls, [382]);
check('  which is emphatically not the top of the book', scrolls[0] === 0, false);

scrolls.length = 0;
S.scrollToSong('s2');
// The UNIT at 1600, not the sheet at 1644: the bar above the sheet is what
// carries the song's name, and arriving under it reads as the wrong song.
check('an ordinary song scrolls to its control bar', scrolls, [1482]);

scrolls.length = 0;
S.scrollToSong('does-not-exist');
check('a song that is not in the book scrolls nowhere', scrolls, []);

console.log('\nfolding, and what survives a re-render');
check('a song nobody has opened starts folded', S.unitFolded('s3'), true);
S.setFolded('s3', false);
check('  once opened it stays open', S.unitFolded('s3'), false);
check('a second unopened song starts folded too', S.unitFolded('s5'), true);
PHONE = false;
check('on a desktop nothing is folded', S.unitFolded('s4'), false);
check('  not even one the phone had folded', S.unitFolded('s5'), false);
PHONE = true;
check('  and the phone has not forgotten', S.unitFolded('s5'), true);

console.log('\nthe chevron says which way it goes');
check('folded: closed chevron, collapsed to a reader',
  S.btn('s9', true),
  '<button class="sb-unit-fold" id="sbFold-s9" onclick="WO.sbToggleSongFold(\'s9\')"' +
  ' aria-expanded="false" title="Open this song">' +
  '<i class="fa-solid fa-chevron-right"></i></button>');
check('open: the chevron points down',
  S.btn('s9', false).indexOf('fa-chevron-down') !== -1, true);
check('  and the reader is told it is open',
  S.btn('s9', false).indexOf('aria-expanded="true"') !== -1, true);

console.log('\nopening and closing one song');
S.setFolded('s2', true);
calls.zoom = 0; calls.redraw.length = 0;
S.toggle('s2');
check('the unit loses the folded class', unit2.classList.contains('sb-unit--collapsed'), false);
check('  the chevron turns down',
  doc.getElementById('sbFold-s2').querySelector('.fa-chevron-down') !== null, true);
check('  and says so to a screen reader',
  doc.getElementById('sbFold-s2').getAttribute('aria-expanded'), 'true');
// The zoom transform's bottom margin is computed from the wrap's height.
// Left stale, the book keeps the scroll room of pages it is not showing.
check('  the book is re-measured', calls.zoom, 1);
check('  and the annotations are put back', calls.redraw, ['s2']);

S.toggle('s2');
check('folding it again puts the class back', unit2.classList.contains('sb-unit--collapsed'), true);
check('  the chevron turns back',
  doc.getElementById('sbFold-s2').querySelector('.fa-chevron-right') !== null, true);
check('  and nothing is redrawn for a page nobody can see', calls.redraw, ['s2']);

console.log('\na folded song opens itself when you tap it in the contents');
S.setFolded('s1', true);
scrolls.length = 0;
S.scrollToSong('s1');
check('the song is open', S._sbFolded.s1, false);
check('  the class is off the unit', unit1.classList.contains('sb-unit--collapsed'), false);
check('  and it still scrolled to the right place', scrolls, [382]);

console.log('\nthe stylesheet, which is where the folding actually happens');
// All of this belongs to the phone, so it is asserted against the PHONE
// sheet and not against the file. A rule that drifted out of the media
// query would fold a desktop songbook away too, and a desktop is where
// the whole sheet is already on screen and there is nothing to fold.
const PHONE_CSS = (function () {
  const i = raw.indexOf('<style id="sb-mobile-reading-fix-css">');
  if (i < 0) return '';
  const j = raw.indexOf('</style>', i);
  return j < 0 ? '' : raw.slice(i, j);
})();
check('the phone stylesheet is where it was', PHONE_CSS.length > 0, true);

// Folded by clipping. sbPaginateAll places the A4 page-break markers from
// the live children's offsetTop, and inside a display:none page every one
// of those is 0 -- the markers would pile up at the top of the song and
// nobody would see it until the next time they printed.
const FOLD_RULE = /#songbookLiveModal \.sb-unit--collapsed > :not\(\.sb-page-controls-bar\) \{([^}]*)\}/
  .exec(PHONE_CSS);
check('the folded rule is in it', !!FOLD_RULE, true);
check('  it clips the pages away', /max-height:\s*0/.test(FOLD_RULE ? FOLD_RULE[1] : ''), true);
check('  and does NOT take them out of the layout',
  /display:\s*none/.test(FOLD_RULE ? FOLD_RULE[1] : ''), false);
// max-height cannot shrink a border-box below its own padding, and the
// sheet carries 48px under the words -- a sliver of paper per folded song.
check('  nor leaves the sheet its padding',
  /padding:\s*0/.test(FOLD_RULE ? FOLD_RULE[1] : ''), true);
check('the chevron is off everywhere else', /\.sb-unit-fold \{ display:none; \}/.test(raw), true);
check('  and only the phone sheet turns it on',
  /\.sb-unit-fold \{\s*\r?\n?\s*display:inline-flex/.test(PHONE_CSS), true);

// The contents is a page of the book. As a fluid box it was the WRAP's
// width -- the phone's -- and then scaled by a zoom calculated to fit a
// 794px sheet, which left it a stamp beside songs that filled the screen.
const IDX_RULE = /#songbookLiveModal \.sb-index-page \{([^}]*)\}/.exec(PHONE_CSS);
check('the phone gives the contents the sheet it gives every song', !!IDX_RULE, true);
check('  at the A4 width the fit-zoom is calculated from',
  /width:\s*794px/.test(IDX_RULE ? IDX_RULE[1] : ''), true);
check('  not capped back to the fluid 820',
  /max-width:\s*794px/.test(IDX_RULE ? IDX_RULE[1] : ''), true);
check('  and the A4 height to go with it',
  /min-height:\s*1123px/.test(IDX_RULE ? IDX_RULE[1] : ''), true);
// The desktop songbook is untouched: its contents card is still the
// fluid box it always was.
check('the desktop contents card is left alone',
  /\.sb-index-page \{ background:white;[^}]*width:100%; max-width:820px;/.test(raw), true);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN && passed === results.length) {
  console.log('\nBUT --expect-broken was given and everything passed.');
  process.exit(1);
}
process.exit(passed === results.length ? 0 : 1);
