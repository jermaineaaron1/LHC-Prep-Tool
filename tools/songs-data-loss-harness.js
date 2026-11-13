'use strict';
// Harness for the songs-library and songbook data-loss fixes from the review
// of 2026-11-12 (CLAUDE.md gotcha 92):
//   - the Edit Song form's Save wrote the WHOLE row and blanked the choir
//     parts flag, the use count and the dates (SBQ_SONGS.updateForm);
//   - the appearance controls replaced display_style and lost the instrument
//     names and part colours (_sfApplyAppearance, withAppearance);
//   - a new song had no date;
//   - a standalone songbook's save dropped each song's Choir / Lyrics view;
//   - the shared-link Songbook kept the previous order's liturgy and type, and
//     saved them into this one (openSongbookByOrderId);
//   - Add choir parts in the library seeded over parts it did not know of;
//   - Overwrite the Master Copy kept the master as this device last read it.
//
// USAGE
//   node tools/songs-data-loss-harness.js
//   node tools/songs-data-loss-harness.js <Index.html> --expect-broken

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
// An error part-way is a failure, and the exit code must say so.
process.on('unhandledRejection', e => { check('no unexpected error', false, String(e && e.message || e)); console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(1); });

const sStart = SRC.indexOf('\nvar SBQ_SONGS = {');
const sEnd = sStart < 0 ? -1 : SRC.indexOf('\n};', sStart);
const sbqSrc = sStart < 0 ? '' : SRC.slice(sStart, sEnd + 3);
if (!/updateForm: function\(song[,)]/.test(sbqSrc)) {
  if (EXPECT_BROKEN) { console.log('--expect-broken: no SBQ_SONGS.updateForm, as expected.'); process.exit(0); }
  console.log('FAIL there is no SBQ_SONGS.updateForm'); process.exit(1);
}
if (EXPECT_BROKEN) { console.log('\nBUT --expect-broken was given and the fix is present.'); process.exit(1); }

// A fake Supabase that keeps one song row and records every write.
function fakeSb(row, opts) {
  const o = opts || {}, log = [];
  const sb = {
    log,
    from(table) {
      const q = { table, op: 'select', patch: null, filters: [] };
      const api = {
        select() { return api; },
        update(p) { q.op = 'update'; q.patch = JSON.parse(JSON.stringify(p)); return api; },
        eq(k, v) { q.filters.push([k, v]); return api; },
        maybeSingle() { return api; }, single() { return api; },
        then(res, rej) {
          log.push(q);
          if (q.op === 'update') {
            if (o.noScripture && 'scripture' in q.patch) return Promise.resolve({ error: { message: 'column "scripture" does not exist' } }).then(res, rej);
            Object.assign(row, q.patch);
            return Promise.resolve({ error: null }).then(res, rej);
          }
          return Promise.resolve({ error: null, data: JSON.parse(JSON.stringify(row)) }).then(res, rej);
        }
      };
      return api;
    },
    channel() { return { subscribe() {}, send() { return Promise.resolve(); } }; },
    removeChannel() {}
  };
  return sb;
}

