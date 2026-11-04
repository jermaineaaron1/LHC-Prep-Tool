'use strict';
// Harness for a songbook edited by more than one device.
//
// WHY THIS EXISTS
// Four things, reported together from the Caroling book (2026-11-04):
//   1. "This songbook changed on another device" kept coming up, and Refresh
//      showed nothing new. Its fingerprint hashed the rows as stored -- the
//      book's items with each device's own page breaks, margins, fonts and
//      slides, the songs' last-edited times, the newest line's updated_at --
//      so a save that changed no word, or a word typed and taken out again,
//      still raised it. It now hashes what a reader sees.
//   2. Save Lyrics in the Songbook's Lyrics & Chords editor saved nothing,
//      ever: the editor is the song form's, and nothing handed the words
//      back to the songbook.
//   3. Two people could edit one song at once, and the second save quietly
//      undid the first. Now whoever opens an editor first holds the song.
//   4. On an iPhone a line shook: the chord fit measured the line at the
//      size it was deciding, so the answer moved with the question.
//
// USAGE
//   node tools/songbook-live-edit-harness.js                 # ../Index.html
//   node tools/songbook-live-edit-harness.js path/to/file.html
//   node tools/songbook-live-edit-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 47f5994:Index.html > x`).
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

console.log('1. The banner: what a reader sees, not when it was written');
const fpNames = ['function _sbmHash(', 'function _sbmLivePlain(', 'function _sbmLiveText(', 'function _sbmLiveBookOf(',
                 'function _sbmLiveSongsOf(', 'function _sbmLiveLinesOf('];
const fpSrc = fpNames.map(extract);
check('what is compared is worked out by functions of their own', fpSrc.every(Boolean));
if (fpSrc.every(Boolean)) {
  const F = new Function(fpSrc.join('\n') + '\nreturn { hash: _sbmHash, book: _sbmLiveBookOf, songs: _sbmLiveSongsOf, lines: _sbmLiveLinesOf, text: _sbmLiveText };')();
  const item = o => Object.assign({ songId: 'song_a', customLyrics: 'C  F\nIt came upon', richLyrics: null, transposeSteps: -1, versionId: '',
    slides: [{ content: 'It came upon' }], pageMargin: 12, manualBreaks: [14], fontOverride: { size: 18 }, annotations: [], sbLyricsColumns: 1 }, o);
  const row = o => ({ song_ids: ['song_a', 'song_b'], items: [item(o), item({ songId: 'song_b', customLyrics: '' })] });
  const h = r => F.hash(F.book(r));
  check('another device\'s page breaks, margins, fonts and slides are not a change',
    h(row()) === h(row({ pageMargin: 40, manualBreaks: [9, 30], fontOverride: { size: 21 }, slides: [{ content: 'It came upon', background: 'x' }] })));
  check('...but a word is', h(row()) !== h(row({ customLyrics: 'C  F\nIt came upon a' })));
  check('...and a word typed and taken out again is no change at all', h(row()) === h(row({ customLyrics: 'C  F\nIt came upon   ' })));
  check('...a key changed is a change, and so are the songs in another order',
    h(row()) !== h(row({ transposeSteps: 2 })) && h(row()) !== h({ song_ids: ['song_b', 'song_a'], items: row().items }));
  check('...the same words drawn as other markup are the same words',
    F.text('<div>C&nbsp; F</div><div><span style="color:red">It came</span> upon</div>') === 'C  F\nIt came upon' &&
    h(row({ richLyrics: '<div>It came upon</div>' })) === h(row({ richLyrics: 'It came upon<br>' })));
  const song = o => Object.assign({ id: 'song_a', title: 'It Came Upon', key: 'C', lyrics: 'It came upon', voice_layout: '', last_edited: 'x', display_style: { a: 1 } }, o);
  check('a song saved again, or restyled, with the same words is no change',
    F.hash(F.songs([song(), song({ id: 'song_b' })])) === F.hash(F.songs([song({ id: 'song_b', last_edited: 'y' }), song({ display_style: { a: 2 } })])));
  check('...its words or key changed are', F.hash(F.songs([song()])) !== F.hash(F.songs([song({ lyrics: 'It came upon a' })])) &&
    F.hash(F.songs([song()])) !== F.hash(F.songs([song({ key: 'D' })])));
  const ln = o => Object.assign({ id: 1, song_id: 'song_a', sort_order: 0, part: 'both', section: 'Verse 1', text: 'It came upon', sustained: false, updated_at: 't1' }, o);
  check('choir parts written again word for word (new ids, new times) are no change',
    F.hash(F.lines([ln(), ln({ id: 2, sort_order: 1, text: 'That glorious' })])) === F.hash(F.lines([ln({ id: 9, sort_order: 1, text: 'That glorious', updated_at: 't2' }), ln({ id: 8, updated_at: 't2' })])));
  check('...a line\'s words, its part or its place are', [ln({ text: 'It came' }), ln({ part: 'women' }), ln({ sort_order: 3 })]
    .every(x => F.hash(F.lines([ln()])) !== F.hash(F.lines([x]))));
}
check('the fingerprint reads the words, not the times',
  has(/select\('song_id,sort_order,part,section,text,sustained'\)/) && has(/select\('id,title,key,lyrics,voice_layout'\)/) &&
  !has(/select\('id,last_edited,display_style,voice_layout'\)/) && !has(/latest\('song_voice_lines', 'updated_at'\)/));
