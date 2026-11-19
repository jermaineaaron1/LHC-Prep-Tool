'use strict';
// Regression harness: Refresh keeps the user where they are.
//
// WHY THIS EXISTS
// From the operator (2026-11-19): "sometimes when users hit that refresh
// buttons, rather than just refreshing the page, it refreshes the entire app
// and brings the users to the main menu ... The users should be at the same
// page and receive the updates. This is especially important when the LCD
// receive updates are getting back online after a sudden internet outage."
//
// Measured in WebKit and Chromium (2026-11-19) before the fix:
//   - The offline bar's "Back online -- Refresh" called location.reload(). The
//     app starts on Home, so an operator in LCD Projection -- full screen, a
//     slide on the wall -- was put on Home, with no order, no step, no slide;
//     the projection window lost the page that drives it.
//   - The order banner's "Reload order" chose where to land by reading
//     `wo-mode-song`, which the order's landing sets too, so a reload from
//     the landing opened the retired Song Order list; in LCD Projection it
//     left the console's full screen and the operator's slide.
// Now nothing in the app reloads the page: window.lhcRefreshHere brings each
// part on screen up to date where it stands (gotcha 107).
//
// USAGE
//   node tools/refresh-keeps-place-harness.js                  # ../Index.html
//   node tools/refresh-keeps-place-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show b63f08c:Index.html > x`): every check must then FAIL.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const raw = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(EXPECT_BROKEN ? !ok : ok);
  console.log((EXPECT_BROKEN ? (!ok ? '  ok    (broken, as expected) ' : '  FAIL  (expected broken) ') : (ok ? '  ok    ' : '  FAIL  ')) + label);
  if (!ok && !EXPECT_BROKEN) { console.log('          got  ' + JSON.stringify(got)); console.log('          want ' + JSON.stringify(want)); }
}
// The text of `head ... }` with its braces matched (no braces in its strings).
function slice(head) {
  const i = raw.indexOf(head);
  if (i < 0) return null;
  let d = 0, started = false;
  for (let k = raw.indexOf('{', i); k < raw.length; k++) {
    const c = raw[k];
    if (c === '{') { d++; started = true; } else if (c === '}') { d--; if (started && !d) return raw.slice(i, k + 1); }
  }
  return null;
}
function run(src, ctx) { vm.createContext(ctx); vm.runInContext(src, ctx); return ctx; }

// A small stand-in for the page: classes on <body>, elements by id.
function page(o) {
  const els = {};
  function el(id, shown, cls) {
    const c = new Set(cls || []);
    return els[id] = { style: { display: shown ? '' : 'none' }, getClientRects: () => (shown ? [1] : []),
                       classList: { contains: k => c.has(k) } };
  }
  el('woModeLanding', !!o.landing);
  el('worshipOrderView', o.ordersView !== false);
  const main = el('mainContent', !!o.main, o.songOrder ? ['wo-song-order'] : []);
  const body = new Set(o.body || []);
  return {
    $: id => els[id] || null,
    document: { body: { classList: { contains: k => body.has(k) } },
                querySelector: s => (s === '.wo-main-content' ? main : null),
                getElementById: id => els[id] || null },
    _lbdIsActive: () => !!o.builder
  };
}

