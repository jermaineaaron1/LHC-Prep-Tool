'use strict';
// Harness for Set up choir parts and the choir score's chords (2026-11-11,
// CLAUDE.md gotcha 89). From the operator:
//   - "if one user hits on the Set Up Choir Parts then everyone will have
//     the choir parts already"; "in a medley, when that button is hit, then
//     all the songs in the medley will be choir part as well";
//   - "direct all users to choir part after it's creation";
//   - musicians change chords in Chords + Lyrics: "make sure the choir part
//     and other view gets reflected as well".
//
// USAGE
//   node tools/songbook-choir-setup-harness.js
//   node tools/songbook-choir-setup-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const files = args.filter(a => !a.startsWith('--'));
const INDEX = files[0] || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const LF = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');

function extractFrom(text, startRe) {
  const ls = text.split('\n');
  const startIdx = ls.findIndex(l => startRe.test(l));
  if (startIdx < 0) throw new Error('not found: ' + startRe);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < ls.length; i++) {
    out.push(ls[i]);
    for (const ch of ls[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces: ' + startRe);
}
const fn = n => { try { return extractFrom(LF, new RegExp('^\\s*function ' + n + '\\s*\\(')); } catch (e) { return ''; } };
const has = re => re.test(LF);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}
function run(label, f) { try { return f(); } catch (e) { check(label, false, e.message); } }
// Old source has none of this; an error there is a failure, never a crash.
process.on('unhandledRejection', function(e) { check('no unexpected error', false, String(e && e.message || e)); });
const tick = () => new Promise(r => setImmediate(r));
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };

