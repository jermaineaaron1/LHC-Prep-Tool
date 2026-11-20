'use strict';
// Harness for the Liturgy Book as a document, as the operator marked it up
// on 2026-11-20:
//
//   1. Fit the screen's width, big and clear, and zoom in or out: the words
//      reflow (CSS zoom), never an A4 page shrunk; print and the PDF stay A4.
//   2. White, black and gold, not green; the header puts Full Screen, PDF /
//      Print and WhatsApp first.
//   3. The contents: sections dragged to reorder, renamed in place, added.
//   4. The words: Shift+Enter starts a new slide at the cursor (Enter alone
//      on a touch screen, at a slide's end); Backspace at a slide's start
//      joins it back; every edit one Undo, the builder's.
//   5. Full screen: laid out as it is, the words read only until held for
//      2 seconds.
//   6. Songs as the Songbook shows them: Lyrics, Chords, or Choir where the
//      song has parts, in the key sung, and the Songbook a button away.
//   7. A song's words double-tapped are edited in place and saved through
//      the Songbook's own save; the choir score opens the choir pad.
//
// USAGE
//   node tools/liturgy-book-doc-harness.js
//   node tools/liturgy-book-doc-harness.js <file> --expect-broken

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
const fn = n => { try { return extractFn(n); } catch (e) { return ''; } };
const has = re => re.test(SRC);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// the book's own style block
const bStart = SRC.indexOf('/* ===== LITURGY BOOK 2 (lb2)');
const bEnd = bStart >= 0 ? SRC.indexOf('@media print {', bStart) : -1;
const BLOCK = bStart >= 0 && bEnd > bStart ? SRC.slice(bStart, bEnd) : '';

