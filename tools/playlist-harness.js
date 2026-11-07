'use strict';
// Harness for the playlist player and its links.
//
// WHY THIS EXISTS
// A shared playlist was meant to play a service's songs one after another --
// in a car, at work -- with nobody touching it. It built a new YouTube player
// for every song, and a phone will not start the sound of a new player
// without a tap, so the list stopped after its first song; a video that would
// not play stopped it too. It now keeps one player and hands it the next
// video, passes over a video that will not play, and keeps the screen on
// while it plays. Its links carry the songs' names and the service's, the
// page shares itself on WhatsApp, and the same videos open as a queue in the
// YouTube app.
//
// USAGE
//   node tools/playlist-harness.js                 # ../Index.html
//   node tools/playlist-harness.js path/to/file.html
//   node tools/playlist-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 7f1907f:Index.html > x`).
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

console.log('The links');
const parts = ['window.lhcPlaylistLink = function(', 'window.lhcYouTubeQueue = function(', 'function decodePl(', 'function _plReadLink('].map(extract);
check('the links are made and read by functions of their own', parts.every(Boolean));
if (parts.every(Boolean)) {
  const btoa = s => Buffer.from(s, 'binary').toString('base64');
  const atob = s => Buffer.from(s, 'base64').toString('binary');
  const win = { __WEBAPP_URL: 'https://app.example/', location: { href: 'https://app.example/?x=1' },
                detectMediaType: u => (/youtube|youtu\.be/.test(u) ? { type: 'youtube', id: (u.match(/v=([\w-]{11})/) || [])[1] } : { type: 'link' }) };
  const L = new Function('window', 'btoa', 'atob',
    parts.join('\n') + '\nreturn { link: window.lhcPlaylistLink, queue: window.lhcYouTubeQueue, read: _plReadLink };')(win, btoa, atob);
  const items = [
    { url: 'https://www.youtube.com/watch?v=5LO1K58Io54', songTitle: 'Come, Now Is The Time' },
    { url: 'https://youtu.be/hDSoMLnUwJA', songTitle: 'We Praise You ✝' },
    { url: 'https://open.spotify.com/track/abc', songTitle: '' }
  ];
  const link = L.link(items, 'Service - Nov 8');
  const q = link.split('?playlist=')[1];
  check('a link is this app\'s address with the list in it', link.indexOf('https://app.example/?playlist=') === 0 && !/[+/=]/.test(q), link);
  const back = L.read(decodeURIComponent(q));
  check('...read back, the service\'s name and each song\'s, its videos as videos',
    back && back.name === 'Service - Nov 8' && back.items.length === 3 &&
    back.items[0].url === 'https://www.youtube.com/watch?v=5LO1K58Io54' && back.items[0].songTitle === 'Come, Now Is The Time' &&
    back.items[1].url === 'https://www.youtube.com/watch?v=hDSoMLnUwJA' && back.items[1].songTitle === 'We Praise You ✝' &&
    back.items[2].url === 'https://open.spotify.com/track/abc' && back.items[0].mediaType.type === 'youtube', JSON.stringify(back));
  // A '+' in a link that was not escaped arrives as a space.
  let plus = null;
  for (let k = 0; k < 400 && !plus; k++) {
    const b = decodeURIComponent(L.link([{ url: 'https://youtu.be/AAAAAAAAAAA', songTitle: 'Song ' + '>'.repeat(k % 7) + '?'.repeat(k % 5) + k }], 'S').split('?playlist=')[1]);
    if (b.indexOf('+') !== -1) plus = b;
  }
  check('...and a "+" that reached it as a space still reads', !!plus && !!L.read(plus.replace(/\+/g, ' ')), plus);
  const old = 'WyJ5Omk2Z3VXS25teFlVIiwieTp4cm9SdXFaNVE2RSIsInk6dGpxbGtXaHotYUEiLCJ5OlN3d2V6RkZvVkFjIl0=';
  const was = L.read(old);
  check('a link shared before names were carried still plays', was && was.name === '' && was.items.length === 4 &&
    was.items[1].url === 'https://www.youtube.com/watch?v=xroRuqZ5Q6E');
  check('nothing to read is no playlist', L.read('') === null && L.read('not base64!') === null);
  check('the YouTube app\'s queue: the videos, each once, and nothing for a list without any',
    L.queue(items.concat([{ url: 'https://www.youtube.com/watch?v=5LO1K58Io54' }])) === 'https://www.youtube.com/watch_videos?video_ids=5LO1K58Io54,hDSoMLnUwJA' &&
    L.queue([{ url: 'https://open.spotify.com/track/abc' }]) === '');
}

