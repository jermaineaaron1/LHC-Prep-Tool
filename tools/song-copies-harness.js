'use strict';
// Harness for a song sung in two sections of one service.
//
// WHY THIS EXISTS
// A song added to a second section used to be the SAME entry in both: its
// serviceSections listed the two, and the Songbook, which lists each entry
// once, showed it only under the first. "We Praise You", placed in Praise &
// Worship and again as the Dismissal Song, was not in the Songbook's
// Dismissal Song at all, and a key or a word changed for one moment changed
// the other.
//
// Now each section has a copy of its own (_woSongCopy), with the same
// arrangement to start from; an entry stored the old way is split as the
// order opens (_woSplitSharedSongs), under ids two devices agree on. A copy
// can take the arrangement of another copy, or of an earlier service
// (sbArrCopy), and make its drawings its own (sbmOwnVersion).
//
// USAGE
//   node tools/song-copies-harness.js                 # ../Index.html
//   node tools/song-copies-harness.js path/to/file.html
//   node tools/song-copies-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 3bc1417:Index.html > x`).
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

function extract(header) {
  const startIdx = lines.findIndex(l => l.indexOf(header) !== -1);
  if (startIdx < 0) return null;
  let depth = 0, started = false;
  const out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  return null;
}

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

const LIST = [
  { id: 'wo-section-3', title: 'Praise & Worship', serviceSectionId: 'praise' },
  { id: 'wo-section-6', title: 'Song of Preparation', serviceSectionId: 'preparation' },
  { id: 'wo-section-16', title: 'Dismissal Song', serviceSectionId: 'dismissal' }
];

console.log('Two sections, two copies');
const names = ['function _woSongSectionIds(', 'function _woSongCopy(', 'function _woSongCopyIn(', 'function _woSplitSharedSongs('];
const fns = names.map(extract);
check('the copies are made and found by functions of their own', fns.every(Boolean));
if (fns.every(Boolean)) {
  const C = new Function(
    'var songOrderSections = [];\nfunction _woSectionList() { return [] }\n' + fns.join('\n') +
    '\nreturn { copy: _woSongCopy, split: _woSplitSharedSongs, inSec: function(songs, lib, sec, list) { songOrderSections = songs; return _woSongCopyIn(lib, sec, list); } };')();
  const shared = () => ({
    id: 'wo-song-1-a', songId: 'song_wpy', title: 'We Praise You', serviceSections: ['wo-section-3', 'wo-section-16'], sectionId: 'wo-section-3',
    transposeSteps: 2, customLyrics: 'G  C\nWe praise You', versionId: 'ver_1', liturgistNotes: 'Into the prayer',
    annotations: [{ d: 'M0 0' }], savedSlides: [{ content: 'We praise You' }]
  });
  const other = { id: 'wo-song-2-b', songId: 'song_come', title: 'Come', serviceSections: ['wo-section-3'], sectionId: 'wo-section-3' };

  const songs = [other, shared()];
  const made = C.split(songs, LIST);
  check('an entry in two sections is split into a copy for each', made === 1 && songs.length === 3, made + ' / ' + songs.length);
  const [, first, copy] = songs;
  check('...the entry keeps its id (and so its medley) and its first section',
    first.id === 'wo-song-1-a' && JSON.stringify(first.serviceSections) === '["wo-section-3"]' && first.sectionId === 'wo-section-3');
  check('...the copy is in the other, under an id two devices agree on',
    copy.id === 'wo-song-1-a_in_wo-section-16' && JSON.stringify(copy.serviceSections) === '["wo-section-16"]' && copy.sectionId === 'wo-section-16');
  check('...with the same arrangement: key, words, version, page marks, slides, and the note',
    copy.transposeSteps === 2 && copy.customLyrics === first.customLyrics && copy.versionId === 'ver_1' &&
    copy.annotations.length === 1 && copy.savedSlides.length === 1 && copy.liturgistNotes === 'Into the prayer');
  copy.annotations.push({ d: 'M2 2' });
  copy.transposeSteps = 5;
  check('...and its own, not the entry\'s: changing it changes nothing on the other', first.annotations.length === 1 && first.transposeSteps === 2);
  check('split again, nothing more is made', C.split(songs, LIST) === 0 && songs.length === 3);

  // Saved by a device that had not split it, next to a copy another made.
  const again = [shared(), Object.assign(shared(), { id: 'wo-song-9-z', serviceSections: ['wo-section-16'], sectionId: 'wo-section-16' })];
  check('a section that already has a copy only loses the shared entry',
    C.split(again, LIST) === 0 && again.length === 2 && JSON.stringify(again[0].serviceSections) === '["wo-section-3"]');

  const kinds = [Object.assign(shared(), { serviceSections: ['praise', 'dismissal'] })];
  check('an entry stored by section KIND is split by the same rule the views place it by',
    C.split(kinds, LIST) === 1 && kinds[1].id === 'wo-song-1-a_in_wo-section-16');
  const gone = [Object.assign(shared(), { serviceSections: ['wo-section-3', 'wo-section-99'] })];
  check('a section no longer in the order makes no copy', C.split(gone, LIST) === 0 && gone.length === 1);

  const fresh = C.copy(shared(), 'wo-section-6');
  check('a copy made by adding the song again starts without the other moment\'s note, under a new id',
    fresh.liturgistNotes === '' && /^wo-song-\d+-[a-z0-9]+$/.test(fresh.id) && fresh.id !== 'wo-song-1-a' && fresh.transposeSteps === 2);
  check('a section duplicated keeps the note', C.copy(shared(), 'wo-section-6', null, true).liturgistNotes === 'Into the prayer');

  const both = [first, copy, other];
  check('the copy in a section is found by section, and the first anywhere without one',
    C.inSec(both, 'song_wpy', 'wo-section-16', LIST) === copy && C.inSec(both, 'song_wpy', 'wo-section-3', LIST) === first &&
    C.inSec(both, 'song_wpy', '', LIST) === first && C.inSec(both, 'song_wpy', 'wo-section-6', LIST) === null);
}

