'use strict';
// Regression harness for opening a roster cell on a touch screen.
//
// WHY THIS EXISTS
// A PIC signed in on an iPhone, went to change the Live Streaming
// enablers, and found that nothing he did to the cell had any effect.
// His login was fine. The GESTURE never arrived.
//
// Every ordinary duty cell opened its editor from `td.ondblclick` and
// nothing else. iOS does not dependably dispatch dblclick: this page
// declares user-scalable=yes with maximum-scale=4, so a double tap is a
// zoom and Safari keeps it. Live Streaming, PA System, Sunday School,
// Flower Arrangement -- every cell of the table a phone lands on by
// default -- simply did not answer.
//
// The fix already existed in the file. The comment on the old
// _bindScriptureTap said it outright: "dblclick is not dependable on
// touch -- the browser would rather treat two taps as a zoom". It was
// then wired to SCRIPTURE cells only, four per service, while the forty
// around them were left on dblclick. Nothing checked that, because what
// was tested was the behaviour of the cells that HAD the shim.
//
// THE DANGEROUS DIRECTION
// This failure is silent and total: no error, no toast, no console, and
// the PIC concludes the system has locked them out. So the check that
// matters most is not "does a double tap edit a cell" -- it is "is
// there a cell anywhere in the table that a double tap cannot reach".
//
// USAGE
//   node tools/roster-touch-edit-harness.js                 # ../Index.html
//   node tools/roster-touch-edit-harness.js path/to/file.html
//   node tools/roster-touch-edit-harness.js <file> --expect-broken
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

