'use strict';
// Regression harness for turning a shared link into a song.
//
// WHY THIS EXISTS
// Two things decide what a shared link becomes: what kind of link it is, and
// what the song ends up called. Both are pure functions over strings, both are
// easy to change without noticing, and both fail in the quiet direction -- a
// link that stops being recognised becomes a generic "Web Link", and a naming
// rule that stops firing produces a second song with the same title as one
// already in the library. Neither throws, neither logs, and nobody finds out
// until the library has two of something.
//
// This was written after two fixes were lost. They had been made by hand and
// never written down, so rebuilding the work on a newer master silently
// dropped both: titles differing only by a comma inside a number stopped
// matching, and Transcribe started offering itself on playlists that Add as
// Song refused. Everything else in this repo is guarded; this was not.
//
// HOW IT WORKS
// It reimplements nothing. It slices the real lhcDetectLink, lhcSongTitle,
// lhcLinkIsSongCandidate and lhcLinkIsTranscribable out of Index.html and runs
// them, with a stub library standing in for LHC_STATE.songs.
//
// USAGE
//   node tools/share-link-song-harness.js
//   node tools/share-link-song-harness.js path/to/file.html
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const INDEX = process.argv.slice(2).find(a => !a.startsWith('--')) ||
              path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }

const raw = fs.readFileSync(INDEX, 'utf8');
const nl = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(nl);

const results = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(ok);
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n          got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)));
}

// Slice from the opening line to the line that closes it at the same indent.
function grab(openRe, closeLine, what) {
  const s = lines.findIndex(l => openRe.test(l));
  if (s < 0) throw new Error('not found in ' + path.basename(INDEX) + ': ' + what +
    '\n(renamed? fix the anchor rather than deleting the test)');
  const e = lines.findIndex((l, i) => i > s && l === closeLine);
  if (e < 0) throw new Error('no close for: ' + what);
  // A ceiling, because an end-anchor that matches far away would otherwise
  // swallow the file and still parse.
  if (e - s > 150) throw new Error(what + ': span of ' + (e - s) + ' lines looks wrong');
  return lines.slice(s, e + 1).join('\n');
}

