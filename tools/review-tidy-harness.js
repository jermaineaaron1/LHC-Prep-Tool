'use strict';
// Harness for the tidy-ups left from the Songbook review (2026-11-13,
// CLAUDE.md gotcha 95), on the real functions sliced out of Index.html:
//   - the builder's WhatsApp list and export keep a medley's songs together;
//   - a medley is not made over a song its section already sings;
//   - the A4 pages' drag across sections says why it does nothing;
//   - a saved medley's song added to a standalone book gets an id of its own;
//   - the Songbook's shared list keeps two sections of one name apart;
//   - a songbook's save keeps who made it;
//   - the Songbook's lyrics editor lets its hold go when it cannot open;
//   - a tap away from the unsaved-changes toast does not ask again;
//   - two comments and a no-op put right.
//
// USAGE
//   node tools/review-tidy-harness.js
//   node tools/review-tidy-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const fn = name => { const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 600) : '')); }
}
const J = JSON.stringify;
process.on('unhandledRejection', e => { check('no unexpected error', false, String(e && e.stack || e)); console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(1); });

if (!/var secId = list\.length \? \(_woSongFirstSec\(u\.items\[0\], list\) \|\| ''\) : '';/.test(SRC)) {
  if (EXPECT_BROKEN) { console.log('--expect-broken: the tidy-ups are absent, as expected.'); process.exit(0); }
  console.log('FAIL the tidy-ups are not in ' + path.basename(INDEX)); process.exit(1);
}
if (EXPECT_BROKEN) { console.log('\nBUT --expect-broken was given and the tidy-ups are present.'); process.exit(1); }

