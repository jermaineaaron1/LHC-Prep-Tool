'use strict';
// Harness for offline service support.
//
// WHY THIS EXISTS
// The operator asked for it on 2026-11-11: "can you establish a way to work
// offline, in the event the internet is down, especially half way through the
// service". The church runs the service from this app, so this is the one
// feature whose failure mode is a blank screen in front of a congregation --
// and the one feature that cannot be verified by reading the diff, because
// nothing about it is visible until the network is gone.
//
// WHAT WAS TRUE BEFORE, MEASURED
//   - There was no service worker anywhere. pwa-shell/sw.js is for a retired
//     GitHub Pages deployment (BASE = '/LHC-Worship-App') and is never served.
//   - "/" is a DYNAMIC Next route with no Cache-Control, so the browser kept
//     nothing, and boot needs four render-blocking third-party resources.
//   - Index.html threw on `window.supabase.createClient(...)` with no network,
//     taking the remaining ~575 lines of that block with it -- the URL-param
//     deep-link reader and the window.google shim included. Silently.
//   - The banner said "You're offline -- showing last loaded data". There was
//     no store of any kind, so on a cold load that sentence sat over an empty
//     app; and it was driven by navigator.onLine, which reports TRUE on church
//     Wi-Fi whose uplink has died -- the most common real failure.
//   - A failed SILENT autosave called _soSetSaveStatus(''), which BLANKS the
//     indicator. Every LCD edit goes through the silent path, so mid-service
//     the operator got nothing saved and nothing said.
//
// THE FOUR THINGS THIS GUARDS
//
// 1. THE ROUTING TABLE, run rather than matched. A wrong answer here is
//    silent and only shows up on a Sunday. The shell is NETWORK-FIRST: it is
//    one 7.3 MB file that redeploys on every push, and a worker that serves a
//    stale app is worse than no worker at all. Storage objects are
//    cache-first because their paths carry a timestamp. A non-GET is never
//    touched.
// 2. THE URL HARVEST, run rather than matched. urlsIn walks the loaded JSON
//    instead of naming fields, because backgrounds, sermon pages, inbox files
//    and attachments all hold their addresses in different shapes and those
//    shapes move. A field a hand-written list missed would be a picture
//    simply absent from the wall.
// 3. OFFLINE IS READ-ONLY, and there is no write queue. SBQ.saveOrder upserts
//    then PRUNES everything the payload does not contain, and its rails
//    (_knownItems, _lastWritten) live in page memory. A replayed payload is
//    detached from them, so it would re-assert deletion authority the client
//    no longer has.
// 4. THE RECONNECT FAULTS. A dropped lock channel used to stay dropped, so
//    locks failed OPEN for the rest of the service with nobody told -- and
//    the rebuild must NOT go through _edTeardownLocks, which broadcasts
//    ed_unlock for everything we hold.
//
// USAGE
//   node tools/offline-service-harness.js                 # ../Index.html
//   node tools/offline-service-harness.js path/to/file.html
//   node tools/offline-service-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show a2ddc8c:Index.html > x`).
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const ROOT = path.join(__dirname, '..');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(ROOT, 'Index.html');
// The worker is read from the repository, not from beside whatever file was
// passed in, so a negative control run on old Index.html source still
// exercises every check about the page rather than skipping half of them for
// want of a sw.js next door.
const SW = path.join(ROOT, 'public', 'sw.js');
const OWN = path.resolve(INDEX) === path.resolve(path.join(ROOT, 'Index.html'));

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const SRC = fs.readFileSync(INDEX, 'utf8');
const SWSRC = fs.existsSync(SW) ? fs.readFileSync(SW, 'utf8') : '';
const has = re => re.test(SRC);
const swHas = re => re.test(SWSRC);
// Bounded, on purpose. A lazy [^]*? that is not closed at the function's own
// end wanders into the rest of the file and matches a word that belongs to
// somebody else -- which is how three of this harness's own checks passed on
// prose the first time it was run (CLAUDE.md gotcha 82).
const fn = (name, indent) => {
  const i = indent === undefined ? '  ' : indent;
  const m = SRC.match(new RegExp('\\n' + i + 'function ' + name +
    '\\([^)]*\\) \\{[^]*?\\r?\\n' + i + '\\}'));
  return m ? m[0] : '';
};

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

