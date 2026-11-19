'use strict';
// Regression harness: the Songbook's Refresh never loses the choir's takes.
//
// WHY THIS EXISTS
// From the operator (2026-11-19): "There was an instance yesterday during a
// choir practice that when someone made a change in the songbook and the rest
// of the users hit refresh, all the recordings were gone but only after they
// closed the app and reopened did they receive back all the data."
//
// Reproduced in Chromium and WebKit (2026-11-19), every write blocked:
//   - A save of the choir parts gives every line a NEW id, and the database
//     moves each take to its new line (gotcha 19). The other devices raise the
//     banner, and Refresh read the songs and the lines again but NOT the takes:
//     lhcVoiceRec still said "loaded", filed by the old ids, and every line's
//     badge read nought -- "Make Room" went from 18 takes to 0 -- until the
//     app was opened afresh. (Gotcha 22 had said it: anything that renumbers
//     lines must drop the flag. Only the device that saved did.)
//   - lhcVoiceRec.load emptied the store BEFORE its read, so a read that
//     failed, or was slow (one that fails takes about seven seconds), left
//     every badge at nought on a score drawn meanwhile.
// Now Refresh, and parts arriving from another device, forget the takes with
// the lines (_sbmTakesStale); a read keeps what is held until it lands, and a
// failed one is tried again on the 30-second check; and every view paints
// what the store holds at once, read or not (gotcha 108).
//
// USAGE
//   node tools/songbook-refresh-takes-harness.js                  # ../Index.html
//   node tools/songbook-refresh-takes-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show 534b99b:Index.html > x`): every check must then FAIL, except the
// ones marked "kept", which guard behaviour that was right already and must
// stay so in both.

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
// Right before the fix and after it alike.
function kept(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log((ok ? '  ok    (kept) ' : '  FAIL  (kept) ') + label);
  if (!ok) { console.log('          got  ' + JSON.stringify(got)); console.log('          want ' + JSON.stringify(want)); }
}
// The text of `head ... }` with its braces matched, from `from` on.
function slice(head, from) {
  const i = raw.indexOf(head, from || 0);
  if (i < 0) return null;
  let d = 0, started = false;
  for (let k = raw.indexOf('{', i); k < raw.length; k++) {
    const c = raw[k];
    if (c === '{') { d++; started = true; } else if (c === '}') { d--; if (started && !d) return raw.slice(i, k + 1); }
  }
  return null;
}
function run(src, ctx) { vm.createContext(ctx); vm.runInContext(src, ctx); return ctx; }
const tick = () => new Promise(r => setImmediate(r));

// ---------------------------------------------------------------------------
// 1. lhcVoiceRec.load keeps what it holds until its read lands
// ---------------------------------------------------------------------------
const REC = raw.indexOf('window.lhcVoiceRec = {');
const loadSrc = (function () {
  const at = raw.indexOf('  _draftsFor: function(songId) {', REC);
  const s = at < 0 ? null : slice('  load: function(songId) {', at);
  return s ? '(function ' + s.slice(s.indexOf('(songId)')) + ')' : null;
})();

// A store holding two takes of line L1 and a draft; a read we answer by hand.
function store() {
  let answer, fail, reads = 0;
  const R = {
    _takes: { S: { L1: [{ id: 't1', line_id: 'L1' }, { id: 't2', line_id: 'L1' }] } },
    _drafts: { S: [{ id: 'd1', line_id: null }] },
    _loaded: {},
    _sb: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => { reads++; return new Promise((res, rej) => { answer = res; fail = rej; }); } }) }) }) })
  };
  const ctx = run('var load = ' + loadSrc + ';', { window: { lhcVoiceRec: R }, Promise });
  R.load = ctx.load;
  const count = () => Object.keys(R._takes.S || {}).reduce((n, k) => n + R._takes.S[k].length, 0) + (R._drafts.S || []).length;
  return { R, count, answer: x => answer(x), fail: e => fail(e), reads: () => reads };
}

