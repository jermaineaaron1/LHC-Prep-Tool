'use strict';
// Harness for versions of a song: the way a service sings it (its key, its
// words as that service had them, the remarks drawn on it), kept with the
// song so a later service can sing it the same way.
//
// WHY THIS EXISTS
// Before versions, every remark drawn in the Songbook's reading view
// belonged to the song alone, so drawing for one service marked the song for
// every service. A version owns its remarks (song_marks.version_id), and
// three things have to hold for that to mean anything:
//
//   * every view that shows remarks -- the card, the printed page, the
//     Phone view -- shows only the remarks of the version the service sings;
//   * a remark drawn is saved on that version, and only once the database
//     has the column, or every stroke is refused;
//   * which version a service sings survives every path a copy of a song
//     takes: the full save, the songbook's quick sync, another device's
//     broadcast and poll, a reload, a standalone songbook.
//
// The words are kept WHOLE, as the service had them. A transposition made in
// Song Order was saved as the copy's own text (the 30 Aug order's songs all
// look "re-worded" against the library for that reason), so "did this
// service change the words?" has no good answer against the song itself;
// against a version, whose words were copied verbatim, it has.
//
// Checked against the shipped functions, sliced out of Index.html by brace
// balance.
//
// USAGE
//   node tools/songbook-versions-harness.js
//   node tools/songbook-versions-harness.js path/to/file.html
//   node tools/songbook-versions-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before versions:
// there the helpers do not exist and the harness must fail.
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
const MIGRATION = path.join(path.dirname(INDEX), 'migrations', '2026-11-01_song_versions.sql');
const MIGRATION_ALT = path.join(__dirname, '..', 'migrations', '2026-11-01_song_versions.sql');

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

