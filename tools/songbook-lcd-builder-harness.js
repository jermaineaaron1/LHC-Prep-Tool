'use strict';
// Harness for the Songbook <-> LCD Projection / Liturgy Builder fixes from the
// review of 2026-11-12 (CLAUDE.md gotcha 93):
//   - a song drawn into the schedule from elsewhere (another device's change,
//     the Songbook's Add a song) selected -- and so PROJECTED -- its first
//     slide: a key moved on a phone put a verse up over the Gospel;
//   - another device's new words reached richLyrics only, so this device
//     showed them and kept the old ones underneath, and its next save put
//     them back;
//   - a version (or an earlier arrangement) used, and its Undo, changed the
//     words and never the projected slides;
//   - a chord-only change (a few lines transposed, a chord on the choir pad)
//     re-split the slides and threw away the operator's slide work;
//   - a re-split dropped a heading the operator typed, and lost the selected
//     slide;
//   - a song inserted after a medley's song went INTO the medley.
//
// USAGE
//   node tools/songbook-lcd-builder-harness.js
//   node tools/songbook-lcd-builder-harness.js <Index.html> --expect-broken

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
process.on('uncaughtException', e => { check('no unexpected error', false, String(e && e.stack || e)); console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(1); });

if (!fn('_sbSlidesFollow')) {
  if (EXPECT_BROKEN) { console.log('--expect-broken: no _sbSlidesFollow, as expected.'); process.exit(0); }
  console.log('FAIL there is no _sbSlidesFollow'); process.exit(1);
}
if (EXPECT_BROKEN) { console.log('\nBUT --expect-broken was given and the fix is present.'); process.exit(1); }

const tokRe = (SRC.match(/\nvar CHORD_TOKEN_RE = [^\n]*/) || [''])[0];
const chordChain = tokRe + '\n' + top('lhcChordAscii') + '\n' + top('isChordToken') + '\n' + top('isChordLineGlobal') + '\n';

// ---------------------------------------------------------------------------
console.log('\n1. The slides follow the projected words, and only when they change');
const follow = () => {
  const log = [];
  const F = new Function('log', chordChain +
    'function refreshSongSlidesInOrder(id, words, o) { log.push(["refresh", id, words, !!(o && o.keepLyrics)]); }\n' +
    'function _lcdReproject() { log.push(["reproject"]); }\n' +
    fn('_sbProjectionWords') + '\n' + fn('_sbSlidesFollow') + '\nreturn _sbSlidesFollow;')(log);
  return { F, log };
};
let t = follow();
t.F({ id: 's1', lyrics: '  G       C\nAmazing grace\n\n  D\nhow sweet' }, '  F       Bb\nAmazing grace\n\n  C\nhow sweet');
check('chords alone moved (a few lines transposed, a chord on the choir pad): the slides are left alone', t.log.length === 0, J(t.log));
t = follow();
t.F({ id: 's1', lyrics: 'G\nAmazing grace, how sweet\n\nthat saved' }, 'G\nAmazing grace\n\nthat saved');
check('the words changed: split again, chord lines out, the song\'s own words kept', J(t.log) === J([['refresh', 's1', 'Amazing grace, how sweet\n\nthat saved', true], ['reproject']]), J(t.log));
t = follow();
t.F({ id: 's1', lyrics: 'words' }, null);
check('nothing to compare with: split again', t.log.length === 2);
check('"Am" as a word is a word, not a chord line', (() => { const x = follow(); x.F({ id: 's', lyrics: 'Am I not' }, 'Am I'); return x.log.length === 2; })());