(async () => {
  console.log('\n1. The builder\'s list and export keep a medley together');
  const shareEnv = new Function('ctx', `
    function _woSectionList() { return [{ id: 's1', title: 'Gathering' }]; }
    function _woMedleys() { return ctx.md; }
    function _lbdSecOrder() { return { songs: ctx.songs, ordered: [] }; }
    function _sbSungKey() { return ''; }
    function _lbdKindOf() { return ''; }
    ${fn('_woRunWithMedleys')}
    ${fn('_woUnits')}
    ${fn('_lbdShareSections')}
    return _lbdShareSections;`);
  const A = { id: 'a', title: 'Amazing Grace' }, X = { id: 'x', title: 'Here I Am' }, B = { id: 'b', title: 'My Chains Are Gone' };
  const lines = shareEnv({ md: [{ id: 'm', songs: ['a', 'b'] }], songs: [A, X, B] })()[0].lines.map(l => l.text);
  check('a medley split by another song is one line, not two', J(lines) === J(['♪ Medley: Amazing Grace + My Chains Are Gone', '♪ Here I Am']), J(lines));
  check('...and the export does the same', /_woUnits\(_woRunWithMedleys\(so\.songs, md\), md\)\.forEach/.test(fn('_lbdExportModel')));

  console.log('\n2. A medley is not made over a song its section already sings');
  const mdEnv = (ctx) => new Function('ctx', `
    var currentOrderData = { template: {} }, songOrderSections = ctx.order, _woSongsTakenOutOfSections = {}, _sbStandaloneId = '';
    function _woSectionList() { return [{ id: 's1' }, { id: 's2' }]; }
    function _lbdSong(id) { return ctx.order.filter(function(s) { return s.id === id; })[0]; }
    function _woSongFirstSec(s) { return s.sectionId; }
    function _woSongSectionIds(s) { return [s.sectionId]; }
    function _woLcdInPage() { return false; }
    function _woSongCopyIn(lib, sec) { return ctx.order.filter(function(s) { return s.songId === lib && s.sectionId === sec; })[0] || null; }
    function _lbdSecTitle(sec) { return sec === 's1' ? 'Gathering' : 'Sending'; }
    function showToast(m) { ctx.toasts.push(m); }
    function _woMedleys() { return []; }
    function _woSongsChange(f) { ctx.changed++; f(); return true; }
    function _lbdSortSongsByService() {}
    ${fn('_woSaveMedley')}
    return _woSaveMedley;`)(ctx);
  // Gathering sings "Amazing Grace"; Sending has another copy of it and "Here I Am".
  const mk = () => ({ toasts: [], changed: 0, order: [
    { id: 'g1', songId: 'AG', title: 'Amazing Grace', sectionId: 's1' },
    { id: 'h1', songId: 'HI', title: 'Here I Am', sectionId: 's1' },
    { id: 'g2', songId: 'AG', title: 'Amazing Grace', sectionId: 's2' }] });
  let c = mk();
  let ok = mdEnv(c)('', ['h1', 'g2']);   // a medley from Gathering's "Here I Am" and Sending's "Amazing Grace"
  check('refused, nothing changed, and it says which song and where', ok === false && c.changed === 0 &&
    /Amazing Grace/.test(c.toasts[0] || '') && /already sung in Gathering/.test(c.toasts[0] || ''), J(c.toasts));
  c = mk(); c.order[2].songId = 'OTHER';
  ok = mdEnv(c)('', ['h1', 'g2']);
  check('a song the section does not sing still moves in and makes the medley', ok === true && c.changed === 1 && c.order.find(s => s.id === 'g2').sectionId === 's1');

  console.log('\n3. The A4 pages\' drag across sections says why');
  check('a drop on a song of another section is refused with the song view\'s own words',
    /var _da = songOrderSections\.filter[^\n]*dragBase[^\n]*\n\s*var _db = songOrderSections\.filter[^\n]*targetBase[^\n]*\n\s*if \(_da && _db && !_sbmSameSection\(_da, _db\)\) \{ _sbmOtherSectionToast\(\); return; \}\n\s*_sbReorderSongs\(dragBase, targetBase\);/.test(fn('sbInitDrag')));

  console.log('\n4. A saved medley\'s song added to a standalone book gets an id of its own');
  const addEnv = (ctx) => new Function('ctx', `
    var _sbStandaloneId = 'sb1', songOrderSections = ctx.order, currentOrderData = {};
    var songOriginalLyrics = {}, songOriginalRichLyrics = {}, sbTransposeSteps = {};
    function _woNewSongEntry(lib) { return { songId: lib.id, title: lib.title, lyrics: '' }; }
    function autoSaveOrder() {}
    function formatLyricsWithHighlights(x) { return x; }
    ${fn('_mdsAddToBook')}
    return _mdsAddToBook;`)(ctx);
  // The book had [L, B]; L was taken out and put back, so it is entry _1 with one entry.
  const ord = [{ id: 'sbsong_L_1', songId: 'L' }];
  const e = addEnv({ order: ord })({ id: 'L', title: 'Silent Night' }, '', []);
  check('the count names an entry still there: the next free place is taken instead', e && e.id === 'sbsong_L_2' && ord.length === 2 && ord[0].id !== ord[1].id, J(ord));
  const ord2 = [{ id: 'sbsong_A_0' }];
  check('...and with no clash it is the count, as before', addEnv({ order: ord2 })({ id: 'L', title: 'x' }, '', []).id === 'sbsong_L_1');

  console.log('\n5. The Songbook\'s shared list keeps two sections of one name apart');
  const msg = new Function(fn('_sbShareMessage') + '\nreturn _sbShareMessage;')();
  const m1 = msg({ title: 'Service', rows: [
    { section: 'Song', secId: 's3', text: 'Amazing Grace', medley: '' },
    { section: 'Song', secId: 's4', text: 'Here I Am', medley: '' }] });
  check('two sections called "Song" side by side: two headings', (m1.match(/\*Song\*/g) || []).length === 2, m1);
  const m2 = msg({ title: 'Service', rows: [
    { section: 'Song', text: 'Amazing Grace', medley: '' },
    { section: 'Song', text: 'Here I Am', medley: '' }] });
  check('rows with no section id read as before', (m2.match(/\*Song\*/g) || []).length === 1, m2);
  check('the rows carry the section a song is first sung in', /rows\.push\(\{ section: sec, secId: secId,/.test(fn('_sbShareRows')) && /_sbStandaloneId\) \? _woSectionList\(\) : \[\];/.test(fn('_sbShareRows')));

  console.log('\n6. A songbook\'s save keeps who made it');
  const sStart = SRC.indexOf('\nvar SBQ_SONGBOOKS = {');
  const sbqSrc = SRC.slice(sStart, SRC.indexOf('\n};', sStart) + 3);
  const written = [];
  const fake = { from() { return { upsert(rows) { written.push(rows[0]); return Promise.resolve({ error: null }); } }; } };
  const B2 = new Function('getSupabaseClient', 'var SBQ = { invalidateUsageIndex: function() {} };\n' + sbqSrc.replace(/^\n/, '') + '\nreturn SBQ_SONGBOOKS;')(() => fake);
  const loaded = B2._fromRow({ id: 'sb1', name: 'Caroling', song_ids: ['a'], items: [], created_date: '2026-10-27', created_by: 'Choir' });
  await B2.save(loaded);
  check('read with the row, and written back as it was', loaded.createdBy === 'Choir' && written[0].created_by === 'Choir', J(written[0]));

  console.log('\n7. The Songbook\'s lyrics editor lets go of the song when it cannot open');
  check('no editor window: the hold is let go', /if \(!modal \|\| !textarea\) \{ sbLyricsEditorClosed\(\); return; \}/.test(fn('sbOpenLyricsEditor')));

  console.log('\n8. A tap away from the unsaved-changes toast does not ask again');
  const ask = fn('_sbmAskUnsaved');
  check('the tap is Keep editing, and its click goes nowhere',
    /var away = function\(e\) \{\n\s*if \(el\.contains\(e\.target\)\) return;\n\s*done\('keep'\);[^]*?document\.addEventListener\('click', eat, true\);/.test(ask) &&
    /var eat = function\(ev\) \{ document\.removeEventListener\('click', eat, true\); if \(Date\.now\(\) <= until\) \{ ev\.stopPropagation\(\); ev\.stopImmediatePropagation\(\); ev\.preventDefault\(\); \} \};/.test(ask));

  console.log('\n9. Comments and a no-op put right');
  check('no comment says display_style is not in the database', !/doesn't exist in Supabase yet/.test(SRC));
  check('no .replace(\'b\', \'b\')', !/\.replace\('b',\s*'b'\)/.test(SRC));
  check('no comment says replaceAll rewrites the lyrics column', !/replaceAll rewrites the\s*\n?\s*\/\/\s*lyrics column/.test(SRC));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