// ---------------------------------------------------------------------------
console.log('\nnothing in the app reloads the page (it restarts on Home)');
{
  const n = (raw.match(/location\.reload\(/g) || []).length;
  check('no location.reload() anywhere', n, 0);
  const off = slice('    function _offRefresh(btn) {') || '';
  check('the offline bar\'s Refresh refreshes in place (lhcRefreshHere)', /window\.lhcRefreshHere\(/.test(off), true);
}

// ---------------------------------------------------------------------------
console.log('\nthe step on screen is read right (_orderSyncWhere)');
{
  const src = slice('  function _orderSyncWhere() {');
  if (!src) { check('_orderSyncWhere exists', false, true); }
  else {
    const where = o => run(src, page(o))._orderSyncWhere();
    check('LCD Projection -> service', where({ body: ['lcd-console-open', 'wo-mode-song'], main: true }), 'service');
    check('the Liturgy Builder -> liturgy', where({ builder: true, body: ['wo-mode-song'], main: true, songOrder: true }), 'liturgy');
    // The landing sets wo-mode-song: the old rule read that as Song Order.
    check('the order\'s landing -> null, not the retired Song Order', where({ landing: true, body: ['wo-mode-song'] }), null);
    check('the Song Order list itself -> song', where({ main: true, songOrder: true, body: ['wo-mode-song'] }), 'song');
  }
}

// ---------------------------------------------------------------------------
console.log('\nReload order comes back to the place, not just the step');
{
  const rl = slice('  function _orderSyncReload() {') || '';
  check('it records the slide, the full screen and the scroll', /live:\s*mode === 'service' \? _orderSyncRememberLive\(\)/.test(rl) && /fs:\s*mode === 'service'/.test(rl) && /scroll:\s*_orderSyncScrollTop\(\)/.test(rl), true);
  const i = raw.indexOf('    if (_orderSyncResume) {');
  const block = i < 0 ? '' : raw.slice(i, raw.indexOf('    // A link shared to this service', i));
  check('the resume puts the slide back (_orderSyncRestoreLive)', /_orderSyncRestoreLive\(_rs\.live\)/.test(block), true);
  check('the resume re-enters the console\'s full screen', /_rs\.fs[\s\S]*lcdToggleWorkspaceFullscreen\(true\)/.test(block), true);
  check('the resume puts the builder back where it was scrolled', /_rs\.mode === 'liturgy' && _rs\.scroll/.test(block), true);
  const land = slice('  function showOrderModeLanding() {') || '';
  check('the landing keeps the browser\'s own full screen on the way back', /lcdToggleWorkspaceFullscreen\(false,\s*!!\(_orderSyncResume && _orderSyncResume\.fs\)\)/.test(land), true);
}

// ---------------------------------------------------------------------------
console.log('\nback online: each part catches up where it stands (WO.refreshHere)');
{
  const where = slice('  function _orderSyncWhere() {');
  const src = slice('  function refreshHere(opts) {');
  if (!src || !where) { check('WO.refreshHere exists', false, true); }
  else {
    function go(o, opts) {
      const calls = [];
      const ctx = page(o);
      Object.assign(ctx, {
        currentOrderData: o.order === false ? null : { id: 'order_1' },
        _ordersPreloaded: true,
        silentPreloadOrders: () => calls.push('orders list'),
        _sbmBookOpen: () => !!o.songbook,
        sbmLiveRefresh: () => calls.push('songbook'),
        _orderSyncTick: () => calls.push('sync'),
        _orderSyncReload: () => calls.push('reload order'),
        unsavedWork: () => !!o.unsaved,
        setTimeout: f => calls.push('later'),
        _orderSyncPending: 'x', _orderSyncDismissed: 'y'
      });
      run(where + '\n' + src, ctx);
      const out = ctx.refreshHere(opts || {});
      return { out, calls };
    }
    const lcd = go({ body: ['lcd-console-open'], main: true });
    check('LCD Projection: the live sync, read three times, never a reload', lcd.calls, ['orders list', 'sync', 'later', 'later']);
    check('  ...and it says where it was', lcd.out.where, 'service');
    check('the Liturgy Builder: the order reloaded, back on the builder', go({ builder: true, main: true }).calls, ['orders list', 'reload order']);
    check('the landing: the order reloaded, back on the landing', go({ landing: true }).calls, ['orders list', 'reload order']);
    check('the Songbook open: its own refresh, nothing under it touched', go({ songbook: true, body: ['lcd-console-open'] }).calls, ['orders list', 'songbook']);
    check('changes not saved and keepOrder: the order is left alone', go({ builder: true, main: true, unsaved: true }, { keepOrder: true }), { out: { where: 'liturgy', kept: true }, calls: ['orders list'] });
    check('not on the Orders page: only the list is read again', go({ ordersView: false }).calls, ['orders list']);
  }
}

// ---------------------------------------------------------------------------
console.log('\nthe page-wide refresh (window.lhcRefreshHere)');
{
  const i = raw.indexOf('    window.lhcRefreshHere = function (opts) {');
  const src = i < 0 ? null : slice('    window.lhcRefreshHere = function (opts) {');
  if (!src) { check('window.lhcRefreshHere exists', false, true); }
  else {
    function go(shownIds, opts) {
      const calls = [];
      const win = {
        lhcReloadData: () => { calls.push('songs+orders'); return Promise.resolve(); },
        WO: { refreshHere: o => { calls.push('orders' + (o.keepOrder ? ' (keep order)' : '')); return { kept: !!o.keepOrder }; } },
        RosterEngine: { refreshHere: () => { calls.push('roster'); return Promise.resolve(true); } },
        LiturgyModule: { syncFromBackend: () => calls.push('liturgy') }
      };
      const ctx = { window: win, WO: win.WO, RosterEngine: win.RosterEngine, LiturgyModule: win.LiturgyModule, Promise,
        document: { getElementById: id => (shownIds.includes(id) ? { getClientRects: () => [1] } : { getClientRects: () => [] }) } };
      run(src, ctx);
      return win.lhcRefreshHere(opts).then(r => ({ calls, r }));
    }
    Promise.all([
      go(['worshipOrderView']),
      go(['worshipRosterView']),
      go(['liturgyView'], { keepOrder: true })
    ]).then(([a, b, c]) => {
      check('on an order: songs and orders read, the order caught up', a.calls, ['songs+orders', 'orders']);
      check('on the Roster: its month read again too', b.calls, ['songs+orders', 'orders', 'roster']);
      check('on the Liturgy page, keepOrder passed on, kept said back', [c.calls, c.r], [['songs+orders', 'orders (keep order)', 'liturgy'], { kept: true }]);
      roster();
    });
  }
}

// ---------------------------------------------------------------------------
function roster() {
  console.log('\nthe Roster never reads over edits not yet saved');
  const i = raw.indexOf('    refreshHere: function() {');
  const src = i < 0 ? '' : raw.slice(i, raw.indexOf('    loadRosterData: function() {', i));
  check('RosterEngine.refreshHere refuses while edits are unsaved', /if \(STATE\.rosterHasUnsaved && STATE\.rosterEdits\.size\) return Promise\.resolve\(false\);/.test(src), true);
  check('  ...and keeps the scroll, both ways', /scrollLeft = x/.test(src) && /window\.scrollTo\(0, y\)/.test(src), true);
  done();
}

function done() {
  console.log('\n================================');
  const passed = results.filter(Boolean).length;
  console.log(passed + '/' + results.length + ' checks passed' + (EXPECT_BROKEN ? ' (as broken)' : ''));
  if (passed !== results.length) process.exit(1);
}
if (!raw.includes('    window.lhcRefreshHere = function (opts) {')) roster();
