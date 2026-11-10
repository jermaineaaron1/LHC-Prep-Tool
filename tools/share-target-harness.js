'use strict';
// Regression harness for what the app does with a Web Share Target
// arrival: a link, selected TEXT, or both.
//
// WHY THIS EXISTS
// The manifest has always asked for three things -- shareInbox (a url),
// shareTitle and shareText -- and SBQ_INBOX has always had a column for
// each. But the handler began:
//
//     if (window.__SHARE_INBOX_URL && window.__SHARE_INBOX_URL.trim()) {
//
// so selecting the chords on a page and sharing them -- text, no url --
// did nothing whatever. No error, no inbox row, no screen. The one path
// that gets a chord sheet out of a site that will not be framed and
// will not be scraped was shut, and shut silently.
//
// THE DANGEROUS DIRECTION
// A share is somebody's only copy of something they went looking for.
// Losing it is worse than putting it in the wrong place, so the checks
// below care most that SOMETHING accepts every shape of arrival, and
// that words are never written over a song without being asked.
//
// USAGE
//   node tools/share-target-harness.js                 # ../Index.html
//   node tools/share-target-harness.js path/to/file.html
//   node tools/share-target-harness.js <file> --expect-broken
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

function extract(pattern, name) {
  const startIdx = lines.findIndex(l => pattern.test(l));
  if (startIdx < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('no close for ' + name);
}

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log((ok ? '  ok    ' : '  FAIL  ') + label);
  if (!ok) {
    console.log('          got  ' + JSON.stringify(got));
    console.log('          want ' + JSON.stringify(want));
  }
}

let lastSrc;
try {
  lastSrc = extract(/^    window\._lhcShareLast = function\(\) \{/, '_lhcShareLast');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the share handler is present.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log('\nthe manifest asks for all three, so all three must be handled');
const manifest = JSON.parse(fs.readFileSync(
  path.join(path.dirname(INDEX), 'public', 'manifest.json'), 'utf8'));
const st = manifest.share_target || {};
check('the app is a share target', !!st.action, true);
check('  it asks for the url', (st.params || {}).url, 'shareInbox');
check('  the title', (st.params || {}).title, 'shareTitle');
check('  and the selected text', (st.params || {}).text, 'shareText');
// Each param the manifest asks for is read into a global at boot.
['shareInbox', 'shareTitle', 'shareText'].forEach(function (p) {
  check("  '" + p + "' is read from the address", raw.indexOf("p.get('" + p + "')") > -1, true);
});

console.log('\nwhat counts as an arrival');
// This is the fix: the gate used to be the url alone.
const gate = /if \(\(window\.__SHARE_INBOX_URL && window\.__SHARE_INBOX_URL\.trim\(\)\) \|\|\s*\r?\n\s*\(window\.__SHARE_INBOX_TEXT && window\.__SHARE_INBOX_TEXT\.trim\(\)\)\) \{/
  .test(raw);
check('text on its own is an arrival', gate, true);
check('  and the url-only gate is gone',
  /if \(window\.__SHARE_INBOX_URL && window\.__SHARE_INBOX_URL\.trim\(\)\) \{\s*\r?\n\s*var _siUrl/.test(raw), false);

console.log('\nthe song you were reading, if it was recent');
const L = new Function('localStorage', 'Date',
  lastSrc.replace(/^    window\._lhcShareLast = /, 'var f = ') + '\nreturn f;');
const store = (v) => ({ getItem: () => v, setItem: () => {} });
const NOW = 1000000000;
const clock = { now: () => NOW };
check('nothing remembered, nothing offered', L(store(null), clock)(), null);
check('junk remembered, nothing offered', L(store('{{{'), clock)(), null);
check('a record with no song is no use',
  L(store(JSON.stringify({ title: 'x', at: NOW })), clock)(), null);
const fresh = { sid: 's1', title: 'Give Me Oil', book: 'sb-1', order: '', at: NOW - 3600 * 1000 };
check('an hour ago is offered', L(store(JSON.stringify(fresh)), clock)(), fresh);
// A Saturday evening's hunting is for Sunday morning; older than that
// and the offer would be guessing.
const old = Object.assign({}, fresh, { at: NOW - 13 * 3600 * 1000 });
check('thirteen hours ago is not', L(store(JSON.stringify(old)), clock)(), null);
const edge = Object.assign({}, fresh, { at: NOW - 11.9 * 3600 * 1000 });
check('  just inside twelve hours is', !!L(store(JSON.stringify(edge)), clock)(), true);

console.log('\nand what it does with it');
check('the reader notes the song it is showing',
  /_sbmNoteLastSong\(sid\);/.test(raw), true);
// Nothing is written until Save Lyrics, so a share of words can be
// looked at beside the song's own and thrown away.
check('shared words open the editor, they do not overwrite',
  /var lyrics = \(seed && String\(seed\)\.trim\(\)\) \? String\(seed\) : \(s\.customLyrics \|\| s\.lyrics \|\| ''\);/
    .test(raw), true);
const attach = extract(/^  function sbmShareAttach\(/, 'sbmShareAttach');
// The book loads asynchronously; a fixed delay would attach to nothing
// on a slow connection and say it had worked.
check('attaching waits for the book instead of guessing a delay',
  /setInterval\(/.test(attach) && /songOrderSections \|\| \[\]\)\.some/.test(attach), true);
check('  and gives up out loud', /showToast\('Could not open that songbook/.test(attach), true);
check('a link goes through the one save path',
  /_sbAddLinkToSong\(ref\.sid, url\);/.test(attach), true);
// Two found by running it rather than reading it.
//
// The songbook LIST keys a book 'sb-<id>' and this opener wants the bare
// id -- the deep-link path strips it for the same reason. Passed whole,
// nothing loaded and the wait timed out against a book that never came.
check('the book key is stripped before it is opened',
  /openSongbookStandalone\(String\(ref\.book\)\.replace\(\/\^sb-\/, ''\)\);/.test(attach), true);
// A cold open of a five-song book took about seven seconds on a good
// connection, so ten was not a budget, it was a coin toss.
const budget = parseInt((/waited < (\d+)\)/.exec(attach) || [])[1], 10);
check('the wait is long enough for a cold open', budget >= 20000, true);
// Shared words mean the lyrics editor whichever pages the song shows:
// sent to a song in choir view they used to open the parts editor and
// be dropped on the floor.
check('a seed is not diverted to the choir parts editor',
  /if \(!\(seed && String\(seed\)\.trim\(\)\) &&\s*\r?\n\s*\(typeof _sbChoirView === 'function'\) && _sbChoirView\(s\) === 'choir'\) \{/
    .test(raw), true);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
