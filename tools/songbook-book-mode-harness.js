'use strict';
// Harness for Book Mode as a place to draw and type (CLAUDE.md gotcha 64).
//
// WHY THIS EXISTS
// From the operator (2026-11-06): a Book Mode tile on every song, opening
// the songbook full screen at that song; and in it, a double-click (a double
// tap on a phone) anywhere on the words to start drawing, and a line held
// to type over it. So:
//   - a song's book pages are drawn from the song view's own words, in the
//     key sung, every line carrying the anchor drawn remarks are kept
//     against -- the drawings are the song view's, both ways;
//   - a book page is a drawing card (.sbm-bk-card); it is scaled by a
//     transform, so ems and the canvas are worked out in screen pixels;
//   - holding the words makes the whole song a notepad (gotcha 65, checked
//     by tools/songbook-notepad-harness.js);
//   - in the browser's real full screen only the overlay is drawn, so what
//     the songbook adds to <body> -- the drawing bar, its questions, toasts
//     -- is taken into the overlay while it is open.
//
// USAGE
//   node tools/songbook-book-mode-harness.js                 # ../Index.html
//   node tools/songbook-book-mode-harness.js path/to/file.html
//   node tools/songbook-book-mode-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 5851fff:Index.html > x`).
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

const SRC = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const has = re => re.test(SRC);
const fn = name => { const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}
function run(label, fnSrc, params, args, extra) {
  try { return new Function(...params, (extra || '') + '\n' + fnSrc + '\nreturn ' + label + '.apply(null, arguments[arguments.length - 1]);')(...args, []); }
  catch (e) { return { __err: e.message }; }
}

console.log('A tile on every song, opening the book at it');
const render = fn('_sbmRender');
// (Since 2026-11-07 one row: Record, Tracks, YouTube, Book Mode, Drawings, Edit, More;
// since 2026-11-09 Save / Load Versions between Edit and More.)
check('the song\'s tiles have Book Mode after YouTube, then Drawings, Edit, Save / Load Versions and More',
  /YouTube<\/button>'\) \+\n(\s*\/\/[^\n]*\n)*\s*'<button class="sbm-tile" onclick="WO\.sbmBookMode\(\)"[^\n]*Book Mode<\/button>' \+\n(\s*\/\/[^\n]*\n)*\s*_sbmDrawingsTile\(song\) \+\n\s*'<button class="sbm-tile" data-sbm-edit=[^\n]*\n\s*vTile \+\n\s*'<button class="sbm-tile sbm-tile--more" onclick="WO\.sbmMore\(\)"><i class="fa-solid fa-ellipsis"><\/i>More<\/button>' \+\n\s*'<\/div><\/div>';/.test(render));
check('...and it is on WO', has(/\n    sbmBookMode: sbmBookMode,\n/));
const open = fn('sbOpenFullscreen');
const startSrc = (open.match(/if \(typeof startSongId === 'string' && startSongId\) \{[^]*?\n    \}/) || [''])[0];
if (startSrc) {
  const at = (map, id) => new Function('_sbFsSongPageMap', 'startSongId', 'var _sbFsIdx = 0;\n' + startSrc + '\nreturn _sbFsIdx;')(map, id);
  check('the book opens at the song\'s FIRST page', at({ 3: 'a', 4: 'a', 7: 'b', 8: 'b', 9: 'b' }, 'b') === 7 && at({ 12: 'z', 11: 'z' }, 'z') === 11);
  check('...and at the contents when the song has no pages, or none was asked', at({ 3: 'a' }, 'q') === 0);
} else check('sbOpenFullscreen takes the song to open at', false);
// (Since 2026-11-07 a page with no zoom of its own takes the last one set before it.)
check('...with the zoom for that page, not the first', /_sbFsZoom = _sbFsZoomAt\(_sbFsPageZooms, _sbFsIdx, _sbFsFitZoom\);/.test(open));
check('sbmBookMode opens it at the song in front', /sbOpenFullscreen\(song \? song\.id : ''\);/.test(fn('sbmBookMode')));