console.log('\n2. Every way a copy\'s words change goes through it');
const scw = fn('_sbSetCopyWords');
check('the editor\'s save, the notepad and the few-lines transpose bar (_sbSetCopyWords): the words before, compared',
  /var before = song\.lyrics;\n\s*song\.lyrics = lyrics;/.test(scw) && /_sbSlidesFollow\(song, before\);/.test(scw) && !/refreshSongSlidesInOrder\(/.test(scw));
const ver = () => {
  const log = [];
  const V = new Function('log', chordChain +
    'var songOriginalLyrics = {}, songOriginalRichLyrics = {}, _sbCanonicalText = {};\n' +
    'function formatLyricsWithHighlights(t) { return "<p>" + t + "</p>"; }\n' +
    'function _lbdLibSong() { return { lyrics: "LIB words" }; }\n' +
    'function refreshSongSlidesInOrder(id, words) { log.push(["refresh", id, words]); }\nfunction _lcdReproject() { log.push(["reproject"]); }\n' +
    fn('_sbProjectionWords') + '\n' + fn('_sbSlidesFollow') + '\n' + fn('_sbVerSetWords') + '\nvar _SB_VER_FIELDS = ["versionId", "lyrics", "customLyrics", "hasCustomLyrics", "richLyrics", "customRichLyrics"];\nfunction _sbVerSetKey() {}\n' + fn('_sbVerRestore') +
    '\nreturn { set: _sbVerSetWords, restore: _sbVerRestore };')(log);
  return { V, log };
};
let v = ver();
const song = { id: 'c1', lyrics: 'Old verse three', masterLyrics: 'Old verse three', songId: 'song_1' };
v.V.set(song, { lyrics: 'New verse three', rich_lyrics: null });
check('a version used: its words go to the slides too', J(v.log[0]) === J(['refresh', 'c1', 'New verse three']), J(v.log));
v.V.restore(song, { versionId: '', lyrics: 'Old verse three', customLyrics: '', hasCustomLyrics: false, richLyrics: null, customRichLyrics: null, steps: 0 });
check('...and its Undo puts the old words back on the slides', J(v.log[2]) === J(['refresh', 'c1', 'Old verse three']), J(v.log));
v = ver();
v.V.set({ id: 'c2', lyrics: 'G\nSame words', masterLyrics: '' }, { lyrics: 'A\nSame words', rich_lyrics: null });
check('a version that differs only in its chords leaves the slides alone', v.log.length === 0, J(v.log));
check('an earlier arrangement used goes through the same (_sbArrApply -> _sbVerSetWords, _sbArrRestore -> _sbVerRestore)',
  /_sbVerSetWords\(song, /.test(fn('_sbArrApply')) && /_sbVerRestore\(song, snap\);/.test(fn('_sbArrRestore')));

// ---------------------------------------------------------------------------
console.log('\n3. Another device\'s words are this device\'s words');
const ab = fn('sbApplyBroadcast');
check('a broadcast or poll with new words sets the copy\'s words, not only how they are drawn',
  /if \(typeof inc\.customLyrics === 'string' && inc\.customLyrics !== \(song\.customLyrics \|\| ''\)\) \{\n\s*song\.customLyrics = inc\.customLyrics;\n\s*song\.hasCustomLyrics = !!inc\.customLyrics;\n\s*song\.lyrics = inc\.customLyrics \|\| song\.masterLyrics/.test(ab) &&
  /songOriginalLyrics\[song\.id\] = song\.lyrics;/.test(ab) && /_sbCanonicalText\[song\.id\] = song\.lyrics;/.test(ab));
check('...and is drawn again', /_sbCanonicalText\[song\.id\] = song\.lyrics;\n\s*p\.lyrics = true;\n\s*p\.words = true;/.test(ab));
check('...not while this device is typing in that song\'s words', ab.indexOf('if (!_sbActivelyEditingThisSong) {') < ab.indexOf("typeof inc.customLyrics === 'string'"));

// ---------------------------------------------------------------------------
console.log('\n4. A song drawn in from elsewhere does not take the wall');
const add = fn('addSongToServiceSection');
check('addSongToServiceSection selects its first slide only when asked to', /function addSongToServiceSection\(sectionId, songSection, silent, noSelect\)/.test(add) && /if \(firstSlideBox && !noSelect\) \{\n\s*selectSlideBox\(firstSlideBox\);/.test(add));
check('another device\'s change draws its songs without selecting them', /scratch\.serviceSectionSongs\[sec\]\.forEach\(function\(entry\) \{\n\s*addSongToServiceSection\(sec, entry, true, true\);/.test(SRC));
check('...and so does the Songbook\'s Add a song', /if \(\$\(secId \+ '-boxes'\)\) addSongToServiceSection\(secId, entry, true, true\);/.test(fn('_woAddSongToSection')));

// ---------------------------------------------------------------------------
console.log('\n5. A re-split keeps the typed heading and the selected slide');
const rs = fn('refreshSongSlidesInOrder');
check('the same number of slides: the heading on the page is the one the data kept', /var hdr = \(newSavedSlides\[idx\] && newSavedSlides\[idx\]\.header\) \|\| '';/.test(rs) && !/var headerHtml = slide\.header\n/.test(rs));
check('a different number: the same, for the new boxes', /var hdr2 = \(newSavedSlides\[idx\] && newSavedSlides\[idx\]\.header\) \|\| '';/.test(rs));
check('...and the slide that was selected is selected again at its place',
  /existingBoxes\.forEach\(function\(box, i\) \{ if \(box\.classList\.contains\('selected'\)\) selAt = i; \}\);/.test(rs) &&
  /if \(selAt > -1\) \{\n\s*var again = [^\n]*\n\s*var back = again\[Math\.min\(selAt, again\.length - 1\)\];\n\s*if \(back\) selectSlideBox\(back\);/.test(rs));

// ---------------------------------------------------------------------------
console.log('\n6. A song inserted after a medley\'s song goes after the medley');
const ins = (afterId) => {
  const list = [{ id: 'a' }, { id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'z' }];
  const E = new Function('songOrderSections', 'showToast', `
    function _woSectionList() { return []; }
    function _woSongCopyIn() { return null; }
    function _woSongSectionIds() { return []; }
    function _woNewSongEntry(lib) { return { id: 'NEW' }; }
    function _woSongCopy(e) { return { id: 'NEW' }; }
    function _lbdChange(f) { f(); return true; }
    function _lbdSortSongsByService() {}
    function _lbdPlaceSong() {}
    function _lbdSetCur() {}
    function _lbdCssId(x) { return x; }
    function _lbdReveal() {}
    function _lbdSong(id) { return songOrderSections.filter(function(s) { return s.id === id; })[0] || null; }
    function _woMedleyOf(id) { return ['m1', 'm2', 'm3'].indexOf(id) > -1 ? { medley: { songs: ['m1', 'm2', 'm3'] }, at: 0, n: 3 } : null; }
    ${fn('_lbdAddSong')}
    return _lbdAddSong;`)(list, () => {});
  E('sec', { id: 'lib', title: 'New' }, afterId);
  return list.map(x => x.id).join(',');
};
check('the cursor on a medley\'s first song: the new song goes after the whole medley', ins('m1') === 'a,m1,m2,m3,NEW,z', ins('m1'));
check('...on its middle song: the same', ins('m2') === 'a,m1,m2,m3,NEW,z', ins('m2'));
check('a song not in a medley: straight after it, as before', ins('a') === 'a,NEW,m1,m2,m3,z', ins('a'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