check('a change shows only once it has lasted a few seconds',
  has(/if \(!L\.pendingAt\) \{\r?\n\s*L\.pendingAt = Date\.now\(\);/) && has(/if \(Date\.now\(\) - L\.pendingAt >= 7000\) _sbmLiveBanner\(true\);/) &&
  has(/if \(!d\.structural\) \{ L\.pendingAt = 0; _sbmLiveBanner\(false\); return; \}/));

console.log('\n2. Save Lyrics from the Songbook saves');
const saveSrc = extract('function saveLyricsEditor(');
check('the editor hands the Songbook\'s words back to it, and stays open if refused',
  !!saveSrc && /if \(currentLyricsMode === '__sb__'\) \{\r?\n\s*if \(window\.WO && WO\.sbSaveLyricsFromModal && WO\.sbSaveLyricsFromModal\(lyrics\) === false\) return;\r?\n\s*closeLyricsEditor\(\);\r?\n\s*return;/.test(saveSrc) &&
  saveSrc.indexOf("currentLyricsMode === '__sb__'") < saveSrc.indexOf('songData[currentLyricsMode].lyrics = lyrics'));
check('...which saves them both ways, tells the others, and shows them',
  has(/_sbCanonicalText\[sid\] = lyrics;[^]*?sbAutoSave\(\);\r?\n\s*autoSaveOrder\(\);\r?\n\s*_sbmLiveSend\(\);\r?\n\s*renderSongbookLive\(\);/));
check('...with the transposition\'s baseline the new words', has(/songOriginalLyrics\[sid\] = lyrics;\r?\n\s*songOriginalRichLyrics\[sid\] = song\.richLyrics;/));
check('closing the editor lets the song go', has(/if \(currentLyricsMode === '__sb__'\) \{\r?\n\s*currentLyricsMode = 'new';\r?\n\s*if \(window\.WO && WO\.sbLyricsEditorClosed\) WO\.sbLyricsEditorClosed\(\);/) &&
  has(/sbLyricsEditorClosed: sbLyricsEditorClosed,/));

console.log('\n3. One editor at a time, first come first served');
const lockNames = ['function _edOnLock(', 'function _edOnUnlock(', 'function edIsLockedByOther(', 'function edTryClaim(', 'function edRelease(', 'function _edAnnounceMine('];
const lockSrc = lockNames.map(extract);
check('the locks are the lock channel\'s own functions', lockSrc.every(Boolean));
if (lockSrc.every(Boolean)) {
  // Two devices, A and B, each the real functions, wired to each other.
  let clock = 1000;
  const mk = (id) => new Function('net', 'clock',
    'var _edClientId = ' + JSON.stringify(id) + ', _edLocks = {}, _edMyLocks = {}, ED_LOCK_TTL = 8000, toasts = [];\n' +
    'var Date = { now: function() { return clock(); } };\n' +
    'function _edEnsureChannel() {}\nfunction _edApplyLockUI() {}\nfunction setTimeout(f) { f(); }\n' +
    'function showToastWO(m) { toasts.push(m); }\nfunction _edSend(e, p) { net(e, p); }\n' +
    lockSrc.join('\n') +
    '\nreturn { claim: edTryClaim, release: edRelease, other: edIsLockedByOther, onLock: _edOnLock, onUnlock: _edOnUnlock, announce: _edAnnounceMine,' +
    ' mine: function(k) { return !!_edMyLocks[k]; }, label: function(k) { return (_edLocks[k] || {}).label; }, toasts: toasts };');
  let A, B, connected = true;
  const route = from => (e, p) => { if (!connected) return; const to = from === 'A' ? B : A; if (e === 'ed_lock') to.onLock(p); if (e === 'ed_unlock') to.onUnlock(p); };
  A = mk('ed_zzz')(route('A'), () => clock);
  B = mk('ed_aaa')(route('B'), () => clock);
  const K = 'sbedit:song_a';
  check('the first to open an editor has the song, and the other is refused',
    A.claim(K, 'Patrina') === true && B.claim(K, 'Jermaine') === false && B.label(K) === 'Patrina');
  A.release(K);
  check('...and has it as soon as the first one closes', B.other(K) === false && B.claim(K, 'Jermaine') === true && A.claim(K, 'Patrina') === false);
  B.release(K);
  // Both claim while they cannot hear each other, B a moment later; then
  // each hears the other's claim. B's client id is the lower, which is what
  // used to decide it.
  connected = false; clock = 2000; A.claim(K, 'Patrina'); clock = 2600; B.claim(K, 'Jermaine'); connected = true;
  A.announce(); B.announce();
  check('two claims at once: the earlier keeps it, not the lower device id',
    A.mine(K) && !B.mine(K) && B.other(K) && B.toasts.some(t => /Patrina started editing this first/.test(t)), JSON.stringify({ a: A.mine(K), b: B.mine(K), t: B.toasts }));
}
check('the three whole-song editors take the song as they open',
  has(/\/\/ One editor at a time for a song: refused while somebody else has it\.\r?\n\s*if \(!_sbEditClaim\(s\)\) return;/) &&
  has(/function sbmEditParts\(\) \{\r?\n\s*var song = _sbmSong\(\); if \(!song\) return;\r?\n\s*if \(!_sbEditClaim\(song\)\) return;/) &&
  has(/if \(!_sbEditClaim\(\{ songId: base, title: title \}\)\) return;/));
check('...let it go as they close, or when they could not open',
  has(/var base = _sbmPad && _sbmPad\.o \? _sbmPad\.o\.base : '';\r?\n\s*_sbmPad = null;\r?\n\s*_sbEditRelease\(base\);/) &&
  has(/var base = _sbmEd \? _sbmEd\.base : '';\r?\n\s*_sbmEd = null;\r?\n\s*_sbEditRelease\(base\);/) &&
  (SRC.match(/function\(e\) \{ _sbEditRelease\(base\); _sbLinesUnread\(e\); \}/g) || []).length === 2);
check('...and a save from anyone who lost it is refused, editor left open',
  has(/if \(ed\.base && !_sbEditMayWrite\(ed\.base\)\) return;/) && has(/if \(P\.o && P\.o\.base && !_sbEditMayWrite\(P\.o\.base\)\) return;/) &&
  has(/if \(!_sbEditMayWrite\(song\)\) return false;/));
check('the book joins its lock channel as it opens, and the Edit tile shows who has the song',
  has(/function _sbmLiveStart\(\) \{\r?\n\s*if \(!_sbmBookOpen\(\)\) return;\r?\n\s*var key = _sbmLiveKey\(\); if \(!key\) return;\r?\n\s*_edEnsureChannel\(\);/) &&
  has(/data-sbm-edit="' \+ escapeHtml\(_sbBaseSongId\(song\)\) \+ '"/) && has(/function _edApplyLockUI\(\) \{\r?\n\s*_sbmMarkEditTile\(\);/));

console.log('\n4. A line that shook');
check('the fit measures the words from their font, at full size, not the line as laid out',
  has(/var need = Math\.max\(_sbmTextPx\(cl, ct, cur\), _sbmTextPx\(lyr, lt, cur\)\);/) &&
  has(/_sbmFitCtx\.measureText\(text\)\.width/) && !has(/var charPx = rg\.getBoundingClientRect\(\)\.width \/ cur;/));
check('...moves a line only by a visible step, and settles within a few changes',
  has(/if \(Math\.abs\(k - cur\) < 0\.01\) return;/) && has(/if \(\+\+cl\.__fitN > 3\) return;/));
check('...and an iPhone does not resize the words behind its back', has(/#sbmRoot \{\r?\n(\s*\/\*[^]*?\*\/\r?\n)?\s*-webkit-text-size-adjust: 100%; text-size-adjust: 100%;/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