async function partLoad() {
  console.log('the takes held stay until the read has come back with what replaces them');
  if (!loadSrc) { check('lhcVoiceRec.load is found', false, true); return; }
  {
    const t = store(); const p = t.R.load('S');
    check('while the read is out, the takes held are still there', t.count(), 3);
    t.answer({ error: { message: 'Failed to fetch' } }); await p;
    check('a read that failed leaves them as they were, and not "loaded"', [t.count(), !!t.R._loaded.S], [3, false]);
  }
  {
    const t = store(); const p = t.R.load('S');
    t.fail(new Error('network')); await p;
    check('a read that threw leaves them too', t.count(), 3);
  }
  {
    const t = store(); const p = t.R.load('S');
    // Deleted here while the read was out, as R.del does: from wherever it is held.
    Object.keys(t.R._takes.S).forEach(k => { t.R._takes.S[k] = t.R._takes.S[k].filter(x => x.id !== 't2'); });
    t.answer({ data: [{ id: 't1', line_id: 'L1n' }, { id: 't2', line_id: 'L1n' }, { id: 'd1', line_id: null }] }); await p;
    check('a take deleted while the read was out stays deleted', Object.keys(t.R._takes.S).map(k => k + ':' + t.R._takes.S[k].map(x => x.id).join(',')), ['L1n:t1']);
  }
  {
    const t = store(); const p = t.R.load('S');
    (t.R._takes.S.L9 = t.R._takes.S.L9 || []).push({ id: 'new', line_id: 'L9' });   // recorded here while the read was out
    t.answer({ data: [{ id: 't1', line_id: 'L1n' }] }); await p;
    kept('a take recorded while the read was out is kept', (t.R._takes.S.L9 || []).map(x => x.id), ['new']);
  }
  {
    const t = store(); const p = t.R.load('S');
    t.answer({ data: [{ id: 't1', line_id: 'L1n' }, { id: 't2', line_id: 'L1n' }, { id: 'd2', line_id: null }] }); await p;
    kept('a read that lands files each take under the line it names now',
      [Object.keys(t.R._takes.S), t.R._takes.S.L1n.length, t.R._drafts.S.map(x => x.id), !!t.R._loaded.S], [['L1n'], 2, ['d2'], true]);
  }
  {
    const t = store(); t.R.load('S'); t.R.load('S');
    kept('two pages asking at once make one read', t.reads(), 1);
  }
}