console.log('\nWhere copies are made, and split');
check('the builder\'s Add a song makes a copy for a song sung elsewhere, and places one waiting in no section',
  has(/var entry = existing \? _woSongCopy\(existing, secId\) : _woNewSongEntry\(libSong, secId\);/) &&
  has(/var loose = !!existing && !_woSongSectionIds\(existing, list\)\.length;/) &&
  !has(/if \(existing\) \{\r?\n\s*_lbdPlaceSong\(existing, secId, list\);/));
check('...and so does the Songbook\'s, with LCD Projection in the page',
  has(/entry = entry \? _woSongCopy\(entry, secId\) : _woNewSongEntry\(libSong, secId\);/));
check('a section duplicated gets copies of its songs', has(/songs\.forEach\(function\(s\) \{ songOrderSections\.push\(_woSongCopy\(s, nid, null, true\)\); \}\);/));
check('an order is split as it opens',
  has(/songOrderSections = order\.songs \|\| \[\];\r?\n(\s*\/\/[^\n]*\r?\n)*\s*if \(songOrderSections\.some\(function\(s\) \{ return s && Array\.isArray\(s\.serviceSections\) && s\.serviceSections\.length > 1; \}\)\) \{\r?\n\s*_woSplitSharedSongs\(songOrderSections, _woSectionList\(\)\);/));
check('...and as a shared Songbook link opens it, with the order\'s own sections and each copy\'s version',
  has(/songOrderSections = songs;\r?\n\s*_woSplitSharedSongs\(songOrderSections, _woSectionList\(\)\);\r?\n\s*openSongbook\(\);/) &&
  has(/currentOrderData\.sectionLayout = orderMeta\.template\.sectionLayout;/) &&
  has(/liturgistNotes: cust\.liturgistNotes \|\| '',\r?\n(\s*\/\/[^\n]*\r?\n)*\s*versionId: cust\.versionId \|\| ''\r?\n\s*\}\);/));