const SRC = [
  grab(/^\s*window\.LHC_LINK_TYPES = \[/, '    ];', 'LHC_LINK_TYPES'),
  grab(/^\s*window\.lhcDetectLink = function/, '    };', 'lhcDetectLink'),
  grab(/^\s*window\.lhcSongTitle = \{/, '    };', 'lhcSongTitle'),
  grab(/^\s*window\.lhcLinkIsTranscribable = function/, '    };', 'lhcLinkIsTranscribable'),
  grab(/^\s*window\.lhcLinkIsSongCandidate = function/, '    };', 'lhcLinkIsSongCandidate'),
].join('\n');

const LIB = [
  '10,000 Reasons (Bless the Lord)',
  'Amazing Grace',
  'Be Still',
  'How Great Thou Art',
  'All Hail King Jesus',
  'All Creatures of Our God and King',
  'The Lord Is My Shepherd',
];

// clashes() reads window.LHC_STATE.songs, so the stub library goes on the
// window stub. Hanging it off a bare LHC_STATE instead looks right and leaves
// the library invisible, which makes every naming check pass for the wrong
// reason: nothing clashes when there is nothing to clash with.
const W = new Function(
  'var window = { LHC_STATE: { songs: ' +
  JSON.stringify(LIB.map(t => ({ title: t, artist: 'Someone' }))) + ' } };\n' +
  'var LHC_STATE = window.LHC_STATE;\n' +
  SRC + '\nreturn window;'
)();
const T = W.lhcSongTitle;

// ---------------------------------------------------------------------------
console.log('\nwhat kind of link is this');
[
  ['https://www.youtube.com/watch?v=abc',        'youtube'],
  ['https://youtu.be/abc',                       'youtube'],
  ['https://m.youtube.com/watch?v=abc',          'youtube'],
  ['https://www.youtube.com/shorts/abc',         'youtube'],
  ['https://www.youtube.com/playlist?list=PL1',  'youtube-playlist'],
  ['https://www.youtube.com/watch?v=a&list=PL1', 'youtube-playlist'],
  ['https://open.spotify.com/track/x',           'spotify-track'],
  ['https://open.spotify.com/album/x',           'spotify-album'],
  ['https://open.spotify.com/artist/x',          'spotify-artist'],
  ['https://www.facebook.com/reel/1',            'facebook-video'],
  ['https://fb.watch/abc/',                      'facebook-video'],
  ['https://www.facebook.com/LHC/videos/2',      'facebook-video'],
  ['https://www.facebook.com/watch?v=3',         'facebook-video'],
  ['https://www.facebook.com/LHC/posts/4',       'facebook'],
  ['https://www.instagram.com/reel/X/',          'instagram-video'],
  ['https://www.instagram.com/p/X/',             'instagram'],
  ['https://www.instagram.com/someband/',        'instagram'],
  ['https://docs.google.com/presentation/d/1',   'gslides'],
  ['https://docs.google.com/spreadsheets/d/1',   'gsheet'],
  ['https://drive.google.com/file/d/1',          'gdrive'],
  ['https://www.canva.com/design/1',             'canva'],
  ['https://example.org/thing',                  'link'],
].forEach(([u, want]) => check(u.replace(/^https:\/\/(www\.)?/, ''), W.lhcDetectLink(u).type, want));

console.log('\nwhich links can become a song, and which can be transcribed');
// The invariant that matters: Transcribe must never appear where Add as Song
// does not. Offering to read a video the app will not file is the two buttons
// disagreeing in front of the person using them.
const BUTTONS = [
  ['https://youtu.be/a',                        true,  true ],
  ['https://www.youtube.com/shorts/a',          true,  true ],
  ['https://www.youtube.com/watch?v=a&list=P',  false, false],
  ['https://www.youtube.com/playlist?list=P',   false, false],
  ['https://open.spotify.com/track/x',          true,  false],
  ['https://open.spotify.com/artist/x',         false, false],
  ['https://fb.watch/a/',                       true,  false],
  ['https://www.instagram.com/reel/X/',         true,  false],
  ['https://www.instagram.com/someband/',       false, false],
  ['https://docs.google.com/document/d/1',      false, false],
];
BUTTONS.forEach(([u, song, scribe]) => {
  check('song? ' + u.replace(/^https:\/\/(www\.)?/, ''), W.lhcLinkIsSongCandidate(u), song);
  check('  transcribe? ', W.lhcLinkIsTranscribable(u), scribe);
});
check('transcribe never offered where add-as-song is not',
  BUTTONS.every(([u]) => !W.lhcLinkIsTranscribable(u) || W.lhcLinkIsSongCandidate(u)), true);

console.log('\na video title is not a song title');
[
  ['Be Still (Official Lyric Video)',            'Be Still'],
  ['Be Still (Official Lyric Video) [HD]',       'Be Still'],
  ['Only By Grace [HD]',                         'Only By Grace'],
  ['How Great Thou Art | Lyrics',                'How Great Thou Art'],
  ['Cornerstone - Official Music Video',         'Cornerstone'],
  ['10,000 Reasons (Bless the Lord) - Official Music Video', '10,000 Reasons (Bless the Lord)'],
  // The ones that must survive: these say something about the performance.
  ['Spirit Song (Live at Bethel)',               'Spirit Song (Live at Bethel)'],
  ['In Christ Alone (Reprise)',                  'In Christ Alone (Reprise)'],
  ['Amazing Grace (Acoustic)',                   'Amazing Grace (Acoustic)'],
].forEach(([t, want]) => check(JSON.stringify(t).slice(0, 48), T.clean(t), want));

console.log('\ntwo titles that name the same song');
[
  ['Be Still', 'Be Still', true],
  ['All  Hail   KING Jesus', 'All Hail King Jesus', true],
  ['The Lord Is My Shepherd', 'Lord Is My Shepherd', true],
  // A comma inside a number puts a space where the other has none. One edit
  // apart, but too long for the typo rule -- this is why the despaced
  // comparison exists, and it was lost once already.
  ['10,000 Reasons (Bless the Lord)', '10000 Reasons Bless the Lord', true],
  ['Be Still', 'Be Stil', true],
  ['Café Hymn', 'Cafe Hymn', true],
  // ...and the ones that must stay apart, or every song sharing a common word
  // gets renamed.
  ['Grace', 'Amazing Grace', false],
  ['How Great Thou Art', 'How Great Is Our God', false],
  ['All Hail King Jesus', 'All Creatures of Our God and King', false],
  ['Be Still', 'Be Thou My Vision', false],
].forEach(([a, b, want]) => check(a + '  vs  ' + b, T.similar(a, b), want));

console.log('\nevery script, not just English');
// A title in Mandarin or Tamil used to normalise to the empty string, so two
// IDENTICAL ones did not match each other and the duplicate check silently
// never fired. This congregation does not sing only in English.
const CN = '恩典夠用';
const CN_NEAR = '恩典夠大';
const TA = 'அருள் செழி';
check('a Mandarin title survives normalising', T.norm(CN) !== '', true);
check('a Tamil title survives normalising', T.norm(TA) !== '', true);
check('two identical Mandarin titles match', T.similar(CN, CN), true);
check('one character different is a different song', T.similar(CN, CN_NEAR), false);
// The typo rule is forgiving by two letters, which is right for English and
// wrong for a four-character title, so it stays where it was earned.
check('typo tolerance does not reach Mandarin', T.similar(CN, CN_NEAR), false);

console.log('\nwhat the song gets called');
check('a song the library does not have keeps its own name',
  T.disambiguate('Rivers Of Living Water', 'Some Band').name, 'Rivers Of Living Water');
check('one the library already has gains the band',
  T.disambiguate('10,000 Reasons (Bless the Lord)', 'Matt Redman').name,
  '10,000 Reasons (Bless the Lord) — Matt Redman');
check('  and says which song it resembles',
  T.disambiguate('10,000 Reasons (Bless the Lord)', 'Matt Redman').clashes.map(s => s.title),
  ['10,000 Reasons (Bless the Lord)']);
check('with no band known, no guess is appended',
  T.disambiguate('10,000 Reasons (Bless the Lord)', '').name, '10,000 Reasons (Bless the Lord)');
check('  but the clash is still reported',
  T.disambiguate('10,000 Reasons (Bless the Lord)', '').clashes.length, 1);
check('an empty title clashes with nothing',
  T.disambiguate('', 'A Band').clashes.length, 0);
check('no library title matches another',
  LIB.filter(t => T.clashes(t).length > 1), []);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