// From the operator (2026-11-07): a zoom set on a page carries on to the
// pages after it until it is changed on one of them, and every change is
// kept; and a swipe turns pages like a book -- right to left is the next
// page, left to right the one before. It was the other way round.
console.log('\nBook Mode: the zoom carries on, and a swipe turns like a book');
let zoomAt = null;
try { zoomAt = new Function(fn('_sbFsZoomAt') + '\nreturn _sbFsZoomAt;')(); } catch (e) { zoomAt = null; }
if (!zoomAt) check('a page\'s zoom is worked out by a function of its own', false);
else {
  const map = { 2: 1.4, 6: 0.9 };
  check('a page with no zoom of its own takes the last one set before it',
    zoomAt(map, 2, 0.6) === 1.4 && zoomAt(map, 3, 0.6) === 1.4 && zoomAt(map, 5, 0.6) === 1.4);
  check('...until a later page sets its own, which carries on in turn', zoomAt(map, 6, 0.6) === 0.9 && zoomAt(map, 9, 0.6) === 0.9);
  check('...and the pages before any zoom fit the screen', zoomAt(map, 0, 0.6) === 0.6 && zoomAt(map, 1, 0.6) === 0.6);
  check('...a zoom kept as text (JSON keys) is read, nothing else is', zoomAt({ '1': 1.2 }, 4, 0.6) === 1.2 && zoomAt({ 1: null, 2: 'x' }, 3, 0.6) === 0.6 && zoomAt(null, 3, 0.6) === 0.6);
}
check('every way into a page uses it: opening, the cloud\'s zooms, turning a page',
  (SRC.match(/_sbFsZoom = _sbFsZoomAt\(_sbFsPageZooms, _sbFsIdx, _sbFsFitZoom\);/g) || []).length === 3 &&
  !/_sbFsPageZooms\[_sbFsIdx\] !== undefined/.test(SRC) && /_sbFsPageZooms\[_sbFsIdx\] = _sbFsZoom;/.test(fn('_sbFsSaveZoom')));
const pinchSrc = fn('_sbFsInitPinch');
check('right to left is the next page, left to right the one before', /if \(dx < 0\) sbFsNext\(\);\r?\n\s*else\s+sbFsPrev\(\);/.test(pinchSrc) && !/if \(dx > 0\) sbFsNext\(\);/.test(pinchSrc));

console.log('\nThe book\'s words are the song view\'s');
check('one source of a song\'s words: the song view, the page view and the book',
  /var lyricsHtml = _sbmLyricsSource\(song\);/.test(render) && /var lyricsHtml = _sbmLyricsSource\(song\);/.test(fn('renderSongbookLive')) &&
  /_sbmLyricsSource\(song\)/.test(fn('_sbmLinesOf')) && /_sbmLyricsSource\(song\)/.test(fn('_sbBkLyricsHtml')));
const build = fn('_sbFsBuildPages');
check('a song\'s book pages take their words from _sbBkLyricsHtml, not the printed page\'s DOM',
  /var lyricsHtml = _sbBkLyricsHtml\(song\);/.test(build) && !/getElementById\('sbLyrics-' \+ song\.id\);\n\s*\/\/ Strip page-break/.test(build));
const bkHtml = fn('_sbBkLyricsHtml');
if (bkHtml) {
  // A stand-in element that parses a run of flat blocks, as the formatter makes them.
  const fakeDoc = { createElement() {
    const el = { kids: [] };
    Object.defineProperty(el, 'innerHTML', {
      set(h) { el.kids = (h.match(/<div[^>]*>[^<]*<\/div>/g) || []).map(b => { const at = {}; return { setAttribute(k, v) { at[k] = v; }, html: () => b.replace(/^<div/, '<div' + Object.keys(at).map(k => ' ' + k + '="' + at[k] + '"').join('')) }; }); },
      get() { return el.kids.map(k => k.html()).join(''); } });
    Object.defineProperty(el, 'children', { get() { return el.kids; } });
    return el;
  } };
  const words = '<div class="wo-lyrics-section-header verse">[Verse]</div><div class="wo-lyrics-chord-line">C   G</div><div class="wo-lyrics-lyric-line">Amazing grace</div>';
  let steps = 0, xp = null;
  const html = new Function('document', '_sbmLyricsSource', '_sbmStepsOf', '_sbTransposeHtml', bkHtml + '\nreturn _sbBkLyricsHtml({});')(
    fakeDoc, () => words, () => steps, (h, s) => { xp = s; return h; });
  check('every line of the book is given its anchor, l:0, l:1, l:2 -- the song view\'s',
    /data-anchor="l:0"[^>]*>\[Verse\]/.test(html) && /data-anchor="l:1"[^>]*>C   G/.test(html) && /data-anchor="l:2"[^>]*>Amazing grace/.test(html), html);
  steps = 2;
  new Function('document', '_sbmLyricsSource', '_sbmStepsOf', '_sbTransposeHtml', bkHtml + '\nreturn _sbBkLyricsHtml({});')(fakeDoc, () => words, () => steps, (h, s) => { xp = s; return h; });
  check('...in the key it is sung in', xp === 2);
} else check('_sbBkLyricsHtml exists', false);

console.log('\nA book page is a drawing card');
check('each page of a song carries the card, with its song (one column and two)',
  /'<div class="sbm-bk-card" data-sbm-song="' \+ escapeHtml\(song\.id\) \+ '" style="position:absolute;top:' \+ \(-breakY\) \+ 'px;left:0;width:794px;">'/.test(build) &&
  /'<div class="sbm-bk-card" data-sbm-song="' \+ escapeHtml\(song\.id\) \+ '" style="height:' \+ A4H \+ 'px;overflow:hidden;position:relative;background:white;">'/.test(build));