console.log('\nPlaying straight through');
check('the next video goes into the player already playing, not a new one',
  has(/if \(info\.type === 'youtube' && info\.id && _ytPlayer && _ytPlayerOk && document\.getElementById\('plYtContainer'\)\) \{\r?\n\s*try \{ _ytPlayer\.loadVideoById\(info\.id\); return; \} catch \(e\) \{\}/) &&
  SRC.indexOf('_ytPlayer.loadVideoById(info.id)') < SRC.indexOf('try { _ytPlayer.destroy(); } catch(e) {}'));
check('...which says when it is ready for one, and plays in the page on an iPhone',
  has(/onReady: function\(\) \{ _ytPlayerOk = true; \},/) && has(/playerVars: \{ autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 \},/));
check('a video that will not play is passed over, but not round and round a list where none will',
  has(/onError: function\(\) \{ _plSkipBroken\(\); \}/) &&
  has(/if \(!_autoplay \|\| _items\.length < 2 \|\| \+\+_plErrors >= _items\.length\) return;\r?\n\s*setTimeout\(function\(\) \{ plNext\(\); \}, 1500\);/) &&
  has(/if \(e\.data === YT\.PlayerState\.PLAYING\) \{ _plErrors = 0;/));
check('the screen stays on while it plays, and is let go when paused or closed',
  has(/navigator\.wakeLock\.request\('screen'\)/) && has(/else if \(e\.data === YT\.PlayerState\.PAUSED\) \{ _plPlaying = false; _plUnwake\(\); \}/) &&
  has(/_plPlaying = false;\r?\n\s*_plUnwake\(\);\r?\n\s*if \(_ytPlayer\) \{\r?\n\s*try \{ _ytPlayer\.stopVideo\(\); \} catch\(e\) \{\}/));
check('opened from a link, it says to tap play once; the tap that starts it takes the note away',
  has(/_plHint\(!!_meta\.fromLink\);/) && has(/window\.openPlaylistPlayer\(got\.items, \{ name: got\.name, fromLink: true \}\);/) &&
  has(/_plPlaying = true; _plHint\(false\); _plWake\(\);/));

console.log('\nSharing it');
check('the page has WhatsApp and the YouTube app in its bar',
  has(/class="pl-hbtn" onclick="plShare\(\)" title="Share this playlist on WhatsApp"/) && has(/onclick="plOpenYouTube\(\)" id="plYouTubeBtn"/));
check('...the message: its songs by name, the link that plays them here, and the YouTube app\'s queue',
  has(/lines\.push\('', 'Play them all, one after another: ' \+ window\.lhcPlaylistLink\(_items, name\)\);/) &&
  has(/if \(q\) lines\.push\('', 'Or in the YouTube app: ' \+ q\);/) &&
  has(/window\.open\(window\.lhcWhatsAppUrl\(lines\.join\('\\n'\)\), '_blank', 'noopener'\);/));
check('the Songbook\'s player knows the service it plays', has(/window\.openPlaylistPlayer\(items, \{ name: \(currentOrderData && currentOrderData\.title\) \|\| '' \}\);/));
check('on a phone the bar still fits: smaller buttons, no icon box, Auto as an icon',
  has(/#plPlayerOverlay \.pl-hbtn \{ width: 32px !important; height: 32px !important; \}/) && has(/#plAutoplayLabel \{ display: none; \}/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