(async () => {
  console.log('\n1. The Edit Song form writes only what it owns');
  const row = { id: 'song_1', title: 'Old', lyrics: 'old', voice_layout: 'two-part', use_count: 7, date_added: '2026-01-01', last_used: 'Sun Nov 08 2026',
    display_style: { lyricFont: 'Lato', recInstruments: 5, recInstrumentNames: { 'instrument-4': 'Cello' }, partColours: { women: '#ff0000' } } };
  const sb = fakeSb(row);
  const S = new Function('getSupabaseClient', top('_songStyleWithEra') + '\n' + top('songToRow') + '\n' + sbqSrc.replace(/^\n/, '') + '\nreturn SBQ_SONGS;')(() => sb);
  const form = { id: 'song_1', title: 'New title', artist: 'A', category: 'Hymn', key: 'G', lyrics: 'new words', youtube: ['https://youtu.be/x'], attachments: [],
    display_style: { lyricFont: 'Georgia', lyricSize: '', lyricColor: '#1f2937', chordFont: '', chordSize: '', chordColor: '#991b1b' } };
  const r = await S.updateForm(form);
  const up = sb.log.filter(q => q.op === 'update').pop();
  check('it writes the form\'s fields', row.title === 'New title' && row.lyrics === 'new words' && row.key === 'G' && row.style === 'Hymn' && J(row.youtube) === J(['https://youtu.be/x']));
  check('...and NOT the choir parts flag, the use count or the dates', row.voice_layout === 'two-part' && row.use_count === 7 && row.date_added === '2026-01-01' && row.last_used === 'Sun Nov 08 2026' &&
    !('voice_layout' in up.patch) && !('use_count' in up.patch) && !('date_added' in up.patch) && !('last_used' in up.patch), J(up.patch));
  check('...and stamps when it was edited', /^\d{4}-\d\d-\d\dT/.test(row.last_edited || ''));
  check('the appearance it sets goes over the song\'s style; instrument names and part colours stay',
    row.display_style.lyricFont === 'Georgia' && row.display_style.recInstruments === 5 && row.display_style.recInstrumentNames['instrument-4'] === 'Cello' && row.display_style.partColours.women === '#ff0000', J(row.display_style));
  check('...read FRESH before it is written (not the copy the page loaded)', sb.log[0].op === 'select' && sb.log[0].table === 'songs');
  check('it reports success', r && r.success === true);
  const row2 = { id: 'song_2', voice_layout: null, display_style: {} };
  const sb2 = fakeSb(row2, { noScripture: true });
  const S2 = new Function('getSupabaseClient', top('_songStyleWithEra') + '\n' + top('songToRow') + '\n' + sbqSrc.replace(/^\n/, '') + '\nreturn SBQ_SONGS;')(() => sb2);
  await S2.updateForm({ id: 'song_2', title: 'T', scripture: 'Jn 1' });
  check('a database without the scripture column: saved without it', row2.title === 'T' && !('scripture' in row2));
  check('withAppearance keeps every other key (pure)', J(S.withAppearance({ a: 1, lyricFont: 'x' }, { lyricFont: 'y', other: 2 })) === J({ a: 1, lyricFont: 'y' }));
  check('the form\'s Save goes through it', /SBQ_SONGS\.updateForm\(songData(, \{ openedLyrics: _asmOpenedLyrics \})?\)\.then/.test(fn('saveEditSong')) && !/SBQ_SONGS\.update\(songData\)/.test(fn('saveEditSong')));
  check('...and the list shown at once keeps the song\'s other style keys', /merged\.display_style = (_songStyleWithEra\()?SBQ_SONGS\.withAppearance\(prev\.display_style, saved\.display_style\)(, saved\))?;/.test(fn('_applySavedSongLocally')));

  console.log('\n2. The appearance controls keep the other keys');
  const els = { sfLyricFont: { value: 'Lato' }, sfLyricSize: { value: '18' }, sfLyricColor: { value: '#111111' }, sfChordFont: { value: '' }, sfChordSize: { value: '' }, sfChordColor: { value: '#991b1b' } };
  const A = new Function('document', 'var currentDisplayStyle = { recInstrumentNames: { "instrument-4": "Cello" }, partColours: { men: "#00f" }, lyricFont: "Old" };\n' +
    'function _sfPaintAppearance() {}\n' + top('_sfApplyAppearance') + '\n_sfApplyAppearance(); return currentDisplayStyle;')({ getElementById: id => els[id] || null });
  check('a font changed: the instrument names and part colours stay', A.lyricFont === 'Lato' && A.lyricSize === '18' && A.recInstrumentNames['instrument-4'] === 'Cello' && A.partColours.men === '#00f', J(A));

  console.log('\n3. A new song has its date');
  check('Add Song stamps date added and last edited', /songData\.dateAdded = songData\.lastEdited = new Date\(\)\.toISOString\(\);/.test(top('saveNewSong') || fn('saveNewSong')));

  console.log('\n4. A standalone songbook keeps each song\'s Choir / Lyrics view');
  check('the full save writes choirView with each song', /choirView:\s+s\.choirView \|\| ''\n\s+\};\n\s+\}\);\n\n\s+SBQ_SONGBOOKS\.save\(\{/.test(SRC));

  console.log('\n5. The shared-link Songbook: its own order, liturgy and type');
  const op = fn('openSongbookByOrderId');
  check('the order open before steps aside: its waiting edit saved as itself, its page taken down',
    /if \(_prevId && _prevId !== orderMeta\.id && !_sbStandaloneId[^\n]*\{\n\s*if \(_autoSaveTimer && !_loadingOrder\) \{ clearTimeout\(_autoSaveTimer\); _autoSaveTimer = null; saveCurrentOrder\(true\); \}\n\s*_lbdSetActive\(false\);[^]*?_woc\.removeAttribute\('data-order-id'\);[^]*?_woHideEditor\(\);/.test(op));
  check('...the same order is left as it is (a Refresh while projecting must not take the LCD down)', /_prevId !== orderMeta\.id/.test(op));
  check('its own type, liturgy, readings and text, as a full load builds them',
    /currentOrderType = orderMeta\.type \|\| 'traditional';/.test(op) && /_absorbOrderItem\(it, _scr\)/.test(op) &&
    /currentOrderData\.allItems = result\.items \|\| \[\];\n\s*currentOrderData\.serviceSectionItems = _scr\.serviceSectionItems;\n\s*window\.serviceSectionItems = _scr\.serviceSectionItems;/.test(op));
  check('...and the rows on screen noted, for the save\'s prune', /SBQ\._noteKnownItems\(orderMeta\.id, \(result\.items \|\| \[\]\)\.map/.test(op));
  check('...before the songs are split and the book opens', op.indexOf('window.serviceSectionItems = _scr') < op.indexOf('openSongbook();'));

  console.log('\n6. Add choir parts asks for parts it does not know of');
  const lp = top('_lpStartChoirParts');
  const ctx = { written: [], seeded: 0, toasts: [], mode: '' };
  const make = rows => new Function('ctx', 'window', 'var currentLyricsPreviewSong = ctx.song, _lpVoiceLineCache = {}, SBQ_VOICE_LINES = window.SBQ_VOICE_LINES, SBQ_SONGS = window.SBQ_SONGS;\n' +
    'function showToast(m) { ctx.toasts.push(m); }\nfunction _lpSyncChoirEditBtn() {}\nfunction switchLyricsPreviewMode(m) { ctx.mode = m; }\nvar document = { getElementById: function() { return null; } };\n' +
    'function _lpSeedChoirParts() { ctx.seeded++; }\n' + lp + '\nreturn { start: _lpStartChoirParts, cache: function() { return _lpVoiceLineCache; } };')(ctx, {
      lhcVoiceLines: {}, SBQ_VOICE_LINES: { forSong: () => Promise.resolve(rows) },
      SBQ_SONGS: { updateFields: (id, p) => { ctx.written.push([id, p]); return Promise.resolve(); } }
    });
  ctx.song = { id: 'song_1', lyrics: 'words', voiceLayout: null };
  const L1 = make([{ part: 'women', text: 'a' }]);
  L1.start(ctx.song); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  check('parts found: shown, nothing seeded, and the flag put right', ctx.seeded === 0 && ctx.mode === 'choir' && ctx.song.voiceLayout === 'two-part' &&
    J(ctx.written) === J([['song_1', { voice_layout: 'two-part' }]]), J(ctx));
  const L2 = make([]);
  L2.start(ctx.song); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  check('none found: seeded from the words, as before', ctx.seeded === 1);
  check('Set up choir parts puts a missing flag right when it finds parts already there',
    /if \(lib && lib\.voiceLayout !== 'two-part' && window\.SBQ_SONGS && SBQ_SONGS\.updateFields\) SBQ_SONGS\.updateFields\(base, \{ voice_layout: 'two-part' \}\)/.test(fn('_sbmChoirSetUp')));

  console.log('\n7. Overwrite the Master Copy keeps the master as it is stored now');
  check('the stored words and key are read before the copy is kept',
    /sup\.from\('songs'\)\.select\('lyrics, key'\)\.eq\('id', base\)\.maybeSingle\(\)\.then\(function\(r0\) \{[^]*?return _sbVerReplaceMainNow\(base, lib, m\);/.test(fn('_sbVerReplaceMain')));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