// Brace-matched slice of one method of the RosterEngine object literal.
function extractMethod(pattern, name) {
  const startIdx = lines.findIndex(l => pattern.test(l));
  if (startIdx < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n').replace(/,\s*$/, '');
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

let bindSrc, tapSrc;
try {
  bindSrc = extractMethod(/^    bindCellEvents: function\(\) \{/, 'bindCellEvents');
  tapSrc = extractMethod(/^    _bindDoubleTap: function\(td, act\) \{/, '_bindDoubleTap');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}

// ---------------------------------------------------------------------------
// A table shaped like the one in the screenshot: a scripture row, two
// ordinary duty rows, and the service-type toggle row that is deliberately
// not editable this way.
// ---------------------------------------------------------------------------
function cell(key, rowCls, attrs) {
  const td = new El('td', 'roster-role-cell', Object.assign({ 'data-key': key }, attrs || {}));
  td._listeners = {};
  td.addEventListener = (type, fn) => { (td._listeners[type] = td._listeners[type] || []).push(fn); };
  return td;
}

function buildTable() {
  const doc = makeDocument();
  const tbody = new El('tbody', '', { id: 'rosterTbody' });
  doc.root.appendChild(tbody);
  const rows = {};
  [['duty', ''], ['scripture', 'roster-scripture-row'], ['toggle', 'roster-servicetype-row']]
    .forEach(([k, cls]) => {
      const tr = new El('tr', cls);
      tbody.appendChild(tr);
      rows[k] = tr;
    });
  const cells = {
    live:      cell('livestream__Nov_1'),
    pa:        cell('pa__Nov_1'),
    scripture: cell('reading1__Nov_1', '', { 'data-ref': 'John 1:1' }),
    toggle:    cell('servicetype__Nov_1')
  };
  rows.duty.appendChild(cells.live);
  rows.duty.appendChild(cells.pa);
  rows.scripture.appendChild(cells.scripture);
  rows.toggle.appendChild(cells.toggle);
  return { doc, tbody, cells };
}

// A tap, as the shim sees one.
function tap(td, at, onTarget) {
  const target = onTarget || td;
  const ev = {
    target: Object.assign({ closest: sel => (target._matchesSel === sel ? target : null) }, {}),
    _prevented: false,
    preventDefault() { this._prevented = true; }
  };
  const now = Date.now;
  Date.now = () => at;
  try { (td._listeners.touchend || []).forEach(fn => fn(ev)); }
  finally { Date.now = now; }
  return ev;
}

function run(table, STATE, log) {
  const self = {
    editCell: td => log.push('edit:' + td.getAttribute('data-key')),
    openScripture: td => log.push('read:' + td.getAttribute('data-key')),
    showCellDropdown: () => log.push('menu'),
    _refreshScriptureTitles: () => {}
  };
  // Both methods evaluated as real properties of one object, which is how
  // the file has them -- so `self` and `this` mean inside the slice exactly
  // what they mean in the app.
  const make = new Function('document', 'STATE', 'RosterEngineSelf',
    'var obj = RosterEngineSelf;\n' +
    'obj.bindCellEvents = ' + bindSrc.replace(/^    bindCellEvents: /, '') + ';\n' +
    'obj._bindDoubleTap = ' + tapSrc.replace(/^    _bindDoubleTap: /, '') + ';\n' +
    'return obj;');
  return make(table.doc, STATE, self);
}

// ---------------------------------------------------------------------------
console.log('\nevery cell answers a double tap, not only the scripture ones');
{
  const table = buildTable();
  const log = [];
  const STATE = { picMode: true };
  const R = run(table, STATE, log);
  R.bindCellEvents();

  const bound = k => (table.cells[k]._listeners.touchend || []).length > 0;
  check('the Live Streaming cell is bound to touch', bound('live'), true);
  check('  so is PA System', bound('pa'), true);
  check('  and the scripture cell, as it always was', bound('scripture'), true);
  // The toggle row's buttons are the whole interaction surface; binding a
  // text editor behind them would be a second, conflicting answer.
  check('the service-type toggles are left alone', bound('toggle'), false);

  // The check that would have caught the bug: not "does this cell work"
  // but "is there a cell that does not".
  const dutyCells = ['live', 'pa', 'scripture'];
  check('no duty cell is left without a touch path',
    dutyCells.filter(k => !bound(k)), []);
}

console.log('\nwhat two taps do, and what one does not');
{
  const table = buildTable();
  const log = [];
  const STATE = { picMode: true };
  run(table, STATE, log).bindCellEvents();
  const td = table.cells.live;

  tap(td, 1000);
  check('one tap edits nothing', log, []);
  const second = tap(td, 1200);
  check('two inside 400ms open the editor', log, ['edit:livestream__Nov_1']);
  // Without this the second tap is a zoom and the editor opens under a
  // page that has just jumped.
  check('  and the zoom is cancelled with it', second._prevented, true);

  log.length = 0;
  tap(td, 5000);
  tap(td, 5600);
  check('two taps 600ms apart are two taps', log, []);

  log.length = 0;
  tap(table.cells.live, 7000);
  tap(table.cells.pa, 7100);
  check('a tap on one cell then another is not a double', log, []);
}

console.log('\nwho is allowed, and what each cell does');
{
  const table = buildTable();
  const log = [];
  const STATE = { picMode: false };
  run(table, STATE, log).bindCellEvents();

  tap(table.cells.live, 1000); tap(table.cells.live, 1200);
  check('signed out, a duty cell does nothing at all', log, []);
  // A scripture cell has something to offer a reader either way.
  tap(table.cells.scripture, 2000); tap(table.cells.scripture, 2200);
  check('  but a scripture cell still reads its passage', log, ['read:reading1__Nov_1']);

  // picMode is read at TAP time, not at bind time: a PIC login does not
  // re-render this table, so a handler that captured the mode would keep
  // acting on whichever mode was in force at the last render.
  log.length = 0;
  STATE.picMode = true;
  tap(table.cells.live, 3000); tap(table.cells.live, 3200);
  check('signing in needs no re-render to take effect', log, ['edit:livestream__Nov_1']);
  log.length = 0;
  tap(table.cells.scripture, 4000); tap(table.cells.scripture, 4200);
  check('  and the scripture cell switches to editing', log, ['edit:reading1__Nov_1']);
}

console.log('\nthe cell menu is its own control');
{
  const table = buildTable();
  const log = [];
  run(table, { picMode: true }, log).bindCellEvents();
  const td = table.cells.live;
  const icon = { _matchesSel: '.roster-cell-dropdown-icon' };
  tap(td, 1000, icon);
  tap(td, 1200, icon);
  check('two taps on the options button do not edit the cell', log, []);
}

console.log('\nand the ways in are visible on a phone');
const css = raw.replace(/\r/g, '');
// 7px at 35% opacity was a smudge, not a control -- and this is the route
// a PIC finds when the gesture does not occur to them.
// The PHONE's rule, which is the one that overrides -- picked by the
// !important it carries rather than by counting media queries. Written
// the other way first, this read the DESKTOP rule and passed against
// 7px/0.35 still being live on every phone.
const iconRules = (function () {
  const out = [];
  for (let i = css.indexOf('.roster-cell-dropdown-icon {'); i >= 0;
       i = css.indexOf('.roster-cell-dropdown-icon {', i + 1)) {
    out.push(css.slice(i, css.indexOf('}', i) + 1));
  }
  return out;
})();
const overriding = iconRules.filter(r => /!important/.test(r));
check('exactly one rule overrides the icon for touch', overriding.length, 1);
const iconRule = overriding[0] || '';
const px = parseFloat((/font-size:\s*([\d.]+)px/.exec(iconRule) || [])[1]);
const op = parseFloat((/opacity:\s*([\d.]+)/.exec(iconRule) || [])[1]);
check('the cell menu is big enough to see', px >= 10, true);
check('  and solid enough to find', op >= 0.5, true);
check('  with padding to give it a thumb-sized target',
  /padding:\s*\d+px \d+px\s*!important/.test(iconRule), true);
// The desktop says this in a title attribute, which a phone never shows.
check('a PIC on a phone is told the gesture',
  /<div class="rmp-edit-hint pic-only" id="rmpEditHint">/.test(raw), true);
check('  and only while signed in as one',
  /#rosterMobilePremium \.rmp-edit-hint \{ display: none !important; \}/.test(css) &&
  /body\.pic-mode #rosterMobilePremium \.rmp-edit-hint \{/.test(css), true);

console.log('\nthe phone roster\'s controls stay big enough to hit');
// FLOORS, not exact sizes. The sizes are a taste decision and have moved
// once already (-6 on the menu, -15 across the month bar and tabs, +5 on
// the share button, all asked for). What must not move is that each of
// these is something a thumb has to find on a phone: the share button was
// 14px tall before, below anything anyone can aim at, and it is the
// control that sends a whole service to the team.
const rule = sel => {
  const i = css.indexOf(sel + ' {', css.indexOf('#worshipRosterView #rosterMobilePremium'));
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
};
const sizeOf = (r, prop) => parseFloat((new RegExp(prop + ':\\s*([\\d.]+)px').exec(r) || [])[1]);
const moreRule = rule('.rmp-more');
check('the appbar menu is a square you can hit',
  sizeOf(moreRule, 'width') >= 28 && sizeOf(moreRule, 'height') >= 28, true);
check('the month arrows are too', sizeOf(rule('.rmp-nav-btn'), 'height') >= 32, true);
check('and the Whole Month / Service Cards tabs',
  sizeOf(rule('.rmp-tab'), 'min-height') >= 30, true);
// The share button has no height of its own -- it is padding either side
// of an icon -- so the floor is on what adds up to one.
const shareRule = (function () {
  const i = css.indexOf('.roster-share-btn { padding:');
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
})();
const sp = /padding:\s*([\d.]+)px\s+([\d.]+)px/.exec(shareRule);
const sf = /font-size:\s*([\d.]+)px/.exec(shareRule);
check('the WhatsApp button is taller than the 14px it was',
  !!sp && !!sf && (parseFloat(sp[1]) * 2 + parseFloat(sf[1])) >= 18, true);
check('  and wider than its own glyph',
  !!sp && parseFloat(sp[2]) >= 8, true);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN && passed === results.length) {
  console.log('\nBUT --expect-broken was given and everything passed.');
  process.exit(1);
}
process.exit(passed === results.length ? 0 : 1);