// ---------------------------------------------------------------------------
// 1. The routing table, lifted out of sw.js and RUN
// ---------------------------------------------------------------------------
console.log('The service worker routes each request to the right cache, or leaves it alone');

check('public/sw.js exists and is served from the web root', !!SWSRC);

let route = null;
if (SWSRC) {
  const grab = name => {
    const m = SWSRC.match(new RegExp('^function ' + name + '\\([^)]*\\) \\{[^]*?^\\}', 'm'));
    return m ? m[0] : null;
  };
  const consts = (SWSRC.match(/^var (?:SUPA_HOST|ASSET_HOSTS) = [^;]*;$/gm) || []).join('\n');
  const origin = grab('_swOrigin'), router = grab('_swRoute');
  if (consts && origin && router) {
    try {
      route = new Function(consts + '\n' + origin + '\n' + router + '\nreturn _swRoute;')();
    } catch (e) { route = null; }
  }
  check('_swRoute can be run outside a browser (no bare `self`)', !!route);
}

if (route) {
  const O = 'https://lhc-prep-tool.vercel.app';
  const S = 'https://jypzhumcdifxnazexdcu.supabase.co';
  const t = (u, m, nav) => route(u, m || 'GET', !!nav, O);

  // The shell. A deep link must open the SAME cached document, or every link
  // but the bare root would miss -- which is most of how this app is opened.
  check('a navigation is the shell', t(O + '/', null, true) === 'shell');
  check('...and so is a deep link, query string and all',
    t(O + '/?order=abc&view=builder', null, true) === 'shell' &&
    t(O + '/?sbmPreview=x&sbmSong=y', null, true) === 'shell');
  check('the root as a subresource is the shell too', t(O + '/') === 'shell');
  check('/index.html is the shell', t(O + '/index.html') === 'shell');

  // Supabase.
  check('a REST read is data', t(S + '/rest/v1/orders?select=*') === 'data');
  check('a Storage object is media',
    t(S + '/storage/v1/object/public/Liturgy%20Files/a/1_b.png') === 'media');
  check('...matched on the PREFIX, so the bucket\'s space does not matter',
    t(S + '/storage/v1/object/public/Liturgy Files/a/1_b.png') === 'media');
  check('a signed Storage url is NOT cached', t(S + '/storage/v1/object/sign/x/y') === null);
  check('realtime is left alone (a worker cannot intercept a websocket anyway)',
    t(S + '/realtime/v1/websocket') === null);
  check('auth is left alone', t(S + '/auth/v1/token') === null);

  // The CDNs the page cannot paint without.
  check('the CDN scripts and webfonts are assets',
    t('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js') === 'asset' &&
    t('https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js') === 'asset' &&
    t('https://cdn.tailwindcss.com') === 'asset' &&
    t('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css') === 'asset' &&
    t('https://fonts.gstatic.com/s/lato/x.woff2') === 'asset');
  check('the app\'s own icons and manifest are assets',
    t(O + '/icon-192.png') === 'asset' && t(O + '/manifest.json') === 'asset');

  // Things that must never be answered from a cache.
  check('/api/* is never cached -- bible-passage is a live lookup',
    t(O + '/api/bible-passage?q=John+1') === null &&
    t(O + '/api/render-roster-pdf') === null);
  check('sw.js itself is never cached, or it could never be replaced',
    t(O + '/sw.js') === null);
  check('an unknown third party is left alone',
    t('https://www.youtube.com/watch?v=1') === null);
  check('a url that will not parse is left alone', t('::::') === null);

  // THE rule: offline is read-only, and the worker is where that is enforced
  // first. Every verb that can change data must fall straight through.
  const verbs = ['POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];
  const wrote = verbs.filter(v => t(S + '/rest/v1/orders', v) !== null ||
                                  t(O + '/', v) !== null);
  check('NO non-GET verb is ever routed to a cache', wrote.length === 0, wrote.join(', '));
}

// ---------------------------------------------------------------------------
// 2. Strategy, asserted on the worker's own source
// ---------------------------------------------------------------------------
console.log('\nThe shell is never served stale, and the immutables never re-fetched');
check('the shell is network-first with a fallback timeout',
  swHas(/_networkFirst\('shell', req, \d+\)/));
check('a REST read is network-first too, so online is always fresh',
  swHas(/_networkFirst\('data',\s+req, \d+\)/));
check('assets and media are cache-first',
  swHas(/_cacheFirst\(kind, req\)/));
check('only a clean answer is cached as the shell',
  swHas(/res\.ok && res\.type !== 'opaqueredirect'/));
check('the shell is keyed "/" whatever query string it was asked for',
  swHas(/function _keyFor[^]*?kind === 'shell' \? new Request\(self\.location\.origin \+ '\/'\)/));
check('activate deletes only this worker\'s own caches',
  swHas(/n\.indexOf\('lhc-offline-'\) === 0 && MINE\.indexOf\(n\) === -1/));
check('the render-blocking CDN files are precached on install',
  swHas(/PRECACHE_ASSETS = \[[^]*?supabase-js@2[^]*?cdn\.tailwindcss\.com[^]*?font-awesome[^]*?\]/));
check('each precache entry is put on its own -- addAll is all-or-nothing',
  swHas(/\.map\(function \(u\) \{ return _warm\(c, u\); \}\)/));
check('the download files each url in the cache _swRoute would READ it from',
  swHas(/var kind = _swRoute\(u, 'GET', false\);[^]*?caches\.open\(CACHE_OF\[kind\]\)/));
// The failure the church actually has: a guest network whose sign-in page
// intercepts everything and answers a REST read with 200 and an HTML form.
// Cached, that becomes "the order" until the cache is cleared -- and it would
// survive the network coming back.
check('a captive portal\'s HTML is never kept as an order',
  swHas(/if \(kind === 'data'\)\s+return ct\.indexOf\('json'\) !== -1;/));
check('...nor as the app shell',
  swHas(/if \(kind === 'shell'\) return ct\.indexOf\('html'\) !== -1;/));
check('a 5xx or a portal page falls back to what we have',
  swHas(/if \(!good\) \{ fallBack\(res\); return; \}/));
check('...but with nothing cached the real answer is passed on, not Response.error',
  swHas(/resolve\(hit \? _fromCache\(hit\) : \(res \|\| Response\.error\(\)\)\);/));
check('an opaque asset is still replayable -- it has no readable headers',
  swHas(/if \(res\.type === 'opaque'\) return kind === 'asset' \|\| kind === 'media';/));

// ---------------------------------------------------------------------------
// 3. The URL harvest, lifted out of Index.html and RUN
// ---------------------------------------------------------------------------
console.log('\nEvery Storage address a service needs is found, whatever shape it is in');

const urlsSrc = fn('urlsIn');
let urlsIn = null;
if (urlsSrc) {
  try { urlsIn = new Function(urlsSrc + '\nreturn urlsIn;')(); } catch (e) { urlsIn = null; }
}
check('urlsIn can be run on its own', !!urlsIn);

if (urlsIn) {
  const B = 'https://jypzhumcdifxnazexdcu.supabase.co/storage/v1/object/public/';
  // The real shapes, from the order a service actually loads.
  const order = {
    order: {
      id: 'order_1',
      template: {
        backgrounds: { 'wo-section-1': { type: 'image', value: B + 'Liturgy%20Files/bg/1699_a.jpg' } },
        pptSections: [{ pages: [B + 'Liturgy%20Files/ppt/1700_p1.png', B + 'Liturgy%20Files/ppt/1700_p2.png'] }]
      }
    },
    items: [
      { id: 'i1', slides: [{ index: 0, content: 'Holy, holy', background: { value: B + 'media/1701_x.png' } }] },
      { id: 'i2', content: { youtube: ['https://www.youtube.com/watch?v=abc'],
                             attachments: [{ url: B + 'docs/1702_sheet.pdf' }] } }
    ]
  };
  const got = urlsIn(order).sort();
  check('it finds a slide background, nested two objects deep',
    got.indexOf(B + 'media/1701_x.png') !== -1);
  check('...a sermon page image inside an array inside the template',
    got.indexOf(B + 'Liturgy%20Files/ppt/1700_p2.png') !== -1);
  check('...and a song attachment, in a different shape again',
    got.indexOf(B + 'docs/1702_sheet.pdf') !== -1);
  check('it leaves a YouTube link alone -- that is not ours to cache',
    got.every(u => u.indexOf('youtube.com') === -1));
  check('the whole order yields exactly its five Storage files', got.length === 5, got.join('\n       '));

  // The details that bite.
  check('a url is listed once, however many places it appears',
    urlsIn({ a: B + 'x/1.png', b: { c: B + 'x/1.png' }, d: [B + 'x/1.png'] }).length === 1);
  check('trailing punctuation from prose is trimmed off',
    urlsIn({ n: 'see ' + B + 'x/1.png.' })[0] === B + 'x/1.png');
  check('nothing in an empty or odd order throws',
    urlsIn(null).length === 0 && urlsIn(undefined).length === 0 &&
    urlsIn(0).length === 0 && urlsIn('').length === 0 && urlsIn([]).length === 0);
  check('a cycle does not hang it',
    (function () {
      const a = { u: B + 'x/1.png' }; a.self = a;
      try { return urlsIn(a).length === 1; } catch (e) { return false; }
    })());
}

// ---------------------------------------------------------------------------
// 4. Boot survives a missing library
// ---------------------------------------------------------------------------
console.log('\nThe page still boots with no network and no supabase-js');
check('createClient is guarded, not bare',
  has(/try \{\s*\r?\n\s*if \(window\.supabase && window\.supabase\.createClient\) \{\s*\r?\n\s*_db = window\.supabase\.createClient\(SUPA_URL, SUPA_ANON\);/));
check('...and the bare throw is gone',
  !has(/\n\s*var _db = window\.supabase\.createClient\(SUPA_URL, SUPA_ANON\);/));
check('the deep-link reader is still in the same block, below it, so it now runs',
  /_db = window\.supabase\.createClient[^]*?__DEEPLINK_ORDER/.test(SRC));
check('a missing library is reported as the network being down',
  /supabase-js did not load[^]*?LHC_Net\.mark\(false\)/.test(SRC));

// ---------------------------------------------------------------------------
// 5. The banner tells the truth
// ---------------------------------------------------------------------------
console.log('\n"Offline" means a read actually failed, not navigator.onLine');
// Anchored at `var watch =`, not at the method test on its own: a fragment
// match passed on `var watch = true || String(method)...`, which watches
// writes too.
check('LHC_Net watches Supabase GETs by wrapping fetch',
  has(/window\.LHC_Net = \{/) &&
  has(/var watch = String\(method\)\.toUpperCase\(\) === 'GET' &&/));
// A Storage picture served from the offline cache says nothing about whether
// the DATABASE is there, and counting it was one of the two ways this lied.
check('...and only REST reads count, not a cached Storage picture',
  has(/String\(url\)\.indexOf\('\/rest\/v1\/'\) !== -1/));
check('it is installed BEFORE the supabase-js tag, so the library captures it',
  SRC.indexOf('window.LHC_Net = {') <
  SRC.indexOf('src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'));
check('a write is never counted -- a refused write is not a dead uplink',
  has(/Only GETs are\s*\r?\n\s*watched/));
check('"not asked yet" is null, not offline, so the banner is quiet at boot',
  has(/var reachable = null/) && has(/return reachable === false \|\| navigator\.onLine === false;/));
// ---------------------------------------------------------------------------
// Measured 2026-11-13, running the app with every Supabase read failing: the
// app worked perfectly off the cache and LHC_Net.reachable() was still TRUE,
// so the banner never appeared. Two causes, one check each.
// ---------------------------------------------------------------------------
check('a resolved response is NOT success -- a 401 or a portal page resolves too',
  !has(/return p\.then\(function \(res\) \{ mark\(true\); return res; \}/) &&
  /function judge\(res\)[^]*?if \(res\.ok\) \{ mark\(true\); return; \}/.test(SRC));
check('a CACHE-SERVED read means we did not reach the database',
  /function judge\(res\)[^]*?if \(cached\) \{ mark\(false\); return; \}/.test(SRC) &&
  has(/res\.headers\.get\('X-LHC-From-Cache'\)/));
check('...and the worker is what stamps it',
  swHas(/h\.set\('X-LHC-From-Cache', '1'\);/) &&
  swHas(/resolve\(hit \? _fromCache\(hit\) : \(res \|\| Response\.error\(\)\)\);/));
check('an opaque response is never re-wrapped -- it has no readable headers',
  swHas(/if \(!res \|\| res\.type === 'opaque'\) return res;/));
check('a 4xx leaves the flag alone: the server answered, so the uplink is fine',
  /function judge\(res\)[^]*?if \(res\.status >= 500 \|\| res\.status === 0\) mark\(false\);/.test(SRC));

check('the banner reads LHC_Net',
  has(/var off = window\.LHC_Net \? LHC_Net\.offline\(\) : !navigator\.onLine;/));
check('...and no longer toggles on navigator.onLine alone',
  !has(/offDiv\.classList\.toggle\('show', !navigator\.onLine\)/));
// The phrase itself still appears -- in the comment saying why it went. So
// this asks about the STATEMENT, not the words (gotcha 82 again).
check('it no longer claims "showing last loaded data" with nothing stored',
  !has(/offDiv\.innerHTML = '<i class="fa-solid fa-wifi-slash"><\/i> You/));
check('it says WHICH of the two situations it is',
  has(/running from the copy of this service you downloaded/) &&
  has(/cannot reach the database/));
check('a change in reachability redraws it',
  has(/window\.addEventListener\('lhc:net', _syncOnline\)/));

// ---------------------------------------------------------------------------
// 6. A failed save is visible
// ---------------------------------------------------------------------------
console.log('\nA silent autosave that did not land says so');
check('there is a "failed" state at all', has(/if \(state === 'failed'\)/));
check('neither silent failure path blanks the indicator any more',
  !/if \(silent\) \{\s*\r?\n\s*_soSetSaveStatus\(''\);/.test(SRC) &&
  !/Backend save failed:', err\);[^]*?_soSetSaveStatus\(''\);/.test(SRC));
// REVERSED on 2026-11-13, and the reason matters. A failed save used to call
// LHC_Net.mark(false) -- "a save that threw is almost always the uplink".
// Once the reconnect below began retrying the save, the two made a loop:
// the retry fails, marks us offline, the next read succeeds and marks us
// online, which fires the retry again. Measured in the browser: with writes
// refused, LHC_Net.reachable() oscillated and the banner would not settle.
// Reads answer the question on their own, the offline case included -- with a
// warm cache the worker stamps what it served and judge() reads that as not
// having reached the database.
check('a failed save no longer claims the network is down',
  !/Backend save failed[^]*?_soSetSaveStatus\('failed'\);\s*\r?\n\s*(?:\/\*[^]*?\*\/\s*\r?\n\s*)?if \(window\.LHC_Net\) LHC_Net\.mark\(false\)/.test(SRC));
check('...and it still says so in the indicator',
  /Backend save failed[^]*?_soSetSaveStatus\('failed'\);/.test(SRC));
check('nothing is queued to be written later',
  !has(/lhc_offline_queue|_offlineQueue|replayOfflineWrites/));

// ---------------------------------------------------------------------------
// 7. The download
// ---------------------------------------------------------------------------
console.log('\n"Download for Sunday" replays the app\'s own reads');
// Asked of the download function ALONE. `return SBQ.loadOrder(orderId).then`
// also appears in the WO module, so this check passed on somebody else's call
// the first time it was written -- the mutation test is what found that
// (CLAUDE.md gotcha 82, for the third time in one harness).
const dlSrc = fn('download');
const dlHas = re => re.test(dlSrc);
check('the download function can be found at all', !!dlSrc);
check('it goes through SBQ.loadOrder, not a hand-built REST url',
  dlHas(/return SBQ\.loadOrder\(orderId\)\.then/));
check('it warms the projection versions, settings and pictures',
  dlHas(/SBQ_PROJECTION\.load\(orderId\)/) && dlHas(/SBQ_PROJECTION\.loadMedia\(orderId\)/));
check('...the song library and each song\'s choir parts',
  dlHas(/SBQ_SONGS\.getAll\(\)\.then\(collect/) && dlHas(/SBQ_VOICE_LINES\.forSong\(sid\)/));
check('...and song_marks / song_recordings query for query, so the keys match',
  dlHas(/from\('song_marks'\)\.select\('\*'\)\.eq\('song_id', sid\)\s*\r?\n?\s*\.order\('created_at'\)/) &&
  dlHas(/from\('song_recordings'\)\.select\('\*'\)\.eq\('song_id', sid\)/));
// MEASURED on a real order, not assumed. A stored song row's own id is
// `wo-song-<ts>-<rand>` and neither content nor customizations carries the
// song at all; the library id is `sourceId`. Written the other way round
// first, the download reported "0 songs in this service" and quietly fetched
// no choir parts, no drawings and no takes, while looking like it worked.
check('the library song id is read off sourceId, which is where it actually is',
  dlHas(/var sid = it\.sourceId \|\| it\.songId \|\| String\(it\.id \|\| ''\)\.split\('--'\)\[0\];/));
check('...only for song rows, so a liturgy id is never queried as a song',
  dlHas(/if \(it\.itemType !== 'song'\) return;/));
check('...and only when it looks like a song id',
  dlHas(/String\(sid\)\.indexOf\('song_'\) === 0/));
check('what is stored is remembered per order, with its size',
  has(/STORE = 'lhc_offline_ready'/) && has(/bytes: \(r && r\.bytes\) \|\| 0/));
check('the sheet says practice recordings are not downloaded',
  has(/Practice[^]{0,40}recordings are not downloaded/));
check('the sheet says plainly that nothing can be saved offline',
  has(/nothing can be saved/));

// ---------------------------------------------------------------------------
// The next service keeps itself downloaded
// ---------------------------------------------------------------------------
console.log('\nThe next service is kept on the device without anybody remembering');
const warmSrc = fn('warm');
const skipSrc = fn('_warmSkip');
check('there is a quiet warm, separate from the sheet\'s download', !!warmSrc);
check('it is quiet -- a failure is a console line, never a toast',
  warmSrc.indexOf('showToast') === -1 && warmSrc.indexOf('console.warn') !== -1);
check('it leaves the SAME record a hand-pressed download leaves',
  warmSrc.indexOf('download(orderId, title)') !== -1);
check('a switch governs it, default on',
  has(/function autoOn\(\) \{\s*\r?\n\s*try \{ return localStorage\.getItem\(AUTO\) !== '0'; \}/));
check('...and the sheet offers that switch',
  has(/id="lhcOffAuto"/) && has(/au\.onchange = function \(\) \{ setAuto\(au\.checked\); \};/));
// This spends somebody's data and battery, so each refusal is its own check.
check('it refuses when the switch is off', skipSrc.indexOf("if (!autoOn())") !== -1);
check('it refuses on Data Saver or a 2g connection',
  skipSrc.indexOf('c.saveData') !== -1 && /slow-2g/.test(skipSrc));
check('it refuses while a download the operator started is running',
  skipSrc.indexOf('if (_busy)') !== -1);
check('it refuses more than once a day per order',
  skipSrc.indexOf('WARM_EVERY') !== -1 &&
  has(/var WARM_EVERY = 20 \* 60 \* 60 \* 1000;/));
check('it refuses before the worker is running', skipSrc.indexOf('if (!ready())') !== -1);

const pickSrc = fn('_woAutoOffline');
check('the WO module picks which service, since only it knows', !!pickSrc);
// The COMPARISON, not the word "bestWhen": a first version of this check
// looked for the variable name, and passed on a mutant that kept the name and
// took whichever upcoming order came first in the array. The mutation test is
// what caught it (gotcha 82, yet again).
check('the SOONEST upcoming service, not the most recently edited',
  /if \(when < bestWhen\) \{ bestWhen = when; next = o; \}/.test(pickSrc) &&
  pickSrc.indexOf('_woOrderIsUpcoming(o)') !== -1);
check("...and never a songbook's pseudo-order, which is not a service",
  pickSrc.indexOf("indexOf('standalone_') === 0") !== -1);
check('it waits well past boot, so it never competes with the app painting',
  /\}, tries \? 15000 : 20000\);/.test(pickSrc));
check('it retries while the worker is still installing on a first visit',
  pickSrc.indexOf('!LHC_Offline.ready() && ++tries < 5') !== -1);
check('...but not for ever', pickSrc.indexOf('tries < 5') !== -1);
check('it runs once, from the background orders preload',
  has(/_woFetchOrderCounts\(\);\s*\r?\n\s*_woAutoOffline\(\);/) &&
  pickSrc.indexOf('if (_woAutoOfflineDone) return;') !== -1);
// _woOrderIsUpcoming worked the date out and threw it away; sorting needs it.
check('one definition of when a service is, shared with _woOrderIsUpcoming',
  !!fn('_woOrderWhen') &&
  fn('_woOrderIsUpcoming').indexOf('_woOrderWhen(order)') !== -1);

// ---------------------------------------------------------------------------
// The banner closes, and coming back offers a refresh
// ---------------------------------------------------------------------------
console.log('\nThe offline bar can be shut, and the internet coming back says so');
// From the operator (2026-11-13), after testing a real phone with the data
// plan and Wi-Fi both off: everything worked, and the bar sat over the
// controls above the header for the whole service.
check('the bar has a close',
  has(/<button type="button" class="lhc-off-x" aria-label="Close">/) &&
  has(/offDiv\.querySelector\('\.lhc-off-x'\)\.onclick = function \(\) \{/));
check('...a real tap target, the full height of the bar',
  has(/#lhcOfflineBanner \.lhc-off-x \{[^}]*width: 40px;/) &&
  has(/#lhcOfflineBanner \.lhc-off-x \{[^}]*top: 0; right: 0; bottom: 0;/));
check('...and the message is kept clear of it',
  has(/padding: 8px 44px 8px 16px;/));
// Dismissed per EPISODE: since() moves on every change of state, so going
// offline again, or coming back, speaks again.
check('closing it hides this episode, not every future one',
  has(/_offSeenAt = _offSince\(\);/) &&
  has(/if \(!mode \|\| _offSeenAt === _offSince\(\)\) \{ offDiv\.classList\.remove\('show'\); return; \}/));
check('a dismissal cannot outlive the state it was made in',
  has(/function _offSince\(\) \{ return window\.LHC_Net \? LHC_Net\.since\(\) : 0; \}/));
check('nothing is said about being back until we have been away',
  has(/var mode = off \? 'off' : \(_offWasOff \? 'back' : null\);/));
check('back online is its own colour and offers the refresh',
  has(/#lhcOfflineBanner\.is-back \{/) &&
  has(/Back online \u2014 refresh to load the latest changes\./) &&
  has(/data-off="refresh"/));

const refSrc = fn('_offRefresh', '    ');
check('the refresh can be found', !!refSrc);
// The trap this avoids: everything typed during the outage failed to save, so
// a reload would throw it away.
// Matched WITH its indent, and by ORDER. Without the indent this also found
// the identical line inside the wait loop, so a mutant that deleted the real
// early return changed nothing the harness could see.
const _early = refSrc.indexOf(String.fromCharCode(10) + '      if (!unsaved()) { location.reload(); return; }');
const _saves = refSrc.indexOf('WO.saveImmediately()');
check('it saves BEFORE reloading, and only reloads once nothing is unsaved',
  _early !== -1 && _saves !== -1 && _early < _saves);
check('...and if the save will not land it says so rather than reloading',
  /if \(\+\+tries > 25\) \{/.test(refSrc) &&
  refSrc.indexOf('Refreshing now would lose them') !== -1 &&
  refSrc.indexOf("btn.textContent = 'Refresh anyway'") !== -1);
check('"unsaved" covers a save waiting on its debounce as well as one that failed',
  has(/_soUnsaved = \(state === 'pending' \|\| state === 'failed'\);/) &&
  has(/function unsavedWork\(\) \{ return !!\(_soUnsaved && currentOrderData\); \}/) &&
  has(/    unsavedWork: unsavedWork,/));
// Bounded to the listener itself. A lazy [^]*? run across the whole file
// found a saveImmediately() belonging to something else and passed on a
// mutant that had taken this one out (gotcha 82).
const _netListen = (SRC.match(/\n  window\.addEventListener\('lhc:net', function \(e\) \{[^]*?\r?\n  \}\);/) || [''])[0];
check('the internet coming back saves what the outage held',
  _netListen.indexOf('if (!unsavedWork()) return;') !== -1 &&
  _netListen.indexOf('saveImmediately();') !== -1);
check('...at most once per reconnect',
  has(/if \(Date\.now\(\) - _soRetryAt < 15000\) return;/));

// ---------------------------------------------------------------------------
// 8. Registration
// ---------------------------------------------------------------------------
console.log('\nThe worker is registered once, and never by the Phone view');
check('registration happens at boot', has(/if \(window\.LHC_Offline\) LHC_Offline\.register\(\);/));
check('...in the branch that is not the Phone view',
  /if \(window\.__SBM_PREVIEW\) \{[^]*?\} else \{[^]*?LHC_Offline\.register\(\);/.test(SRC));
check('...and register() refuses in the Phone view even if something calls it',
  /function register\(\) \{[^]*?if \(window\.__SBM_PREVIEW\) return Promise\.resolve\(null\);/.test(SRC));
check('a non-secure context is skipped rather than throwing',
  has(/if \(!window\.isSecureContext\) return Promise\.resolve\(null\);/));
check('the scope is the whole app', has(/register\('\/sw\.js', \{ scope: '\/' \}\)/));

// ---------------------------------------------------------------------------
// 9. The two reconnect faults
// ---------------------------------------------------------------------------
console.log('\nLocks come back after a blip, and a background we cannot fetch goes black');
check('both lock channels schedule a rebuild when they drop',
  (SRC.match(/_edScheduleRelock\(\);/g) || []).length >= 2);
const relockSrc = fn('_edRebuildLockChannels');
check('the rebuild does NOT go through _edTeardownLocks, which would give our locks away',
  !!relockSrc && relockSrc.indexOf('_edTeardownLocks') === -1, relockSrc.slice(0, 200));
check('...so _edMyLocks survives it and SUBSCRIBED re-asserts them',
  relockSrc.indexOf('_edMyLocks') === -1 &&
  /_edEnsureChannel\(\);\s*\r?\n\s*\}$/.test(relockSrc) &&
  has(/_edLockReady = true;\s*\r?\n\s*_edRelockDelay = 5000;/));
check('a deliberate teardown does not trigger a pointless rebuild',
  has(/if \(_edLockReady && _edSongReady\) \{ _edRelockDelay = 5000; return; \}/));
check('it backs off, so a long outage does not hammer the socket',
  has(/_edRelockDelay = Math\.min\(60000, _edRelockDelay \* 2\);/));
check('no relock is scheduled with no order open',
  has(/if \(!\(currentOrderData && currentOrderData\.id\)\) return;/));

check('a background that will not load is replaced with black',
  /function _lcdBgBlackOnFail\(el\) \{[^]*?el\.style\.background = '#000';[^]*?\n  \}/.test(SRC));
// The version tried first -- "a remote url is unresolvable while the health
// flag says we are offline" -- is wrong the moment the worker has the file
// cached: it would blank a background that works.
check('...hooked on the element, NOT guessed from the network flag',
  has(/m\.addEventListener\('error'/) &&
  fn('_lcdBgUnresolvable').indexOf('LHC_Net') === -1);
check('...which is what keeps a cached background working offline',
  has(/not in the offline cache/));
check('both the image and the fresh video get the hook',
  (SRC.match(/_lcdBgBlackOnFail\(el\);/g) || []).length >= 2);
check('a later slide cannot be blanked by an earlier probe',
  has(/if \(m\.parentNode !== el\) return;/));
check('the projection popup probes its background-image, which fires no error',
  has(/bgEl\.setAttribute\("data-bg", bg\.value\);/) &&
  has(/if \(bgEl\.getAttribute\("data-bg"\) === u\) bgEl\.style\.background = "#000"/));

// ---------------------------------------------------------------------------
// 10. The two copies
// ---------------------------------------------------------------------------
console.log('\nIndex.html and dist/index.html still match');
const DIST = path.join(ROOT, 'dist', 'index.html');
// Only when the repository's own Index.html is what was checked. Against a
// file out of git history the two are SUPPOSED to differ.
if (!OWN) {
  console.log('  --   skipped (not this repo\'s Index.html)');
} else if (fs.existsSync(DIST)) {
  check('byte-identical', fs.readFileSync(DIST, 'utf8') === SRC);
} else {
  check('dist/index.html exists', false);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
