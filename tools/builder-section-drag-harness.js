'use strict';
// Harness for dragging a section in the Liturgy Builder (2026-11-11). From the
// operator, on a phone screenshot of the builder: "Allow the user to drag and
// drop sections to rearrange, make sure the numbering follows order too".
//
// A heading could be dragged only by a grip, and the phone hid the grip. Now
// (CLAUDE.md gotcha 85):
//   1. The grip shows on a phone, and the number drags too, at once.
//   2. A finger holds a heading anywhere else and drags it; a finger that
//      moves first scrolls; held and let go, it opens the section's menu.
//   3. While a section is dragged the page is its headings, the section moves
//      among them, and every number follows the order shown.
//   4. The drop is one change, and the songs' running order follows it.
//
// USAGE
//   node tools/builder-section-drag-harness.js
//   node tools/builder-section-drag-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const files = args.filter(a => !a.startsWith('--'));
const INDEX = files[0] || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');

function extractFrom(text, startRe) {
  const ls = text.split('\n');
  const startIdx = ls.findIndex(l => startRe.test(l));
  if (startIdx < 0) throw new Error('not found: ' + startRe);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < ls.length; i++) {
    out.push(ls[i]);
    for (const ch of ls[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces: ' + startRe);
}
const fn = n => { try { return extractFrom(SRC, new RegExp('^  function ' + n + '\\s*\\(')); } catch (e) { return ''; } };
const css = (() => { const i = SRC.indexOf('/* The outline. */'); return i < 0 ? '' : SRC.slice(i, i + 80000); })();

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}
function run(label, f) {
  try { f(); } catch (e) { check(label, false, e.message); }
}

// A zone of rows laid out one under another (a hidden row takes no room),
// enough for _lbdDragPlace / _lbdDragNumber to measure and move them.
function mkZone(ids, heights, hidden) {
  const zone = { rows: [] };
  ids.forEach(id => {
    const r = { id, hidden: !!(hidden && hidden.includes(id)), height: (heights && heights[id]) || 60, parentNode: zone, num: { textContent: '?' } };
    r.getAttribute = k => k === 'data-sec' ? r.id : null;
    r.querySelector = () => r.num;
    r.getBoundingClientRect = () => {
      let top = 0;
      for (const x of zone.rows) { if (x === r) break; if (!x.hidden) top += x.height; }
      return { top, height: r.height, bottom: top + r.height };
    };
    Object.defineProperty(r, 'nextSibling', { get() { return zone.rows[zone.rows.indexOf(r) + 1] || null; } });
    zone.rows.push(r);
  });
  zone.querySelectorAll = sel => zone.rows.filter(r => !/:not\(\[hidden\]\)/.test(sel) || !r.hidden);
  zone.insertBefore = (el, ref) => {
    zone.rows.splice(zone.rows.indexOf(el), 1);
    if (ref == null) zone.rows.push(el); else zone.rows.splice(zone.rows.indexOf(ref), 0, el);
  };
  zone.order = () => zone.rows.map(r => r.id).join('');
  zone.nums = () => zone.rows.map(r => r.id + r.num.textContent).join(' ');
  zone.row = id => zone.rows.find(r => r.id === id);
  return zone;
}

// ------------------------------------------------------------ 1. where it goes
console.log('\n1. The section held goes where the finger is, and stays put there');
run('the place and the numbers', () => {
  const M = new Function(fn('_lbdDropSlot') + '\n' + fn('_lbdDragPlace') + '\n' + fn('_lbdDragNumber') +
    '\nreturn { slot: _lbdDropSlot, place: _lbdDragPlace, number: _lbdDragNumber };')();
  check('the slot is the count of middles above the finger',
    M.slot([90, 150, 210], 100) === 1 && M.slot([90, 150, 210], -5) === 0 && M.slot([90, 150, 210], 999) === 3 && M.slot([], 50) === 0);

  const gn = { textContent: '' };
  const z = mkZone(['A', 'B', 'C', 'D']);
  const d = { zoneEl: z, sel: '.lbw-sec', zone: 'page', el: z.row('A'), y: 0, ghost: { querySelector: () => gn } };
  M.number(d);
  check('on picking up, the numbers are written as shown', z.nums() === 'A1. B2. C3. D4.' && gn.textContent === '1.', z.nums());
  d.y = 100; M.place(d);
  check('past the next heading\'s middle, it moves under it, and the numbers follow', z.order() === 'BACD' && z.nums() === 'B1. A2. C3. D4.' && gn.textContent === '2.', z.nums());
  M.place(d); M.place(d);
  check('the finger still: it stays where it is (no flicker)', z.order() === 'BACD');
  d.y = 999; M.place(d);
  check('below the last: it is last, numbered last', z.order() === 'BCDA' && z.nums() === 'B1. C2. D3. A4.' && gn.textContent === '4.', z.nums());
  d.y = -5; M.place(d);
  check('above the first: it is first again', z.order() === 'ABCD' && z.nums() === 'A1. B2. C3. D4.');

  // Headings of different heights (a name on two lines) must not flip-flop.
  const z2 = mkZone(['A', 'B', 'C'], { A: 120, B: 60, C: 60 });
  const d2 = { zoneEl: z2, sel: '.lbw-sec', zone: 'page', el: z2.row('A'), y: 0, ghost: null };
  let flips = 0, last = z2.order();
  for (let y = 0; y <= 260; y += 4) { d2.y = y; M.place(d2); M.place(d2); if (z2.order() !== last) { flips++; last = z2.order(); } }
  check('a tall heading dragged down past two short ones moves twice, never back', flips === 2 && z2.order() === 'BCA', flips + ' ' + z2.order());

  // The outline: a find hides some lines; the held one moves among those
  // shown, and every line is numbered, hidden or not.
  const z3 = mkZone(['A', 'B', 'C', 'D'], null, ['B']);
  const d3 = { zoneEl: z3, sel: '.lbw-nav-item', zone: 'nav', el: z3.row('D'), y: 10, ghost: null };
  M.place(d3);
  check('in the outline, among the lines shown, numbered without a stop', z3.order() === 'DABC' && z3.nums() === 'D1 A2 B3 C4', z3.nums());
});

// ------------------------------------------------------------ 2. picking it up
console.log('\n2. What picks a section up');
run('pointer down', () => {
  const env = new Function('ctx', `
    var _lbdPD = null, _LBD_HOLD_MS = 380;
    var document = ctx.document;
    function setTimeout(f, ms) { ctx.timers.push(ms); return 1; }
    function _lbdHoldArm() {}
    function _lbdOnPointerMove() {} function _lbdOnPointerUp() {} function _lbdOnPointerCancel() {}
    ${fn('_lbdHeadFree')}
    ${fn('_lbdOnPointerDown')}
    return { down: _lbdOnPointerDown, pd: function() { return _lbdPD; }, reset: function() { _lbdPD = null; } };`);
  // An element whose closest() answers from a table of selectors.
  const node = (map) => ({ closest: sel => (sel in map ? map[sel] : null), getAttribute: k => (k === 'data-sec' ? 'sec1' : null) });
  const sec = node({ '.lbw-nav': null });
  const head = node({ '[data-sec]': sec });
  const mkCtx = () => ({ timers: [], added: [], document: { addEventListener: (t) => ctxRef.added.push(t) } });
  let ctxRef = mkCtx();
  const E = env(ctxRef);
  const ev = (target, pointerType, button) => {
    const e = { target, pointerType, button: button || 0, clientX: 10, clientY: 20, prevented: false };
    e.preventDefault = () => { e.prevented = true; };
    return e;
  };
  const GRIP = '[data-grip], .lbw-page .lbw-h-num', HEAD = '.lbw-page .lbw-h',
    NOT = 'button, a, input, select, textarea, [data-field], [contenteditable="true"], [contenteditable="plaintext-only"]';
  const grip = node({ [GRIP]: node({ '[data-sec]': sec }) });
  let e = ev(grip, 'touch'); E.down(e);
  check('a finger on the grip (or the number) picks it up at once', E.pd() && E.pd().hold === false && e.prevented && E.pd().zone === 'page' && E.pd().id === 'sec1');
  E.reset();
  const free = node({ [HEAD]: head });
  e = ev(free, 'touch'); E.down(e);
  check('a finger elsewhere on the heading holds it first', E.pd() && E.pd().hold === true && E.pd().touch && ctxRef.timers.indexOf(380) !== -1 && !e.prevented);
  e = ev(grip, 'touch'); E.down(e);
  check('a second finger meanwhile is not a second drag', E.pd().hold === true && !e.prevented);
  E.reset();
  e = ev(free, 'mouse'); E.down(e);
  check('the mouse picks a heading up from anywhere on it, no hold', E.pd() && E.pd().hold === false);
  E.reset();
  const title = node({ [HEAD]: head, [NOT]: {} });
  E.down(ev(title, 'touch'));
  check('its name is not a handle: a tap there is typing', E.pd() === null);
  E.down(ev(title, 'mouse'));
  check('...for the mouse either', E.pd() === null);
  E.down(ev(free, 'mouse', 2));
  check('a right click is not a drag', E.pd() === null);
});

// ------------------------------------------------------------ 3. hold, scroll, drag
console.log('\n3. A finger: scroll, hold, drag');
run('pointer move', () => {
  const env = new Function('ctx', `
    var _lbdPD = null;
    function _lbdDragEnd(drop) { ctx.log.push('end:' + drop); _lbdPD = null; }
    function _lbdDragBegin() { ctx.log.push('begin'); _lbdPD.on = true; }
    function _lbdDragMove() { ctx.log.push('move'); }
    ${fn('_lbdOnPointerMove')}
    ${fn('_lbdHeadTouchMove')}
    ${fn('_lbdHeadTouchEnd')}
    var _lbdHeldUpAt = 0;
    return { move: _lbdOnPointerMove, tm: _lbdHeadTouchMove, te: _lbdHeadTouchEnd, set: function(d) { _lbdPD = d; }, pd: function() { return _lbdPD; }, held: function(t) { _lbdHeldUpAt = t; } };`);
  const ctx = { log: [] };
  const E = env(ctx);
  const ev = (x, y) => { const e = { clientX: x, clientY: y, cancelable: true, prevented: false }; e.preventDefault = () => { e.prevented = true; }; return e; };
  const pd = (o) => Object.assign({ x0: 100, y0: 100, x: 100, y: 100, on: false, hold: false, armed: false }, o);

  E.set(pd({ hold: true })); E.move(ev(100, 104));
  check('a tremble while holding is still a hold', E.pd() && ctx.log.length === 0);
  let t = ev(100, 104); E.tm(t);
  check('...and the page may still scroll then', !t.prevented);
  E.move(ev(100, 112));
  check('moving before the hold: scrolling, so no drag', ctx.log.join() === 'end:false' && E.pd() === null);

  ctx.log.length = 0; E.set(pd({ hold: true, armed: true }));
  t = ev(100, 104); E.tm(t);
  check('held: the page does not scroll under the finger', t.prevented);
  const m = ev(100, 108); E.move(m);
  check('held, then moved: the drag begins and follows', ctx.log.join() === 'begin,move' && m.prevented);

  ctx.log.length = 0; E.set(pd({})); E.move(ev(103, 103));
  check('by the grip, under 6px is not yet a drag', ctx.log.length === 0);
  E.move(ev(100, 107));
  check('by the grip, 6px is', ctx.log.join() === 'begin,move');

  E.set(null); E.held(Date.now());
  t = ev(0, 0); E.te(t);
  check('a hold or drag just let go: its touchend clicks nothing', t.prevented);
  E.held(Date.now() - 1000); t = ev(0, 0); E.te(t);
  check('...an ordinary tap clicks', !t.prevented);
});

// ------------------------------------------------------------ 4. the drop
console.log('\n4. Letting go');
run('drag end', () => {
  const env = new Function('ctx', `
    var _lbdPD = null, _lbdHeldUpAt = 0, _lbdSuppressClick = 0;
    var document = ctx.document, window = ctx.window;
    function $(id) { return ctx.host; }
    function _lbdDragRow(d) { return ctx.lifted; }
    function _lbdSetCur(a, b) { ctx.log.push('cur:' + a); }
    function _lbdOpenSecMenu(at, id) { ctx.log.push('menu:' + id); }
    function _lbdMoveSectionTo(id, t, after) { ctx.log.push('move:' + id + '>' + t + ':' + after); return ctx.moved; }
    function lbdRender() { ctx.log.push('render'); }
    function _lbdCssId(s) { return s; }
    function _lbdKeepInView() { ctx.log.push('keep'); }
    function _lbdOnPointerMove() {} function _lbdOnPointerUp() {} function _lbdOnPointerCancel() {}
    ${fn('_lbdDragEnd')}
    return { end: _lbdDragEnd, set: function(d) { _lbdPD = d; }, pd: function() { return _lbdPD; }, held: function() { return _lbdHeldUpAt; } };`);
  const cls = () => ({ list: [], add(c) { this.list.push(c); }, remove(c) { this.list = this.list.filter(x => x !== c); }, contains(c) { return this.list.includes(c); } });
  const mk = (moved) => {
    const flash = { classList: cls(), offsetWidth: 1 };
    const ctx = {
      log: [], moved, scrolled: [], lifted: { classList: cls() },
      document: { removeEventListener() {}, documentElement: { classList: cls() } },
      window: { scrollBy(x, y) { ctx.scrolled.push(y); } },
      host: { querySelector: () => ({ getBoundingClientRect: () => ({ top: 500 }), parentNode: flash }) },
      flash
    };
    return ctx;
  };
  const row = (id) => ({ id, getAttribute: () => id, classList: cls(), querySelector: () => ({ getBoundingClientRect: () => ({ top: 320 }) }) });
  const drag = (ctx, at, extra) => {
    const rows = ['a', 'b', 'c'].map(row);
    const z = { querySelectorAll: () => rows };
    return Object.assign({ id: rows[at].id, zone: 'page', on: true, touch: true, zoneEl: z, sel: '.lbw-sec', el: rows[at], timer: 0 }, extra || {});
  };

  let ctx = mk(true), E = env(ctx);
  E.set(drag(ctx, 1)); E.end(true);
  check('let go in the middle: it goes before the section under it', ctx.log[0] === 'move:b>c:false' && E.pd() === null, ctx.log.join());
  check('...the page unfolds round it, the heading kept where it was let go', ctx.scrolled[0] === 180 && ctx.flash.classList.contains('is-flash'), JSON.stringify(ctx.scrolled));
  check('...and its touchend clicks nothing', Date.now() - E.held() < 1000);
  ctx = mk(true); E = env(ctx);
  E.set(drag(ctx, 2)); E.end(true);
  check('let go last: it goes after the one before it', ctx.log[0] === 'move:c>b:true', ctx.log.join());
  ctx = mk(false); E = env(ctx);
  E.set(drag(ctx, 1)); E.end(true);
  check('let go where it started: nothing recorded, the page drawn as it was', ctx.log.join().indexOf('render') !== -1 && !ctx.flash.classList.contains('is-flash'), ctx.log.join());
  ctx = mk(true); E = env(ctx);
  E.set(drag(ctx, 1)); E.end(false);
  check('Escape or a cancelled touch: no move, the page as it was', !ctx.log.some(x => /^move/.test(x)) && ctx.log.indexOf('render') !== -1, ctx.log.join());

  ctx = mk(true); E = env(ctx);
  E.set({ id: 'b', zone: 'page', on: false, hold: true, armed: true, touch: true, x: 40, y: 50 }); E.end(true);
  check('held and let go without moving: the section\'s menu, as a long press', ctx.log.join() === 'cur:b,menu:b' && !ctx.lifted.classList.contains('is-lifted'), ctx.log.join());
  ctx = mk(true); E = env(ctx);
  E.set({ id: 'b', zone: 'page', on: false, hold: true, armed: true, touch: true }); E.end(false);
  check('...but not when the touch was cancelled', ctx.log.length === 0);
  ctx = mk(true); E = env(ctx);
  E.set({ id: 'b', zone: 'page', on: false, hold: true, armed: false, touch: true }); E.end(true);
  check('a tap (never held): nothing, so its click comes', ctx.log.length === 0 && E.held() === 0);
});

// ------------------------------------------------------------ 5. the order
console.log('\n5. The drop is one change, and the songs follow it');
run('move to', () => {
  const env = new Function('ctx', `
    var currentOrderData = ctx.order, songOrderSections = ctx.songs;
    function _lbdChange(f) { ctx.changes++; return f() !== false; }
    function _woSectionList() { return currentOrderData.sectionLayout.map(function(s) { return { id: s.id, title: s.title }; }); }
    function _woSongSectionIds(s) { return s.serviceSections || []; }
    function _lbdReveal() {}
    function _lbdCssId(s) { return s; }
    ${fn('_lbdSecIndex')}
    ${fn('_lbdSortSongsByService')}
    ${fn('_lbdMoveSectionTo')}
    ${fn('lbdMoveSection')}
    return { to: _lbdMoveSectionTo, by: lbdMoveSection };`);
  const ctx = {
    changes: 0,
    order: { sectionLayout: [{ id: 'inv', title: 'Invocation' }, { id: 'conf', title: 'Confession' }, { id: 'pw', title: 'Praise & Worship' }, { id: 'resp', title: 'Song of Response' }] },
    songs: [{ id: 's1', serviceSections: ['pw'] }, { id: 's2', serviceSections: ['pw'] }, { id: 's3', serviceSections: ['resp'] }]
  };
  const E = env(ctx);
  const order = () => ctx.order.sectionLayout.map(s => s.id).join(',');
  const songs = () => ctx.songs.map(s => s.id).join(',');
  check('a drop puts the section there', E.to('resp', 'pw', false) === true && order() === 'inv,conf,resp,pw', order());
  check('...and the songs run in the new order', songs() === 's3,s1,s2', songs());
  const n = ctx.changes;
  check('a drop where it already was records nothing', E.to('resp', 'pw', false) === false && order() === 'inv,conf,resp,pw');
  E.by('resp', 1);
  check('Move down (the menu and the buttons) keeps the songs in order too', order() === 'inv,conf,pw,resp' && songs() === 's1,s2,s3', order() + ' / ' + songs());
  check('a section moved onto itself is not a change', E.to('inv', 'inv', false) === false);
  void n;
});

// ------------------------------------------------------------ 6. wiring and look
console.log('\n6. Wired in, and shown');
const render = fn('lbdRender');
check('a redraw waits while a section is dragged (the drop redraws)',
  /if \(_lbdPD && _lbdPD\.on\) return;/.test(render));
check('every heading is bound for a finger after each draw', /_lbdApplyShell\(\);\r?\n\s*_lbdBindHeads\(host\);/.test(render) &&
  /addEventListener\('touchmove', _lbdHeadTouchMove, \{ passive: false \}\)/.test(fn('_lbdBindHeads')) &&
  /addEventListener\('touchend', _lbdHeadTouchEnd, \{ passive: false \}\)/.test(fn('_lbdBindHeads')));
check('the outline is not redrawn under a drag', /if \(!el \|\| \(_lbdPD && _lbdPD\.on\)\) return;/.test(fn('_lbdRenderNavPane')));
check('a held heading does not open the browser\'s menu as well', /if \(_lbdPD && \(_lbdPD\.hold \|\| _lbdPD\.on\)\) \{ e\.preventDefault\(\); return; \}/.test(fn('_lbdOnContextMenu')));
check('Escape puts a dragged section back', /if \(e\.key === 'Escape' && _lbdPD && _lbdPD\.on\) \{ e\.preventDefault\(\); _lbdDragEnd\(false\); return; \}/.test(fn('_lbdOnDocKey')));
check('pointercancel is not a drop', /function _lbdOnPointerCancel\(\) \{ _lbdDragEnd\(false\); \}/.test(SRC) && /addEventListener\('pointercancel', _lbdOnPointerCancel\)/.test(fn('_lbdOnPointerDown')));
check('the page folds to its headings when the drag begins, keeping the held one where it was',
  /zone\.classList\.add\('is-sorting'\);\r?\n\s*if \(h\) window\.scrollBy\(0, h\.getBoundingClientRect\(\)\.top - top0\);/.test(fn('_lbdDragBegin')));
check('a section\'s number is its place in the order', /'<span class="lbw-h-num">' \+ \(idx \+ 1\) \+ '\.<\/span>'/.test(fn('_lbdSectionHtml')));

// The WHOLE selector list of the phone's hiding rule: from the last '}'
// before it, so a grip put back in front of the arrows is seen.
const phoneHide = (css.match(/\}([^{}]*\.lbw--sm \.lbw-tb\[data-act="sec-up"\][^{]*)\{ display: none; \}/) || ['', ''])[1];
check('a phone shows the heading\'s grip (it was hidden with the arrows)', phoneHide && !/\.lbw-grip/.test(phoneHide) &&
  /\.lbw--sm \.lbw-h \.lbw-grip \{ width: 26px; height: 44px;/.test(css), phoneHide);
check('the number drags at once on a finger', /\.lbw-page \.lbw-h-num \{ touch-action: none; cursor: grab; \}/.test(css));
check('the heading is picked up, not selected; its name still is', /\.lbw-page \.lbw-h \{ -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; \}/.test(css) &&
  /\.lbw-page \.lbw-h-title \{ -webkit-user-select: text; user-select: text; \}/.test(css));
check('while sorting, the sections are their headings', /\.lbw-page\.is-sorting \.lbw-sec > \.lbw-margin, \.lbw-page\.is-sorting \.lbw-sec-body[^{]*\{ display: none; \}/.test(css));
check('the one held shows where it will land', /\.lbw-page\.is-sorting \.lbw-sec\.is-dragging > \.lbw-h \{[^}]*dashed/.test(css));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