check('every song picker says "In this section" of any copy there',
  (SRC.match(/_woSongCopyIn\(s\.id, (sec|secId|st\.sectionId), list\)/g) || []).length === 3 &&
  !has(/var here = !*\(?o &&[^;\n]*_woSongSectionIds\(o, list\)\.indexOf/));
check('the playlist plays a video once, however many copies carry it',
  has(/if \(!url \|\| seen\[url\]\) return;\r?\n\s*seen\[url\] = true;/) &&
  has(/function sbOpenPlaylist\(\) \{\r?\n\s*var items = _sbCurrentPlaylistItems\(\);/));

console.log('\nA copy\'s library links follow the library');
const syncFns = ['function _woLinkList(', 'function _woSyncLibLinks('].map(extract);
check('the library\'s links are taken by a function of their own', syncFns.every(Boolean));
if (syncFns.every(Boolean)) {
  const W = { LHC_STATE: { songs: [
    { id: 'song_wpy', youtube: ['https://www.youtube.com/watch?v=NEW'], attachments: [{ url: 'https://x/new.pdf', name: 'Chart' }] },
    { id: 'song_str', youtube: 'https://youtu.be/A, https://youtu.be/B', attachments: [] }
  ] } };
  const S = new Function('window', 'var songOrderSections = [];\n' + syncFns.join('\n') + '\nreturn function(songs) { return _woSyncLibLinks(songs); };')(W);
  const copy = { id: 'c1', songId: 'song_wpy', youtube: ['https://www.youtube.com/watch?v=OLD'], attachments: [],
                 customYoutube: ['https://youtu.be/MINE'], removedLibraryYoutubeUrls: ['https://www.youtube.com/watch?v=OLD'] };
  const other = { id: 'c2', songId: 'song_str', youtube: [], attachments: [] };
  const gone = { id: 'c3', songId: 'song_deleted', youtube: ['https://youtu.be/KEEP'] };
  const blank = { id: 'b1', itemType: 'blank', songId: 'song_wpy' };
  const n = S([copy, other, gone, blank]);
  check('a video replaced in the library replaces the copy\'s, one for one (the old refresh took only MORE videos)',
    JSON.stringify(copy.youtube) === '["https://www.youtube.com/watch?v=NEW"]' && copy.attachments[0].name === 'Chart', JSON.stringify(copy));
  check('...the service\'s own links and its hidden ones are left as they are',
    JSON.stringify(copy.customYoutube) === '["https://youtu.be/MINE"]' && copy.removedLibraryYoutubeUrls.length === 1);
  check('...a library list kept as text is read as a list', JSON.stringify(other.youtube) === '["https://youtu.be/A","https://youtu.be/B"]');
  check('...a song no longer in the library, and a notes page, are not touched',
    JSON.stringify(gone.youtube) === '["https://youtu.be/KEEP"]' && blank.youtube === undefined && n === 2, n);
  check('...and run again it changes nothing', S([copy, other, gone]) === 0);
  W.LHC_STATE.songs = [];
  copy.youtube = ['x'];
  check('with the library not loaded yet it waits, rather than emptying every copy', S([copy]) === 0 && copy.youtube[0] === 'x');
}
check('it runs as an order opens, as the Songbook opens and redraws, and as the library reloads',
  has(/\/\/ The library's links as the library has them now\.\r?\n\s*_woSyncLibLinks\(\);/) &&
  has(/\/\/ Each song's library links as the library has them now\.\r?\n\s*_woSyncLibLinks\(\);/) &&
  has(/function renderSongbookLive\(\) \{\r?\n(\s*\/\/[^\n]*\r?\n)*\s*_woSyncLibLinks\(\);/) &&
  has(/lcdRefreshLibrary: function\(\) \{\r?\n(\s*\/\/[^\n]*\r?\n)*\s*if \(_woSyncLibLinks\(\) && _sbmBookOpen\(\)\) renderSongbookLive\(\);/));

console.log('\nIn the Songbook');
// The notice under the song's title went on 2026-11-07 (the operator: it
// stood between a singer and the words). That the drawings are shared, and
// Own drawings, are in the Drawings window; Copy an arrangement is in More.
check('no notice on the song\'s card any more', has(/\(mdHere \? _sbmMedleyRibbon\(song, mdHere\) : ''\) \+ '<\/div>';/) &&
  !has(/_sbmTwiceRibbon/) && !has(/sbm-twice/));
check('...the Drawings window says a copy shares its drawings, and offers Own drawings',
  has(/var same = _sbmOtherCopies\(song\)\.filter\(function\(x\) \{ return \(x\.versionId \|\| ''\) === \(song\.versionId \|\| ''\); \}\);/) &&
  has(/onclick="WO\.sbmCloseSheet\(\);WO\.sbmOwnVersion\(\)"/) && has(/html \+= _sbmSharedDrawingsNote\(song\) \+ _sbmWhoNote\(\);/));
// (2026-11-08: Copy an arrangement became Earlier versions: tools/songbook-earlier-versions-harness.js.)
check('Versions (once Earlier versions, once Copy an arrangement) is in More for any song of a service', has(/if \(song && \(order \|\| _sbVerOk === true\)\) rows\.push\(\['fa-code-branch', 'Save \/ Load Versions', 'WO\.sbmVersions\(\)'/));
check('copying is one step with Undo, saved like a version chosen',
  has(/var before = _sbArrSnap\(song\);\r?\n\s*_sbArrApply\(song, r\.src\);\r?\n\s*_sbVerSaved\(\);/) &&
  has(/_sbArrRestore\(song, before\);\r?\n\s*_sbVerSaved\(\);/));
check('...a version is copied only while it still exists',
  has(/song\.versionId = \(src\.versionId && _sbVerById\(base, src\.versionId\)\) \? src\.versionId : '';/));
check('Own drawings saves the copy as a version, through the same save as Versions',
  has(/return _sbVerSaveAs\(song, name\)\.catch\(function\(\) \{\}\);/) &&
  has(/_sbVerSaveNamed\(song, name\)\.then\(function\(\) \{ if \(btn\) btn\.disabled = false; \}, function\(\) \{ if \(btn\) btn\.disabled = false; \}\);/) &&
  has(/if \(!x\) return _sbVerSaveAs\(song, name\);/) &&
  has(/return sup\.from\('song_versions'\)\.insert\(row\)\.select\(\)\.then/) && has(/\s+return v;\r?\n\s*\}\);\r?\n\s*\}\)\.catch\(function\(err\) \{\r?\n[^\n]*\r?\n\s*throw err;/));

const earlierSrc = extract('function _sbArrEarlier(');
check('the earlier services are read by a function of their own', !!earlierSrc);
if (earlierSrc) {
  const fake = { items: [
      { id: 'a', order_id: 'order_now', section_id: 'wo-section-3', customizations: {} },
      { id: 'b', order_id: 'standalone_sb1', section_id: '', customizations: {} },
      { id: 'c', order_id: 'order_old', section_id: 'wo-section-3', customizations: { transposeSteps: 2, customLyrics: 'G\nwords', versionId: 'v1', annotations: [1, 2] }, ta: [{}], cols: 2 },
      { id: 'd', order_id: 'order_older', section_id: 'wo-section-9', customizations: {}, ta: null, cols: null }
    ], orders: [
      { id: 'order_old', title: 'Service - Oct 4', created_date: '2026-09-20', layout: [{ id: 'wo-section-3', title: '4. Praise & Worship' }] },
      { id: 'order_older', title: 'Service - Aug 2', created_date: '2026-07-20', layout: [] }
    ] };
  const asked = [];
  const chain = data => { const c = { select(q) { asked.push(q); return c; }, eq() { return c; }, in(k, v) { asked.push(v.join(',')); return c; },
    then(f, g) { return Promise.resolve({ data: data, error: null }).then(f, g); } }; return c; };
  const E = new Function('window', 'currentOrderData',
    'function _sbBaseSongId(s) { return s.songId; }\nfunction _woStripNum(t) { return String(t).replace(/^\\s*\\d+\\.\\s*/, ""); }\n' + earlierSrc + '\nreturn _sbArrEarlier;')(
    { _supabase: { from: t => chain(t === 'order_items' ? fake.items : fake.orders) } }, { id: 'order_now' });
  E({ songId: 'song_x' }).then(rows => {
    check('...not this service, nor a standalone songbook; the newest service first, its section by name',
      rows.length === 2 && rows[0].title === 'Service - Oct 4' && rows[0].sub === 'Praise & Worship' && rows[1].title === 'Service - Aug 2' && rows[1].sub === '' &&
      asked.indexOf('order_old,order_older') !== -1, JSON.stringify(rows.map(r => [r.title, r.sub])));
    const src = rows[0] && rows[0].src;
    check('...each as an arrangement: its key, words, version, page marks and columns',
      !!src && src.steps === 2 && src.customLyrics === 'G\nwords' && src.versionId === 'v1' && src.annotations.length === 2 &&
      src.textAnnotations.length === 1 && src.sbLyricsColumns === 2 && rows[1].src.sbLyricsColumns === 1, JSON.stringify(src));
    finish();
  }, err => { check('...read', false, err && err.message); finish(); });
} else finish();

function finish() {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (EXPECT_BROKEN) {
    if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
    console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
  }
  process.exit(failed ? 1 : 0);
}
