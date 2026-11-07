'use strict';
// Harness for the Songbook's coach marks (2026-11-07). From the operator,
// for phones and desks alike:
//
//   1. the scroll-down flash, "only at the initial opening of a songbook when
//      the app is first opened" -- once each time the app is opened, held in
//      memory -- and on a desk too, whenever the words are not yet up the
//      screen;
//   2. when the recordings sheet opens, four seconds pointing at what kind of
//      take it is (whole song, an instrument, a voice part; a section has its
//      own mic in the song) and at Record;
//   3. when a take is stopped, arrows to Tracks, where it plays back;
//   4. after two minutes in a songbook, how to draw a remark (double-tap the
//      words) and that its drawer chooses who sees it, Everyone by default.
//
// Each shows once each time the app is opened, never in the desk's Phone view.
//
// USAGE
//   node tools/songbook-coach-harness.js
//   node tools/songbook-coach-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

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
function extractVar(name) {
  const l = lines.find(x => new RegExp('^  var ' + name + '\\b').test(x));
  if (!l) throw new Error('var not found: ' + name);
  return l;
}
const fn = n => { try { return extractFn(n); } catch (e) { return ''; } };
const has = re => re.test(SRC);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// --------------------------------------------------------------- 1. the flash
console.log('\n1. The scroll-down flash: the first songbook each time the app is opened');
let want = null;
try { want = new Function(extractFn('_sbmIntroWant') + '\nreturn _sbmIntroWant;')(); } catch (e) { want = null; }
if (!want) check('whether the flash is wanted is a function of its own', false);
else {
  check('a phone, the words below the screen: yes', want(748, 3000, 812) === true);
  check('a desk, a few lines in sight but the words low on the screen: yes', want(536, 2000, 768) === true);
  check('the words up the screen already: no', want(200, 2500, 812) === false);
  check('the whole song in sight: no', want(500, 700, 812) === false);
  check('nothing measured: no', want(NaN, 0, 812) === false && want(500, 900, 0) === false);
}
const gc = fn('_sbmGuideCheck');
check('it shows when wanted, the floater comes after it, and waits while it is up',
  /if \(_sbmIntroDue\(\) && _sbmIntroWant\(wt, wb, r\.height\)\) \{ _sbmIntroShow\(\); want = true; \}/.test(gc) &&
  /_sbmGuideOn = want;\r?\n\s*\/\/[^\n]*\r?\n\s*if \(_sbmIntroUp\(\)\) want = false;/.test(gc));
check('held in memory only: once each time the app is opened', /return !_sbmIntroDone && !window\.__SBM_PREVIEW;/.test(fn('_sbmIntroDue')) && !has(/lhc_sbm_intro_seen/));