(async () => {
  // ------------------------------------------------------------ 1. the chords
  console.log('\n1. The choir score\'s chords are the words Chords + Lyrics shows');
  run('chord words', () => {
    const env = new Function('ctx', `
      var window = { STATE: ctx.STATE }, STATE = ctx.STATE, songOrderSections = ctx.copies;
      function _sbBaseSongId(s) { return s.songId; }
      function _sbSetCopyWords(s, t) { ctx.log.push('copy:' + s.id); s.customLyrics = t; }
      var SBQ_SONGS = { updateLyrics: function(id, t) { ctx.log.push('lib:' + id); return Promise.resolve(); } };
      ${fn('_sbCopyById')}
      ${fn('_sbChoirChordWords')}
      ${fn('_sbChoirChordSave')}
      return { byId: _sbCopyById, words: _sbChoirChordWords, save: _sbChoirChordSave };`);
    const lib = { id: 'song_1', lyrics: 'G\nLIB words' };
    const own = { id: 'c1', songId: 'song_1', customLyrics: 'Bm\nOWN words', lyrics: 'Bm\nOWN words' };
    const none = { id: 'c2', songId: 'song_1', customLyrics: '', lyrics: 'stale' };
    const ctx = { STATE: { songs: [lib] }, copies: [own, none], log: [] };
    const E = env(ctx);
    check('a copy with words of its own: those (what Chords + Lyrics shows and edits)', E.words(own) === 'Bm\nOWN words');
    check('a copy with none: the song\'s, as before', E.words(none) === 'G\nLIB words' && E.words(null, 'song_1') === 'G\nLIB words');
    E.save(own, 'song_1', 'X'); E.save(none, 'song_1', 'Y'); E.save(null, 'song_1', 'Z');
    check('a chord written from the choir side goes into those same words', ctx.log.join() === 'copy:c1,lib:song_1,lib:song_1', ctx.log.join());
    check('a copy is found in the book by its id', E.byId('c2') === none && E.byId('') === null && E.byId('nope') === null);
  });
  check('the score is drawn from them', /var chords = window\.lhcVoiceLines\.chordIndex\(\n\s*_sbChoirChordWords\(song\),/.test(fn('_sbChoirBodyHtml')) && !/lib && lib\.lyrics/.test(fn('_sbChoirBodyHtml')));
  check('Overview edit, Edit Parts\' pad and Book Mode\'s choir notepad read the same words',
    /var lyrics = _sbChoirChordWords\(_sbCopyById\(sid\), base\);/.test(fn('_sbOverviewOpenNow')) &&
    has(/var lyrics = _sbChoirChordWords\(_sbCopyById\(ed\.sid\), ed\.base\);/) &&
    /var lyrics = _sbChoirChordWords\(song, base\), parts = V\.lanes\(rows\)/.test(fn('_sbChNpOpen')));
  check('...and write to them: the pad (with its copy), Edit Parts, the notepad\'s Undo',
    /function _sbmPadSaveChords\(base, rows, chords, sid\)/.test(LF) && /var lyrics = _sbChoirChordWords\(copy, base\)/.test(fn('_sbmPadSaveChords')) &&
    /return _sbChoirChordSave\(copy, base, lyrics\)/.test(fn('_sbmPadSaveChords')) &&
    /_sbmPadSaveChords\(base, _sbVoiceLines\[base\], chords, sid\)/.test(fn('_sbmPadSaveSong')) &&
    (LF.match(/ed\.pendingChords, ed\.sid\)/g) || []).length === 2 &&
    /return _sbChoirChordSave\(N\.song, base, N\.lyrics\);/.test(fn('_sbChNpUndo')));
  check('the printed page\'s chord row writes where its page reads (lyricAt counts in those words)',
    /root\.__vlEditChordWords = \(opts && typeof opts\.chordWords === 'function'\) \? opts\.chordWords : null;/.test(LF) &&
    /var cw = \(typeof root\.__vlEditChordWords === 'function'\) \? root\.__vlEditChordWords\(\) : null;/.test(LF) &&
    /window\.lhcVoiceLines\.withChord\(cw\.lyrics \|\| '', lyricAt, chordAt, next\)/.test(LF) &&
    /chordWords: function\(\) \{\n\s*var copy = _sbCopyById\(pageSid\);/.test(fn('sbBindChoirRecorders')));

  console.log('\n   ...the pad\'s save, through a copy');
  await (async () => {
    const lyricsCopy = 'Bm\nMake room\n\nG\nTo be found';
    const env = new Function('ctx', `
      var window = { lhcVoiceLines: ctx.V, STATE: ctx.STATE }, STATE = ctx.STATE, songOrderSections = ctx.copies;
      function _sbBaseSongId(s) { return s.songId; }
      function _sbSetCopyWords(s, t) { ctx.wrote.push(['copy', s.id, t]); s.customLyrics = t; }
      function _sbmIsChord() { return function(l) { return /^\\s*[A-G][#bm]*(\\s+[A-G][#bm]*)*\\s*$/.test(l); }; }
      var SBQ_SONGS = { updateLyrics: function(id, t) { ctx.wrote.push(['lib', id, t]); return Promise.resolve(); } };
      ${fn('_sbCopyById')}
      ${fn('_sbChoirChordWords')}
      ${fn('_sbChoirChordSave')}
      ${fn('_sbmPadSaveChords')}
      return _sbmPadSaveChords;`);
    const V = (() => {
      const lines = LF.split('\n');
      const a = lines.findIndex(l => /^window\.lhcVoiceLines = \{/.test(l));
      const b = lines.findIndex((l, i) => i > a && l === '};');
      return new Function('var window = {};\n' + lines.slice(a, b + 1).join('\n') + '\nreturn window.lhcVoiceLines;')();
    })();
    const copy = { id: 'c1', songId: 'song_1', customLyrics: lyricsCopy };
    const ctx = { V, STATE: { songs: [{ id: 'song_1', lyrics: 'C\nMake room\n\nF\nTo be found' }] }, copies: [copy], wrote: [] };
    const save = env(ctx);
    const rows = [{ id: 1, part: 'both', text: 'Make room', section: 'Verse', sortOrder: 0 }, { id: 2, part: 'both', text: 'To be found', section: 'Verse', sortOrder: 1 }];
    try {
      const r = await save('song_1', rows, [{ words: 'Make room', chord: 'D' }], 'c1');
      check('a copy with its own words takes the chord there, never the library song', r && r.written && ctx.wrote.length === 1 && ctx.wrote[0][0] === 'copy' &&
        /^D\nMake room/.test(ctx.wrote[0][2]) && /G\nTo be found/.test(ctx.wrote[0][2]), JSON.stringify(ctx.wrote));
      ctx.wrote.length = 0;
      await save('song_1', rows, [{ words: 'To be found', chord: 'Am' }]);
      check('...and with no copy, the library song, as before', ctx.wrote.length === 1 && ctx.wrote[0][0] === 'lib' && /Am\nTo be found/.test(ctx.wrote[0][2]), JSON.stringify(ctx.wrote));
    } catch (e) { check('the pad save runs', false, e.message); }
  })();

  // ------------------------------------------------------------ 2. Set up: the medley, everyone, Choir
  console.log('\n2. Set up choir parts: the medley, everyone, Choir');
  const V2 = { fromLyrics: t => String(t || '').trim() ? [{ part: 'both', text: t }] : [] };
  run('targets', () => {
    const env = new Function('ctx', `
      var window = { lhcVoiceLines: ctx.V }, songOrderSections = ctx.copies;
      function _sbBaseSongId(s) { return s.songId; }
      function _woMedleys() { return ctx.medleys; }
      function _sbSongHasChoir(s) { return !!s.parts; }
      ${fn('_sbCopyById')}
      ${fn('_sbmChoirStartTargets')}
      return _sbmChoirStartTargets;`);
    const a = { id: 'a', songId: 'A', lyrics: 'words' }, b = { id: 'b', songId: 'B', lyrics: 'words' }, c = { id: 'c', songId: 'C', lyrics: 'words', parts: true },
      d = { id: 'd', songId: 'D', lyrics: '' }, e = { id: 'e', songId: 'A', lyrics: 'words' }, x = { id: 'x', songId: 'X', lyrics: 'words' };
    const T = env({ V: V2, copies: [a, b, c, d, e, x], medleys: [{ id: 'm', songs: ['a', 'b', 'c', 'd', 'e'] }] });
    const got = T(a).map(s => s.id).join(',');
    check('the song and the rest of its medley with words and no parts yet: not one with parts, nor one with no words, nor a song twice', got === 'a,b', got);
    check('a song in no medley: itself alone', T(x).map(s => s.id).join(',') === 'x');
  });

  await (async () => {
    const env = new Function('ctx', `
      var window = { lhcVoiceLines: ctx.V, SBQ_VOICE_LINES: {}, STATE: ctx.STATE }, STATE = ctx.STATE, songOrderSections = ctx.copies;
      var _sbVoiceLines = {};
      function _sbmSong() { return ctx.copies[0]; }
      function _sbBaseSongId(s) { return s.songId; }
      function _woMedleys() { return ctx.medleys; }
      function _sbSongHasChoir(s) { return !!s.parts; }
      function _sbEditClaim(s) { return s.id !== ctx.locked; }
      function _sbEditRelease(b) { ctx.log.push('release:' + b); }
      function _sbVoiceWrite(base, sid, rows, o) { ctx.log.push('write:' + base + (o.onlyIfEmpty ? ':empty' : '')); if (base === ctx.elsewhere) { var e = new Error('x'); e.code = 'has-parts'; e.rows = [1]; return Promise.reject(e); } return Promise.resolve(); }
      function sbAutoSave() { ctx.log.push('autosave'); }
      function _sbPersistChoirViews(b, v) { ctx.log.push('persist:' + b.join('+') + ':' + v); }
      function renderSongbookLive() { ctx.log.push('render'); }
      function _sbmLiveSend() { ctx.log.push('send'); }
      function _sbmChoirAnnounce(b) { ctx.log.push('announce:' + b.join('+')); }
      function showToast(m, k) { ctx.toasts.push(m); }
      function showLoader() {}
      ${fn('_sbCopyById')}
      ${fn('_sbmChoirStartTargets')}
      ${fn('_sbmChoirSetUp')}
      ${fn('_sbmChoirShow')}
      ${fn('sbmChoirStart')}
      return sbmChoirStart;`);
    const mk = (o) => {
      const a = { id: 'a', songId: 'A', lyrics: 'w', title: 'Silent Night', choirView: 'lyrics', sbmLyricsMode: 'lyrics' };
      const b = { id: 'b', songId: 'B', lyrics: 'w', title: 'O Holy Night' };
      const b2 = { id: 'b2', songId: 'B', lyrics: 'w', title: 'O Holy Night', choirView: 'both' };   // the same song elsewhere in the book
      const c = { id: 'c', songId: 'C', lyrics: 'w', title: 'Holy Holy Holy' };
      return Object.assign({ V: V2, STATE: { songs: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] }, copies: [a, b, c, b2], medleys: [{ id: 'm', songs: ['a', 'b', 'c'] }], log: [], toasts: [] }, o || {});
    };
    try {
      let ctx = mk(); let start = env(ctx); start(); await settle();
      check('each song of the medley is set up, one after the other, only where it is empty', ctx.log.filter(x => /^write/.test(x)).join() === 'write:A:empty,write:B:empty,write:C:empty', ctx.log.join());
      check('every copy of them shown in Choir, the same song elsewhere in the book too', ctx.copies.every(x => x.choirView === 'choir' && x.voiceLayout === 'two-part') && ctx.copies[0].sbmLyricsMode === '');
      check('the view saved for everyone (a service\'s book and a standalone one, in one write), then everyone told',
        ctx.log.indexOf('autosave') > -1 && ctx.log.indexOf('persist:A+B+C:choir') > -1 && ctx.log.indexOf('send') > -1 && ctx.log.indexOf('announce:A+B+C') > -1 &&
        ctx.log.indexOf('announce:A+B+C') > ctx.log.indexOf('persist:A+B+C:choir'), ctx.log.join());
      check('...and it says so', /Choir parts set up for 3 songs of the medley/.test(ctx.toasts[0] || '') && /shown in Choir for everyone/.test(ctx.toasts[0] || ''), ctx.toasts[0]);
      check('each song\'s hold let go', ctx.log.filter(x => /^release/.test(x)).length === 3);
      ctx = mk({ locked: 'b' }); start = env(ctx); start(); await settle();
      check('a song somebody else is editing is left, and named', ctx.log.indexOf('write:B:empty') === -1 && /Not set up: O Holy Night/.test(ctx.toasts[0] || '') && ctx.copies[1].choirView !== 'choir', ctx.toasts[0]);
      ctx = mk({ elsewhere: 'C' }); start = env(ctx); start(); await settle();
      check('a song set up elsewhere meanwhile counts as done: shown in Choir, nothing written over it', ctx.copies[2].choirView === 'choir' && ctx.log.indexOf('announce:A+B+C') > -1);
    } catch (e) { check('Set up runs', false, e.message); }
  })();

  console.log('\n   ...on every other device');
  await (async () => {
    const env = new Function('ctx', `
      var window = { SBQ_VOICE_LINES: { forSong: function(b) { ctx.log.push('read:' + b); return Promise.resolve([{ id: 1 }]); } }, STATE: ctx.STATE }, STATE = ctx.STATE, songOrderSections = ctx.copies;
      var _sbVoiceLines = {}, _sbVoiceWanted = { A: true }, _sbVoiceRetryAt = {}, _sbmLive = {};
      function _sbBaseSongId(s) { return s.songId; }
      function _sbmBookOpen() { return true; }
      function _sbmSong() { return ctx.copies[0]; }
      function renderSongbookLive() { ctx.log.push('render'); }
      function showToast(m) { ctx.toasts.push(m); }
      function _sbmLiveCheck(adopt) { ctx.log.push('check:' + adopt); }
      ${fn('_sbmChoirShow')}
      ${fn('_sbmChoirArrived')}
      ${fn('_sbmPartsArrived')}
      return { arrived: _sbmChoirArrived, parts: _sbmPartsArrived, lines: function() { return _sbVoiceLines; }, wanted: function() { return _sbVoiceWanted; } };`);
    const a = { id: 'a', songId: 'A', choirView: 'lyrics', sbmLyricsMode: 'both' }, z = { id: 'z', songId: 'Z', choirView: 'lyrics' };
    const ctx = { STATE: { songs: [{ id: 'A' }, { id: 'Z' }] }, copies: [a, z], log: [], toasts: [] };
    let E = null;
    try { E = env(ctx); } catch (e) { check('the arrival exists', false, e.message); return; }
    try {
      await E.arrived(['A']); await settle();
      check('the parts are read, the song shown in Choir, no Refresh to press', ctx.log.indexOf('read:A') > -1 && a.choirView === 'choir' && a.sbmLyricsMode === '' && a.voiceLayout === 'two-part' &&
        ctx.STATE.songs[0].voiceLayout === 'two-part' && E.lines().A && ctx.log.indexOf('render') > -1 && !E.wanted().A);
      check('...the reader told when it is the song in front, and what was seen taken as seen', /set up on another device/.test(ctx.toasts[0] || '') && ctx.log.indexOf('check:true') > -1);
      check('...and another song left as it was', z.choirView === 'lyrics');
      ctx.log.length = 0;
      await E.arrived(['Q']);
      check('a song not in this book: nothing', ctx.log.length === 0);
    } catch (e) { check('the arrival runs', false, e.message); }
    check('songs with parts now and none before, from the 30-second check', JSON.stringify(E.parts('A,B', 'A,B,C,D')) === '["C","D"]' && E.parts('A', 'A').length === 0 &&
      E.parts(null, 'A').length === 0 && E.parts('na', 'A').length === 0 && E.parts('', 'A').join() === 'A');
  })();

  check('the broadcast is heard on the book\'s channel', /\.on\('broadcast', \{ event: 'choir' \}, function\(m\) \{ _sbmChoirArrived\(\(\(m && m\.payload\) \|\| \{\}\)\.bases\); \}\)/.test(fn('_sbmLiveStart')));
  check('...and sent', /_sbmLive\.channel\.send\(\{ type: 'broadcast', event: 'choir', payload: \{ bases: bases, at: Date\.now\(\) \} \}\)/.test(fn('_sbmChoirAnnounce')));
  check('a device that missed it finds the new parts on its next check: shown at once, no banner',
    /var arrived = _sbmPartsArrived\(L\.seen\.parts, fp\.parts\);[^]*?L\.seen\.lines = fp\.lines; L\.seen\.songs = fp\.songs; L\.seen\.parts = fp\.parts;[^]*?_sbmChoirArrived\(arrived\);[^]*?var d = _sbmLiveDiff\(L\.seen, fp\)/.test(fn('_sbmLiveCheck')) &&
    /return \{ marks: a\[0\], recs: a\[1\], lines: a\[2\]\.lines, parts: a\[2\]\.parts, songs: a\[3\], book: a\[4\] \};/.test(fn('_sbmLiveFingerprint')));

  console.log('\n   ...the standalone book\'s view, in one write');
  await (async () => {
    const env = new Function('ctx', `
      var _sbStandaloneId = 'sb1';
      var SBQ_SONGBOOKS = { loadAll: function() { ctx.reads++; return Promise.resolve([{ id: 'sb1', items: [{ songId: 'A', choirView: 'lyrics' }] }]); },
                            save: function(sb) { ctx.saves.push(JSON.parse(JSON.stringify(sb.items))); return Promise.resolve(); } };
      var window = { SBQ_SONGBOOKS: SBQ_SONGBOOKS };
      function _sbmLiveSend() {}
      function showToast() {}
      ${fn('_sbPersistChoirViews')}
      return _sbPersistChoirViews;`);
    const ctx = { reads: 0, saves: [] };
    try { env(ctx)(['A', 'B'], 'choir'); } catch (e) { check('the batched save exists', false, e.message); return; }
    await settle();
    check('one read and one write for all the songs, or each would write the book back over the others',
      ctx.reads === 1 && ctx.saves.length === 1 && JSON.stringify(ctx.saves[0]) === '[{"songId":"A","choirView":"choir"},{"songId":"B","choirView":"choir"}]', JSON.stringify(ctx.saves));
  })();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
