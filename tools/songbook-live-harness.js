#!/usr/bin/env node
'use strict';
// songbook-live-harness.js
//
// What a change of fingerprint means to the reading view's live layer:
// marks and takes reload quietly, lines / words / settings / the book ask
// for a refresh, and a part that could not be read says nothing. Sliced
// out of Index.html; `--expect-broken` is the negative control.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

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

let S;
try {
  const src = extract(/^  function _sbmLiveDiff\(/, '_sbmLiveDiff') + '\n' + extract(/^  function _sbmHash\(/, '_sbmHash');
  S = new Function(src + '\nreturn { diff: _sbmLiveDiff, hash: _sbmHash };')();
  S.pollSrc = extract(/^  function _sbPollChanged\(/, '_sbPollChanged');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the live layer is present.');
  process.exit(1);
}

const fp = (o) => Object.assign({ marks: '3@a', recs: '5@b', lines: '40@c', songs: 'h1', book: 'h2' }, o || {});

console.log('\nwhat a change of fingerprint means');
check('nothing changed, nothing to do', S.diff(fp(), fp()), { marks: false, recs: false, structural: false });
check('a new mark reloads the marks quietly', S.diff(fp(), fp({ marks: '4@z' })), { marks: true, recs: false, structural: false });
check('a new take reloads the takes quietly', S.diff(fp(), fp({ recs: '6@z' })), { marks: false, recs: true, structural: false });
check('rewritten lines ask for a refresh', S.diff(fp(), fp({ lines: '40@d' })).structural, true);
check('  so do the songs\' words or settings', S.diff(fp(), fp({ songs: 'h9' })).structural, true);
check('  and the book itself', S.diff(fp(), fp({ book: 'h9' })).structural, true);
check('a part that could not be read says nothing', S.diff(fp(), fp({ lines: 'na' })).structural, false);
check('  either way round', S.diff(fp({ marks: 'na' }), fp()).marks, false);
check('nothing seen yet is nothing to compare', S.diff(null, fp()), { marks: false, recs: false, structural: false });

console.log('\nthe hash');
check('the same text hashes the same', S.hash('abc') === S.hash('abc'), true);
check('  and different text differently', S.hash('abc') === S.hash('abd'), false);

(async function() {
  console.log('\nthe songbook\'s 2-second poll asks first whether anything changed');
  // A stand-in client that answers the orders table and notes what was asked.
  let stamp = '2026-10-31T10:00:00.000Z', fail = false;
  const asked = [];
  const sb = { from: t => ({ select: cols => { asked.push(t + ':' + cols); return { eq: () => ({ maybeSingle: () => Promise.resolve(fail ? { data: null, error: { message: 'x' } } : { data: { last_edited: stamp }, error: null }) }) }; } }) };
  const P = new Function('SBQ', 'var _sbPollFullRead = {}, _sbLastPollTs = 0;\n' + S.pollSrc + '\nreturn { changed: _sbPollChanged, seen: function(t) { _sbLastPollTs = t; } };')({ _sb: () => sb });
  check('the first poll of an open reads everything, asking nothing first', [await P.changed('o1'), asked.length], [true, 0]);
  P.seen(new Date(stamp).getTime());
  check('  after that it asks for the last-edited time alone', [await P.changed('o1'), asked], [false, ['orders:last_edited']]);
  stamp = '2026-10-31T10:00:05.000Z';
  check('  and reads everything again once that time has moved', await P.changed('o1'), true);
  fail = true;
  check('  a probe that cannot tell reads everything, as before', await P.changed('o1'), true);
  check('another order is read in full on its first poll', await P.changed('o2'), true);

  // -------------------------------------------------------------------
  console.log('\nhow a shared link can be shown inside the app');
  // The matrix, end to end: detectMediaType -> sbIsNativelyEmbeddable ->
  // sbBuildEmbedUrl -> _sbmLinkFrame. Sliced together rather than stubbed,
  // because the bug this replaces was a DISAGREEMENT between them.
  const F = new Function('window',
    extract(/^  function extractYoutubeId\(/, 'extractYoutubeId') + '\n' +
    extract(/^  function detectMediaType\(/, 'detectMediaType') + '\n' +
    extract(/^  function sbIsNativelyEmbeddable\(/, 'sbIsNativelyEmbeddable') + '\n' +
    extract(/^  function sbBuildEmbedUrl\(/, 'sbBuildEmbedUrl') + '\n' +
    extract(/^  function _sbmLinkView\(/, '_sbmLinkView') + '\n' +
    'window.detectMediaType = detectMediaType;\n' +
    'return _sbmLinkView;')({});

  const mode = u => F(u).mode;
  check('a YouTube link plays in the app', mode('https://youtu.be/dQw4w9WgXcQ'), 'embed');
  check('  through its embed address',
    /\/embed\//.test(F('https://youtu.be/dQw4w9WgXcQ').src), true);
  check('a Spotify track plays in the app', mode('https://open.spotify.com/track/abc123'), 'embed');
  check('a Google Doc opens in the app',
    mode('https://docs.google.com/document/d/AbC_1/edit'), 'embed');
  check('a Drive file opens in the app',
    /\/preview$/.test(F('https://drive.google.com/file/d/AbC_1/view').src), true);
  check('a PDF anywhere goes through a viewer that allows it',
    /docs\.google\.com\/viewer/.test(F('https://example.org/sheet.pdf').src), true);
  check('an image is just an image', mode('https://example.org/chart.png'), 'image');

  // The link the question was actually about. It must NOT pretend.
  const ug = F('https://tabs.ultimate-guitar.com/tab/x/y-123');
  check('a site that refuses framing is offered as a link, not a frame', ug.mode, 'open');
  check('  and it names the site that refused',
    /tabs\.ultimate-guitar\.com/.test(ug.why), true);
  check('nothing at all is still answerable', F('').mode, 'open');

  console.log('\nand the app is never framed inside itself');
  // sbBuildProxyUrl built "<this app's own URL>?proxy=<the site>". Under
  // Apps Script that was a server that fetched the page; on Vercel it is
  // THIS APP, so the panel loaded a second songbook inside itself. Every
  // caller is `sbBuildProxyUrl(u) || <the embed it already had>`.
  check('the proxy no longer builds an address',
    /function sbBuildProxyUrl\(\) \{ return null; \}/.test(raw), true);
  check('  and nothing points an iframe at our own origin',
    /window\.location\.origin \+ window\.location\.pathname;[\s\S]{0,120}\?proxy=/.test(raw), false);

  console.log('\nsharing a link with everyone');
  check('the channel listens for one',
    /\.on\('broadcast', \{ event: 'show' \}, function\(m\)/.test(raw), true);
  check('  and there is a sender for it',
    /_sbmLive\.channel\.send\(\{ type: 'broadcast', event: 'show',/.test(raw), true);
  // A panel across the words mid-verse is the one place this must not
  // barge in.
  check('the projector is told, not covered',
    /if \(!force && \(_sbLiveFullscreen \|\| _sbmPageView\)\) \{/.test(raw), true);
  check('  with a way to open it when ready',
    /actionLabel: 'Open',/.test(raw), true);
  // A URL is somebody else's text and may hold a quote.
  check('no URL is written into an onclick',
    /onclick="WO\.sbmLinkOpenCur\(\)"/.test(raw), true);

  const failed = results.filter(r => !r).length;
  console.log('\n' + (failed ? failed + ' of ' + results.length + ' checks FAILED' : 'All ' + results.length + ' checks passed.'));
  process.exit(failed ? 1 : 0);
})();
