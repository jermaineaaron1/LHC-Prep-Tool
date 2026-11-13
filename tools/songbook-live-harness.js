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
const SRC = raw;
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
  S.pollSrc = extract(/^  function _sbPollChanged\(/, '_sbPollChanged') + '\n' +
    extract(/^  function _sbPollVerdict\(/, '_sbPollVerdict') + '\n' + extract(/^  function _sbPollTake\(/, '_sbPollTake');
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
  const own = [];
  const P = new Function('SBQ', 'var _sbPollFullRead = {}, _sbPollSeen = {};\n' + S.pollSrc +
    '\nreturn { changed: _sbPollChanged, take: _sbPollTake, verdict: _sbPollVerdict, seen: function(o, t) { _sbPollSeen[o] = t; }, known: function(o) { return _sbPollSeen[o]; } };')(
    { _sb: () => sb, _isOwnEdit: (o, t) => own.indexOf(o + '@' + t) !== -1, _noteSeenEdit: () => {} });
  const ms = x => new Date(x).getTime();
  check('the first poll of an open reads everything, asking nothing first', [await P.changed('o1'), asked.length], [true, 0]);
  P.seen('o1', ms(stamp));
  check('  after that it asks for the last-edited time alone', [await P.changed('o1'), asked], [false, ['orders:last_edited']]);
  stamp = '2026-10-31T10:00:05.000Z';
  check('  and reads everything again once that time has moved', await P.changed('o1'), true);
  // The clock skew (review, 2026-11-13): another device's clock a minute
  // behind this one's stamps its save EARLIER than what this device last
  // saw. Compared with a clock the poll skipped it; compared by value it is
  // a change.
  P.seen('o1', ms('2026-10-31T10:01:00.000Z'));
  stamp = '2026-10-31T10:00:30.000Z';
  check('  a save stamped by a slower clock than this one is still a change', await P.changed('o1'), true);
  check('  ...and a full read of it is applied', P.take('o1', ms(stamp)), true);
  check('  ...and then known, so the next poll asks and reads nothing more', [P.known('o1'), await P.changed('o1')], [ms(stamp), false]);
  stamp = '2026-10-31T10:02:00.000Z'; own.push('o1@' + ms(stamp));
  check('this device\'s own save is not taken for a change', await P.changed('o1'), false);
  check('  ...and becomes the time known', P.known('o1'), ms(stamp));
  check('  ...a full read of its own save applies nothing', P.take('o1', ms(stamp)), false);
  check('a first full read is taken as the start, never applied', [P.take('o9', ms(stamp)), P.known('o9')], [false, ms(stamp)]);
  check('a full read that cannot tell its time applies nothing', P.take('o1', 0), false);
  check('the verdict, pure', [P.verdict(0, 5, false), P.verdict(5, undefined, false), P.verdict(5, 5, false), P.verdict(4, 5, true), P.verdict(4, 5, false)],
    ['unknown', 'adopt', 'same', 'own', 'new']);
  fail = true;
  check('  a probe that cannot tell reads everything, as before', await P.changed('o1'), true);
  check('another order is read in full on its first poll', await P.changed('o2'), true);
  check('no poll path compares the order\'s time with this device\'s clock', /_sbLastPollTs|remoteTs <= /.test(SRC), false);
  check('every write of an order notes its time as this device\'s own',
    (SRC.match(/SBQ\._noteOwnEdit\(/g) || []).length >= 5 &&
    /SBQ\._noteOwnEdit\(orderId, now\);\s*\r?\n\s*return sb\.from\('orders'\)\.update\(\{ last_edited: now \}\)/.test(SRC) &&
    /last_edited:  now,\s*\r?\n\s*created_by:[^\n]*\r?\n\s*\};\s*\r?\n\s*SBQ\._noteOwnEdit\(id, now\);/.test(SRC), true);

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

  console.log('\nwhere a saved link goes');
  // Browse online saves through the SAME function the Add-a-link modal
  // saves through, because the decision is three-way -- media to
  // customYoutube, a document to customDocs, an ordinary site to
  // sbLinks -- and a second copy of it would drift from the first.
  // Extracted from the modal callback, so this is the live routing.
  const A = new Function('window', 'document', 'songOrderSections', 'detectMediaType',
    'sbDomainLabel', '$', 'buildSongMediaArea', 'updateQuickList', 'renderSongbookLive',
    'sbAutoSave', 'sbToggleSongLink', 'setTimeout',
    extract(/^  function _sbAddLinkToSong\(/, '_sbAddLinkToSong') +
    '\nreturn _sbAddLinkToSong;');

  // It reads window.detectMediaType, not a bare one -- so the classifier
  // goes on the window it is handed. Passed as a plain argument first,
  // every link routed to sbLinks and four of these checks failed, which
  // is the stub being wrong rather than the app.
  const dm = new Function('url',
    extract(/^  function extractYoutubeId\(/, 'extractYoutubeId') + '\n' +
    extract(/^  function detectMediaType\(/, 'detectMediaType') + '\nreturn detectMediaType(url);');

  const route = (url) => {
    const song = { id: 's1', title: 'A song' };
    A({ detectMediaType: dm }, { getElementById: () => null }, [song], dm,
      (u) => String(u).replace(/^https?:\/\//, '').split('/')[0],
      () => null, () => '', () => {}, () => {}, () => {}, () => {}, () => {})('s1', url);
    return { yt: (song.customYoutube || []).length, docs: (song.customDocs || []).length,
             links: (song.sbLinks || []).length };
  };

  check('a YouTube link is filed as media', route('https://youtu.be/abc'), { yt: 1, docs: 0, links: 0 });
  check('a Spotify link is filed as media',
    route('https://open.spotify.com/track/abc123'), { yt: 1, docs: 0, links: 0 });
  check('a Google Doc is filed as a document',
    route('https://docs.google.com/document/d/A1/edit'), { yt: 0, docs: 1, links: 0 });
  check('a PDF is filed as a document',
    route('https://example.org/chart.pdf'), { yt: 0, docs: 1, links: 0 });
  // The one the Browse panel exists for.
  check('an ordinary site is filed as a link',
    route('https://tabs.ultimate-guitar.com/tab/x/y-123'), { yt: 0, docs: 0, links: 1 });
  check('an address typed without https still saves',
    route('tabs.ultimate-guitar.com/tab/x/y'), { yt: 0, docs: 0, links: 1 });
  check('nothing typed saves nothing', route(''), { yt: 0, docs: 0, links: 0 });
  check('the modal still goes through the same door',
    /sbShowAddLinkModal\(function\(url\) \{ _sbAddLinkToSong\(songId, url\); \}\);/.test(raw), true);

  console.log('\nwhat Browse online searches for');
  // The song, whoever wrote it, and the word that turns a song into a
  // chord sheet. Put IN the box, not appended on the way out, so it can
  // be read and changed before it is sent.
  const Q = new Function(extract(/^  function _sbmFindQuery\(/, '_sbmFindQuery') +
    '\nreturn _sbmFindQuery;')();
  check('title, artist and the word chords',
    Q({ title: 'Give Me Oil In My Lamp', artist: 'Traditional' }),
    'Give Me Oil In My Lamp Traditional chords');
  check('no artist, no empty gap', Q({ title: 'Silent Night' }), 'Silent Night chords');
  check('an artist of spaces counts as none',
    Q({ title: 'Silent Night', artist: '   ' }), 'Silent Night chords');
  check('nothing at all still asks for chords', Q({}), 'chords');
  check('the box is filled from it, not from the title',
    /value="' \+ escapeHtml\(_sbmFindQuery\(song\)\) \+/.test(raw), true);
  // One search, not four: the three site buttons were each a worse
  // search than the web's.
  check('there is one place to search',
    /var _SBM_SEARCH = 'https:\/\/duckduckgo\.com\/\?q=';/.test(raw), true);
  check('  and the site-by-site list is gone', /_SBM_FIND/.test(raw), false);
  // Found by looking at it on a phone, not by reading it. `.sbm-input`
  // is sized for a flex ROW -- `flex: 1 1 auto; min-width: 0`, beside a
  // button sharing the line. On a line of its OWN none of that applies
  // and the box falls back to the browser's default input width: 209px
  // under a 347px button, so the query the panel had just written was
  // cut off at "Make Room (In Your Hea" and could be neither read nor
  // edited. Every box in this sheet is on a line of its own, so every
  // one of them must say so -- including the next one somebody adds.
  const browseSrc = extract(/^  function sbmBrowse\(\) \{/, 'sbmBrowse');
  const plainInputs = (browseSrc.match(/class="sbm-input(?!--|[\w-]* sbm-input--block)[^"]*"/g) || []);
  check('every box in Browse online is laid out as a block', plainInputs, []);
  check('  and that is what the class means',
    /\.sbm-input--block \{ width: 100%; \}/.test(raw), true);

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