// ------------------------------------------------------------ the coach layer
console.log('\nThe coach layer');
let C = null;
try {
  C = function(win, doc, timers) {
    const body = extractVar('_sbmCoachSeen') + '\n' + ['_sbmCoachDue', '_sbmCoachOpen', '_sbmCoachClose', '_sbmCoachPlace', '_sbmCoachFrame'].map(extractFn).join('\n') +
      '\nreturn { due: _sbmCoachDue, open: _sbmCoachOpen, close: _sbmCoachClose, frame: _sbmCoachFrame, seen: _sbmCoachSeen };';
    return new Function('window', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', body)(win, doc, timers.st, timers.ct, timers.si, timers.ci);
  };
} catch (e) { C = null; }
if (!C) check('the coach layer exists', false);
else {
  let layer = null; const made = [];
  const doc = {
    getElementById: id => (id === 'sbmCoach' ? layer : null),
    createElement: () => { const el = { attrs: {}, className: '', setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, remove() { if (layer === this) layer = null; this.removed = true; } }; made.push(el); return el; },
    body: { appendChild: el => { layer = el; } },
    addEventListener() {}
  };
  const win = { addEventListener() {} };
  const T = { st: () => 1, ct: () => {}, si: () => 2, ci: () => {} };
  let api = null; try { api = C(win, doc, T); } catch (e) { api = null; }
  if (!api) { check('the coach layer exists', false); } else {
  check('each one is due once, then not again while the app stays open', api.due('record') === true && (api.open('record', 4000), api.due('record') === false) && api.due('tracks') === true);
  check('one layer at a time: opening another closes the first', (api.open('tracks', 5000), made.length === 2 && made[0].removed === true && layer === made[1]));
  check('closing by name leaves another one alone', (api.close('record'), layer === made[1]) && (api.close('tracks'), layer === null));
  const phone = C({ __SBM_PREVIEW: true, addEventListener() {} }, doc, T);
  check('never in the desk\'s Phone view', phone.due('record') === false && phone.due('draw') === false);
  const node = { style: {} };
  api.frame(node, { left: 26, top: 599, width: 323, height: 40 }, 6);
  check('a ring is drawn round its target, a little outside it', node.style.left === '20px' && node.style.top === '593px' && node.style.width === '335px' && node.style.height === '52px', JSON.stringify(node.style));
  const op = fn('_sbmCoachOpen'), cl = fn('_sbmCoachClose');
  check('it follows what it points at, and goes by itself', /el\.__iv = setInterval\(_sbmCoachPlace, 200\);/.test(op) && /el\.__t = setTimeout\(function\(\) \{ _sbmCoachClose\(key\); \}, ms\);/.test(op) &&
    /clearTimeout\(el\.__t\); clearInterval\(el\.__iv\); el\.remove\(\);/.test(cl));
  }
  check('it sits over the recordings sheet (z-index 3750)', has(/\.sbm-coach \{ position: fixed; inset: 0; z-index: 3800; pointer-events: none;/) && has(/id="sbRecSheet" style="display:none;position:fixed;inset:0;z-index:3750;/));
}

// --------------------------------------------------------- 2. the recordings sheet
console.log('\n2. The recordings sheet: what kind of take, then Record');
const rec = fn('_sbmCoachRecord');
check('it comes when the sheet opens', /sbLoadRecordings\(_sbRecCurrentSongId\);\r?\n\s*\/\/[^\n]*\r?\n\s*setTimeout\(_sbmCoachRecord, 80\);/.test(fn('sbOpenRecordings')));
check('four seconds', /var L = _sbmCoachOpen\('record', 4000\);/.test(rec));
check('a ring on the kind of take, numbered 1, and one on Record, numbered 2, with a finger pressing it',
  /_sbmCoachFrame\(L\.querySelector\('\[data-n="1"\]'\), rs, 6\);/.test(rec) && /_sbmCoachFrame\(L\.querySelector\('\[data-n="2"\]'\), rb, 6\);/.test(rec) &&
  /var sel = document\.getElementById\('sbRecCategory'\), btn = document\.getElementById\('sbRecordBtn'\);/.test(rec) && /sbm-coach__hand/.test(rec));
check('it says the kinds: the whole song, an instrument, a voice part -- and a section has its own mic',
  /the <b>whole song<\/b>, an <b>instrument<\/b> or a <b>voice part<\/b>/.test(rec) && /Just one section\? Use the mic beside it in the song\./.test(rec) && /Tap <b>Record<\/b> to start/.test(rec));
check('not while recording; it goes when Record is pressed or the sheet is closed',
  /_sbRecording\) return;/.test(rec) && /\} else \{\r?\n\s*_sbmCoachClose\('record'\);\r?\n\s*_sbStartRecording\(\);/.test(fn('sbToggleRecording')) &&
  /function sbCloseRecordings\(\) \{\r?\n\s*_sbmCoachClose\('record'\);/.test(SRC));

// ------------------------------------------------------------ 3. Tracks
console.log('\n3. A take stopped: arrows to Tracks');
const tr = fn('_sbmCoachTracks');
check('it comes when a take is stopped (the sheet\'s Record and the floating Stop both go through the toggle)',
  /if \(_sbRecording\) \{\r?\n\s*_sbStopRecording\(\);\r?\n\s*\/\/[^\n]*\r?\n\s*setTimeout\(_sbmCoachTracks, 350\);/.test(fn('sbToggleRecording')) &&
  has(/class="sb-rec-float__stop" onclick="WO\.sbToggleRecording\(\)"/));
check('five seconds, a ring on Tracks and arrows up to it', /var L = _sbmCoachOpen\('tracks', 5000\);/.test(tr) &&
  /document\.querySelector\('#sbmRoot \.sbm-tiles \[onclick="WO\.sbmPractice\(\)"\]'\)/.test(tr) && /fa-chevron-up/.test(tr) && /Play it back in <b>Tracks<\/b>/.test(tr));
check('the ring opens Tracks, the sheet closed first', /_sbmCoachClose\(\);\r?\n\s*if \(typeof sbCloseRecordings === 'function'\) sbCloseRecordings\(\);\r?\n\s*sbmPractice\(\);/.test(tr) &&
  has(/\.sbm-coach__ring--tap \{ pointer-events: auto; cursor: pointer; \}/));
check('Tracks is brought into sight first, above the sheet and under a desk\'s sticky bar', /if \(tr\.top < minTop \|\| tr\.bottom > room - 140\) root\.scrollTop \+= tr\.top - want;/.test(tr));

// ------------------------------------------------------------ 4. drawing
console.log('\n4. Two minutes in a songbook: drawing a remark');
let K = null;
try {
  K = function(env) {
    const body = extractVar('_sbmCoachSeen') + '\n' + extractVar('_sbmCoachClock') + '\n' + ['_sbmCoachDue', '_sbmCoachTick'].map(extractFn).join('\n') +
      '\nreturn { tick: _sbmCoachTick, clock: _sbmCoachClock, seen: _sbmCoachSeen };';
    const names = Object.keys(env);
    return new Function(...names, body)(...names.map(k => env[k]));
  };
} catch (e) { K = null; }
if (!K) check('the two minutes are kept by a function of its own', false);
else {
  let now = 1000000; const S = { open: true, active: true, busy: false, shown: 0, hidden: false };
  const env = { Date: { now: () => now }, document: { get hidden() { return S.hidden; } }, window: {}, clearInterval: () => {},
    _sbmBookOpen: () => S.open, _sbmActive: () => S.active, _sbmCoachBusy: () => S.busy, _sbmMarksOk: true, _sbmCoachDraw: () => { S.shown++; } };
  let k = null; try { k = K(env); } catch (e) { k = null; }
  if (!k) check('the two minutes are kept by a function of its own', false); else {
  k.clock.last = now;
  const run = (n, step) => { for (let i = 0; i < n; i++) { now += step; k.tick(); } };
  run(23, 5000);
  check('under two minutes open: nothing yet', S.shown === 0 && k.clock.ms === 115000, k.clock.ms);
  S.hidden = true; run(10, 5000); S.hidden = false;
  check('time in another tab does not count', S.shown === 0 && k.clock.ms === 115000);
  S.open = false; run(10, 5000); S.open = true;
  check('...nor time with the songbook closed', S.shown === 0 && k.clock.ms === 115000);
  now += 3600000; k.tick();
  check('a long gap counts as one tick at most', k.clock.ms === 121000 && S.shown === 1, k.clock.ms + ' / ' + S.shown);
  const k2 = K(Object.assign({}, env, { _sbmCoachDraw: () => { S.shown2 = (S.shown2 || 0) + 1; } }));
  S.busy = true; k2.clock.last = now; for (let i = 0; i < 30; i++) { now += 5000; k2.tick(); }
  check('at two minutes, while the reader is busy (drawing, a sheet, recording): it waits', !S.shown2);
  S.busy = false; now += 5000; k2.tick();
  check('...and shows when they are not', S.shown2 === 1);
  }
}
const draw = fn('_sbmCoachDraw');
check('the clock starts with the book', /\/\/ The two minutes before the drawing coach mark start with the book\.\r?\n\s*_sbmCoachClockStart\(\);/.test(fn('_sbmGuideUpdate')) &&
  /_sbmCoachClock\.t = setInterval\(_sbmCoachTick, 5000\);/.test(fn('_sbmCoachClockStart')));
check('busy means drawing, typing, Book Mode, recording, a sheet, Tracks, the flash or another coach mark',
  /_sbmDraw \|\| _sbNp \|\| _sbBkOpen\(\) \|\| _sbRecording \|\| \(rs && rs\.style\.display !== 'none'\)/.test(fn('_sbmCoachBusy')) &&
  /document\.getElementById\('sbmSheet'\) \|\| document\.getElementById\('sbmPrac'\) \|\| document\.getElementById\('sbmIntro'\)/.test(fn('_sbmCoachBusy')));
check('it says: double-tap the chords & lyrics to draw a remark', /<b>Double-tap<\/b> anywhere on the chords &amp; lyrics to draw a remark/.test(draw));
check('...then who sees it, Everyone the default', /When you finish, choose who sees it:/.test(draw) &&
  /<span class="sbm-coach__chip is-on"><i class="fa-solid fa-earth-asia"><\/i>Everyone<small>\(default\)<\/small><\/span>/.test(draw) &&
  /Only me/.test(draw) && /A group/.test(draw) && has(/'<button type="button" class="who-part' \+ \(c\[0\] === 'all' \? ' is-on' : ''\) \+ '"/));
check('Try it now goes to the words with the pen out; a tap anywhere closes it; nine seconds', /var L = _sbmCoachOpen\('draw', 9000\);/.test(draw) &&
  /if \(act && act\.getAttribute\('data-act'\) === 'try'\) sbmLayersDraw\(\);/.test(draw) && /_sbmCoachClose\('draw'\);/.test(draw));
check('closing the songbook takes any coach mark with it', /function closeSongbook\(\) \{\r?\n\s*_sbmCoachClose\(\);/.test(SRC));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