// The app's own chord transposers, top level in the page: what moves a
// chart into another key, and what decides which lines are chords.
function extractTop(name) {
  const startIdx = lines.findIndex(l => new RegExp('^function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('top-level function not found: ' + name);
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
  const l = lines.find(x => new RegExp('^var ' + name + ' = ').test(x));
  if (!l) throw new Error('var not found: ' + name);
  return l;
}

let T = null;
try {
  const vars = ['CHORD_NOTES', 'FLAT_TO_SHARP', 'CHORD_TOKEN_RE', 'SHARP_TO_FLAT', 'FLAT_KEY_ROOTS'].map(extractVar);
  const top = ['isChordToken', 'isChordLineGlobal', 'transposeChord', 'transposeLine', '_keyDistance', '_spellChordsForKey',
               '_transposeChordRowKeepingColumns', '_transposeChordLinesOnly'].map(extractTop);
  const names = ['_sbVerMarks', '_sbVerNorm', '_sbVerWordsOf', '_sbVerDrift', '_sbLinkWith', '_sbSongShareMessage',
                 '_sbVerSung', '_sbVerIsChordLine', '_sbVerHasChords', '_sbVerWordsAlone', '_sbVerMainOf', '_sbVerRebase'];
  T = new Function(vars.join('\n') + '\n' + top.join('\n') + '\n' + names.map(extractFn).join('\n') +
    '\nreturn {' + names.map(n => n + ':' + n).join(',') + '};')();
} catch (e) {
  console.log('  (helpers not present: ' + e.message.split('\n')[0] + ')');
}

console.log('\nA version shows only its own drawn remarks');
if (!T) {
  check('the version helpers exist', false, 'none of them is in this source');
} else {
  const marks = [
    { id: 'a', version_id: null }, { id: 'b' }, { id: 'c', version_id: 'v1' }, { id: 'd', version_id: 'v2' }, null
  ];
  const ids = l => l.map(m => m.id).join(',');
  check("Standard's are the remarks with no version, null or missing", ids(T._sbVerMarks(marks, '')) === 'a,b');
  check('a copy with no version at all sings Standard', ids(T._sbVerMarks(marks, undefined)) === 'a,b');
  check("a version's are its own and nobody else's", ids(T._sbVerMarks(marks, 'v1')) === 'c');
  check('a version with none has none', T._sbVerMarks(marks, 'v9').length === 0);
  check('no remarks loaded yet is no remarks, not a crash', T._sbVerMarks(undefined, 'v1').length === 0);
}

console.log('\nThe words a version keeps');
if (T) {
  const copy = { customLyrics: 'G  C\nAmazing grace', lyrics: 'ignored', richLyrics: '<div>rich</div>', masterLyrics: 'G\nAmazing grace' };
  const w = T._sbVerWordsOf(copy);
  check("the copy's own words, as it shows them", w.lyrics === 'G  C\nAmazing grace' && w.rich === '<div>rich</div>');
  const plain = T._sbVerWordsOf({ lyrics: 'Amazing grace', masterLyrics: 'Amazing grace' });
  check('a copy with no words of its own keeps the words it shows', plain.lyrics === 'Amazing grace' && plain.rich === null);
  check('a copy with nothing gives empty words, never undefined', T._sbVerWordsOf({}).lyrics === '' && T._sbVerWordsOf(null).lyrics === '');
  check('spacing is not a change of words', T._sbVerNorm('  Amazing\r\n grace  ') === T._sbVerNorm('Amazing grace'));
  check('a changed word is', T._sbVerNorm('Amazing grace') !== T._sbVerNorm('Amazing face'));
}

console.log('\nHow a service has moved from the version it sings');
if (T) {
  const v = { id: 'v1', transpose_steps: -5, lyrics: 'D  G\nLord, I need you', rich_lyrics: '<div>r</div>' };
  const copy = { customLyrics: 'D  G\nLord, I need you', richLyrics: '<div>r</div>' };
  const d0 = T._sbVerDrift(copy, v, -5);
  check('just chosen, nothing has moved', !d0.key && !d0.words, JSON.stringify(d0));
  check('a different key is a change of key', T._sbVerDrift(copy, v, -4).key === true);
  check('steps given as text read as numbers', T._sbVerDrift(copy, v, '-5').key === false);
  check('edited words are a change of words', T._sbVerDrift(Object.assign({}, copy, { customLyrics: 'D  G\nLord, we need you' }), v, -5).words === true);
  check('so is a change only to how they are drawn', T._sbVerDrift(Object.assign({}, copy, { richLyrics: '<div>r2</div>' }), v, -5).words === true);
  check('re-spaced words are not', T._sbVerDrift(Object.assign({}, copy, { customLyrics: 'D  G\r\nLord, I need you  ' }), v, -5).words === false);
  const s = T._sbVerDrift({ customLyrics: 'something transposed', richLyrics: '<div>x</div>', masterLyrics: 'the song' }, null, 0);
  check("against Standard the words are never asked -- a Song Order transposition looks like new words", s.words === false && s.key === false);
  check("against Standard a moved key is", T._sbVerDrift({}, null, 3).key === true);
}

console.log("\nThis service's way made the song's main version");
if (T) {
  const chart = '[Verse 1]\nG       C       G\nAmazing grace how sweet the sound\nG              D\nThat saved a wretch like me';
  const m = T._sbVerMainOf(chart, 2, 'G', 'G');
  const ln = m.lyrics.split('\n');
  check('the key is the one it is sung in', m.key === 'A', m.key);
  check('the chords are written in that key, over the same columns', ln[1] === 'A       D       A' && ln[3] === 'A              E', JSON.stringify(ln));
  check('the words, and the section, are left alone', ln[0] === '[Verse 1]' && ln[2] === 'Amazing grace how sweet the sound' && ln[4] === 'That saved a wretch like me');
  check("the song's key moves by as much", m.moved === 2);
  const same = T._sbVerMainOf(chart, 0, 'G', 'G');
  check('in its own key nothing moves', same.lyrics === chart && same.key === 'G' && same.moved === 0);
  check('steps as text read as numbers', T._sbVerMainOf(chart, '-2', 'G', 'G').key === 'F');
  const down = T._sbVerMainOf(chart, -7, 'G', 'G');
  check("a long way down is the short way up for the song's key", down.key === 'C' && down.moved === 5, JSON.stringify([down.key, down.moved]));
  check('a song with no key keeps none, and its chords still move', T._sbVerMainOf('G\nHallelujah', 2, '', '').key === '' &&
    T._sbVerMainOf('G\nHallelujah', 2, '', '').lyrics === 'A\nHallelujah');
  check('"A mighty fortress" is a line of words, not of chords', T._sbVerMainOf('A mighty fortress is our God', 2, 'C', 'C').lyrics === 'A mighty fortress is our God');

  // Another version of the song, written again from the new key: it must
  // sound as it did, and a service singing it must not be told it changed.
  const v = { id: 'v1', transpose_steps: -2, lyrics: chart, rich_lyrics: null };
  const p = T._sbVerRebase(v, 2, 'A');
  check('a version moved with its song has steps from the new key', p.transpose_steps === -4);
  check('and its chords written from the new key', p.lyrics.split('\n')[1] === 'A       D       A');
  check('so it sounds exactly as it did', T._sbVerSung(p.lyrics, p.transpose_steps) === T._sbVerSung(v.lyrics, v.transpose_steps));
  check('no move is no change', JSON.stringify(T._sbVerRebase(v, 0, 'G')) === JSON.stringify({ transpose_steps: -2, lyrics: chart, rich_lyrics: null }));
  const old = { customLyrics: chart };
  const d1 = T._sbVerDrift(old, Object.assign({}, v, p), -2);
  check('a service that chose it before the move sees no change', !d1.key && !d1.words, JSON.stringify(d1));
  const d2 = T._sbVerDrift(old, Object.assign({}, v, p), 0);
  check('but one that has since moved its key does, and only the key', d2.key && !d2.words, JSON.stringify(d2));
  const d3 = T._sbVerDrift({ customLyrics: chart.replace('wretch', 'soul') }, Object.assign({}, v, p), 0);
  check('and new words are new words, whatever the key', d3.words === true);
  check('spelling is not a change: Bb is A#', T._sbVerSung('Bb  F\nla', 0) === T._sbVerSung('A#  F\nla', 0));
}

console.log('\nA link to one song, and the message that carries it');
if (T) {
  check('a link without a query gains one', T._sbLinkWith('https://x.app/', 'sbSong', 'wo-song-1') === 'https://x.app/?sbSong=wo-song-1');
  check('a link with one gains a parameter', T._sbLinkWith('https://x.app/?sb=order-9', 'sbSong', 'wo song') === 'https://x.app/?sb=order-9&sbSong=wo%20song');
  const msg = T._sbSongShareMessage({ title: 'Lord, I Need You', key: 'D', fromKey: 'G', version: 'Communion - quiet',
    medley: 'Medley: sung straight into “10,000 Reasons”', service: 'Service - 30 Aug 2026 · Aug 30',
    video: 'https://youtu.be/x', link: 'https://x.app/?sb=order-9&sbSong=s1' });
  const ln = msg.split('\n');
  check('titled', ln[0] === '*Lord, I Need You*');
  check('the key it is sung in, and the one it was moved from', ln.indexOf('Key: D (moved from G)') !== -1);
  check('its version, its medley, its service, a video', ln.indexOf('Version: Communion - quiet') !== -1 &&
    ln.some(l => /^Medley: /.test(l)) && ln.indexOf('For: Service - 30 Aug 2026 · Aug 30') !== -1 && ln.indexOf('Listen: https://youtu.be/x') !== -1);
  check('the link, then the signature', ln.indexOf('Open it in the Songbook: https://x.app/?sb=order-9&sbSong=s1') > 0 && ln[ln.length - 1] === '_LHC Worship Prep_');
  const bare = T._sbSongShareMessage({ title: 'Song', key: 'G', fromKey: 'G', link: 'L' });
  check('a song in its own key, on Standard, says only that', bare === '*Song*\nKey: G\n\nOpen it in the Songbook: L\n\n_LHC Worship Prep_', JSON.stringify(bare));
}

console.log('\nThe wiring');
{
  const has = re => re.test(SRC);
  check('a remark is drawn on the version the service sings, once the column exists',
    has(/if \(_sbVerOk === true\) mark\.version_id = song\.versionId \|\| null;/));
  check('the card paints only that version\'s remarks', has(/var marks = _sbmMarksOf\(base, song && song\.versionId\), memo = \{\}/));
  check('so does the printed page, lyrics and choir score',
    has(/_sbMarksInjectLyrics\(_songDiv, _sbBaseSongId\(song\), song\.versionId\)/) && has(/_sbMarksInjectScore\(_prChoir, _sbBaseSongId\(song\), song\.versionId\)/) &&
    has(/function _sbMarksInjectLyrics\(songDiv, base, versionId\) \{\r?\n\s*var marks = _sbmMarksOf\(base, versionId\)/));
  check('and the Phone view, which is told the version too',
    has(/marks: _sbmMarksOf\(base, song\.versionId\) \};/) && has(/_SBM_PHONE_FIELDS = \[[^\]]*'versionId'\]/));
  check('a loaded copy knows its version', has(/versionId: cust\.versionId \|\| ''/));
  check('the full save writes it', has(/versionId: songData\.versionId \|\| undefined/));
  check('the quick sync writes it, and clears it going back to Standard',
    has(/\(snap\.versionId \|\| \(base\.customizations && base\.customizations\.versionId\)\) \? \{ versionId: snap\.versionId \|\| '' \} : \{\}/));
  check('another device is told, and follows', has(/versionId:       s\.versionId \|\| '',/) &&
    has(/if \(typeof inc\.versionId === 'string' && inc\.versionId !== \(song\.versionId \|\| ''\)\) \{/));
  check('the polls carry it', (SRC.match(/versionId:\s+typeof c\.versionId === 'string' \? c\.versionId : ''/g) || []).length === 2);
  check('a standalone songbook keeps it', has(/versionId: saved\.versionId \|\| ''/) && has(/versionId:\s+s\.versionId \|\| ''\r?\n\s*\};/));
  check('a link to one song opens the book at it',
    has(/window\.__DEEPLINK_SBSONG\s+= p\.get\('sbSong'\)/) && has(/localStorage\.setItem\('lhc_sbm_song_' \+ _deepSb\.replace\(\/\^\(order\|sb\)-\/, ''\), _deepSbSong\)/));
  check('versions are offered only once the database has them', has(/_sbVerOk = !rs\[0\]\.error && !rs\[1\]\.error;/));
  check('a saved version is read back before it is reported as kept',
    has(/return sup\.from\('song_versions'\)\.select\('id'\)\.eq\('id', v\.id\);/) && has(/throw new Error\('the database did not keep it'/));
  check('making it the main version keeps the song as it was first, then writes only its words and key',
    has(/keepRow = Object\.assign\(\{ song_id: base, name: keepName, made_from: null \}/) &&
    has(/SBQ_SONGS\.updateFields\(base, \{ lyrics: m\.lyrics, key: m\.key, last_edited: nowIso \}\)/) &&
    !has(/SBQ_SONGS\.update\(\{[^)]*m\.lyrics/));
  check('and reads the song back, and tells the open orders', has(/sup\.from\('songs'\)\.select\('lyrics, key'\)\.eq\('id', base\)\.maybeSingle\(\)/) &&
    has(/SBQ_SONGS\._announceSongChange\(base, m\.lyrics\);/));
  check('the sheet lists the saved versions and offers it', has(/<span>Saved versions<\/span><span class="ver-head__n">/) &&
    has(/onclick="WO\.sbVerMakeMain\(\)"/) && has(/sbVerMakeMain: sbVerMakeMain/));
  const mig = fs.existsSync(MIGRATION) ? MIGRATION : (fs.existsSync(MIGRATION_ALT) ? MIGRATION_ALT : null);
  const sql = mig ? fs.readFileSync(mig, 'utf8') : '';
  check('the migration makes the table, readable through the app\'s key',
    /create table if not exists public\.song_versions/.test(sql) && /rich_lyrics\s+text/.test(sql) && /create policy "anon_all_song_versions"/.test(sql));
  check('and a remark\'s version, which goes when its version goes',
    /add column if not exists version_id uuid references public\.song_versions \(id\) on delete cascade/.test(sql));
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
if (EXPECT_BROKEN) {
  if (fail) { console.log('(--expect-broken: failures expected, and found)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)');
  process.exit(1);
}
process.exit(fail ? 1 : 0);