// ---------------------------------------------------------------------------
// 2. The Songbook forgets the takes wherever it reads the lines again
// ---------------------------------------------------------------------------
function partStale() {
  console.log('\nRefresh, and parts arriving from another device, read the takes again with the lines');
  const stale = slice('  function _sbmTakesStale(base) {');
  if (!stale) { check('_sbmTakesStale is found', false, true); }
  else {
    const R = { _loaded: { A: true, B: true } }, at = { A: 1, B: 1 };
    const ctx = run(stale, { window: { lhcVoiceRec: R }, _sbmRecsAt: at });
    ctx._sbmTakesStale('A');
    check('_sbmTakesStale forgets the song\'s takes and its Tracks list, and nothing else', [R._loaded, at], [{ B: true }, { B: 1 }]);
  }
  const refresh = slice('  function sbmLiveRefresh() {') || '';
  check('Refresh forgets each song\'s takes with its lines',
    /ids\.forEach\(function\(b\) \{ delete _sbVoiceLines\[b\]; delete _sbVoiceWanted\[b\]; _sbmTakesStale\(b\);/.test(refresh), true);
  const arrived = slice('  function _sbmChoirArrived(bases) {') || '';
  check('parts set up on another device: the takes are read again too',
    /delete _sbVoiceWanted\[b\]; delete _sbVoiceRetryAt\[b\];\s*_sbmTakesStale\(b\);/.test(arrived), true);
}

// ---------------------------------------------------------------------------
// 3. _sbmRecRefresh(base, quiet): another device's change is not announced as ours
// ---------------------------------------------------------------------------
function partQuiet() {
  console.log('\nanother device\'s change is read again quietly');
  const src = slice('  function _sbmRecRefresh(base');
  if (!src) { check('_sbmRecRefresh is found', false, true); return; }
  function go(quiet) {
    const said = [];
    const R = { _loaded: { A: true }, load: () => Promise.resolve({}), paintAll: () => {}, _changed: b => said.push(b) };
    const ctx = run(src, { window: { lhcVoiceRec: R }, _sbmRecsAt: { A: 1 }, document: { querySelectorAll: () => [] },
      _sbmSong: () => null, _sbmLoadRecs: () => {}, _sbRecCurrentSongId: null, Promise });
    ctx._sbmRecRefresh('A', quiet);
    return said;
  }
  check('quiet: no "changed" broadcast as if this device had made it', go(true), []);
  kept('not quiet (a take recorded or deleted here): announced, as before', go(false), ['A']);
}

// ---------------------------------------------------------------------------
// 4. The 30-second check: other songs forgotten, a failed read tried again
// ---------------------------------------------------------------------------
async function partCheck() {
  console.log('\nthe 30-second check');
  const src = slice('  function _sbmLiveCheck(adopt) {');
  const diff = slice('  function _sbmLiveDiff(seen, cur) {');
  const stale = slice('  function _sbmTakesStale(base) {') || 'function _sbmTakesStale() {}';
  if (!src || !diff) { check('_sbmLiveCheck is found', false, true); return; }
  async function go(o) {
    const refreshed = [];
    const R = { _loaded: Object.assign({ A: true, B: true, C: true }, o.loaded || {}), _loading: o.loading || {},
      loaded: id => !!R._loaded[id] };
    const seen = { marks: 'm', recs: 'r', lines: 'l', songs: 's', book: 'b', parts: 'p' };
    const fp = Object.assign({}, seen, o.fp || {});
    const L = { ids: ['A', 'B', 'C'], seen: Object.assign({}, seen) };
    const ctx = { window: { lhcVoiceRec: R }, Date, setTimeout: () => 0, clearTimeout: () => {}, Promise,
      _sbmLiveOwnAt: 0, _sbmMarksAt: {}, _sbmRecsAt: { A: 1, B: 1, C: 1 }, _sbmLoadMarks: () => {},
      _sbmLiveFingerprint: () => Promise.resolve(fp), _sbmPartsArrived: () => [], _sbmChoirArrived: () => {},
      _sbmSong: () => ({ id: 'A-copy' }), _sbBaseSongId: () => 'A', _sbmLiveBanner: () => {},
      _sbmRecRefresh: (b, quiet) => refreshed.push(b + (quiet ? ' quietly' : '')) };
    ctx._sbmLive = L;
    run(diff + '\n' + stale + '\n' + src, ctx);
    ctx._sbmLiveCheck(false);
    await tick(); await tick();
    return { refreshed, loaded: Object.keys(R._loaded).filter(k => R._loaded[k]) };
  }
  const recs = await go({ fp: { recs: 'r2' } });
  check('takes changed elsewhere: the song in front read again quietly, the others forgotten till shown',
    recs, { refreshed: ['A quietly'], loaded: ['A'] });
  const failed = await go({ loaded: { A: false } });
  check('nothing changed, but the song\'s last read failed: it is tried again', failed.refreshed, ['A quietly']);
  kept('nothing changed and the takes are read: nothing is asked', (await go({})).refreshed, []);
  kept('...nor while a read is still out', (await go({ loaded: { A: false }, loading: { A: true } })).refreshed, []);
}

// ---------------------------------------------------------------------------
// 5. Every view paints what the store holds at once
// ---------------------------------------------------------------------------
async function partPaint() {
  console.log('\nevery view paints what it holds at once, and the read repaints');
  const src = slice('  function sbBindChoirRecorders() {');
  if (!src) { check('sbBindChoirRecorders is found', false, true); return; }
  const painted = [];
  let landed;
  const mk = n => ({ n, getAttribute: k => (k === 'data-choir-song' ? 'S' : ''), closest: () => ({}) });
  const pages = [mk('score'), mk('printed')];
  const R = { loaded: () => false, bind: () => {}, paintAll: p => painted.push(p.n), load: () => new Promise(r => { landed = r; }) };
  const ctx = run(src, { window: { lhcVoiceRec: R }, Promise,
    document: { querySelectorAll: () => pages, querySelector: () => pages[0] } });
  ctx.sbBindChoirRecorders();
  check('a score drawn while the takes are being read shows what is held', painted.slice(), ['score', 'printed']);
  painted.length = 0; landed({}); await tick();
  check('when the read lands, every page of the song is painted, not only the first', painted.slice(), ['score', 'printed']);
  check('the reading view\'s lyrics card paints at once too',
    /R\.bind\(ly, base\);\s*R\.paintAll\(ly\);[^\n]*\n\s*if \(!R\.loaded\(base\)\) R\.load\(base\)/.test(raw), true);
  check('...and the song library\'s Choir parts tab',
    /window\.lhcVoiceRec\.bind\(container, currentLyricsPreviewSong\.id\);\s*window\.lhcVoiceRec\.paintAll\(container\);[^\n]*\n\s*if \(!window\.lhcVoiceRec\.loaded\(currentLyricsPreviewSong\.id\)\) \{/.test(raw), true);
}

(async () => {
  await partLoad();
  partStale();
  partQuiet();
  await partCheck();
  await partPaint();
  console.log('\n================================');
  const passed = results.filter(Boolean).length;
  console.log(passed + '/' + results.length + ' checks passed' + (EXPECT_BROKEN ? ' (as broken)' : ''));
  if (passed !== results.length) process.exit(1);
})().catch(e => { console.log('  FAIL  the harness threw: ' + (e && e.stack || e)); process.exit(1); });
