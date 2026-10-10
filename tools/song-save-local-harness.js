'use strict';
// Regression harness for showing a saved song without waiting for the catalogue.
//
// WHY THIS EXISTS
// saveEditSong wrote the row and then called loadSongs(), which refetches EVERY
// song -- 119 KB, the lyrics of all 65 of them -- and only repaints once that
// lands. loadSongs() is not awaited, so the loader hid and the modal closed
// straight away while the list underneath still showed the old title. About a
// second on the office wifi; long enough on a phone at church to look like the
// save failed, which is how somebody presses Save twice.
//
// _applySavedSongLocally merges the row that was just written into the list in
// memory so the repaint happens immediately.
//
// WHAT THIS CHECKS
// Mostly the fields the form does NOT own. The Edit Song form knows nothing
// about use_count, last_used or date_added -- they come from orders and from
// the original insert. A merge that rebuilds the object instead of carrying
// those over would blank them on screen until the background refetch landed,
// and the sidebar statistics are drawn from exactly those numbers. That is a
// flicker nobody would attribute to the save.
//
// It also checks the two-name field: the list reads `category`, the column is
// `style`, and normalizeSongFromSupabase sets both. Setting only one means the
// song moves category on screen and moves back a second later.
//
// And that arrays are COPIED. The object handed in is the live form payload;
// sharing its arrays would let a later edit mutate the catalogue in place.
//
// USAGE
//   node tools/song-save-local-harness.js                 # ../Index.html
//   node tools/song-save-local-harness.js path/to/file.html
//   node tools/song-save-local-harness.js <file> --expect-broken
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

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

function extractFunction(name) {
  const start = lines.findIndex(l => new RegExp('^\\s*function ' + name + '\\s*\\(').test(l));
  if (start < 0) return null;
  let depth = 0, started = false;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces in ' + name);
}

const fn = extractFunction('_applySavedSongLocally');
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _applySavedSongLocally  ' + (fn ? 'found' : 'ABSENT') + '\n');

if (!fn) {
  if (EXPECT_BROKEN) {
    console.log('Absent, as expected for pre-fix source.');
    process.exit(0);
  }
  console.error('_applySavedSongLocally is missing.');
  process.exit(1);
}

let STATE;
const apply = new Function('STATE_REF',
  'var STATE = STATE_REF;\n' + fn + '\nreturn _applySavedSongLocally;');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

function freshState() {
  return {
    songs: [
      {
        id: 'song_1', title: 'Old Title', artist: 'Old Artist', theme: 'Grace',
        key: 'G', tempo: 'Slow', category: 'Hymn', style: 'Hymn', era: 'Classic',
        season: 'Advent', scripture: 'John 1', lyrics: 'old lyrics',
        youtube: ['https://a'], attachments: [{ url: 'u', name: 'n' }],
        timeSignature: '4/4', bpm: 72, serviceSuitability: ['opening'],
        display_style: { size: 1 },
        // The form knows none of these.
        useCount: 12, lastUsed: '2026-09-01', dateAdded: '2024-01-01',
        lastEdited: '2026-01-01'
      },
      { id: 'song_2', title: 'Untouched', useCount: 3 }
    ]
  };
}

const SAVED = {
  id: 'song_1', title: 'New Title', artist: 'New Artist', theme: 'Hope',
  key: 'D', tempo: 'Fast', category: 'Contemporary', era: 'Modern',
  season: 'Easter', scripture: 'Luke 2', lyrics: 'new lyrics',
  youtube: ['https://b', 'https://c'], attachments: [{ url: 'u2', name: 'n2' }],
  timeSignature: '3/4', bpm: 90, serviceSuitability: ['closing'],
  display_style: { size: 2 }
};

console.log('the edited fields reach the list');
STATE = freshState();
const ok1 = apply(STATE)(SAVED);
const s = STATE.songs[0];
check('it reports that it applied', ok1, true);
check('title', s.title, 'New Title');
check('artist', s.artist, 'New Artist');
check('key', s.key, 'D');
check('lyrics', s.lyrics, 'new lyrics');
check('youtube', s.youtube, ['https://b', 'https://c']);
check('bpm', s.bpm, 90);
check('display_style', s.display_style, { size: 2 });

console.log('\nthe list reads `category`, the column is `style` -- both move together');
check('category', s.category, 'Contemporary');
check('style', s.style, 'Contemporary');

console.log('\nfields the form never knew are carried over, not blanked');
check('useCount survives', s.useCount, 12);
check('lastUsed survives', s.lastUsed, '2026-09-01');
check('dateAdded survives', s.dateAdded, '2024-01-01');
check('lastEdited is refreshed', typeof s.lastEdited === 'string' && s.lastEdited !== '2026-01-01', true);

console.log('\nnothing else in the catalogue is touched');
check('the other song is untouched', STATE.songs[1], { id: 'song_2', title: 'Untouched', useCount: 3 });
check('the list is the same length', STATE.songs.length, 2);
check('the song stays in place', STATE.songs[0].id, 'song_1');

console.log('\narrays are copied, not shared with the form payload');
STATE = freshState();
const payload = JSON.parse(JSON.stringify(SAVED));
apply(STATE)(payload);
payload.youtube.push('https://mutated');
payload.attachments.push({ url: 'mutated' });
payload.serviceSuitability.push('mutated');
check('youtube did not follow the payload', STATE.songs[0].youtube.length, 2);
check('attachments did not follow', STATE.songs[0].attachments.length, 1);
check('serviceSuitability did not follow', STATE.songs[0].serviceSuitability.length, 1);

console.log('\nit declines rather than guessing');
STATE = freshState();
check('a song not in the list', apply(STATE)({ id: 'nope', title: 'x' }), false);
check('  and the list is unchanged', STATE.songs.length, 2);
check('no id', apply(STATE)({ title: 'x' }), false);
check('null', apply(STATE)(null), false);
STATE = { songs: null };
check('no catalogue loaded yet', apply(STATE)(SAVED), false);
STATE = {};
check('no songs key at all', apply(STATE)(SAVED), false);

console.log('\nempty values are stored as empty, not as the word undefined');
STATE = freshState();
apply(STATE)({ id: 'song_1', title: 'T' });
const e = STATE.songs[0];
check('artist', e.artist, '');
check('bpm', e.bpm, '');
check('youtube', e.youtube, []);
check('display_style', e.display_style, {});
check('  but useCount is still carried', e.useCount, 12);

console.log('\n' + '='.repeat(60));
const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN) {
  if (pass === results.length) {
    console.log('\nBUT --expect-broken was given and everything passed.');
    process.exit(1);
  }
  console.log('\nFailures above are expected for pre-fix source.');
  process.exit(0);
}
if (pass === results.length) console.log('A saved song shows at once, and keeps the numbers the form never saw.');
process.exit(pass === results.length ? 0 : 1);
