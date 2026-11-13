'use strict';
// Harness for the smaller leftovers of the Songbook review (2026-11-13,
// CLAUDE.md gotcha 95), run on the real functions sliced out of Index.html:
//   - "Choir parts were set up on another device" said once, not twice
//     (the broadcast and the 30-second check both bring the news);
//   - the song form's Era / Decade is kept (in display_style: no column);
//   - the Edit Song form writes the words only when they were changed in
//     it, and refuses words changed here AND stored changed since;
//   - the song library's own lyrics and choir parts saves check what is
//     stored, go through the Songbook's write, and hold the song.
// The poll's clock skew is checked in songbook-live-harness.js.
//
// USAGE
//   node tools/songbook-small-fixes-harness.js
//   node tools/songbook-small-fixes-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const fn = name => { const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };
const top = name => { const m = SRC.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\) \\{[^]*?\\n\\}')); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 600) : '')); }
}
const J = JSON.stringify;
process.on('unhandledRejection', e => { check('no unexpected error', false, String(e && e.stack || e)); console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(1); });
const tick = () => new Promise(r => setTimeout(r, 0));

if (!top('_songStyleWithEra') || !/var _sbmChoirGotAt = \{\};/.test(SRC)) {
  if (EXPECT_BROKEN) { console.log('--expect-broken: the fixes are absent, as expected.'); process.exit(0); }
  console.log('FAIL the fixes are not in ' + path.basename(INDEX)); process.exit(1);
}
if (EXPECT_BROKEN) { console.log('\nBUT --expect-broken was given and the fixes are present.'); process.exit(1); }