check('...and each choir page, whose moments keep the song view\'s score anchors (s:<section>|<n>)',
  /'<div class="sbm-bk-card sbm-bk-card--choir" data-sbm-song="' \+ escapeHtml\(song\.id\) \+ '" style="height:' \+ A4H \+ 'px;overflow:hidden;position:relative;">'/.test(build) &&
  /data-anchor="' \+ V\._esc\('s:' \+/.test(SRC));
const cardsSrc = fn('_sbmMarkCards');
if (cardsSrc) {
  let asked = '';
  const fake = (open) => new Function('document', '_sbBkOpen', cardsSrc + '\nreturn _sbmMarkCards();')(
    { querySelectorAll(sel) { asked = sel; return []; } }, () => open);
  fake(true); const whenOpen = asked; fake(false); const whenShut = asked;
  check('the book\'s cards are among the cards painted, drawn on and undone -- while the book is open',
    /#sbFsPage \.sbm-bk-card/.test(whenOpen) && !/sbFsPage/.test(whenShut) && /#sbmRoot \.sbm-card/.test(whenShut), whenOpen + ' | ' + whenShut);
} else check('_sbmMarkCards exists', false);
const scaleSrc = fn('_sbmCardScale');
if (scaleSrc) {
  const sc = (lay, screen) => new Function(scaleSrc + '\nreturn _sbmCardScale(arguments[0]);')({ offsetWidth: lay, getBoundingClientRect: () => ({ width: screen }) });
  check('a card\'s scale: the zoom on a book page, exactly 1 in the song view', Math.abs(sc(794, 555.8) - 0.7) < 1e-9 && sc(794, 795) === 1 && sc(0, 10) === 1);
} else check('_sbmCardScale exists', false);
check('ems are scaled with the card, where a stroke\'s place and size are worked out',
  /parseFloat\(getComputedStyle\(el\)\.fontSize\) \* sc/.test(fn('_sbmMarkBox')) && /\* _sbmCardScale\(card\)/.test(fn('_sbmMarkTokensAt')));
const paint = fn('_sbmMarksPaint');
if (paint) {
  const P = (lay, screen, h, dpr) => {
    const cv = { width: 0, height: 0, style: {}, getContext: () => ({ setTransform() {}, clearRect() {} }) };
    const card = { clientWidth: lay, clientHeight: h, querySelector: () => cv };
    new Function('window', '_sbmCardSong', '_sbBaseSongId', '_sbmGlowDraw', '_sbmMarksOf', '_sbmCardScale', '_sbmDraw', paint + '\n_sbmMarksPaint(arguments[7]);')(
      { devicePixelRatio: dpr }, () => null, () => '', () => {}, () => [], () => screen / lay, null, card);
    return cv;
  };
  const a = P(794, 555.8, 3000, 2);
  check('the canvas is laid out in the page\'s pixels and drawn in the screen\'s', a.style.width === '794px' && a.style.height === '3000px' && a.width === Math.floor(555.8 * 2) && a.height === Math.floor(3000 * 0.7 * 2), JSON.stringify(a));
  const b = P(794, 794 * 3, 6000, 2);
  check('...and never past what a phone\'s canvas will hold', b.width * b.height <= 16e6 + 1e5 && b.__dpr < 2, b.width + 'x' + b.height);
  const c = P(1000, 1000, 800, 2);
  check('...the song view as it was: its own size, at the screen\'s density', c.width === 2000 && c.height === 1600 && c.style.width === '1000px');
} else check('_sbmMarksPaint exists', false);
check('a stroke is drawn at the density its canvas was painted at', /dpr = cv\.__dpr \|\| Math\.min/.test(fn('_sbmDrawDown')));
check('after every page drawn, its drawings and the pen', /_sbBkMount\(\);\n  \}$/.test(fn('_sbFsRenderPage')) && /_sbmMarkCanvas\(card\);/.test(fn('_sbBkMount')) && /_sbmLoadMarks\(song\)/.test(fn('_sbBkMount')));

console.log('\nThe gestures');
const auto = fn('_sbFsInitAutoHide');
check('a double-click starts drawing, and no longer closes the book', /addEventListener\('dblclick', function\(e\) \{ _sbBkDouble\(e\); \}\);/.test(auto) && !/dblclick', function\(\) \{ sbFsClose\(\); \}/.test(auto) && has(/title="Close \(Esc\)"/));
const up = fn('_sbBkUp');
if (up) {
  let doubles = 0, now = 1000;
  const U = new Function('_sbBk', '_sbBkCancelHold', '_sbBkDouble', 'Date', '_sbmDraw', '_sbNp', up + '\nreturn _sbBkUp;');
  const st = { tap: null, down: null };
  const tapUp = (kind, moved) => { st.down = { x: 50, y: 50, moved: !!moved, held: false }; U(st, () => {}, () => { doubles++; }, { now: () => now }, null, null)({ pointerType: kind, clientX: 50, clientY: 50 }); };
  tapUp('touch'); now += 200; tapUp('touch');
  check('two taps close together are a double tap: the pen comes out', doubles === 1);
  doubles = 0; now += 2000; tapUp('touch'); now += 600; tapUp('touch');
  check('...two taps far apart in time are not', doubles === 0);
  doubles = 0; now += 2000; tapUp('touch', true); now += 100; tapUp('touch');
  check('...nor a swipe and a tap', doubles === 0);
  doubles = 0; now += 2000; tapUp('mouse'); now += 100; tapUp('mouse');
  check('...and a mouse uses the double-click itself', doubles === 0);
} else check('_sbBkUp exists', false);
const down = fn('_sbBkDown');
if (down) {
  let delay = 0, started = null;
  const st = { tap: null, down: null, hold: null };
  const line = { id: 'L' };
  new Function('_sbBk', '_sbBkCancelHold', '_sbBkHold', 'setTimeout', '_sbmDraw', '_sbNp', down + '\nreturn _sbBkDown;')(
    st, () => {}, (l, x, y) => { started = [l, x, y]; }, (f, ms) => { delay = ms; f(); return 1; }, null, null)(
    { isPrimary: true, button: 0, clientX: 9, clientY: 8, target: { closest: sel => (/data-anchor\^="l:"/.test(sel) ? line : null) } });
  check('holding the words about half a second opens the notepad, where they were held', delay === 550 && started && started[0] === line && started[1] === 9 && started[2] === 8);
} else check('_sbBkDown exists', false);
const pinch = fn('_sbFsInitPinch');
check('the book\'s swipe and pinch stand down while drawing or typing', (pinch.match(/if \(_sbmDraw \|\| _sbNp\)/g) || []).length === 3);
const keys = fn('_sbFsKeyHandler');
check('the book\'s keys leave a line being typed alone, and Esc puts the pen away first',
  /if \(e\.target && e\.target\.isContentEditable\) return;/.test(keys) && /e\.key === 'Escape' && _sbmDraw && _sbBk\.penHere\) \{ _sbBk\.penHere = false; sbmDraw\(false\); return; \}/.test(keys));

console.log('\nIn the browser\'s full screen');
const take = fn('_sbBkTake');
if (take) {
  const ov = { kids: [], appendChild(el) { el.parentNode = ov; this.kids.push(el); } };
  const body = {};
  const doc = { body, getElementById: id => (id === 'sbFsOverlay' ? ov : null) };
  const adopted = [];
  const T = new Function('document', '_sbBkAdopted', take + '\nreturn _sbBkTake;')(doc, adopted);
  const sheet = { nodeType: 1, tagName: 'DIV', parentNode: body }, script = { nodeType: 1, tagName: 'SCRIPT', parentNode: body }, gone = { nodeType: 1, tagName: 'DIV', parentNode: null };
  T(sheet); T(script); T(gone); T(ov);
  check('what the songbook puts on <body> is drawn inside the book: a sheet, the bar, a toast', ov.kids.indexOf(sheet) > -1 && adopted.indexOf(sheet) > -1);
  check('...but not a script, nor what has come and gone (a measuring div), nor the book itself', ov.kids.indexOf(script) < 0 && ov.kids.indexOf(gone) < 0 && ov.kids.indexOf(ov) < 0);
} else check('_sbBkTake exists', false);
check('the bar, a sheet and the toast already open are taken in, and everything is given back on closing',
  /\['toastNotification', 'sbmDrawBar', 'sbmSheet'\]\.forEach/.test(fn('_sbBkAdoptOn')) && /document\.body\.appendChild\(el\)/.test(fn('_sbBkAdoptOff')));
check('closing keeps what is being typed, gives back what was taken, and puts away a pen taken out here',
  /^\n  function sbFsClose\(\) \{\n    _sbBkLeave\(\);/.test(fn('sbFsClose')) &&
  /if \(_sbNp && _sbNp\.where === 'book'\) _sbNpEnd\(true\);/.test(fn('_sbBkLeave')) && /_sbBkAdoptOff\(\);/.test(fn('_sbBkLeave')) && /if \(_sbmDraw && _sbBk\.penHere\) sbmDraw\(false\);/.test(fn('_sbBkLeave')));
check('the book\'s cards take the pen, and the words are not selected by a long press',
  has(/\.sbm-bk-card\.is-drawing \.sbm-marks \{ pointer-events: auto; touch-action: none;/) && has(/#sbFsPage \.sbm-bk-card \{ -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}/) && has(/#sbFsViewport \{ touch-action: manipulation; \}/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
