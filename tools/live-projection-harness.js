'use strict';
// Regression harness for a change on one device reaching a projection
// already running on another.
//
// WHY THIS EXISTS
// The operator asked for it (2026-11-11) and, asked directly, chose that
// the words change in front of the congregation rather than wait to be
// advanced past. Everything here is about a screen a room is looking at,
// so the failures are public ones.
//
// THE DANGEROUS DIRECTION
// Not updating is bad. Updating the operator's SCHEDULE while the wall
// keeps the old words is worse, because the screen they read from then
// says it is done. And putting the app's own chrome -- a banner, a
// half-typed line -- in front of a congregation is worse than either.
//
// USAGE
//   node tools/live-projection-harness.js                 # ../Index.html
//   node tools/live-projection-harness.js path/to/file.html
//   node tools/live-projection-harness.js <file> --expect-broken

const fs = require('fs');
const path = require('path');
const { makeDocument, El } = require('./minidom.js');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}
const SRC = fs.readFileSync(INDEX, 'utf8');

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

const lines = SRC.split('\n');
function extractFn(name) {
  const i = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (i < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let k = i; k < lines.length; k++) {
    out.push(lines[k].replace(/\r$/, ''));
    for (const ch of lines[k]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('no close for ' + name);
}

let slideTextSrc;
try {
  slideTextSrc = extractFn('_lcdSlideText');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the live-projection code is present.');
  process.exit(1);
}

// ── 1. one answer to "what is on the wall" ─────────────────────────────
console.log('\nthe words of a slide have one definition');
// A second copy of this reading would be a second answer to what is
// being projected, and the two would drift.
// Both, because the reader calls the predicate -- which is the point of
// the predicate being its own function.
const _lcdSlideText = new Function(
  extractFn('_lcdIsSlideLine') + '\n' + slideTextSrc + '\nreturn _lcdSlideText;')();

function slide(kids) {
  const c = new El('div', 'wo-slide-content');
  kids.forEach(k => c.appendChild(k));
  return c;
}
function line(text, cls) {
  const el = new El('div', cls || 'wo-slide-line');
  el.textContent = text;
  return el;
}

check('the lines of a slide, joined',
  _lcdSlideText(slide([line('L: In the Name of the Father'), line('C: Amen.')])),
  'L: In the Name of the Father\nC: Amen.');
// This instruction once went up in front of a congregation.
check('the editor\'s own placeholder never reaches the wall, by class',
  _lcdSlideText(slide([line('Real words'), line('anything', 'wo-slide-line wo-slide-empty-hint')])),
  'Real words');
check('  and by its text, for slides that carry it without the class',
  _lcdSlideText(slide([line('Real words'), line('Double-click to add content')])),
  'Real words');
check('an empty slide is empty, not a placeholder', _lcdSlideText(slide([])), '');
check('nothing at all does not throw', _lcdSlideText(null), '');
// A slide being typed on HERE reads from the box being typed in, so the
// operator's own preview follows their keystrokes.
const ta = new El('textarea');
ta.value = 'half a line';
check('a slide being edited here reads from the editor',
  _lcdSlideText(slide([line('stale'), ta])), 'half a line');

console.log('\nand selectSlideBox uses it rather than its own copy');
check('selectSlideBox asks for the text', /var text = _lcdSlideText\(content\);/.test(SRC), true);
// The projector and the rail's preview are different readers; what
// they must never disagree about is which lines count.
check('  the test for what counts is written once',
  (SRC.match(/Double-click to add content'/g) || []).length, 1);
check('  and both readers call it',
  (SRC.match(/\.filter\(_lcdIsSlideLine\)/g) || []).length, 2);
check('  it also records what went up',
  /updateProjectionPreview\(text, true\);[^\n]*\r?\n\s*_lcdProjected = text;/.test(SRC), true);

// ── 2. projecting no longer blocks the apply ───────────────────────────
console.log('\nthe state the operator cares about is no longer excluded');
const busy = extractFn('_orderSyncScreenBusy');
check('projecting does not stand the sync down', /_orderSyncProjecting\(\)/.test(busy), false);
// These stay: they are about not destroying words somebody here is
// typing, which is a different thing from not interrupting a service.
check('a slide being edited here still does', /editingSlideBox/.test(busy), true);
check('  and held, unsaved words', /_lcdEditDirty/.test(busy), true);
check('  and an open slide editor', /\.wo-slide-editor/.test(busy), true);
check('  and the Liturgy Builder, which takes the schedule down', /_lbdIsActive\(\)/.test(busy), true);
// The app's own chrome must still never appear on a projected screen.
check('a banner still refuses to show over a projection',
  /function _orderSyncShowBanner[\s\S]{0,300}?if \(_orderSyncProjecting\(\)\) return;/.test(SRC), true);

// ── 3. the wall follows the schedule ───────────────────────────────────
console.log('\nthe wall follows the schedule, not the other way round');
// Updating the operator's list while the wall kept the old words would
// be the worse failure: the screen they read from would say it was done.
check('the slide is re-sent after a change is applied',
  /applied\.applied\.length\) \{[\s\S]{0,600}?try \{ _lcdReproject\(\); \}/.test(SRC), true);
const repro = extractFn('_lcdReproject');
check('it does nothing when nothing is being projected', /if \(!_lcdOnAir\(\)\) return false;/.test(repro), true);
check('  nor when the operator is typing that very slide here',
  /if \(content\.querySelector\('textarea'\)\) return false;/.test(repro), true);
check('  nor when the words have not actually changed',
  /if \(text === _lcdProjected\) return false;/.test(repro), true);
check('it sends the SELECTED slide, which is the one on the wall',
  /\.wo-slide-box\.selected/.test(repro), true);

console.log('\nwhat counts as being on air');
const onAir = extractFn('_lcdOnAir');
// The operator projects through the Project button's own WINDOW, which
// leaves this page out of fullscreen entirely -- so asking about
// fullscreen alone, as the old sync guard did, answers "no" during most
// real services.
check('the projector WINDOW counts', /projectionWindow && !projectionWindow\.closed/.test(onAir), true);
check('  and a closed cross-origin window does not throw', /catch \(e\)/.test(onAir), true);
check('fullscreen counts', /document\.fullscreenElement/.test(onAir), true);
check('the presenter overlay counts', /sbFsOverlay/.test(onAir), true);

// ── 4. pushed, not waited for ──────────────────────────────────────────
console.log('\npushed, rather than waited for');
// The realtime channel used to be started only by the songbook's open
// paths, so a device sitting in LCD Projection was never subscribed.
check('an open order subscribes, not only an open songbook',
  /function _orderSyncStart\(\)[\s\S]{0,900}?sbStartRealtimeSync\(\)/.test(SRC), true);
check('  and does not start a second channel over a live one',
  /typeof sbRealtimeChannel !== 'undefined' && !sbRealtimeChannel/.test(SRC), true);
check('every save says so, from the one place they all go through',
  /\.then\(function\(res\) \{[\s\S]{0,400}?window\._orderTouchSend\(id\)/.test(SRC), true);
check('  and that place is SBQ.saveOrder, which every path uses',
  /saveOrder: function\(payload\)[\s\S]*?window\._orderTouchSend\(id\)/.test(SRC), true);
check('  and the other devices listen for it',
  /\.on\('broadcast', \{ event: 'order_touch' \}/.test(SRC), true);
check('  for this order only',
  /p\.orderId !== \(currentOrderData && currentOrderData\.id\)\) return;/.test(SRC), true);
// A tick must see a difference twice before it trusts it (a save is
// upsert-then-prune), so one nudge alone would only ever arm it.
check('a nudge asks twice, because one pass only arms the check',
  /_orderSyncTick\(\);[\s\S]{0,120}?setTimeout\(function\(\) \{ _orderSyncTick\(\); \}, 700\);/.test(SRC), true);
check('the 4-second poll is still there as the fallback',
  /ORDER_SYNC_MS = 4000;/.test(SRC), true);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
