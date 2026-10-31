'use strict';
// Harness for the Songbook as step 2 of an order: medleys, moving songs
// around them, the order's inbox, and the song list the Songbook shares.
//
// WHY THIS EXISTS
// Song Order was retired as a step and the Songbook took its place, with
// three things Song Order never had or had wrong:
//
//   * medleys -- songs sung one straight into the next -- kept as a set in
//     the order's template, with the running order of songOrderSections
//     saying in what order they are sung. Every list of songs a person
//     reads brings a medley's songs together, and every move keeps them
//     together, or a medley shows up split by a song that is not in it;
//   * links shared to a service landing in its inbox from four routes,
//     several of which also write the localStorage copy the order's load
//     reads -- so the same link arrived twice unless it is matched by what
//     it is;
//   * the shared song list, which numbered blank pages as songs and put
//     the songs in the order they were added rather than sung.
//
// Each is checked here against the shipped functions, sliced out of
// Index.html by brace balance and run with their dependencies stubbed.
//
// USAGE
//   node tools/songbook-step-harness.js
//   node tools/songbook-step-harness.js path/to/file.html
//   node tools/songbook-step-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the
// change: there the helpers do not exist, and the harness must fail.
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

function extractFn(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('function not found in ' + path.basename(INDEX) + ': ' + name);
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

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

function load(names, prelude) {
  const fns = names.map(n => extractFn(n));
  return new Function((prelude || '') + '\n' + fns.join('\n') + '\nreturn {' + names.map(n => n + ':' + n).join(',') + '};')();
}

let T = null;
try {
  T = load(['_woMedleyList', '_woRunWithMedleys', '_woUnits', '_woFlatUnits', '_woStepInSeq', '_woDropInSeq', '_woWriteSeq',
            '_woInboxKey', '_sbShareMessage', '_lcType', 'soExtractYouTubeId', '_woAttachInboxItem', '_woDetachInboxItem']);
} catch (e) {
  console.log('  (helpers not present: ' + e.message.split('\n')[0] + ')');
}

const S = id => ({ id: id, title: id.toUpperCase() });
const ids = list => (list || []).map(s => s.id).join(',');

console.log('\nMedleys: what a stored medley means now');
if (!T) {
  check('the medley, inbox and share helpers exist', false, 'none of them is in this source');
} else {
  const songs = ['a', 'b', 'c', 'd', 'e'].map(S).concat([{ id: 'blank1', itemType: 'blank' }]);
  const sec = { a: 's1', b: 's1', c: 's1', d: 's2', e: 's2' };
  const secOf = s => sec[s.id] || '';
  const rank = k => ({ s1: 0, s2: 1 })[k] != null ? ({ s1: 0, s2: 1 })[k] : Infinity;
  const L = raw => T._woMedleyList(raw, songs, secOf, rank).map(m => m.id + ':' + m.songs.join('+')).join(' ');

  check('a medley of songs in the order stands', L([{ id: 'm1', songs: ['a', 'b'] }]) === 'm1:a+b');
  check('a song that has left the order leaves its medley',
    L([{ id: 'm1', songs: ['a', 'gone', 'b'] }]) === 'm1:a+b');
  check('a medley left with one song is no medley', L([{ id: 'm1', songs: ['a', 'gone'] }]) === '');
  check('a blank page is never in a medley', L([{ id: 'm1', songs: ['a', 'blank1'] }]) === '');
  check('a song is in one medley only: the first that holds it keeps it',
    L([{ id: 'm1', songs: ['a', 'b'] }, { id: 'm2', songs: ['b', 'c'] }]) === 'm1:a+b');
  check('the same song twice in one medley counts once', L([{ id: 'm1', songs: ['a', 'a', 'b'] }]) === 'm1:a+b');
  check('a member moved to another section drops out; the rest stay a medley',
    L([{ id: 'm1', songs: ['a', 'b', 'd'] }]) === 'm1:a+b');
  check('a two-song medley split across sections is broken up (a tie goes to the earlier section)',
    L([{ id: 'm1', songs: ['d', 'a'] }]) === '');
  check('a medley needs an id and a list', L([{ songs: ['a', 'b'] }, null, { id: 'm3' }]) === '');
  check('nothing stored, no medleys', L(undefined) === '' && L('junk') === '');
}

console.log('\nThe running order: a medley stands together');
if (T) {
  const list = ['x', 'a', 'y', 'b', 'z'].map(S);
  const md = [{ id: 'm1', songs: ['a', 'b'] }];
  check("a medley's songs are brought together where the first of them stands",
    ids(T._woRunWithMedleys(list, md)) === 'x,a,b,y,z', ids(T._woRunWithMedleys(list, md)));
  check('in the order the list already has them, not the order they were stored',
    ids(T._woRunWithMedleys(list, [{ id: 'm1', songs: ['b', 'a'] }])) === 'x,a,b,y,z');
  check('with no medleys the list is untouched', ids(T._woRunWithMedleys(list, [])) === 'x,a,y,b,z');
  const withBlank = [S('a'), { id: 'p', itemType: 'blank' }, S('b'), S('c')];
  check('a blank page between a medley\'s songs stays, after the medley',
    ids(T._woRunWithMedleys(withBlank, md)) === 'a,b,p,c');
  check('nothing is lost or doubled',
    T._woRunWithMedleys(list, md).length === list.length);
}

console.log('\nMoving a song a place up or down');
if (T) {
  const md = [{ id: 'm1', songs: ['b', 'c'] }];
  const seq = ['a', 'b', 'c', 'd'].map(S);
  const step = (id, d, m) => { const r = T._woStepInSeq(seq, id, d, m === undefined ? md : m); return r ? ids(r) : null; };
  check('inside its medley a song changes places with its neighbour there', step('b', 1) === 'a,c,b,d');
  check('at the medley\'s edge it moves with the whole medley', step('c', 1) === 'a,d,b,c', step('c', 1));
  check('the first song moving up takes the medley up', step('b', -1) === 'b,c,a,d');
  check('a song moving past a medley passes the whole of it', step('d', -1) === 'a,d,b,c');
  check('a song moving down past a medley passes the whole of it', step('a', 1) === 'b,c,a,d');
  check('there is nowhere above the top', step('a', -1) === null);
  check('or below the bottom', step('d', 1) === null);
  check('a medley at the bottom cannot go lower', T._woStepInSeq(['a', 'b', 'c'].map(S), 'c', 1, [{ id: 'm', songs: ['b', 'c'] }]) === null);
  check('without medleys it is a plain swap with the neighbour', step('b', 1, []) === 'a,c,b,d' && step('a', -1, []) === null);
  check('a song that is not there goes nowhere', step('q', 1) === null);
}

console.log('\nDropping a song on another\'s place');
if (T) {
  // The songbook's old drag: take it out, put it back at the target's index.
  const old = (arr, from, to) => {
    const a = arr.slice(), fi = a.findIndex(s => s.id === from), ti = a.findIndex(s => s.id === to);
    if (fi < 0 || ti < 0 || fi === ti) return null;
    const m = a.splice(fi, 1)[0]; a.splice(ti, 0, m); return a;
  };
  const five = ['a', 'b', 'c', 'd', 'e'].map(S);
  let same = true, firstDiff = '';
  for (const f of five) for (const t of five) {
    const want = old(five, f.id, t.id), got = T._woDropInSeq(five, f.id, t.id, []);
    if ((want ? ids(want) : null) !== (got ? ids(got) : null)) { same = false; firstDiff = firstDiff || f.id + '->' + t.id; }
  }
  check('with no medleys every drop lands exactly where the old drag put it', same, firstDiff);
  const md = [{ id: 'm1', songs: ['b', 'c'] }];
  const drop = (f, t) => { const r = T._woDropInSeq(five, f, t, md); return r ? ids(r) : null; };
  check('a medley\'s song dropped lower takes the medley, landing after the target', drop('b', 'd') === 'a,d,b,c,e', drop('b', 'd'));
  check('dropped higher, it lands before the target', drop('c', 'a') === 'b,c,a,d,e', drop('c', 'a'));
  check('a song dropped on a medley stands for the whole medley: after it, going down', drop('a', 'b') === 'b,c,a,d,e', drop('a', 'b'));
  check('and before it, going up', drop('e', 'c') === 'a,e,b,c,d', drop('e', 'c'));
  check('a drop inside one medley reorders that medley', drop('c', 'b') === 'a,c,b,d,e');
  check('a song dropped on itself goes nowhere', drop('a', 'a') === null);
}

console.log('\nA section reordered inside the whole list');
if (T) {
  const all = ['a', 'p', 'b', 'q', 'c'].map(S);
  const sub = [all[0], all[2], all[4]];
  const next = [all[4], all[0], all[2]];
  const out = T._woWriteSeq(all, sub, next);
  check('its songs take each other\'s places', ids(out) === 'c,p,a,q,b', ids(out));
  check('everything else stays where it was', out[1] === all[1] && out[3] === all[3]);
  check('the whole list is a new array; the old one is untouched', out !== all && ids(all) === 'a,p,b,q,c');
  check('a sublist that does not fit changes nothing', ids(T._woWriteSeq(all, sub, next.slice(1))) === ids(all));
}

console.log('\nThe inbox: one copy of a link, however it arrives');
if (T) {
  const share = { url: 'https://youtu.be/abcdefghijk', title: 'Shared', addedAt: '1' };
  const mirror = { id: 'li_1', url: 'https://youtu.be/abcdefghijk ', title: 'https://youtu.be/abcdefghijk', addedAt: '2' };
  check('a share and the localStorage copy of it are the same item', T._woInboxKey(share) === T._woInboxKey(mirror));
  check('a different link is a different item', T._woInboxKey(share) !== T._woInboxKey({ url: 'https://youtu.be/zzzzzzzzzzz' }));
  const f1 = { isFile: true, name: 'chart.pdf', size: 120, mimeType: 'application/pdf' };
  check('a file is matched by its name, size and type', T._woInboxKey(f1) === T._woInboxKey(Object.assign({}, f1, { data: 'x', id: 'li_9' })));
  check('a file of the same name and a different size is another file', T._woInboxKey(f1) !== T._woInboxKey(Object.assign({}, f1, { size: 121 })));
  check('a link and a file never match', T._woInboxKey({ url: 'chart.pdf' }) !== T._woInboxKey({ name: 'chart.pdf' }));
}

console.log('\nAn inbox link put on a song, and taken off');
if (T) {
  const song = { id: 'wo-song-1', title: 'Song' };
  const vid = { id: 'li_v', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'A video' };
  check('a YouTube link goes to the song\'s videos', T._woAttachInboxItem(vid, song) === 'video' &&
    song.customYoutube.length === 1 && song.customYoutube[0] === vid.url);
  check('with its title and where it came from', song.customYoutubeMeta[vid.url].title === 'A video' && song.customYoutubeMeta[vid.url].inboxId === 'li_v');
  check('the inbox item is marked with its song', vid.linkedSongId === 'wo-song-1');
  T._woAttachInboxItem(vid, song);
  check('putting it on twice adds it once', song.customYoutube.length === 1);
  const doc = { id: 'li_d', url: 'https://docs.google.com/document/d/x/edit', title: 'https://docs.google.com/document/d/x/edit' };
  check('anything else with an address goes to its documents', T._woAttachInboxItem(doc, song) === 'doc' && song.customDocs.length === 1);
  check('named for its host when it has no title, kept as a Drive document',
    song.customDocs[0].name === 'docs.google.com' && song.customDocs[0].type === 'google_drive' && song.customDocs[0].inboxId === 'li_d');
  check('a file kept on the phone it came from cannot go on a song',
    T._woAttachInboxItem({ id: 'li_f', isFile: true, name: 'a.jpg' }, song) === '' && song.customDocs.length === 1);
  // The same address put on the song by hand, before: it is not this item's to remove.
  song.customDocs.push({ url: 'https://x.test/sheet', name: 'Sheet', inboxId: null });
  T._woDetachInboxItem({ id: 'li_other', url: 'https://x.test/sheet' }, song);
  check('taking an item off leaves a copy the song had before it', song.customDocs.some(d => d.url === 'https://x.test/sheet'));
  T._woDetachInboxItem(doc, song);
  check('it takes off its own document', !song.customDocs.some(d => d.url === doc.url));
  T._woDetachInboxItem(vid, song);
  check('and its own video, with what it knew of it',
    song.customYoutube.length === 0 && !song.customYoutubeMeta[vid.url] && !vid.linkedSongId);
}

console.log('\nThe song list the Songbook shares');
if (T) {
  const msg = T._sbShareMessage({ title: 'Service - 30 Aug', date: 'Aug 30', rows: [
    { section: '4. Praise & Worship', text: 'This Is Amazing Grace (G)' },
    { section: '4. Praise & Worship', text: 'Medley: Lord, I Need You (D) + 10,000 Reasons' },
    { section: '9. Song of Response', text: 'Hari Ini (F)' }
  ], songbookUrl: 'https://x/?sb=order-1', playlistUrl: 'https://x/?playlist=abc' });
  const ln = msg.split('\n');
  check('titled, dated', ln[0] === '*Service - 30 Aug*' && ln[1] === '_Aug 30_');
  check('each section named once, above its songs',
    msg.split('*4. Praise & Worship*').length === 2 && ln.indexOf('*9. Song of Response*') > ln.indexOf('2. Medley: Lord, I Need You (D) + 10,000 Reasons'));
  check('songs numbered straight through the service', ln.indexOf('1. This Is Amazing Grace (G)') !== -1 && ln.indexOf('3. Hari Ini (F)') !== -1);
  check('a medley is one line', ln.filter(l => /^\d+\. /.test(l)).length === 3);
  check('the Songbook and the playlist follow, then the signature',
    ln.indexOf('Open Songbook: https://x/?sb=order-1') > ln.indexOf('3. Hari Ini (F)') && /Playlist: https:\/\/x\/\?playlist=abc/.test(msg) && ln[ln.length - 1] === '_LHC Worship Prep_');
  const plain = T._sbShareMessage({ title: 'Book', rows: [{ section: '', text: 'One' }, { section: '', text: 'Two' }] });
  check('a book without sections lists its songs with no headings', plain === '*Book*\n\n1. One\n2. Two\n\n\n_LHC Worship Prep_', JSON.stringify(plain));
}

console.log('\nThe wiring');
{
  const has = re => re.test(SRC);
  check('step 2 of an order opens the Songbook',
    has(/id="woSongbookStepBtn" onclick="WO\.openSongbook\(\)"/));
  check('a share that arrives with an order open lands in its inbox',
    has(/window\.WO\.openSongbookInbox\(\);/));
  check('an order opened for a share opens its Songbook on it',
    has(/if \(window\._pendingShareItem && order\.id\) \{/) && has(/openSongbookInbox\(\);\r?\n\s*\}, 80\);/));
  check('the share picker\'s Send keeps the link it is sending (close() would drop it)',
    has(/close\(\);\r?\n(?:\s*\/\/.*\r?\n)*\s*window\._pendingShareItem = item;/));
  check('the Songbook lists its songs with their medleys together',
    has(/return _woRunWithMedleys\(sorted, _woMedleys\(\)\);/));
  check('the songbook\'s drag moves a medley as one', has(/var next = _woDropInSeq\(songOrderSections, fromId, toId,/));
  check('the builder\'s Move up and Move down step past a medley as one', has(/var next = _woStepInSeq\(inSec, songId, delta, _woMedleys\(\)\);/));
  check('the builder\'s undo covers medleys', has(/medleys: JSON\.stringify\(\(o\.template && o\.template\.medleys\) \|\| \[\]\)/));
  check('the shared song list is built from the running order', has(/rows: _sbShareRows\(\),/) && has(/return _woUnits\(_sbmSongs\(\), md\)\.map/));
  check('a song taken out of the songbook comes off LCD Projection\'s schedule too', has(/_woLcdDropSong\(baseSongId\);/));
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
if (EXPECT_BROKEN) {
  if (fail) { console.log('(--expect-broken: failures expected, and found)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)');
  process.exit(1);
}
process.exit(fail ? 1 : 0);
