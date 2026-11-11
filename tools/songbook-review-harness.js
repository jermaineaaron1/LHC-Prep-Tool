'use strict';
// Harness for what a save/restore review of the Songbook found (2026-11-05).
//
// WHY THIS EXISTS
// A read-only review of PRs #375-#385 traced every Songbook save path and
// found seven ways data could be lost or written over:
//   S1  a save from the shared Songbook link emptied the order's inbox,
//       brought back removed liturgy and dropped the slide backgrounds
//       (the loader built the order without them);
//   S2  "Set up choir parts" could replace an arrangement another device
//       had just made (it trusted this device's copy);
//   S3  instrument names and part colours could be erased by another device
//       writing its out-of-date display_style back whole;
//   S4  "one editor at a time" held only within one service's songbook;
//   S5  an editor left open on a phone that slept could save its old words
//       over someone else's newer save;
//   S6  regrouping a song's lines (Sing together, Take turns...) moved the
//       drawn remarks onto the wrong moments;
//   S7  the transpose-these-lines Undo could undo other people's changes.
//
// USAGE
//   node tools/songbook-review-harness.js                 # ../Index.html
//   node tools/songbook-review-harness.js path/to/file.html
//   node tools/songbook-review-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fixes
// (`git show 28a37d3:Index.html > x`).
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');
const has = re => re.test(SRC);
const fn = name => { const m = SRC.match(new RegExp('  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}
const vStart = lines.findIndex(l => /^window\.lhcVoiceLines = \{/.test(l));
const vEnd = vStart < 0 ? -1 : lines.findIndex((l, i) => i > vStart && l.replace(/\r$/, '') === '};');
const V = vStart < 0 ? null : new Function('var window = {};\n' + lines.slice(vStart, vEnd + 1).map(l => l.replace(/\r$/, '')).join('\n') + '\nreturn window.lhcVoiceLines;')();

// a supabase stand-in: song_marks rows to read and update, a songs row
function fakeDb(marks, songRow) {
  const upd = [];
  return {
    upd,
    from(t) {
      const q = { t, filters: [] };
      q.select = () => q; q.eq = (c, v) => { q.filters.push([c, v]); return q; };
      q.maybeSingle = () => Promise.resolve({ data: songRow, error: null });
      q.then = (ok, bad) => Promise.resolve({ data: t === 'song_marks' ? marks : [], error: null }).then(ok, bad);
      q.update = row => ({ eq: (c, v) => { upd.push([t, v, row]); return Promise.resolve({ error: null }); } });
      return q;
    }
  };
}

(async () => {
  console.log('S1  the shared Songbook link loads what a full save writes back');
  const loader = fn('openSongbookByOrderId');
  check('its order carries the inbox, the sections liturgy was taken out of, and the backgrounds',
    /currentOrderData\.mediaLinks = Array\.isArray\(orderMeta\.mediaLinks\) \? orderMeta\.mediaLinks\.slice\(\) : \[\];/.test(loader) &&
    /currentOrderData\.clearedSections = \(orderMeta\.template && Array\.isArray\(orderMeta\.template\.clearedSections\)\)/.test(loader) &&
    /if \(typeof loadSlideBackgrounds === 'function'\) loadSlideBackgrounds\(\);/.test(loader) &&
    /currentOrderData\._inboxPresent = !!orderMeta\._inboxPresent;/.test(loader));

  console.log('\nS2, S5  an arrangement is written only over what is stored');
  const vw = fn('_sbVoiceWrite'), sig = fn('_sbLinesSig');
  if (vw && sig && V) {
    const run = (stored, opts) => {
      const calls = { replaceAll: 0 };
      const F = new Function('window', 'songOrderSections', '_sbVoiceLines', '_sbmRekeyMarks',
        sig + '\n' + vw + '\nreturn _sbVoiceWrite;');
      const win = { STATE: { songs: [{ id: 'song_a' }] }, SBQ_VOICE_LINES: {
        forSong: () => Promise.resolve(stored.slice()),
        replaceAll: (b, rows) => { calls.replaceAll++; stored = rows.map((r, i) => Object.assign({ id: 'n' + i }, r)); return Promise.resolve(); } } };
      const w = F(win, [], {}, () => Promise.resolve(0));
      return w('song_a', 'copy', [{ part: 'both', text: 'new', sortOrder: 0, section: 'V' }], opts)
        .then(() => ({ ok: true, calls }), e => ({ ok: false, code: e.code, calls }));
    };
    const parts = [{ id: 'x1', part: 'women', text: 'Do you see', sortOrder: 0, section: 'V' }];
    const setUp = await run(parts, { onlyIfEmpty: true });
    check('Set up choir parts writes nothing over parts already stored', !setUp.ok && setUp.code === 'has-parts' && setUp.calls.replaceAll === 0, JSON.stringify(setUp));
    const openedOn = new Function(sig + '\nreturn _sbLinesSig;')()([{ id: 'old', part: 'women', text: 'Do you', sortOrder: 0, section: 'V' }]);
    const stale = await run(parts, { openSig: openedOn });
    check('an editor that opened on other parts than are stored now is refused, and writes nothing', !stale.ok && stale.code === 'changed' && stale.calls.replaceAll === 0, JSON.stringify(stale));
    const same = await run(parts, { openSig: new Function(sig + '\nreturn _sbLinesSig;')()(parts) });
    check('...one that opened on what is stored saves', same.ok && same.calls.replaceAll === 1, JSON.stringify(same));
  } else check('the arrangement write and its signature are functions of their own', false);
  check('every write of an arrangement goes through it: Edit Parts, Overview, the page view\'s text, Set up',
    has(/_sbVoiceWrite\(ed\.base, ed\.sid, parsed, \{ openSig: ed\.openSig \}\)/) &&
    has(/return _sbVoiceWrite\(base, sid, parsed, \{ openSig: openSig \}\)\.then\(function\(\) \{/) &&
    has(/_sbVoiceWrite\(baseSongId, item \? item\.id : null, parsed, \{ openSig: openSig \}\)/) &&
    has(/_sbVoiceWrite\(base, c\.id, rows, \{ onlyIfEmpty: true \}\)/) &&
    has(/openSig: _sbLinesSig\(Array\.isArray\(o\.openRows\) \? o\.openRows : rows\),/));

  console.log('\nS6  drawn remarks follow their lines when the moments are regrouped');
  const rk = fn('_sbmRekeyMarks'), kp = fn('_sbmKeyParts');
  if (rk && kp && V) {
    const R = (id, part, text, so, sec) => ({ id, part, text, sortOrder: so, section: sec || 'Verse 1' });
    // before: 1 All | 2 men | 3 women | 4 women+men ; after Sing together on 2-3: 1 All | 2 men+women | 3 women+men
    const oldRows = [R('a', 'both', 'Said the night wind', 0), R('b', 'men', 'Do you see what I see', 1), R('c', 'women', 'Do you see what I see too', 2),
                     R('d', 'women', 'oh', 3), R('e', 'men', 'A star a star', 3)];
    const newRows = [R('A', 'both', 'Said the night wind', 0), R('B', 'men', 'Do you see what I see', 1), R('C', 'women', 'Do you see what I see too', 1),
                     R('D', 'women', 'oh', 2), R('E', 'men', 'A star a star', 2)];
    const marks = [
      { id: 1, anchor: 's:Verse 1|1/w:both:2' },          // unchanged moment
      { id: 2, anchor: 's:Verse 1|3/w:women:1' },         // the women's line, moment 3 -> 2
      { id: 3, anchor: 's:Verse 1|4/c:0' },               // a chord of moment 4 -> 3
      { id: 4, anchor: 's:Verse 1|2/r:men>s:Verse 1|4/w:men:2@gk1' },   // a link, both ends, its drawing kept
      { id: 5, anchor: 'l:3/w:1' }                         // the lyrics card: not the score's
    ];
    const db = fakeDb(marks, null);
    const F = new Function('window', '_sbmMarks', '_sbmMarksPaintAll', kp + '\n' + rk + '\nreturn _sbmRekeyMarks;');
    const n = await F({ lhcVoiceLines: V, _supabase: db }, {}, () => {})('song_a', oldRows, newRows);
    const to = id => (db.upd.find(u => u[1] === id) || [])[2];
    check('a part\'s word moves with that part\'s line to its new moment', to(2) && to(2).anchor === 's:Verse 1|2/w:women:1', JSON.stringify(db.upd));
    check('...a chord or the moment itself with the moment\'s first line', to(3) && to(3).anchor === 's:Verse 1|3/c:0', JSON.stringify(to(3)));
    check('...a drawing linking two words moves both ends, and stays one drawing', to(4) && to(4).anchor === 's:Verse 1|2/r:men>s:Verse 1|3/w:men:2@gk1', JSON.stringify(to(4)));
    check('...and nothing else is touched: a moment that did not move, the lyrics card', n === 3 && !to(1) && !to(5), JSON.stringify(db.upd));
    const db2 = fakeDb(marks, null);
    await F({ lhcVoiceLines: V, _supabase: db2 }, {}, () => {})('song_a', oldRows, oldRows.map(r => Object.assign({}, r, { id: r.id + 'x' })));
    check('a save that regroups nothing moves nothing', db2.upd.length === 0, JSON.stringify(db2.upd));
  } else check('moving the remarks is a function of its own', false);

  console.log('\nS3  display_style is read fresh before it is written whole');
  const fresh = fn('_sbDsFresh'), dsw = fn('_sbRecDsWrite'), dswNow = fn('_sbRecDsWriteNow');
  if (fresh && dsw && dswNow) {
    const lib = { id: 'song_a', display_style: { recInstrumentNames: {} } };   // this device's old copy
    const stored = { display_style: { recInstrumentNames: { instrumental: 'Piano' }, partColours: { men: '#0a0' } } };
    let written = null;
    const F = new Function('window', 'STATE', 'SBQ_SONGS', '_sbmLiveSend', fresh + '\n' + dsw + '\n' + dswNow + '\nreturn _sbRecDsWrite;');
    const st = { songs: [lib] };
    await F({ _supabase: fakeDb([], stored), STATE: st }, st, { updateDisplayStyle: (b, ds) => { written = ds; return Promise.resolve(); } }, () => {})
      ('song_a', ds => { ds.recInstrumentNames['instrument-2'] = 'Guitar'; });
    check('naming an instrument keeps what another device named and coloured meanwhile',
      written && written.recInstrumentNames.instrumental === 'Piano' && written.recInstrumentNames['instrument-2'] === 'Guitar' && written.partColours && written.partColours.men === '#0a0',
      JSON.stringify(written));
  } else check('the fresh read is a function of its own', false);
  check('...and so do a new instrument, the instrument count and the part colours',
    /return _sbDsFresh\(base\)\.then\(function\(\) \{ return _sbRecInstrumentAddNow\(base, name\); \}\);/.test(fn('_sbRecInstrumentAdd')) &&
    /return _sbDsFresh\(base\)\.then\(function\(\) \{ return _sbRecInstrumentsSaveNow\(base, n\); \}\);/.test(fn('_sbRecInstrumentsSave')) &&
    /return _sbDsFresh\(base\)\.then\(function\(\) \{ return _sbPartColoursSaveNow\(base, colours\); \}\);/.test(fn('_sbPartColoursSave')));

  console.log('\nS4  one lock for a song, whichever book it is edited from');
  const send = fn('_edSend'), sendOn = fn('_edSendOn');
  if (send && sendOn) {
    const got = { order: [], song: [] };
    const ch = name => ({ send: m => { got[name].push(m.event + ':' + (m.payload.key || '')); return Promise.resolve(); } });
    const F = new Function('_edLockChannel', '_edLockReady', '_edSongChannel', '_edSongReady', sendOn + '\n' + send + '\nreturn _edSend;');
    const s = F(ch('order'), true, ch('song'), true);
    s('ed_lock', { key: 'sbedit:song_a' }); s('ed_lock', { key: 'lcd:wo-section-3:0' }); s('ed_query', { from: 'me' });
    check('a song\'s lock goes on the app-wide channel, a slide\'s on its order\'s, and the roll-call on both',
      JSON.stringify(got) === JSON.stringify({ order: ['ed_lock:lcd:wo-section-3:0', 'ed_query:'], song: ['ed_lock:sbedit:song_a', 'ed_query:'] }), JSON.stringify(got));
  } else check('the lock\'s send is a function of its own', false);
  check('...and every device listens on it', has(/\.channel\('ed-lock-songs', \{ config: \{ broadcast: \{ self: false \} \} \}\)/) && /_edEnsureSongChannel\(sb\);/.test(fn('_edEnsureChannel')));

  console.log('\nS5  a device that slept knows its song lock lapsed');
  check('the lock timer notices a sleep, and the claims lose their head start',
    has(/if \(_edLastTick && now - _edLastTick > ED_LOCK_TTL\) \{\r?\n\s*Object\.keys\(_edMyLocks\)\.forEach\(function\(k\) \{ _edMyLocks\[k\]\.since = now; _edMyLocks\[k\]\.lapsed = true; \}\);/) &&
    has(/lapsed: !!\(mine && mine\.lapsed\) \};/));
  const saveLy = fn('sbSaveLyricsFromModal');
  check('Save Lyrics is refused when the words changed since the editor opened, and checks what is stored after a sleep',
    /if \(opened != null && _sbNormWords\(song\.customLyrics \|\| ''\) !== opened\) \{/.test(saveLy) &&
    /if \(opened == null \|\| !mine \|\| !mine\.lapsed \|\| !sup\) \{ commit\(\); return true; \}/.test(saveLy) &&
    /from\('order_items'\)\.select\('customizations'\)\.eq\('id', sid\)/.test(saveLy) &&
    has(/_sbLyrOpened = \{ sid: sid, words: _sbNormWords\(s\.customLyrics \|\| ''\)(, steps: steps, shown: shownLines, stored: storedLines)? \};/));

  console.log('\nS7  the transpose bar\'s Undo undoes only its own change');
  check('words changed since its last move are not undone, and it says so',
    /X\.after = song\.customLyrics;/.test(fn('sbmXpSel')) &&
    /if \(X\.after != null && String\(song\.customLyrics \|\| ''\) !== String\(X\.after\)\) \{/.test(fn('sbmXpSelUndo')));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (EXPECT_BROKEN) {
    if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
    console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
  }
  process.exit(failed ? 1 : 0);
})();