(async () => {
  // ---------------------------------------------------------------------
  console.log('\n1. "Set up on another device" is said once');
  const arrivedEnv = () => new Function('ctx', `
    var window = { SBQ_VOICE_LINES: { forSong: function(b) { ctx.reads.push(b); return ctx.fail ? Promise.reject(new Error('x')) : Promise.resolve([{ id: 1 }]); } }, STATE: ctx.STATE }, STATE = ctx.STATE, songOrderSections = ctx.copies;
    var _sbVoiceLines = {}, _sbVoiceWanted = {}, _sbVoiceRetryAt = {}, _sbmLive = {};
    var _sbmChoirGotAt = {};
    function _sbBaseSongId(s) { return s.songId; }
    function _sbmBookOpen() { return true; }
    function _sbmSong() { return ctx.copies[0]; }
    function renderSongbookLive() {}
    function showToast(m) { ctx.toasts.push(m); }
    function _sbmLiveCheck() {}
    ${fn('_sbmChoirShow')}
    ${fn('_sbmChoirArrived')}
    return _sbmChoirArrived;`);
  const mk = () => ({ STATE: { songs: [{ id: 'A' }] }, copies: [{ id: 'a', songId: 'A' }], toasts: [], reads: [], fail: false });
  let c = mk(), arrive = arrivedEnv()(c);
  await arrive(['A']); await arrive(['A']);
  check('the broadcast, then the check: one toast, one read', c.toasts.length === 1 && c.reads.length === 1, J(c));
  c = mk(); arrive = arrivedEnv()(c);
  const p1 = arrive(['A']), p2 = arrive(['A']); await p1; await p2;
  check('both at once: still one', c.toasts.length === 1 && c.reads.length === 1, J(c));
  c = mk(); arrive = arrivedEnv()(c); c.fail = true;
  await arrive(['A']); c.fail = false; await arrive(['A']);
  check('a read that failed can be tried again by the next check', c.toasts.length === 1 && c.reads.length === 2, J(c));
  check('the device that set them up takes its own news as known', /var bases = done\.map\(_sbBaseSongId\);\n\s*bases\.forEach\(function\(b\) \{ _sbmChoirGotAt\[b\] = Date\.now\(\); \}\);/.test(fn('sbmChoirStart')));

  // ---------------------------------------------------------------------
  console.log('\n2. The era is kept');
  const E = new Function(top('_songStyleWithEra') + '\nreturn _songStyleWithEra;')();
  check('an era chosen goes into display_style, every other key kept', J(E({ lyricFont: 'Lato' }, { era: '1990s, 2000s' })) === J({ lyricFont: 'Lato', era: '1990s, 2000s' }));
  check('an era cleared is taken out', J(E({ era: '1990s', a: 1 }, { era: '' })) === J({ a: 1 }));
  check('a song that says nothing of era keeps the stored one', J(E({ era: '1990s' }, { title: 'x' })) === J({ era: '1990s' }));
  check('...and the stored object is never changed in place', (() => { const ds = { a: 1 }; E(ds, { era: 'x' }); return J(ds) === J({ a: 1 }); })());
  const toRow = new Function(top('_songStyleWithEra') + '\n' + top('songToRow') + '\nreturn songToRow;')();
  check('a new song is written with its era', toRow({ id: 's', title: 't', era: '2010s', display_style: {} }).display_style.era === '2010s');
  const norm = new Function(top('normalizeSongFromSupabase') + '\nreturn normalizeSongFromSupabase;')();
  check('...and read back as the song\'s era', norm({ id: 's', title: 't', display_style: { era: '2010s' } }).era === '2010s' && norm({ id: 's', title: 't' }).era === '');
  check('normalizeSong carries it too', /era: String\(s\.era \|\| \(s\.display_style && typeof s\.display_style === 'object' && s\.display_style\.era\) \|\| ''\)\.trim\(\),/.test(fn('normalizeSong')));

  // ---------------------------------------------------------------------
  console.log('\n3. The Edit Song form writes the words only when they were changed in it');
  const sStart = SRC.indexOf('\nvar SBQ_SONGS = {');
  const sbqSrc = SRC.slice(sStart, SRC.indexOf('\n};', sStart) + 3);
  function fakeSb(row, o) {
    o = o || {};
    const log = [];
    return {
      log,
      from(table) {
        const q = { table, op: 'select', patch: null, cols: '' };
        const api = {
          select(c) { q.cols = c || ''; return api; },
          update(p) { q.op = 'update'; q.patch = JSON.parse(JSON.stringify(p)); return api; },
          eq() { return api; }, maybeSingle() { return api; }, single() { return api; },
          then(res, rej) {
            log.push(q);
            if (q.op === 'update') { Object.assign(row, q.patch); return Promise.resolve({ error: null }).then(res, rej); }
            if (o.readFails) return Promise.resolve({ error: { message: 'offline' }, data: null }).then(res, rej);
            return Promise.resolve({ error: null, data: JSON.parse(JSON.stringify(row)) }).then(res, rej);
          }
        };
        return api;
      },
      channel() { return { subscribe() {}, send() { return Promise.resolve(); } }; },
      removeChannel() {}
    };
  }
  const songs = sb => new Function('getSupabaseClient', top('_songStyleWithEra') + '\n' + top('songToRow') + '\n' + sbqSrc.replace(/^\n/, '') + '\nreturn SBQ_SONGS;')(() => sb);
  let row = { id: 's1', title: 'T', lyrics: 'theirs, saved at half past', display_style: { recInstruments: 4 } };
  let sb = fakeSb(row), S = songs(sb);
  let r = await S.updateForm({ id: 's1', title: 'New', lyrics: 'as opened at nine', era: '1990s' }, { openedLyrics: 'as opened at nine' });
  let up = sb.log.filter(q => q.op === 'update').pop();
  check('words left as they were opened are not written', !('lyrics' in up.patch) && row.lyrics === 'theirs, saved at half past' && r.wordsKept === true, J(up.patch));
  check('...the rest of the form is', row.title === 'New');
  check('...and the era goes into display_style, read fresh, its other keys kept', row.display_style.era === '1990s' && row.display_style.recInstruments === 4, J(row.display_style));
  row = { id: 's1', title: 'T', lyrics: 'theirs, saved at half past', display_style: {} };
  sb = fakeSb(row); S = songs(sb);
  let err = null;
  try { await S.updateForm({ id: 's1', title: 'New', lyrics: 'mine, typed at ten' }, { openedLyrics: 'as opened at nine' }); } catch (e) { err = e; }
  check('words changed here AND stored changed since: refused, nothing written',
    err && err.code === 'changed' && err.stored === 'theirs, saved at half past' && !sb.log.some(q => q.op === 'update') && row.title === 'T', err && err.message);
  row = { id: 's1', title: 'T', lyrics: 'as opened at nine\r\n', display_style: {} };
  sb = fakeSb(row); S = songs(sb);
  await S.updateForm({ id: 's1', title: 'T', lyrics: 'mine, typed at ten' }, { openedLyrics: 'as opened at nine' });
  check('words changed only here are written (line endings are not a change)', row.lyrics === 'mine, typed at ten');
  check('the same words, pure', S.sameWords('a\r\nb  \n', 'a\nb') && !S.sameWords('a', 'b') && S.sameWords(null, ''));
  check('the form remembers what it opened on and hands it to the save',
    /_asmOpenedLyrics = String\(song\.lyrics \|\| ''\);/.test(fn('openEditSongModal')) && /SBQ_SONGS\.updateForm\(songData, \{ openedLyrics: _asmOpenedLyrics \}\)/.test(fn('saveEditSong')));
  check('...and a refusal keeps the form open and says so', /err && err\.code === 'changed'[^]*?_asmOpenedLyrics = String\(err\.stored \|\| ''\);[^]*?showToast\([^]*?'warning'[^]*?return;/.test(fn('saveEditSong')));

  console.log('\n4. The song library\'s lyrics save checks what is stored');
  const calls = [];
  row = { id: 's2', lyrics: 'theirs' }; sb = fakeSb(row); S = songs(sb);
  S.updateLyrics = (id, l) => { calls.push(l); return Promise.resolve({ success: true }); };
  err = null; try { await S.updateLyricsChecked('s2', 'mine', 'as opened'); } catch (e) { err = e; }
  check('words changed on another device since it opened: refused', err && err.code === 'changed' && err.stored === 'theirs' && !calls.length);
  await S.updateLyricsChecked('s2', 'mine', 'theirs');
  check('as opened: written', J(calls) === J(['mine']));
  sb = fakeSb(row, { readFails: true }); S = songs(sb); S.updateLyrics = (id, l) => { calls.push(l); return Promise.resolve(); };
  await S.updateLyricsChecked('s2', 'offline words', 'as opened');
  check('a read that fails does not block the save', calls[calls.length - 1] === 'offline words');

  // The inline editor itself, with its world stubbed.
  const lyrEnv = (ctx) => new Function('ctx', `
    var currentLyricsPreviewSong = ctx.song, currentLyricsPreviewMode = 'lyrics', STATE = ctx.STATE;
    var console = { error: function() {}, warn: function() {}, log: function() {} };
    var window = { WO: ctx.WO };
    var SBQ_SONGS = { updateLyricsChecked: function(id, l, o) { ctx.asked.push([id, l, o]); return ctx.answer(); } };
    var document = { getElementById: function(id) { return id === 'lyricsPreviewEditTextarea' ? ctx.ta : null; } };
    function showLoader() {}
    function showToast(m, k) { ctx.toasts.push([m, k]); }
    function lyricsPreviewToggleInlineEdit(on) { ctx.toggled.push(on); }
    function _lpSaveVoiceLines() { ctx.parts++; }
    ${top('lyricsPreviewSaveInlineEdit')}
    return lyricsPreviewSaveInlineEdit;`)(ctx);
  const lctx = (answer, may) => ({ song: { id: 's2', lyrics: 'as opened' }, STATE: { songs: [{ id: 's2', lyrics: 'as opened' }], _lpEditBaseline: 'as opened' },
    WO: { sbEditMayWrite: () => may !== false }, ta: { value: 'mine' }, asked: [], toasts: [], toggled: [], parts: 0, answer });
  let lc = lctx(() => { const e = new Error('x'); e.code = 'changed'; e.stored = 'theirs'; return Promise.reject(e); });
  lyrEnv(lc)(); await tick(); await tick();
  check('the editor\'s save hands the words it opened on', J(lc.asked) === J([['s2', 'mine', 'as opened']]));
  check('refused: the editor stays open, theirs become the song here, and it says so',
    !lc.toggled.length && lc.song.lyrics === 'theirs' && lc.STATE.songs[0].lyrics === 'theirs' && lc.toasts.some(t => t[1] === 'warning'), J(lc));
  lc = lctx(() => Promise.resolve());
  lyrEnv(lc)(); await tick(); await tick();
  check('saved: the editor closes', J(lc.toggled) === J([false]) && lc.song.lyrics === 'mine');
  lc = lctx(() => Promise.resolve(), false);
  lyrEnv(lc)(); await tick();
  check('another device holds the song: nothing is written', !lc.asked.length);

  console.log('\n5. The song library\'s choir parts save goes through the Songbook\'s write');
  const partsEnv = (ctx) => new Function('ctx', `
    var STATE = ctx.STATE, _lpChoirPending = ctx.pending, _lpVoiceLineCache = ctx.cache;
    var console = { error: function() {}, warn: function() {}, log: function() {} };
    var window = { WO: ctx.WO, lhcVoiceLines: { parseVoiceText: function(t) { return t ? [{ part: 'all', text: t }] : []; } } };
    var SBQ_VOICE_LINES = { replaceAll: function() { ctx.direct++; return Promise.resolve(); }, forSong: function() { return Promise.resolve([]); } };
    function showLoader() {}
    function showToast(m, k) { ctx.toasts.push([m, k]); }
    function lyricsPreviewToggleInlineEdit(on) { ctx.toggled.push(on); }
    function _lpSyncChoirEditBtn() {}
    ${top('_lpSaveVoiceLines')}
    return { save: _lpSaveVoiceLines, pending: function() { return _lpChoirPending; } };`)(ctx);
  const pctx = (wo, pending) => ({ STATE: { songs: [{ id: 's3' }], _lpEditSig: 'SIG' }, pending: pending ? 's3' : null, cache: {}, WO: wo, toasts: [], toggled: [], direct: 0 });
  const opts = [];
  let pc = pctx({ sbEditMayWrite: () => true, sbLinesSig: r => 'sig' + r.length, sbVoiceWrite: (b, sid, rows, o) => { opts.push(o); return Promise.resolve([{ id: 9 }]); } });
  let P = partsEnv(pc); P.save({ id: 's3' }, 'words'); await tick(); await tick();
  check('an arrangement edited: written only if the parts are still what the editor opened on', J(opts[0]) === J({ openSig: 'SIG' }) && pc.direct === 0);
  check('...saved: the fresh rows kept, the editor closed', J(pc.cache.s3) === J([{ id: 9 }]) && J(pc.toggled) === J([false]));
  pc = pctx({ sbEditMayWrite: () => true, sbLinesSig: r => 'sig' + r.length, sbVoiceWrite: (b, sid, rows, o) => { opts.push(o); return Promise.resolve([]); } }, true);
  P = partsEnv(pc); P.save({ id: 's3' }, 'words'); await tick(); await tick();
  check('a new arrangement: written only if the song still has none', J(opts[1]) === J({ onlyIfEmpty: true }));
  const refuse = code => (b, sid, rows, o) => { const e = new Error('x'); e.code = code; e.rows = [{ id: 'theirs' }]; return Promise.reject(e); };
  for (const code of ['changed', 'has-parts']) {
    pc = pctx({ sbEditMayWrite: () => true, sbLinesSig: r => 'sig' + r.length, sbVoiceWrite: refuse(code) }, code === 'has-parts');
    P = partsEnv(pc); const song = { id: 's3' }; P.save(song, 'words'); await tick(); await tick();
    check('refused (' + code + '): the editor stays open with yours, theirs are the song\'s here, and it says so',
      !pc.toggled.length && J(pc.cache.s3) === J([{ id: 'theirs' }]) && song.voiceLayout === 'two-part' && P.pending() === null &&
      pc.STATE._lpEditSig === 'sig0' && pc.toasts.some(t => t[1] === 'warning'), J(pc));
  }
  pc = pctx({ sbEditMayWrite: () => false, sbVoiceWrite: () => { opts.push('x'); return Promise.resolve([]); } });
  P = partsEnv(pc); const before = opts.length; P.save({ id: 's3' }, 'words'); await tick();
  check('another device holds the song: nothing is written', opts.length === before && pc.direct === 0);

  console.log('\n6. The song library holds the song while it is edited');
  const tog = top('lyricsPreviewToggleInlineEdit');
  check('opening the editor holds it, and a song held elsewhere is not opened',
    /if \(enter && W && typeof W\.sbLibHold === 'function' && !W\.sbLibHold\(song\)\) \{ _lpAbandonPendingChoir\(\); return; \}/.test(tog) &&
    tog.indexOf('W.sbLibHold(song)') < tog.indexOf('STATE.lyricsPreviewEditMode = !!enter;'));
  check('...closing it lets go', /if \(!enter && W && typeof W\.sbLibLetGo === 'function'\) W\.sbLibLetGo\(\);/.test(tog));
  check('...and so does closing the song, or opening another',
    /STATE\.lyricsPreviewEditMode = false;\n\s*if \(window\.WO && typeof WO\.sbLibLetGo === 'function'\) WO\.sbLibLetGo\(\);/.test(top('closeLyricsPreviewModal')) &&
    /STATE\.lyricsPreviewEditMode = false;\n\s*if \(window\.WO && typeof WO\.sbLibLetGo === 'function'\) WO\.sbLibLetGo\(\);/.test(fn('openLyricsPreviewModal')));
  check('the editor notes the parts it opened on', /STATE\._lpEditSig = \(enter && currentLyricsPreviewMode === 'choir'[^]*?W\.sbLinesSig\(_lpVoiceLineCache\[song\.id\] \|\| \[\]\)/.test(tog));
  const holdCtx = { claims: [], releases: [], ok: true };
  const H = new Function('ctx', `
    var _sbmEd = null, _sbmPad = null, _sbLyricsEditBase = '';
    function _sbEditClaim(s) { ctx.claims.push(s.id); return ctx.ok; }
    function edRelease(k) { ctx.releases.push(k); }
    function _sbEditKey(b) { return 'sbedit:' + b; }
    ${fn('_sbEditRelease')}
    var _sbLibEditBase = '';
    ${fn('sbLibHold')}
    ${fn('sbLibLetGo')}
    return { hold: sbLibHold, go: sbLibLetGo, release: _sbEditRelease };`)(holdCtx);
  check('a hold is the Songbook\'s own claim', H.hold({ id: 'S' }) === true && J(holdCtx.claims) === J(['S']));
  H.release('S');
  check('...a Songbook editor on this device closing does not let the library\'s hold go', holdCtx.releases.length === 0);
  H.go();
  check('...letting go releases it', J(holdCtx.releases) === J(['sbedit:S']));
  holdCtx.ok = false;
  check('...and a song somebody else holds is refused', H.hold({ id: 'T' }) === false);
  const ens = fn('_edEnsureChannel');
  check('the song lock channel runs with no order open',
    /if \(!sb\) return;[^]*?_edEnsureSongChannel\(sb\);\n\s*if \(!oid\) \{ _edEnsureTimers\(\); return; \}/.test(ens) && /_edEnsureTimers\(\);\n  \}$/.test(ens) && /\n  function _edEnsureTimers\(\) \{\n    if \(!_edTimers\) \{/.test(SRC));
  check('the WO module hands the library its write, signature and hold',
    /sbLibHold: sbLibHold, sbLibLetGo: sbLibLetGo, sbEditMayWrite: _sbEditMayWrite,\n\s*sbVoiceWrite: _sbVoiceWrite, sbLinesSig: _sbLinesSig,/.test(SRC));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