// ------------------------------------------------------------ 1. fit and zoom
console.log('\n1. The page fits the screen, its words reflowed; the zoom is this device\'s');
let Z = null;
try {
  Z = new Function('store',
    'var localStorage = { getItem: function(k) { return k in store ? store[k] : null; }, setItem: function(k, v) { store[k] = String(v); }, removeItem: function(k) { delete store[k]; } };' +
    'var _LB2_ZOOM_KEY = "lhc_lb2_zoom", _lb2Zoom = 1, applied = 0; function _lb2ApplyZoom() { applied++; }' +
    fn('_lb2FitZoom') + fn('_lb2ZoomChosen') + fn('_lb2SetZoom') +
    '\nreturn { fit: _lb2FitZoom, chosen: _lb2ZoomChosen, set: _lb2SetZoom, z: function() { return _lb2Zoom; } };');
} catch (e) { Z = null; }
let A = null;
try { A = Z ? Z({}) : null; if (A) A.fit(1); } catch (e) { A = null; }
if (A) {
  const store = {}; A = Z(store);
  check('a phone reads at 110%; a desk at 100% to 130% as its width allows',
    A.fit(375) === 1.1 && A.fit(900) === 1 && A.fit(1100) === 1.2 && A.fit(1400) === 1.3 && A.fit(2560) === 1.3,
    [375, 900, 1100, 1400, 2560].map(w => A.fit(w)).join(' '));
  A.set(1.27);
  const kept = store.lhc_lb2_zoom;
  A.set(9);
  check('a size chosen is kept on the device, in tenths, between 60% and 240%', kept === '1.3' && A.z() === 2.4 && A.chosen() === 2.4, kept + ' ' + A.z());
  store.lhc_lb2_zoom = 'junk';
  check('...and anything else stored there is no choice at all', A.chosen() === 0);
} else check('the zoom pieces could be built', false);
const apply = fn('_lb2ApplyZoom');
check('the zoom is CSS zoom on the wrap, so bigger words wrap again; no A4 page scaled by a transform',
  /wrap\.style\.zoom = String\(_lb2Zoom\)/.test(apply) && /wrap\.style\.transform = ''/.test(apply) && !/scale\(/.test(apply));
check('the page is the screen\'s width, at most 860px -- no A4 width left on the screen',
  /width: 100%; max-width: 860px; min-height: 50mm; background: white;/.test(BLOCK) && !/width: 210mm/.test(BLOCK));
check('print and the PDF stay A4 at 100%, without the editing furniture',
  /#lb2ZoomWrap\{zoom:1!important;\}\.lb2-page\{width:210mm!important;max-width:none!important;/.test(fn('lb2PrintPDF')) &&
  /\.lb2-idx-grip,\.lb2-idx-ren,\.lb2-idx-addrow,\.lb2-fsbar,\.lb2-hold-ring,\.lb2-song-bar,\.lb2-song-hint\{display:none!important;\}/.test(fn('lb2PrintPDF')));
check('opening fits it (or uses the size chosen), and a resize refits unless a size was chosen; the % fits again',
  /_lb2Zoom = _lb2ZoomChosen\(\) \|\| _lb2FitZoom\(window\.innerWidth\);/.test(fn('openLiturgyBook')) &&
  /if \(_lb2ZoomChosen\(\)\) return;/.test(fn('openLiturgyBook')) && /localStorage\.removeItem\(_LB2_ZOOM_KEY\)/.test(fn('lb2ZoomFit')) &&
  has(/id="lb2ZoomLabel" onclick="WO\.lb2ZoomFit\(\)"/));

// ------------------------------------------------------------ 2. look and header
console.log('\n2. White, black and gold; Full Screen, PDF and WhatsApp first');
check('no green left in the book\'s styles or its renderer',
  !!BLOCK && !/#16a34a|#14532d|#86efac|#dcfce7|#f0fdf4|#bbf7d0|#15803d/.test(BLOCK) &&
  !/#16a34a|#86efac|#f0fdf4/.test(fn('renderLiturgyBookLive')) && /\(2026-11-20; it was green\)/.test(BLOCK));
check('a charcoal bar with a gold rule; a white page with a gold rule over the contents',
  /background: linear-gradient\(135deg, #1b1e22 0%, #2e3339 100%\); border-bottom: 2px solid #c9a227;/.test(BLOCK) &&
  /\.lb2-idx-header \{ background: #fff; border-top: 3px solid #c9a227;/.test(BLOCK) &&
  has(/id="liturgyBookModal" style="display:none;position:fixed;inset:0;z-index:2210;flex-direction:column;overflow:hidden;background:#e9e7e1;"/));
const hd = (SRC.match(/<div class="lb2-header">[\s\S]*?<div class="lb2-fsbar"/) || [''])[0];
const order = ['lb2ToggleFullscreen', 'lb2PrintPDF', 'lb2Share', 'lb2ZoomOut', 'lb2ZoomFit', 'lb2ZoomIn', 'lb2Undo', 'lb2Redo', 'lb2More', 'closeLiturgyBook'];
check('in order: Full Screen, PDF / Print, WhatsApp, the size, undo, redo, More, close',
  order.every((f, i) => i === 0 || hd.indexOf('WO.' + f + '(') > hd.indexOf('WO.' + order[i - 1] + '(')) && hd.indexOf('WO.lb2ToggleFullscreen(') > 0,
  order.map(f => hd.indexOf('WO.' + f + '(')).join(' '));
check('...Chords, two columns, Sync, Save and the Builder are in More; Book Mode ("coming soon") is gone',
  !/lb2ToggleChords|lb2ToggleTwoCol|lb2OpenBookMode|lb2Refresh|lb2Save\(/.test(hd) &&
  ['lb2GoToOrder', 'lb2ToggleChords', 'lb2ToggleTwoCol', 'lb2Refresh', 'lb2Save'].every(f => new RegExp('run: ' + f + ' ').test(fn('lb2More'))));
check('undo and redo are the builder\'s (they were TODO and did nothing)',
  /function lb2Undo\(\) \{ _lb2Blur\(\); lbdUndo\(\); _lb2Rerender\(true\); \}/.test(SRC) && /function lb2Redo\(\) \{ _lb2Blur\(\); lbdRedo\(\); _lb2Rerender\(true\); \}/.test(SRC));
check('a phone: two rows, nothing scrolling sideways or off the screen',
  has(/#liturgyBookModal \.lb2-header-toolbar \{ display: contents; \}/) && has(/#liturgyBookModal \.lb2-row2 \{ order: 4; flex: 1 1 100%;/) &&
  !has(/#liturgyBookModal \.lb2-header-toolbar \{ flex: 1 1 100%; min-width: 0; flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto;/));

// ------------------------------------------------------------ 3. the contents
console.log('\n3. The contents: drag, rename, add');
const R = fn('renderLiturgyBookLive');
check('each section row carries its id, a grip, its name and a pen; the foot has + Add section',
  /'" data-sec="' \+ escapeHtml\(sec\.id\) \+ '">'/.test(R) && /<span class="lb2-idx-grip"/.test(R) && /<button type="button" class="lb2-idx-ren"/.test(R) &&
  /<tr class="lb2-idx-addrow"><td colspan="2"><button type="button" class="lb2-idx-add" onclick="WO\.lb2AddSection\(this\)"/.test(R));
let drag = null;
try {
  drag = new Function('calls', 'rows',
    'var _lb2Drag = null; var document = { removeEventListener: function() {} }; function clearInterval() {}' +
    'function _lb2DragMove() {} function _lb2DragUp() {} function _lb2DragCancel() {}' +
    'function _lb2Rows() { return rows; }' +
    'function _lbdMoveSectionTo(id, to, after) { calls.push(id + (after ? " after " : " before ") + to); return true; }' +
    'function _lb2Rerender() { calls.push("redraw"); }' +
    fn('_lb2DragEnd') + '\nreturn { set: function(d) { _lb2Drag = d; }, end: _lb2DragEnd };');
} catch (e) { drag = null; }
function row(id) { return { getAttribute: () => id, classList: { remove() {} } }; }
try { if (drag) drag([], []).set; } catch (e) { drag = null; }
if (drag && /_lb2DragEnd/.test(fn('_lb2DragEnd'))) {
  const a = row('a'), b = row('b'), c = row('c'), tb = { classList: { remove() {} } };
  let calls = [];
  let D = drag(calls, [b, c, a]); D.set({ row: a, tb: tb, id: 'a', from: 0, timer: 0 }); D.end(true);
  check('let go last, a section goes after the one before it -- the builder\'s own move', calls.join('|') === 'a after c', calls.join('|'));
  calls = []; D = drag(calls, [b, a, c]); D.set({ row: a, tb: tb, id: 'a', from: 0, timer: 0 }); D.end(true);
  check('...in the middle, before the one after it', calls.join('|') === 'a before c', calls.join('|'));
  calls = []; D = drag(calls, [a, b, c]); D.set({ row: a, tb: tb, id: 'a', from: 0, timer: 0 }); D.end(true);
  check('...let go where it was, or cancelled, it is only drawn again', calls.join('|') === 'redraw', calls.join('|'));
} else check('the drag could be built', false);
check('rows trade places under the finger by elementFromPoint (a box\'s measured top is wrong in Safari\'s CSS zoom)',
  /document\.elementFromPoint\(e\.clientX, e\.clientY\)/.test(fn('_lb2DragMove')) && !/getBoundingClientRect/.test(fn('_lb2DragMove')) &&
  /touch-action: none;/.test((BLOCK.match(/\.lb2-idx-grip \{[\s\S]*?\}/) || [''])[0]));
check('a name is renamed in place: the pen, or a double tap; Enter keeps it, Escape puts it back; one Undo',
  /e\.key === 'Enter'\) \{ e\.preventDefault\(\); finish\(true\);/.test(fn('_lb2StartRename')) &&
  /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); finish\(false\);/.test(fn('_lb2StartRename')) &&
  /currentOrderData\.sectionLayout\[i\]\.title = t;/.test(fn('_lb2StartRename')) && /_lbdChange\(function\(\) \{/.test(fn('_lb2StartRename')) &&
  /now - _lb2Tap\.at < 400\) \{ _lb2Tap = null; _lb2StartRename\(id\); return; \}/.test(fn('_lb2OnClick')));
check('+ Add section offers the builder\'s kinds; a blank one is named at once, in place',
  /_LBD_SEC_KINDS\.map/.test(fn('lb2AddSection')) && /var id = lbdAddSection\(at, k\.title, k\.then\);/.test(fn('lb2AddSection')) &&
  /_lb2StartRename\(id\)/.test(fn('lb2AddSection')));

// ------------------------------------------------------------ 4. the words
console.log('\n4. Shift+Enter starts a new slide at the cursor; one Undo each');
function slideSandbox(item, rec) {
  return new Function('item', 'rec',
    'function _lbdItem() { return item; }' +
    'function _lbdChange(f) { rec.push("change"); f(); return true; }' +
    'function _lbdSetSlide(it, i, t) { it.slides[i].content = t; it.slides[i].richHtml = null; }' +
    'function _lbdRenumber(sl) { sl.forEach(function(x, i) { x.index = i; }); }' +
    'function _lb2Rerender() { rec.push("redraw"); }' +
    'function _lb2FocusSlide(id, i, c) { rec.push("focus " + i + "@" + c); }' +
    fn('_lb2SlideOf') + fn('_lb2Words') + fn('_lb2NewSlideAfter') + fn('_lb2JoinBack') +
    '\nreturn { add: _lb2NewSlideAfter, join: _lb2JoinBack };')(item, rec);
}
function box(idx, text) {
  return { innerText: text, onblur: () => {}, attrs: { 'data-item-id': 'it', 'data-slide-idx': String(idx) },
    getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; } };
}
try {
  const rec = [], item = { id: 'it', slides: [{ index: 0, content: 'L: Lord, have mercy', background: 'bg1.jpg' }, { index: 1, content: 'C: Christ, have mercy', background: '' }] };
  const S = slideSandbox(item, rec);
  const el = box(0, 'L: Lord, have mercy upon us\n');
  const ok = S.add(el, '');
  check('at the end of slide 1: its words kept, an empty slide 2 after it (with its background), the cursor in it',
    ok === true && item.slides.length === 3 && item.slides[0].content === 'L: Lord, have mercy upon us' && item.slides[1].content === '' &&
    item.slides[1].background === 'bg1.jpg' && item.slides[2].content === 'C: Christ, have mercy' && item.slides.map(x => x.index).join('') === '012' &&
    rec.join('|') === 'change|redraw|focus 1@0' && el.onblur === null, JSON.stringify(item.slides) + ' ' + rec.join('|'));
  const recM = [], itemM = { id: 'it', slides: [{ index: 0, content: 'L: In the Name of the Father.\n\nC: Amen.', background: 'b.jpg' }] };
  slideSandbox(itemM, recM).add(box(0, 'L: In the Name of the Father.\n\n'), '\nC: Amen.\n');
  check('in the middle: the words before the cursor stay, the words after it are slide 2, one Undo',
    itemM.slides.length === 2 && itemM.slides[0].content === 'L: In the Name of the Father.' && itemM.slides[1].content === 'C: Amen.' &&
    itemM.slides[1].background === 'b.jpg' && recM.join('|') === 'change|redraw|focus 1@0', JSON.stringify(itemM.slides) + ' ' + recM.join('|'));
  const rec2 = [], item2 = { id: 'it', slides: [{ index: 0, content: 'L: The Lord be with you\n' }, { index: 1, content: 'C: And also with you' }] };
  const S2 = slideSandbox(item2, rec2);
  S2.join(box(1, 'C: And also with you'));
  check('Backspace at the start of slide 2 joins it to slide 1, the cursor where they meet',
    item2.slides.length === 1 && item2.slides[0].content === 'L: The Lord be with you\nC: And also with you' && rec2.join('|') === 'change|redraw|focus 0@23',
    JSON.stringify(item2.slides) + ' ' + rec2.join('|'));
  const rec3 = [], S3 = slideSandbox({ id: 'it', slides: [{ index: 0, content: 'only' }] }, rec3);
  check('...but not the first slide, and a text box with no slides takes a new line',
    S3.join(box(0, 'only')) === false && slideSandbox({ id: 'it', content: { text: 'x' } }, []).add(box(0, 'x'), '') === false);
} catch (e) { check('the slide pieces could be built', false, e.message); }
// The keys, run with what they call stood in for.
function keySandbox(touch, atEnd, splits, rec) {
  return new Function('rec', 'touch', 'atEnd', 'splits',
    'var document = { execCommand: function(c) { rec.push(c); } };' +
    'function _lbdTouchKeys() { return touch; }' +
    'function _lb2CaretAt(el, w) { return w === "end" ? atEnd : false; }' +
    'function _lb2Split() { rec.push("split"); return splits; }' +
    'function _lb2JoinBack() { rec.push("join"); return true; }' +
    fn('_lb2OnKey') + fn('_lb2OnBeforeInput') + '\nreturn { key: _lb2OnKey, input: _lb2OnBeforeInput };')(rec, touch, atEnd, splits);
}
function keyEv(o) {
  const el = { isContentEditable: true };
  return Object.assign({ key: 'Enter', target: { closest: sel => (sel === '.lb2-slide-edit' ? el : null) }, prevented: false,
    preventDefault() { this.prevented = true; } }, o);
}
try {
  let rec = [], K = keySandbox(false, false, true, rec);
  const sh = keyEv({ shiftKey: true }); K.key(sh);
  const ct = keyEv({ ctrlKey: true }); K.key(ct);
  check('Shift+Enter (or Ctrl+Enter) in a slide\'s words is a new slide at the cursor',
    sh.prevented && ct.prevented && rec.join('|') === 'split|split', rec.join('|'));
  rec = []; K = keySandbox(false, false, true, rec);
  const plain = keyEv({}), alt = keyEv({ shiftKey: true, altKey: true }), ime = keyEv({ shiftKey: true, isComposing: true }), other = keyEv({ shiftKey: true, target: { closest: () => null } });
  [plain, alt, ime, other].forEach(e => K.key(e));
  check('...not plain Enter, Alt, a word being composed, or outside a slide\'s words',
    rec.length === 0 && ![plain, alt, ime, other].some(e => e.prevented), rec.join('|'));
  rec = []; K = keySandbox(false, false, false, rec); K.key(keyEv({ shiftKey: true }));
  check('a box with no slides to split takes a line instead', rec.join('|') === 'split|insertLineBreak', rec.join('|'));
  rec = []; K = keySandbox(false, true, true, rec);
  const ent = keyEv({ inputType: 'insertParagraph' }); K.input(ent);
  check('plain Enter on a desk is a new line, even at a slide\'s end (as in the Liturgy Builder)',
    ent.prevented && rec.join('|') === 'insertLineBreak', rec.join('|'));
  rec = []; K = keySandbox(true, true, true, rec); K.input(keyEv({ inputType: 'insertParagraph' }));
  const recMid = []; keySandbox(true, false, true, recMid).input(keyEv({ inputType: 'insertParagraph' }));
  check('on a touch screen (no Shift): Enter at a slide\'s end is the new slide, elsewhere a new line',
    rec.join('|') === 'split' && recMid.join('|') === 'insertLineBreak', rec.join('|') + ' / ' + recMid.join('|'));
} catch (e) { check('the keys could be built', false, e.message); }
check('the slide is cut at the cursor: a selection goes, the words after it are taken out for the new slide',
  /if \(!r\.collapsed\) r\.deleteContents\(\);/.test(fn('_lb2Split')) && /tail\.setEnd\(el, el\.childNodes\.length\);/.test(fn('_lb2Split')) &&
  /after = _lbdTextOf\(tail\.extractContents\(\)\);/.test(fn('_lb2Split')) && /return _lb2NewSlideAfter\(el, after\);/.test(fn('_lb2Split')) &&
  /if \(!_lb2SlideOf\(el\)\) return false;/.test(fn('_lb2Split')) && /body\.addEventListener\('keydown', _lb2OnKey\);/.test(fn('_lb2Bind')));
check('a word kept is one Undo, the builder\'s, and nothing is redrawn under the typing',
  /ok = _lbdChange\(function\(\) \{/.test(fn('lb2SaveSlideEdit')) && /_lb2TextSave = true;/.test(fn('lb2SaveSlideEdit')) &&
  /if \(!_lb2TextSave\) setTimeout\(function\(\) \{ _lb2Rerender\(false\); \}, 0\);/.test(fn('_lbdCommit')) &&
  /if \(!force && a && body && body\.contains\(a\) && a\.isContentEditable\) return;/.test(fn('_lb2Rerender')));

// ------------------------------------------------------------ 5. full screen
console.log('\n5. Full screen: as laid out here, the words held 2 seconds to edit');
const sf = fn('_lb2SetFullscreen');
check('the device\'s own full screen where it has one, never .catch on webkit\'s nothing; Escape there leaves ours',
  /var req = modal && \(modal\.requestFullscreen \|\| modal\.webkitRequestFullscreen\);/.test(sf) && /if \(pr && typeof pr\.catch === 'function'\)/.test(sf) &&
  /if \(_lb2FullscreenActive\) _lb2SetFullscreen\(false, true\);/.test(fn('_lb2OnFsChange')) && /document\.addEventListener\('fullscreenchange', _lb2OnFsChange\);/.test(fn('_lb2Bind')));
check('laid out as it was: the same zoom, the header over the page rather than above it',
  !/_lb2Zoom =/.test(sf) && has(/#liturgyBookModal\.lb2-fs \.lb2-header \{ position: absolute; top: 0; left: 0; right: 0; z-index: 25; \}/));
check('the words read only in full screen, and editable again out of it',
  /_lb2Lock\(true\);\s*\} else \{/.test(sf) && /_lb2Lock\(false\);\s*\}\s*\}\s*$/.test(sf) &&
  /el\.setAttribute\('contenteditable', _lb2Locked \? 'false' : 'true'\);/.test(fn('_lb2ApplyLock')) && /_lb2ApplyLock\(\);\s*\}\s*$/.test(R));
check('held 2 seconds without moving 10px, the words open where the finger was; Done closes them again',
  /setTimeout\(_lb2HoldFire, 2000\)/.test(fn('_lb2HoldStart')) && /> 10 \|\| Math\.abs\(e\.clientY - h\.y\) > 10\)\) _lb2HoldEnd\(\);/.test(fn('_lb2HoldMove')) &&
  /_lb2Lock\(false\);/.test(fn('_lb2HoldFire')) && /caretRangeFromPoint\(x, y\)/.test(fn('_lb2HoldFire')) &&
  /function lb2FsDone\(\) \{ _lb2Blur\(\); _lb2Lock\(true\); \}/.test(SRC));
check('a ring grows over the 2 seconds; the phone\'s own long-press selection is off while read only',
  /animation: lb2Hold 2s linear forwards;/.test(BLOCK) &&
  /\.lb2-locked \.lb2-slide-edit, \.lb2-locked \.lb2-song-slide-edit \{\s*-webkit-user-select: none; user-select: none; -webkit-touch-callout: none;/.test(BLOCK));
check('a bar to leave full screen and size the page; a menu opened there is drawn there',
  has(/<div class="lb2-fsbar" id="lb2FsBar" role="toolbar" aria-label="Full screen">/) && has(/#liturgyBookModal\.lb2-fs \.lb2-fsbar \{ display: flex; \}/) &&
  /\(document\.fullscreenElement \|\| document\.webkitFullscreenElement \|\| document\.body\)\.appendChild\(el\);/.test(fn('_lbdOpenMenu')));

// ------------------------------------------------------------ 6. songs
console.log('\n6. A song as the Songbook shows it: Lyrics, or Choir; the Songbook a button away');
function songSandbox(o) {
  const esc = x => String(x).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const st = Object.assign({
    ls: { getItem: k => o.store[k] || null, setItem: (k, v) => { o.store[k] = String(v); } },
    base: s => s.base, hasChoir: s => !!s.choir, find: id => o.songs.filter(s => s.id === id)[0] || null,
    redraw: f => o.rec.push('redraw' + (f ? '!' : '')), esc, jsArg: x => esc(String(x).replace(/'/g, "\\'")),
    score: s => (s.rows ? '<SCORE>' : ''), css: () => '<style>vl</style>', ready: b => { o.rec.push('read ' + b); return o.read; },
    src: s => '<W>' + s.lyrics + '</W>', steps: s => s.steps || 0, xp: (h, n) => h + '@' + n, fw: () => 'Georgia, serif', fg: () => 'Roboto Mono'
  }, o);
  return new Function('o',
    'var _lb2ShowChords = !!o.chords, _lb2SongViews = null, _lb2ChoirAsked = {};' +
    'var localStorage = o.ls, _sbBaseSongId = o.base, _sbSongHasChoir = o.hasChoir, _lbdSong = o.find, _lb2Rerender = o.redraw,' +
    ' escapeHtml = o.esc, escapeJsArg = o.jsArg, _sbChoirBodyHtml = o.score, _sbChoirCss = o.css, _sbLinesReady = o.ready,' +
    ' _sbmLyricsSource = o.src, _sbmStepsOf = o.steps, _sbTransposeHtml = o.xp, _sbmFontWords = o.fw, _sbmFontGrid = o.fg;' +
    fn('_lb2SongViewsRead') + fn('_lb2SongViewOf') + fn('lb2SongView') + fn('_lb2SongBarHtml') + fn('_lb2SongWordsHtml') +
    '\nreturn { view: _lb2SongViewOf, set: lb2SongView, bar: _lb2SongBarHtml, words: _lb2SongWordsHtml };')(st);
}
(async () => {
try {
  const plainSong = { id: 'e1', base: 'crown', lyrics: 'Crown Him', steps: 2 };
  const choirSong = { id: "e'2", base: 'room', lyrics: 'Make room', choir: true, rows: true };
  const store = {}, rec = [];
  const S = songSandbox({ store, rec, songs: [plainSong, choirSong] });
  const b1 = S.bar(plainSong, S.view(plainSong));
  check('a song with no choir parts: Lyrics and Chords as tabs, no Choir; the Songbook offered (never sent there by itself); the double-tap said',
    /lb2-song-seg__b is-on" role="tab" aria-selected="true"[^>]*'lyrics'/.test(b1) && /role="tab" aria-selected="false"[^>]*'chords'\)"><i class="fa-solid fa-guitar"/.test(b1) &&
    !/Choir/.test(b1) && b1.indexOf('class="lb2-song-open" onclick="WO.lb2OpenSongbook(\'e1\')"') !== -1 && /Open in<\/span>Songbook/.test(b1) &&
    /Double-tap the words to edit them here/.test(b1) && /Double-tap the score to edit the choir parts/.test(S.bar(choirSong, 'choir')), b1);
  const b2 = S.bar(choirSong, S.view(choirSong));
  check('a song with choir parts: Lyrics and Choir as tabs, Lyrics first; an apostrophe in its id cannot break the handlers',
    /lb2-song-seg__b is-on" role="tab" aria-selected="true"[^>]*lyrics/.test(b2) && /role="tab" aria-selected="false"[^>]*choir/.test(b2) &&
    b2.indexOf("WO.lb2SongView('e\\'2','choir')") !== -1, b2);
  S.set("e'2", 'choir');
  const keptChoir = S.view(choirSong) === 'choir' && JSON.parse(store.lhc_lb2_song_view).room === 'choir' && rec.join('|') === 'redraw!';
  S.set("e'2", 'chords');
  const keptChords = S.view(choirSong) === 'chords';
  S.set("e'2", 'lyrics'); S.set("e'2", 'sideways');
  check('Lyrics, Chords or Choir chosen is kept on this device for that song and drawn at once (nothing else is taken)',
    keptChoir && keptChords && S.view(choirSong) === 'lyrics' && JSON.parse(store.lhc_lb2_song_view).room === 'lyrics' && rec.length === 3,
    JSON.stringify(store) + ' ' + rec.join('|'));
  const S2 = songSandbox({ store: { lhc_lb2_song_view: '{"crown":"choir"}' }, rec: [], songs: [plainSong] });
  const S2c = songSandbox({ store: { lhc_lb2_song_view: '{"room":"lyrics"}' }, rec: [], songs: [], chords: true });
  check('...a song that has no parts is never shown as Choir; a song not chosen for follows "Chords on every song"',
    S2.view(plainSong) === 'lyrics' && S2c.view(plainSong) === 'chords' && S2c.view(choirSong) === 'lyrics');
  const w = S.words(plainSong, 'lyrics'), wc = S.words(plainSong, 'chords');
  check('Lyrics: the Songbook\'s own words (_sbmLyricsSource) in the key sung, without chords; Chords with them; in the reader\'s fonts',
    /^<div class="lb2-song-lyrics lb2-song-lyrics--nochords" title="Double-tap to edit" style="--lb2-words:Georgia, serif;--lb2-grid:Roboto Mono;"><W>Crown Him<\/W>@2<\/div>$/.test(w) &&
    /^<div class="lb2-song-lyrics" title="Double-tap to edit" style=/.test(wc), w + ' / ' + wc);
  check('a song with no words yet says so', /No words yet/.test(S.words({ id: 'e3', base: 'x', lyrics: '' }, 'lyrics')) &&
    /No words yet/.test(S.words({ id: 'e3', base: 'x', lyrics: '', richLyrics: '<div><br></div>' }, 'lyrics')));
  check('Choir: the Songbook\'s read-only score with its own styles', S.words(choirSong, 'choir') === '<div class="lb2-song-choir" title="Double-tap to edit the choir parts"><style>vl</style><div class="sb-choir"><SCORE></div></div>');
  let fail1; const rec4 = [];
  const S4 = songSandbox({ store: {}, rec: rec4, songs: [], read: new Promise((res, rej) => { fail1 = rej; }) });
  const unread = { id: 'e4', base: 'holy', choir: true };
  const first = S4.words(unread, 'choir'), second = S4.words(unread, 'choir');
  fail1(new Error('unread')); await new Promise(r => setTimeout(r, 0));
  check('parts not read yet: read once, said meanwhile, and a read that fails is said too',
    /Reading the choir parts/.test(first) && /Reading the choir parts/.test(second) && rec4.filter(x => /^read/.test(x)).length === 1 &&
    rec4.indexOf('redraw') !== -1 && /could not be read just now/.test(S4.words(unread, 'choir')), rec4.join('|'));
} catch (e) { check('the song pieces could be built', false, e.message); }
const R6 = fn('renderLiturgyBookLive');
check('the book draws each song through them: no slide boxes to type in, no "Editable" badge',
  /var _sView = _lb2SongViewOf\(song\);\s*html \+= _lb2SongBarHtml\(song, _sView\);/.test(R6) && /html \+= _lb2SongWordsHtml\(song, _sView\);/.test(R6) &&
  !/lb2-song-slide-edit/.test(R6) && !/Editable<\/span>/.test(R6));
const back = new Function('o',
  'var currentOrderData = o.cur, rec = o.rec, _lb2BackFromSb = null;' +
  'function $() { return o.body; } function closeLiturgyBook() { rec.push("close"); } function openLiturgyBook() { rec.push("open"); }' +
  'function soOpenInSongbook(id) { rec.push("sb " + id); }' +
  fn('lb2OpenSongbook') + fn('_lb2AfterSongbook') + '\nreturn { go: lb2OpenSongbook, after: _lb2AfterSongbook, swap: function(c) { currentOrderData = c; } };');
try {
  const rec = [], body = { scrollTop: 840 }, B = back({ cur: { id: 'o1' }, rec, body });
  B.go('e1'); body.scrollTop = 0; B.after(); B.after();
  const rec2 = [], B2 = back({ cur: { id: 'o1' }, rec: rec2, body: { scrollTop: 5 } });
  B2.go('e1'); B2.swap({ id: 'o2' }); B2.after();
  check('Open in Songbook: the book closes, the Songbook opens at the song, and closing it brings the book back where it was (once, and only for that order)',
    rec.join('|') === 'close|sb e1|open' && body.scrollTop === 840 && rec2.join('|') === 'close|sb e1', rec.join('|') + ' / ' + rec2.join('|'));
} catch (e) { check('the way to the Songbook could be built', false, e.message); }
check('closing the Songbook asks for the book back; the two are on WO',
  /\/\/ Opened from the Liturgy Book: back to the book\.\s*_lb2AfterSongbook\(\);\s*\}\s*$/.test(fn('closeSongbook')) &&
  has(/lb2SongView: lb2SongView,\s*lb2OpenSongbook: lb2OpenSongbook,/));
check('dressed as the Songbook\'s Lyrics: gold section tags, bold black lines, a blank line a breath; ahead of the app\'s later tag colours',
  /\.lb2-page \.lb2-song-lyrics \.wo-lyrics-section-header \{[^}]*border-left: 2\.4px solid #d4a853;[^}]*background: linear-gradient\(90deg, rgba\(212,168,83,0\.18\), transparent\); color: #7f5d20;/.test(BLOCK) &&
  /\.lb2-page \.lb2-song-lyrics \.wo-lyrics-lyric-line \{ font-weight: 700; color: #000; margin: 0 0 0\.5em; \}/.test(BLOCK) &&
  /\.lb2-page \.lb2-song-lyrics \.wo-lyrics-empty-line \{ height: 0\.6em; \}/.test(BLOCK) &&
  /\.lb2-page \.lb2-song-lyrics--nochords \.wo-lyrics-chord-line,\s*\.lb2-page \.lb2-song-lyrics--nochords \.wo-inline-chord \{ display: none; \}/.test(BLOCK));
check('with Chords on: one fixed-width grid that keeps its spaces, a pair too long set smaller together (the Songbook\'s fit)',
  /font-family: var\(--lb2-grid,[^;]*\);\s*font-size: calc\(1rem \* var\(--sbm-fit, 1\)\); letter-spacing: 0; white-space: pre-wrap;/.test(BLOCK) &&
  /_lb2FitChords\(\);\s*\}\s*$/.test(fn('_lb2ApplyZoom')) && /querySelectorAll\('\.lb2-song-lyrics:not\(\.lb2-song-lyrics--nochords\)'\), _sbmFitChordPairsIn\)/.test(fn('_lb2FitChords')));
check('the choir score sits in the page\'s own margins; a phone shortens the Songbook button so the bar is one row',
  /\.lb2-song-choir \.sb-choir \{ padding: 0; \}/.test(BLOCK) && /@media \(max-width: 480px\) \{[^}]*\}[^}]*\}\s*\.lb2-song-open__l \{ display: none; \}/.test(BLOCK));
// ------------------------------------------------------------ 7. editing a song
console.log('\n7. A song\'s words double-tapped are edited where they are, and saved for everyone');
let M = null;
try { M = new Function(fn('_lb2WordsMerge') + '\nreturn _lb2WordsMerge;')(); } catch (e) { M = null; }
if (M) {
  const stored = ['[Verse 1]', 'D    G', 'Crown Him with many crowns', 'A7', 'The Lamb upon His throne', '', 'Hark how the heavenly', 'G'];
  const chord = [false, true, false, true, false, false, false, true];
  const shown = stored.filter((l, i) => !chord[i]);
  check('nothing typed: the words come back exactly as stored', JSON.stringify(M(stored, chord, shown.slice())) === JSON.stringify(stored));
  const mended = M(stored, chord, ['[Verse 1]', 'Crown Him with many crowns', 'The Lamb upon His holy throne', '', 'Hark how the heavenly']);
  check('a word mended keeps the chords over its line', mended.join('|') === '[Verse 1]|D    G|Crown Him with many crowns|A7|The Lamb upon His holy throne||Hark how the heavenly|G', mended.join('|'));
  const added = M(stored, chord, ['[Verse 1]', 'Crown Him with many crowns', 'A new line', 'The Lamb upon His throne', '', 'Hark how the heavenly']);
  check('a new line has no chords, and the line under it keeps its own', added.join('|') === '[Verse 1]|D    G|Crown Him with many crowns|A new line|A7|The Lamb upon His throne||Hark how the heavenly|G', added.join('|'));
  const cut = M(stored, chord, ['[Verse 1]', 'The Lamb upon His throne', '', 'Hark how the heavenly']);
  check('a line taken out takes its chords with it; chords after the last line stay', cut.join('|') === '[Verse 1]|A7|The Lamb upon His throne||Hark how the heavenly|G', cut.join('|'));
} else check('_lb2WordsMerge could be built', false);
// The end of an edit, with what it calls stood in for.
function edSandbox(o) {
  return new Function('o',
    'var _lb2Ed = o.ed, rec = o.rec;' +
    'function _sbNpLines() { return o.typed; } function _lb2SrcLines() { return o.now; }' +
    'function _sbEditRelease(b) { rec.push("release " + b); } function _sbEditMayWrite() { return o.may !== false; }' +
    'function _sbSetCopyWords(s, w) { rec.push("save " + w); s.customLyrics = w; } function _lb2Rerender() { rec.push("redraw"); }' +
    'function _lb2EdBarOff() {} function _lb2EdKey() {} function _lb2EdPaste() {} function _lb2EdBlur() {}' +
    'function showToast(m, k, opt) { rec.push("toast " + m); o.undo = opt && opt.onAction; }' +
    'function isChordLineGlobal(l) { return /^[A-G][#b]?m?7?(\\s+[A-G][#b]?m?7?)*\\s*$/.test(String(l).trim()); }' +
    'function sbTransposeChordLine(l, n) { return l.replace(/[A-G]/g, function(c) { return "CDEFGAB".charAt(("CDEFGAB".indexOf(c) + 7 + n) % 7); }); }' +
    fn('_sbNpMap') + fn('_lb2WordsMerge') + fn('_lb2EdEnd') + '\nreturn _lb2EdEnd;')(o);
}
function fakeEl() { return { classList: { remove() {} }, removeEventListener() {}, removeAttribute() {} }; }
try {
  const song = { customLyrics: 'a' }, rec = [];
  const stored = ['G', 'Crown Him', 'D', 'The Lamb'], chord = [true, false, true, false];
  const ed = { el: fakeEl(), song, base: 'crown', lyrics: true, shown: ['Crown Him', 'The Lamb'], stored, chord, before: stored.join('\n'), steps: 0 };
  const o = { ed, rec, typed: ['Crown Him', 'The holy Lamb'], now: { lines: stored.slice() } };
  edSandbox(o)(true);
  check('Lyrics typed: saved through the Songbook\'s save with the chords put back, the song let go, the book drawn, an Undo offered',
    rec.join('|') === 'save G\nCrown Him\nD\nThe holy Lamb|release crown|redraw|toast Saved. The Songbook and the slides have it too' && typeof o.undo === 'function', rec.join('|'));
  rec.length = 0; o.undo();
  check('...and Undo puts the words back while nobody has changed them since', rec.join('|') === 'save ' + stored.join('\n') + '|redraw', rec.join('|'));
  song.customLyrics = 'someone else'; rec.length = 0; o.undo();
  check('...but not over words changed since', /^toast The words were changed since/.test(rec.join('|')), rec.join('|'));
  const rec2 = [], o2 = { ed: Object.assign({}, ed, { el: fakeEl() }), rec: rec2, typed: ['Crown Him', 'The holy Lamb'], now: { lines: ['Crown Him', 'other'] } };
  edSandbox(o2)(true);
  check('words changed underneath while typing are not written over', /^release crown\|toast These words were changed while you were typing/.test(rec2.join('|')) && !rec2.some(x => /^save /.test(x)), rec2.join('|'));
  const rec3 = [], o3 = { ed: Object.assign({}, ed, { el: fakeEl() }), rec: rec3, typed: ['Crown Him', 'The holy Lamb'], now: { lines: stored.slice() }, may: false };
  edSandbox(o3)(true);
  const rec4 = [], o4 = { ed: Object.assign({}, ed, { el: fakeEl() }), rec: rec4, typed: ['Crown Him', 'The holy Lamb'], now: { lines: stored.slice() } };
  edSandbox(o4)(false);
  check('another device that has the song first keeps it; Esc / Cancel puts it all back', rec3.length === 0 && rec4.join('|') === 'release crown|redraw', rec3.join('|') + ' / ' + rec4.join('|'));
  const song5 = { customLyrics: '' }, rec5 = [];
  const st5 = ['C    G', 'Crown Him'];
  const o5 = { ed: { el: fakeEl(), song: song5, base: 'crown', lyrics: false, shown: ['D    A', 'Crown Him'], stored: st5, chord: [true, false], before: st5.join('\n'), steps: 1 },
    rec: rec5, typed: ['D    B', 'Crown Him'], now: { lines: st5.slice() } };
  edSandbox(o5)(true);
  check('Chords typed in the key sung go back into the copy\'s own key (the Songbook\'s _sbNpMap)', /^save C    A\nCrown Him\|/.test(rec5.join('|')), rec5.join('|'));
} catch (e) { check('the end of an edit could be built', false, e.message); }
// The double-tap on the book's clicks.
try {
  const o = { clock: 1000 }, rec = [];
  const K = new Function('rec', 'o',
    'var Date = { now: function() { return o.clock; } }, _lb2Locked = false, _lb2Ed = null, _lb2SongTap = null, _lb2Tap = null;' +
    'function _lb2SongDouble(el, x, y) { rec.push("double " + el.name + " " + x); }' +
    fn('_lb2OnClick') + '\nreturn { click: _lb2OnClick, lock: function(v) { _lb2Locked = v; }, edit: function(v) { _lb2Ed = v; } };')(rec, o);
  const words = { name: 'w' }, other = { name: 'o' };
  const ev = (el, x) => ({ target: { closest: sel => (/lb2-song-lyrics/.test(sel) ? el : null) }, clientX: x, clientY: 10 });
  K.click(ev(words, 50)); o.clock = 1200; K.click(ev(words, 52));
  const first = rec.join('|');
  o.clock = 3000; K.click(ev(words, 50)); o.clock = 3500; K.click(ev(words, 50));
  o.clock = 5000; K.click(ev(words, 50)); o.clock = 5100; K.click(ev(other, 50));
  K.lock(true); o.clock = 7000; K.click(ev(words, 50)); o.clock = 7100; K.click(ev(words, 50));
  K.lock(false); K.edit({}); o.clock = 9000; K.click(ev(words, 50)); o.clock = 9100; K.click(ev(words, 50));
  check('two taps (or a double-click) on a song\'s words within 350ms edit them where tapped; not slower taps, two songs, full screen\'s lock, or while one is being typed',
    first === 'double w 52' && rec.length === 1, rec.join('|'));
} catch (e) { check('the double-tap could be built', false, e.message); }
const sd = fn('_lb2SongDouble'), es = fn('_lb2EditStart');
check('the choir score opens the choir pad over the book at the moment tapped (out of the device\'s full screen, where <body> is not drawn)',
  /if \(box\.classList\.contains\('lb2-song-choir'\)\) \{/.test(sd) && /hit\.closest\('\[data-anchor\^="s:"\]'\)/.test(sd) &&
  /if \(_lb2FullscreenActive\) _lb2SetFullscreen\(false\);/.test(sd) &&
  /_sbOverviewOpen\(_sbBaseSongId\(song\), song\.id, song\.title \|\| '', null, null, at \? at\.getAttribute\('data-anchor'\) : null\);/.test(sd) &&
  /window\.addEventListener\('lhc:lines-changed', function\(\) \{ if \(_lb2Open\(\)\) _lb2Rerender\(false\); \}\);/.test(fn('_lb2Bind')));
check('editing starts only on words that are lines, the song held; in Lyrics the chord lines are taken out while typed',
  /if \(!src\) \{ showToast\(/.test(es) && /box\.querySelectorAll\('\.wo-lyrics-chord-line'\), function\(c\) \{ c\.remove\(\); \}\)/.test(es) &&
  /if \(!_sbEditClaim\(song\)\)/.test(es) && /box\.setAttribute\('contenteditable', 'true'\);/.test(es) && /_sbNpCaretAt\(box, x, y\)/.test(es) &&
  /\(e\.ctrlKey \|\| e\.metaKey\) && \(e\.key === 'Enter'/.test(fn('_lb2EdKey')) && /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); _lb2EdEnd\(false\);/.test(fn('_lb2EdKey')));
check('full screen: holding a song\'s words 2 seconds edits them too; closing the book keeps what was typed',
  /'\.lb2-slide-edit, \.lb2-song-slide-edit, \.lb2-song-lyrics, \.lb2-song-choir'/.test(fn('_lb2OnDown')) &&
  /\{ _lb2SongDouble\(box, x, y\); return; \}/.test(fn('_lb2HoldFire')) && /if \(_lb2Ed\) _lb2EdEnd\(true\);/.test(fn('closeLiturgyBook')));
check('the Songbook is drawn only when it is open -- a save from the book does not draw it hidden',
  /if \(_sbmBookOpen\(\)\) renderSongbookLive\(\);\s*\}\s*$/.test(fn('_sbSetCopyWords')) && /if \(_sbmBookOpen\(\)\) renderSongbookLive\(\);/.test(fn('_sbmPadSaveSong')));
check('"Chords on every song" forgets each song\'s own Lyrics or Chords, and keeps its Choir',
  /Object\.keys\(v\)\.forEach\(function\(k\) \{ if \(v\[k\] !== 'choir'\) delete v\[k\]; \}\);/.test(fn('lb2ToggleChords')) && /'Lyrics on every song' : 'Chords on every song'/.test(fn('lb2More')));
check('the bar shows inside the device\'s full screen; the words never zoom on the second tap; a gold edge while typed',
  /\(document\.fullscreenElement \|\| document\.webkitFullscreenElement \|\| document\.body\)\.appendChild\(bar\);/.test(fn('_lb2EdBar')) &&
  /\.lb2-song-lyrics, \.lb2-song-choir \{ touch-action: manipulation; cursor: text; \}/.test(BLOCK) && /\.lb2-song-lyrics\.is-editing \{ outline: 2px solid #c9a227;/.test(BLOCK) &&
  has(/lb2SongEdSave: lb2SongEdSave,\s*lb2SongEdCancel: lb2SongEdCancel,/));
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
})();
