'use strict';
// Harness for the Songbook's coach marks (2026-11-07). From the operator,
// for phones and desks alike:
//
//   1. the scroll-down flash, on a desk too whenever the words are not yet up
//      the screen. 2026-11-08: "only the first time the songbook is
//      accessed" -- once on each device -- and 2.5 seconds. The floater
//      ("Scroll down for lyrics / chords") no longer waits for the flash:
//      every song opened with its words not yet up the screen gets it, on a
//      desk too (after #409 it had stopped appearing on a desk after a reload);
//   2. when the recordings sheet opens, four seconds pointing at what kind of
//      take it is (whole song, an instrument, a voice part; a section has its
//      own mic in the song) and at Record;
//   3. when a take is stopped, arrows to Tracks, where it plays back;
//   4. ten seconds into a songbook (it was two minutes), how to draw a remark:
//      no card (2026-11-08) -- a finger double-tapping a word of the song, a
//      ring drawing itself round it, arrows up to the Draw chip.
//
// 2 and 3 show once each time the app is opened; 1 and 4 once on each
// device; none in the desk's Phone view.
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
console.log('\n1. The scroll-down flash: the first songbook on the device');
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
check('kept on the device: once there, ever', /return !_sbmIntroDone && !window\.__SBM_PREVIEW && !_sbmSeenHere\('lhc_sbm_intro_seen_v2'\);/.test(fn('_sbmIntroDue')) &&
  /_sbmIntroDone = true;\r?\n\s*_sbmSeenMark\('lhc_sbm_intro_seen_v2'\);/.test(fn('_sbmIntroShow')));
{
  // The floater, run: a desk 768px tall, the flash already seen on this device.
  let G = null;
  try {
    extractVar('_sbmGuideSong');
    G = env => new Function('document', 'Date', '_sbmBookOpen', '_sbmActive', '_sbmDraw', '_sbBkOpen', '_sbmIntroDue', '_sbmIntroShow', '_sbmIntroUp',
      extractVar('_sbmGuideOn') + '\n' + extractVar('_sbmGuideSong') + '\n' + ['_sbmGuideWant', '_sbmIntroWant', '_sbmGuideCheck'].map(extractFn).join('\n') +
      '\nreturn { check: _sbmGuideCheck, arm: function(t) { _sbmGuideFresh = t; }, fresh: function() { return _sbmGuideFresh; } };')(
      env.document, env.Date, () => true, () => true, null, () => false, () => false, () => {}, () => false);
  } catch (e) { G = null; }
  if (!G) check('the floater is armed by a song being opened', false);
  else {
    let top = 533, now = 1000000;
    const g = { on: false, classList: { toggle(c, v) { if (c === 'is-on') g.on = !!v; } }, setAttribute() {} };
    const words = { getBoundingClientRect: () => ({ top: top, bottom: top + 2400 }) };
    const env = { Date: { now: () => now }, document: { getElementById: id => id === 'sbmGuide' ? g : id === 'sbmRoot' ? { getBoundingClientRect: () => ({ top: 0, height: 768 }) } : id === 'sbmWordsCard' ? { querySelector: () => words } : null } };
    const api = G(env);
    api.check();
    check('a desk, the flash already seen, the words halfway down, nothing opened just now: no floater (the old way, which it was stuck in)', g.on === false);
    api.arm(now); api.check();
    check('...a song just opened there: the floater', g.on === true);
    top = 90; api.check();
    check('...gone once the words are up the screen', g.on === false);
    top = 533; now += 60000; api.check();
    check('...and not back when scrolled up halfway later: it comes back only when they are near the foot again', g.on === false);
    top = 700; api.check();
    check('...which brings it back', g.on === true);
    top = 90; api.check(); api.arm(now); api.check();
    check('a song opened with its words already up the screen: no floater', g.on === false);
    now += 2000; top = 533; api.check();
    check('...and the arming lapses: scrolled up later, still none', g.on === false && api.fresh() === 0);
    top = 40; api.arm(now); api.check(); now += 400; top = 533; api.check();
    check('a page still settling just after a render: the arming waits a moment for the words to land', g.on === true);
  }
  check('a song is armed when the book opens or another song is shown, and again when the book is opened again',
    /if \(song && song\.id !== _sbmGuideSong\) \{ _sbmGuideSong = song\.id; _sbmGuideFresh = Date\.now\(\); \}/.test(fn('_sbmGuideUpdate')) &&
    /function closeSongbook\(\) \{\r?\n\s*_sbmCoachClose\(\);\r?\n\s*_sbmGuideSong = null;/.test(SRC));
}
// 2026-11-08: every device given both once more (fresh keys), and More >
// Show the tips again plays them whenever asked.
check('fresh keys, so every device sees the card and the drawing hint once more', has(/_sbmSeenHere\('lhc_sbm_intro_seen_v2'\)/) &&
  has(/var _SBM_COACH_ONCE = \{ draw: 'lhc_sbm_draw_hint_seen_v2',/) && !has(/'lhc_sbm_intro_seen'\)/) && !has(/draw: 'lhc_sbm_draw_hint_seen' \}/));
{
  const rp = fn('sbmReplayTips');
  check('Show the tips again is in More whenever a song is in front', has(/if \(song\) rows\.push\(\['fa-lightbulb', 'Show the tips again: where the words are, and how to draw', 'WO\.sbmCloseSheet\(\);WO\.sbmReplayTips\(\)'/) &&
    has(/sbmReplayTips: sbmReplayTips,/));
  check('...it puts the song back at its top and plays the card, whatever the device has seen',
    /root\.scrollTop = 0;/.test(rp) && /\r?\n\s*_sbmIntroShow\(\);\r?\n\s*\}\r?$/.test(rp) && /if \(_sbmDraw\) sbmDraw\(false\);/.test(rp));
  check('...then, once the card has gone, brings the words up and plays the drawing hint on them',
    /var then = _sbmReplayThen; _sbmReplayThen = null;\r?\n\s*if \(then\) then\(\);/.test(fn('_sbmIntroEnd')) &&
    /_sbmGuideGo\(\);/.test(rp) && /if \(_sbmCoachDrawAt\(\)\) \{ _sbmCoachDraw\(true\); _sbmReplayRecall\(\); return; \}/.test(rp) && /if \(\+\+tries === 6\) _sbmGuideGo\(true\);\r?\n\s*if \(tries < 12\) setTimeout\(hint, 250\);/.test(rp) && /var smooth = !instant && /.test(fn('_sbmGuideGo')));
  check('...the drawing hint played on request even where it has been seen', /if \(\(!force && !_sbmCoachDue\('draw'\)\) \|\| !_sbmCoachDrawAt\(\)\) return;/.test(fn('_sbmCoachDraw')));
  let R = null;
  try {
    extractFn('sbmReplayTips');
    R = env => new Function('document', 'setTimeout', '_sbmBookOpen', '_sbmSong', '_sbmCloseSheet', '_sbmCoachClose', '_sbmDraw', 'sbmDraw', '_sbmGuideGo', '_sbmCoachDrawAt', '_sbmCoachDraw', '_sbmIntroShow', '_sbmMarksOk', 'clearTimeout', '_sbmIntroT', '_sbmGuideCheck', '_sbmReplayRecall',
      extractVar('_sbmReplayThen') + '\n' + extractFn('sbmReplayTips') + '\n' + extractFn('_sbmIntroEnd') + '\nreturn { replay: sbmReplayTips, end: _sbmIntroEnd };')(
      env.document, env.setTimeout, () => true, () => ({ id: 's1' }), () => {}, () => {}, null, () => {}, env.go, env.at, env.draw, env.show, true, () => {}, 0, () => {}, () => {});
  } catch (e) { R = null; }
  if (!R) check('the replay runs', false);
  else {
    const log = [], timers = [], root = { scrollTop: 900 };
    let atTries = 0;
    const env = { document: { getElementById: id => id === 'sbmRoot' ? root : null }, setTimeout: (f) => { timers.push(f); return timers.length; },
      go: inst => log.push(inst ? 'jump' : 'go'), show: () => log.push('card'), draw: f => log.push('hint:' + f), at: () => (++atTries >= 3 ? { word: {} } : null) };
    const api = R(env);
    api.replay();
    check('replayed: the song at its top and the card up, the hint not yet', root.scrollTop === 0 && log.join() === 'card', log.join());
    api.end();
    while (timers.length) timers.shift()();
    check('...the card gone: the words brought up, and the hint once they are in sight', log.join() === 'card,go,hint:true' && atTries === 3, log.join() + ' / tries ' + atTries);
    api.end();
    check('...and an ordinary end of the card afterwards plays nothing more', log.join() === 'card,go,hint:true');
    // A browser whose smooth scroll never gets there: the words are jumped to.
    log.length = 0; atTries = -100; let jumped = false;
    const env2 = Object.assign({}, env, { go: inst => { log.push(inst ? 'jump' : 'go'); if (inst) jumped = true; }, at: () => (jumped ? { word: {} } : null) });
    const api2 = R(env2); api2.replay(); api2.end();
    while (timers.length) timers.shift()();
    check('...and when a smooth scroll never gets there, the words are jumped to and the hint still plays', log.join() === 'card,go,jump,hint:true', log.join());
  }
}
check('two and a half seconds, the bar that counts them down too', /_sbmIntroT = setTimeout\(_sbmIntroEnd, 2500\);/.test(fn('_sbmIntroShow')) &&
  has(/\.sbm-intro__time span \{[^}]*animation: sbmIntroTime 2\.5s linear forwards; \}/) && !has(/sbmIntroTime 5s/));

