'use strict';
// Harness for the Liturgy Builder as the operator marked it up on 2026-11-20:
//
//   1. On a phone the top bar is small buttons -- the sections (by number),
//      the PDF, collapse all, WhatsApp, Save, Load, undo, redo -- and the
//      Liturgy Book big and shiny; on a desk the ribbon's Liturgy Book is the
//      same gold button, first after Add Item, and keeps its words.
//   2. A double-tap opens a part: a song in the Songbook, liturgy in its
//      own All Slides; never on the words being typed.
//   3. Between two sections, a + that adds one there: a blank section or one
//      of a kind (reading, recitation, song, prayer...), named for it.
//   4. Where to start: once on a device, a bow looses an arrow at the
//      Liturgy Book and a banner says "Start Designing the Liturgy from
//      Here", with fireworks and Bible pages flying behind.
//
// USAGE
//   node tools/builder-word-bar-harness.js
//   node tools/builder-word-bar-harness.js <file> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');

function extractFn(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('function not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}
function extractVarBlock(name) {
  const i = lines.findIndex(l => new RegExp('^  var ' + name + '\\b').test(l));
  if (i < 0) throw new Error('var not found: ' + name);
  const out = [];
  for (let k = i; k < lines.length; k++) { out.push(lines[k]); if (/;\s*\r?$/.test(lines[k])) break; }
  return out.join('\n');
}
const fn = n => { try { return extractFn(n); } catch (e) { return ''; } };
const has = re => re.test(SRC);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// ------------------------------------------------------------ 1. the bar
console.log('\n1. The phone\'s bar: small buttons, the Liturgy Book big and shiny');
let bar = null;
try {
  bar = new Function('folded',
    'var _lbdFolded = folded;' +
    'function _woSectionList() { return [{ id: "a", title: "Invocation" }, { id: "b", title: "Confession" }]; }' +
    'function _lbdCurLabel() { return "2. Confession"; }' +
    'function _lbdEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }' +
    fn('_lbdCurNum') + '\n' + fn('_lbdMbarHtml') + '\nreturn _lbdMbarHtml;');
} catch (e) { bar = null; }
const open = bar ? bar({})() : '', shut = bar ? bar({ a: true, b: true })() : '';
const acts = (open.match(/data-act="[^"]+"/g) || []).map(a => a.slice(10, -1));
check('in order: sections, PDF, collapse all, the Liturgy Book, then WhatsApp, Save, Load, undo, redo',
  acts.join(' ') === 'nav-toggle export-pdf fold-all open-book share-link save-liturgy menu-load undo redo', acts.join(' '));
check('every one small but the Liturgy Book, which is big and says so',
  (open.match(/class="lbw-mb lbw-mb-s[ "]/g) || []).length === 8 && /class="lbw-mb lbw-mb-book" data-act="open-book"/.test(open) &&
  /<i class="fa-solid fa-book-bookmark" aria-hidden="true"><\/i><span>Liturgy Book<\/span>/.test(open));
check('the sections button keeps the picker\'s job: the section you are in, by its number, named in full on hover',
  /<span class="lbw-mbar-cur">2<\/span>/.test(open) && /title="Sections: 2\. Confession"/.test(open) &&
  /mc\.textContent = _lbdCurNum\(\);/.test(fn('_lbdSetCur') || SRC));
check('collapse all says what it will do: collapse, or expand once everything is folded',
  /title="Collapse all sections"/.test(open) && /fa-angles-up/.test(open) && /title="Expand all sections"/.test(shut) && /fa-angles-down/.test(shut));
check('each does what its name says: the PDF export, fold all, the Liturgy Book (ending the intro)',
  has(/case 'export-pdf': lbdExport\('pdf'\); break;/) && has(/case 'fold-all': _lbdFoldAll\(\); break;/) &&
  has(/case 'open-book': _lbdBookIntroEnd\(\); openLiturgyBook\(\); break;/));
check('on a phone they are 30px, the book takes what is left and shines',
  has(/\.lbw--sm \.lbw-mb\.lbw-mb-s \{ min-width: 30px; width: 30px; height: 34px;/) &&
  has(/\.lbw-mb-book \{\r?\n  flex: 1 1 auto; min-width: 74px; height: 42px;/) &&
  has(/\.lbw-mb-book::after, \.lbw-rb\.lbw-rb--book::after \{/) && has(/@keyframes lbwBookShine/));
const rib = fn('_lbdRibbonHtml');
check('on a desk the ribbon\'s Liturgy Book is the same gold button, first after Add Item',
  /class="lbw-rb lbw-rb--book" data-act="open-book"/.test(rib) &&
  rib.indexOf('<span>Add Item</span>') > 0 && rib.indexOf('lbw-rb--book') > rib.indexOf('<span>Add Item</span>') &&
  rib.indexOf('lbw-rb--book') < rib.indexOf("b('menu-import'") && (rib.match(/data-act="open-book"|b\('open-book'/g) || []).length === 1);
check('...and keeps its words on a laptop and a tablet',
  !has(/\.lbw--lg \.lbw-rb\[data-act="open-book"\] span/) && !has(/\.lbw--md \.lbw-rb\[data-act="open-book"\] span/));

// ------------------------------------------------------------ 2. double-tap
console.log('\n2. A double-tap opens a part');
const opened = [];
let dt = null;
try {
  dt = new Function('opened', 'var Date = { now: function() { return opened.clock; } };' +
    'function soOpenInSongbook(id) { opened.push("songbook " + id); }' +
    'function lbdAllSlides(id) { opened.push("allslides " + id); }' +
    'var _lbdTap = null;\n' + fn('_lbdDoubleTap') + '\nreturn _lbdDoubleTap;')(opened);
} catch (e) { dt = null; }
function part(attrs) { return { getAttribute: k => (k in attrs ? attrs[k] : null) }; }
function target(el, excluded) {
  return { closest: sel => (sel === '.lbw-el' ? el : (excluded ? {} : null)) };
}
function tap(el, at, x, excluded) { opened.clock = at; return dt({ clientX: x || 100, clientY: 50 }, target(el, excluded)); }
if (dt) {
  const song = part({ 'data-song': 's1' }), lit = part({ 'data-item': 'i7' });
  tap(song, 1000); const r1 = tap(song, 1250);
  check('a song tapped twice within 400ms opens in the Songbook, at that song', r1 === true && opened[0] === 'songbook s1', JSON.stringify(opened));
  tap(lit, 5000); tap(lit, 5300);
  check('a liturgy part opens in its own All Slides', opened[1] === 'allslides i7', JSON.stringify(opened));
  opened.length = 0;
  tap(song, 9000); tap(song, 9500);
  tap(song, 12000); tap(lit, 12100);
  tap(song, 15000); tap(song, 15100, 160);
  check('...not two taps half a second apart, on two parts, or 60px apart', opened.length === 0, JSON.stringify(opened));
  tap(lit, 20000, 100, true); tap(lit, 20100, 100, true);
  tap(lit, 21000); tap(lit, 21100, 100, true);
  check('...and never on the words being typed, a button or a note (a double-click there selects a word)', opened.length === 0, JSON.stringify(opened));
} else check('the double-tap could be built', false);
check('the builder\'s click asks it first, and a part is touch-action: manipulation so the second tap is not a zoom',
  /if \(_lbdDoubleTap\(e, t\)/.test(fn('_lbdOnClick')) && has(/\.lbw-el \{ touch-action: manipulation; \}/) &&
  /\[data-field="slide"\], \[data-field="content-text"\], \.lbw-note/.test(fn('_lbdDoubleTap')));

// ------------------------------------------------------------ 3. a section between
console.log('\n3. Between two sections, a + adds one there');
let K = null;
try { K = new Function(extractVarBlock('_LBD_SEC_KINDS').replace(/^  var /, 'var ') + '\nreturn _LBD_SEC_KINDS;')(); } catch (e) {
  // the block runs over several lines: take it to its closing ];
  const i = lines.findIndex(l => /^  var _LBD_SEC_KINDS = \[/.test(l));
  const out = [];
  for (let k = i; i >= 0 && k < lines.length; k++) { out.push(lines[k]); if (/^\s*\];\s*\r?$/.test(lines[k])) break; }
  try { K = new Function(out.join('\n') + '\nreturn _LBD_SEC_KINDS;')(); } catch (e2) { K = null; }
}
check('a blank section, or one of a kind: reading, recitation, song, prayer, text, sermon, announcements',
  !!K && K.map(k => k.label).join('|') === 'A blank section|Reading|Recitation (said together)|Song|Prayer|Text slide|Sermon|Announcements' &&
  K[1].then === 'reading' && K[2].then === 'liturgy' && K[3].then === 'song' && !K[0].then && !K[6].then, K && K.map(k => k.label + ':' + k.then).join(' '));
check('the + sits between sections only (the end keeps its own Add a section)',
  has(/list\.map\(function\(sec, i\) \{ return _lbdSectionHtml\(sec, i, list\) \+ \(i < list\.length - 1 \? _lbdInsHtml\(i \+ 1\) : ''\); \}\)\.join\(''\)/) &&
  /data-act="sec-ins-at" data-at="' \+ at \+ '"/.test(fn('_lbdInsHtml')) &&
  has(/case 'sec-ins-at': _lbdAddSecMenu\(btn, parseInt\(btn\.getAttribute\('data-at'\), 10\)\); break;/));
let add = null;
try {
  add = new Function('order', 'calls',
    'var currentOrderData = order, _lbdRenaming = null, _lbdCurSec = "", _lbdCurEl = "";' +
    'var Date = { now: function() { return 42; } };' +
    'function setTimeout(f) { f(); }' +
    'function _lbdChange(f) { f(); return true; }' +
    'function _lbdInsert(kind, id) { calls.push(kind + " " + id); }\n' +
    fn('lbdAddSection') + '\nreturn { add: lbdAddSection, ren: function() { return _lbdRenaming; } };');
} catch (e) { add = null; }
if (add) {
  const order = { sectionLayout: [{ id: 'a', title: 'Invocation' }, { id: 'b', title: 'Confession' }] }, calls = [];
  const A = add(order, calls);
  const id = A.add(1, 'Song', 'song');
  check('a kind goes in where the + was, named for it, and asks for its song at once',
    order.sectionLayout.map(s => s.title).join('|') === 'Invocation|Song|Confession' && calls[0] === 'song wo-section-42' && id === 'wo-section-42' && A.ren() === null,
    order.sectionLayout.map(s => s.title).join('|') + ' ' + calls.join(','));
  const order2 = { sectionLayout: [{ id: 'a', title: 'Invocation' }] }, calls2 = [];
  const B = add(order2, calls2);
  B.add(1);
  check('a blank one is "New Section" with its name selected for typing, as Add a section always was',
    order2.sectionLayout[1].title === 'New Section' && B.ren() === 'wo-section-42' && !calls2.length);
} else check('lbdAddSection could be built', false);
check('the + is a round + on a touch screen, a dashed line and words on hover on a desk, gone while a section is dragged',
  has(/\.lbw-ins-b:hover, \.lbw-ins-b:focus-visible \{ opacity: 1; \}/) && has(/@media \(hover: none\) \{\r?\n  \.lbw-ins-b \{ opacity: 1; \}/) &&
  has(/\.lbw-page\.is-sorting \.lbw-ins \{ display: none; \}/));

// ------------------------------------------------------------ 4. where to start
console.log('\n4. Where to start: the bow, the arrow and the banner');
let geom = null;
try { geom = new Function(fn('_lbdIntroGeom') + '\nreturn _lbdIntroGeom;')(); } catch (e) { geom = null; }
function onEdge(bx, by, r) {
  const g = geom(bx, by, r), a = g.ang * Math.PI / 180;
  const px = bx + Math.cos(a) * (g.stop + 2), py = by + Math.sin(a) * (g.stop + 2);
  const inX = px >= r.left - 0.5 && px <= r.left + r.width + 0.5, inY = py >= r.top - 0.5 && py <= r.top + r.height + 0.5;
  const onX = Math.abs(px - r.left) < 0.6 || Math.abs(px - (r.left + r.width)) < 0.6;
  const onY = Math.abs(py - r.top) < 0.6 || Math.abs(py - (r.top + r.height)) < 0.6;
  return inX && inY && (onX || onY);
}
if (geom) {
  const book = { left: 120, top: 209, width: 74, height: 42 };
  check('the arrow\'s tip lands on the Liturgy Book\'s edge, coming up from the bow (a phone)', onEdge(112, 600, book) && geom(112, 600, book).ang < -45);
  check('...and from the side, on a wide desk button', onEdge(150, 520, { left: 700, top: 120, width: 125, height: 36 }));
} else check('the geometry could be built', false);
const intro = fn('_lbdBookIntroNow'), maybe = fn('_lbdBookIntroMaybe');
check('the banner says "Start Designing the Liturgy from Here", and opens the Liturgy Book or lets go',
  /<b class="lbi-banner__t">Start Designing the Liturgy from Here<\/b>/.test(intro) && /class="lbi-open">Open the Liturgy Book</.test(intro) &&
  /class="lbi-ok">Got it</.test(intro));
check('a large bow, an arrow, fireworks and Bible pages flying behind',
  /class="lbi-bow"/.test(intro) && /class="lbi-arrow"/.test(intro) && /class="lbi-fw"/.test(intro) && /class="lbi-page"/.test(intro) &&
  /for \(var i = 0; i < 9; i\+\+\)/.test(intro) && has(/@keyframes lbiFly/) && has(/@keyframes lbiSpark/) && has(/@keyframes lbiPage/));
check('once on a device: shown only when not seen, marked seen when shown, never in the desk\'s Phone view',
  /localStorage\.getItem\(_LBD_BOOK_INTRO_KEY\) === '1'/.test(maybe) && /window\.__SBM_PREVIEW/.test(maybe) &&
  /localStorage\.setItem\(_LBD_BOOK_INTRO_KEY, '1'\)/.test(intro) && has(/var _LBD_BOOK_INTRO_KEY = 'lhc_lbd_book_intro_v1';/) &&
  has(/if \(!_lbdIntroTried\) setTimeout\(_lbdBookIntroMaybe, 1400\);/));
check('...not over the Liturgy Book, a sheet or a menu; More plays it again',
  /liturgyBookModal/.test(maybe) && /\.lbd-sheet-backdrop, \.lbw-menu, #lbdBookIntro/.test(maybe) &&
  /label: 'Where to start designing \(the tip again\)'/.test(fn('_lbdOpenMoreMenu')));
check('it taps through but for its banner, and goes on a tap, Escape, a resize or after 12 seconds',
  has(/\.lbi \{ position: fixed; inset: 0; z-index: 3200; pointer-events: none;/) && has(/\.lbi-banner \{\r?\n  position: absolute; box-sizing: border-box; padding: 26px 18px 16px; pointer-events: auto;/) &&
  /document\.addEventListener\('pointerdown', away, true\)/.test(intro) && /ev\.key === 'Escape'/.test(intro) &&
  /window\.addEventListener\('resize', size\)/.test(intro) && /setTimeout\(_lbdBookIntroEnd, 12000\)/.test(intro));
check('it waits for the button to stop moving (the sidebar sliding shut) before it aims',
  /_lbdWhenStill\(_lbdBookTarget, _lbdBookIntroNow\);/.test(fn('_lbdBookIntro')) && /Math\.abs\(r1\.left - r0\.left\) < 1/.test(fn('_lbdWhenStill')));
let place = null;
try { place = new Function(fn('_lbdIntroPlace') + '\nreturn _lbdIntroPlace;')(); } catch (e) { place = null; }
function overlaps(a, b) { return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b; }
if (place) {
  const ph = { left: 120, top: 209, width: 74, height: 42, right: 194, bottom: 251 };
  const P1 = place(375, 812, ph);
  check('a phone: a short banner over the button, the bow below it, nothing in the arrow\'s way',
    P1.small && !P1.below && P1.bt + P1.bh <= ph.top && P1.by > ph.bottom + 200, JSON.stringify(P1));
  const dk = { left: 245, top: 225, width: 107, height: 36, right: 352, bottom: 261 };
  const P2 = place(1536, 695, dk);
  const ban = { l: P2.bl, r: P2.bl + P2.bw, t: P2.bt, b: P2.bt + P2.bh };
  const bow = { l: P2.bx - 50, r: P2.bx + 50, t: P2.by - 92, b: P2.by + 92 };
  check('a desk: the banner under the button, the bow off to the side clear of it, the arrow flying in over its top',
    !P2.small && P2.below && P2.bt >= dk.bottom && !overlaps(ban, bow) && P2.bx > dk.right + 200 && P2.by < P2.bt, JSON.stringify(P2));
} else check('the placement could be built', false);
check('with reduced motion: the banner and a ring, nothing flying',
  has(/@media \(prefers-reduced-motion: reduce\) \{\r?\n  \.lbi-pages, \.lbi-fw, \.lbi-bow, \.lbi-arrow \{ display: none; \}/));

// ------------------------------------------------------------ 5. a heading renamed
console.log('\n5. A double-tap on a section heading renames it');
const focused = [];
let ht = null;
try {
  ht = new Function('focused', 'var Date = { now: function() { return focused.clock; } };' +
    'function _lbdCssId(s) { return s; } function _lbdFocus(sel, how) { focused.push(sel + " " + how); }' +
    'var _lbdHeadTap = null;\n' + fn('_lbdHeadDoubleTap') + '\nreturn _lbdHeadDoubleTap;')(focused);
} catch (e) { ht = null; }
function headTarget(secId, excluded) {
  const sec = { getAttribute: () => secId };
  const h = { closest: sel => (sel === '.lbw-sec[data-sec]' ? sec : null) };
  return { closest: sel => (sel === '.lbw-page .lbw-h' ? h : (excluded ? {} : null)) };
}
function htap(secId, at, x, excluded) { focused.clock = at; return ht({ clientX: x || 80, clientY: 30 }, headTarget(secId, excluded)); }
if (ht) {
  htap('s3', 1000); const r = htap('s3', 1250);
  check('two taps on a heading within 400ms select its whole name, to type over',
    r === true && focused[0] === '.lbw-sec[data-sec="s3"] [data-field="sec-title"] select', JSON.stringify(focused));
  focused.length = 0;
  htap('s3', 5000); htap('s3', 5600);
  htap('s3', 8000); htap('s4', 8100);
  htap('s3', 9000, 80, true); htap('s3', 9100, 80, true);
  check('...not taps half a second apart, on two headings, or on its buttons and grip', focused.length === 0, JSON.stringify(focused));
} else check('the heading double-tap could be built', false);
check('the builder\'s click asks it, and a heading is touch-action: manipulation so the second tap is not a zoom',
  /if \(_lbdDoubleTap\(e, t\) \|\| _lbdHeadDoubleTap\(e, t\)\) return;/.test(fn('_lbdOnClick')) &&
  has(/border: 1px solid #dae8db; border-radius: 9px;\r?\n  touch-action: manipulation;/));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) {
    console.log('--expect-broken: nothing failed, so this source already has the fix (or the harness has no teeth)');
    process.exit(1);
  }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