// ------------------------------------------------------------ the coach layer
console.log('\nThe coach layer');
let C = null;
try {
  C = function(win, doc, timers, ls) {
    const body = extractVar('_sbmCoachSeen') + '\n' + extractVar('_SBM_COACH_ONCE') + '\n' +
      ['_sbmSeenHere', '_sbmSeenMark', '_sbmCoachDue', '_sbmCoachOpen', '_sbmCoachClose', '_sbmCoachPlace', '_sbmCoachFrame'].map(extractFn).join('\n') +
      '\nreturn { due: _sbmCoachDue, open: _sbmCoachOpen, close: _sbmCoachClose, frame: _sbmCoachFrame, seen: _sbmCoachSeen };';
    const store = ls || { getItem: () => null, setItem: () => {} };
    return new Function('window', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'localStorage', body)(win, doc, timers.st, timers.ct, timers.si, timers.ci, store);
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
  const kept = {}, LS = { getItem: k => (k in kept ? kept[k] : null), setItem: (k, v) => { kept[k] = String(v); } };
  const day1 = C(win, doc, T, LS);
  check('the drawing hint is due on a device that has never seen it', day1.due('draw') === true);
  day1.open('draw', 7000); day1.close('draw');
  const day2 = C(win, doc, T, LS);
  check('...and never again there, the app opened again; the others are due again',
    !!kept.lhc_sbm_draw_hint_seen_v2 && day2.due('draw') === false && day2.due('record') === true && day2.due('tracks') === true, JSON.stringify(kept));
  const priv = C(win, doc, T, { getItem: () => { throw new Error('no storage'); }, setItem: () => { throw new Error('no storage'); } });
  check('a browser that keeps nothing: still once while the app stays open', priv.due('draw') === true && (priv.open('draw', 7000), priv.due('draw') === false));
  priv.close('draw');
  const node = { style: {} };
  api.frame(node, { left: 26, top: 599, width: 323, height: 40 }, 6);
  check('a ring is drawn round its target, a little outside it', node.style.left === '20px' && node.style.top === '593px' && node.style.width === '335px' && node.style.height === '52px', JSON.stringify(node.style));
  const op = fn('_sbmCoachOpen'), cl = fn('_sbmCoachClose');
  check('it follows what it points at, and goes by itself', /el\.__iv = setInterval\(_sbmCoachPlace, 200\);/.test(op) && /el\.__t = setTimeout\(function\(\) \{ _sbmCoachClose\(key\); \}, ms\);/.test(op) &&
    /clearTimeout\(el\.__t\); clearInterval\(el\.__iv\); el\.remove\(\);/.test(cl) &&
    /if \(el\.__off\) document\.removeEventListener\('pointerdown', el\.__off, true\);/.test(cl));
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
console.log('\n4. Ten seconds into a songbook: how to draw, on the words themselves');
let K = null;
try {
  K = function(env) {
    const body = extractVar('_sbmCoachSeen') + '\n' + extractVar('_SBM_COACH_ONCE') + '\n' + extractVar('_sbmCoachClock') + '\n' + extractVar('_SBM_DRAW_HINT_AFTER') + '\n' +
      ['_sbmSeenHere', '_sbmSeenMark', '_sbmCoachDue', '_sbmCoachTick'].map(extractFn).join('\n') +
      '\nreturn { tick: _sbmCoachTick, clock: _sbmCoachClock, seen: _sbmCoachSeen };';
    const names = Object.keys(env);
    return new Function(...names, body)(...names.map(k => env[k]));
  };
} catch (e) { K = null; }
if (!K) check('the ten seconds are kept by a function of its own', false);
else {
  let now = 1000000; const S = { open: true, active: true, busy: false, shown: 0, hidden: false, at: { word: {} } };
  const env = { Date: { now: () => now }, document: { get hidden() { return S.hidden; } }, window: {}, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    _sbmBookOpen: () => S.open, _sbmActive: () => S.active, _sbmCoachBusy: () => S.busy, _sbmMarksOk: true,
    _sbmCoachDrawAt: () => S.at, _sbmCoachDraw: () => { S.shown++; } };
  let k = null; try { k = K(env); } catch (e) { k = null; }
  if (!k) check('the ten seconds are kept by a function of its own', false); else {
  k.clock.last = now;
  const run = (n, step) => { for (let i = 0; i < n; i++) { now += step; k.tick(); } };
  run(9, 1000);
  check('under ten seconds open: nothing yet', S.shown === 0 && k.clock.ms === 9000, k.clock.ms);
  S.hidden = true; run(10, 1000); S.hidden = false;
  check('time in another tab does not count', S.shown === 0 && k.clock.ms === 9000);
  S.open = false; run(10, 1000); S.open = true;
  check('...nor time with the songbook closed', S.shown === 0 && k.clock.ms === 9000);
  now += 3600000; k.tick();
  check('a long gap counts as two seconds at most; at ten seconds it shows', k.clock.ms === 11000 && S.shown === 1, k.clock.ms + ' / ' + S.shown);
  const k2 = K(Object.assign({}, env, { _sbmCoachDraw: () => { S.shown2 = (S.shown2 || 0) + 1; } }));
  S.busy = true; k2.clock.last = now; for (let i = 0; i < 30; i++) { now += 1000; k2.tick(); }
  check('at ten seconds, while the reader is busy (drawing, a sheet, recording, the flash): it waits', !S.shown2);
  S.busy = false; S.at = null; for (let i = 0; i < 5; i++) { now += 1000; k2.tick(); }
  check('...and while the song\'s words are out of sight', !S.shown2);
  S.at = { word: {} }; now += 1000; k2.tick();
  check('...and shows once they are in sight and the reader is free', S.shown2 === 1);
  const k3 = K(Object.assign({}, env, { _sbmMarksOk: null, _sbmCoachDraw: () => { S.shown3 = 1; } }));
  k3.clock.last = now; for (let i = 0; i < 20; i++) { now += 1000; k3.tick(); }
  check('not before drawing is known to be there (no Draw chip yet)', !S.shown3);
  }
}
const draw = fn('_sbmCoachDraw');
check('the clock starts with the book, ticking each second, ten of them', /\/\/ The ten seconds before the drawing hint start with the book\.\r?\n\s*_sbmCoachClockStart\(\);/.test(fn('_sbmGuideUpdate')) &&
  /_sbmCoachClock\.t = setInterval\(_sbmCoachTick, 1000\);/.test(fn('_sbmCoachClockStart')) && /var _SBM_DRAW_HINT_AFTER = 10000;/.test(SRC));
check('busy means drawing, typing, Book Mode, recording, a sheet, Tracks, the flash or another coach mark',
  /_sbmDraw \|\| _sbNp \|\| _sbBkOpen\(\) \|\| _sbRecording \|\| \(rs && rs\.style\.display !== 'none'\)/.test(fn('_sbmCoachBusy')) &&
  /document\.getElementById\('sbmSheet'\) \|\| document\.getElementById\('sbmPrac'\) \|\| document\.getElementById\('sbmIntro'\)/.test(fn('_sbmCoachBusy')));
check('no card: the yellow card, its chips and buttons are gone', !/sbm-coach__card/.test(draw) && !/data-act=/.test(draw) && !has(/\.sbm-coach__card--draw/) && !has(/function _sbmCoachArt/));
// A hold draws since 2026-11-11 (gotcha 84); a double-tap edits.
check('a finger on a word of the song, holding while a ring fills round it, then a ring drawing itself round the word',
  /fa-hand-pointer sbm-hint__finger/.test(draw) && /<svg class="sbm-hint__hold"/.test(draw) && /<svg class="sbm-hint__ring"/.test(draw) &&
  !/sbm-hint__ripple/.test(draw) && has(/@keyframes sbmHintHold \{/) && has(/@keyframes sbmHintHoldFill \{/) &&
  has(/\.sbm-hint__ring ellipse \{ stroke-dasharray: 100; stroke-dashoffset: 100; animation: sbmHintRing/));
check('it says what to do, under the finger: hold the words 2 seconds to draw', /<b>Hold<\/b> the words 2 seconds to draw/.test(draw) && !/Double-tap/.test(draw));
check('...and points up at the Draw chip when it is in sight: a ring round it, arrows, "or tap Draw"',
  /_sbmCoachFrame\(parts\[0\], c, 5\);/.test(draw) && /sbm-coach__arrows sbm-hint__arrows/.test(draw) && /or tap <b>Draw<\/b>/.test(draw) &&
  /var chip = card\.querySelector\('\.sbm-chip--draw'\)/.test(fn('_sbmCoachDrawAt')));
check('it points at a lyric line or a line of the choir score wholly on the screen, clear of the floater',
  /card\.querySelectorAll\('\.wo-lyrics-lyric-line, \.vl-words'\)/.test(fn('_sbmCoachDrawAt')) && /r\.top < top \+ 8 \|\| r\.bottom > bottom - 90/.test(fn('_sbmCoachDrawAt')));
check('every tap goes through it -- a double-tap draws -- and takes it away; drawing takes it away; seven seconds',
  /var L = _sbmCoachOpen\('draw', 7000\);/.test(draw) && /document\.addEventListener\('pointerdown', L\.__off, true\);/.test(draw) &&
  /if \(_sbmDraw \|\| !_sbmBookOpen\(\)\) \{ _sbmCoachClose\('draw'\); return; \}/.test(draw) && has(/\.sbm-coach \{ position: fixed; inset: 0; z-index: 3800; pointer-events: none;/));
check('it follows the words while they scroll, and hides while they are out of sight', /L\.classList\.toggle\('is-away', !A\);/.test(draw) && has(/\.sbm-coach--hint\.is-away > \* \{ visibility: hidden; \}/));
check('closing the songbook takes any coach mark with it', /function closeSongbook\(\) \{\r?\n\s*_sbmCoachClose\(\);/.test(SRC));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
