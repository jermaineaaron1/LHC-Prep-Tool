/* LHC Worship Prep — offline service worker.
 *
 * WHY THIS EXISTS
 * The church runs the service from this app. Until this file there was no
 * service worker at all, so a dropped connection mid-service left the operator
 * one refresh away from a blank screen: `/` is a dynamic Next route with no
 * Cache-Control, and the page cannot render without five third-party
 * resources (supabase-js, Tailwind's CDN build, Font Awesome, Google Fonts).
 *
 * THE RULE THAT SHAPES EVERYTHING HERE
 * A service worker that serves a stale app is WORSE than no service worker.
 * The shell is one 7.3 MB file that redeploys on every push; if this cached it
 * first, the church would run an old build with no way to tell. So the shell is
 * network-first and only falls back to the cache when the network does not
 * answer. Everything that is immutable — versioned CDN files, Storage objects
 * whose paths carry a timestamp — is cache-first.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It never touches a write. Offline is read-only, because `SBQ.saveOrder` is a
 * whole-order prune whose safety rails live in page memory; replaying a stored
 * payload later would re-assert deletion authority the client no longer has.
 * See CLAUDE.md gotcha 76.
 */
'use strict';

/* Bump BUILD to retire every old cache in one go. */
var BUILD  = 'lhc-offline-v1';
var SHELL  = BUILD + '-shell';
var ASSETS = BUILD + '-assets';
var DATA   = BUILD + '-data';
var MEDIA  = BUILD + '-media';
var MINE   = [SHELL, ASSETS, DATA, MEDIA];

var SUPA_HOST = 'jypzhumcdifxnazexdcu.supabase.co';

/* Hosts whose files are versioned or immutable, so cache-first is safe. */
var ASSET_HOSTS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

/* The render-blocking five, plus the three loaded at the end of the body.
   Without the first four the page paints as unstyled HTML with empty boxes
   where every icon should be. */
var PRECACHE_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;800&family=Lato:wght@300;400;600;700&family=Poppins:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
];

/* Only the document goes in the shell cache. The icons and the manifest are
   routed to ASSETS by _swRoute, and precaching them anywhere else would store
   a copy no request ever reads. */
var PRECACHE_SHELL = ['/'];

var PRECACHE_ICONS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg',
  '/lhc-jubilee-55-light.png',
  '/lhc-luther-rose.png'
];

/* ------------------------------------------------------------------ *
 * The routing decision, as one pure function.
 *
 * Kept pure and exported below so tools/offline-service-worker-harness.js
 * can run it without a browser: this is the part where a wrong answer is
 * silent and only shows up on a Sunday.
 *
 * Returns the cache a request belongs to, or null to leave it alone.
 * ------------------------------------------------------------------ */
function _swOrigin() {
  return (typeof self !== 'undefined' && self.location) ? self.location.origin : '';
}

function _swRoute(rawUrl, method, isNavigate, origin) {
  if (method && method !== 'GET') return null;   // never a write

  /* `origin` is injected by the harness. In the worker it is self's own; a
     bare `self` would be a ReferenceError under Node, and this function has
     to be runnable there or it cannot be tested at all. */
  var here = origin || _swOrigin() || 'https://lhc-prep-tool.vercel.app';
  var u;
  try { u = new URL(rawUrl, here); }
  catch (e) { return null; }

  /* Every navigation is the one shell, whatever the query string. A deep link
     (?order=..., ?view=..., a share-target arrival) must open the SAME cached
     document, or every link but the bare root would miss. */
  if (isNavigate) return 'shell';

  var sameOrigin = (u.origin === here);

  if (sameOrigin) {
    if (u.pathname === '/' || u.pathname === '/index.html') return 'shell';
    /* The API routes are all POST authoring calls; the two GETs among them
       (bible-passage) are live lookups that must never be answered stale. */
    if (u.pathname.indexOf('/api/') === 0) return null;
    if (u.pathname === '/sw.js') return null;
    if (/\.(?:png|svg|ico|webmanifest|json)$/.test(u.pathname)) return 'asset';
    return null;
  }

  if (u.host === SUPA_HOST) {
    if (u.pathname.indexOf('/rest/v1/') === 0) return 'data';
    /* Matched on the PREFIX, never the bucket name: the bucket is
       "Liturgy Files" and appears both encoded and plain across the app. */
    if (u.pathname.indexOf('/storage/v1/object/public/') === 0) return 'media';
    return null;   /* auth, realtime, signed URLs */
  }

  for (var i = 0; i < ASSET_HOSTS.length; i++) {
    if (u.host === ASSET_HOSTS[i]) return 'asset';
  }
  return null;
}

var CACHE_OF = { shell: SHELL, asset: ASSETS, data: DATA, media: MEDIA };

/* The shell is stored under "/" whatever query string it was asked for. */
function _keyFor(kind, request) {
  return kind === 'shell' ? new Request(self.location.origin + '/') : request;
}

/* ------------------------------------------------------------------ *
 * Strategies
 * ------------------------------------------------------------------ */

/* Is this answer the kind of thing it claims to be?
 *
 * THE CASE THIS EXISTS FOR is the one the church actually has: a hotspot or a
 * guest network whose sign-in page intercepts everything. It answers a REST
 * read with 200 and an HTML login form. Cached, that becomes "the order" for
 * as long as the cache lives -- a worse failure than no cache at all, and one
 * that would survive the network coming back. So a data response has to smell
 * like JSON and a shell response like HTML before it is kept or served.
 */
function _looksRight(kind, res) {
  if (!res) return false;
  /* An opaque cross-origin response has no readable headers; it is only used
     for assets, which are replayable whatever they are. */
  if (res.type === 'opaque') return kind === 'asset' || kind === 'media';
  var ct = (res.headers && res.headers.get('content-type')) || '';
  if (kind === 'data')  return ct.indexOf('json') !== -1;
  if (kind === 'shell') return ct.indexOf('html') !== -1;
  return true;
}

function _networkFirst(kind, request, timeoutMs) {
  var key = _keyFor(kind, request);
  var cache = CACHE_OF[kind];
  return new Promise(function (resolve) {
    var settled = false;
    function fallBack(res) {
      if (settled) return;
      settled = true;
      caches.open(cache).then(function (c) {
        return c.match(key, { ignoreVary: true });
      }).then(function (hit) {
        /* With nothing cached, hand back whatever the network said -- a real
           500 or a portal page is more use to the caller than Response.error,
           which the app reports as "Supabase not ready". */
        resolve(hit || res || Response.error());
      }).catch(function () { resolve(res || Response.error()); });
    }
    var timer = timeoutMs ? setTimeout(function () { fallBack(null); }, timeoutMs) : 0;
    fetch(request).then(function (res) {
      if (timer) clearTimeout(timer);
      /* Only a clean, complete answer of the right KIND is worth keeping. A
         redirect or an error page cached as the shell would be the stale-app
         failure in another coat. */
      var good = !!(res && res.ok && res.type !== 'opaqueredirect' && _looksRight(kind, res));
      if (good) {
        var copy = res.clone();
        caches.open(cache).then(function (c) { c.put(key, copy); }).catch(function () {});
      }
      if (settled) return;        /* the timeout already served the cache */
      /* A 5xx, or a portal's login page, is a failure dressed as an answer.
         Prefer what we have over handing the app something it will parse as
         an order and find empty. */
      if (!good) { fallBack(res); return; }
      settled = true;
      resolve(res);
    }).catch(function () { fallBack(null); });
  });
}

function _cacheFirst(kind, request) {
  var cache = CACHE_OF[kind];
  return caches.open(cache).then(function (c) {
    return c.match(request, { ignoreVary: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        /* An opaque response (a cross-origin asset fetched no-cors) is still
           replayable for a <script> or <link>, so it is worth keeping. */
        if (res && (res.ok || res.type === 'opaque')) {
          c.put(request, res.clone()).catch(function () {});
        }
        return res;
      });
    });
  });
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

self.addEventListener('install', function (e) {
  e.waitUntil(
    Promise.all([
      caches.open(SHELL).then(function (c) {
        /* addAll is all-or-nothing; one unreachable icon must not stop the
           shell being cached, so each is put on its own. */
        return Promise.all(PRECACHE_SHELL.map(function (u) { return _warm(c, u); }));
      }),
      caches.open(ASSETS).then(function (c) {
        return Promise.all(PRECACHE_ASSETS.concat(PRECACHE_ICONS)
          .map(function (u) { return _warm(c, u); }));
      })
    ]).then(function () { return self.skipWaiting(); })
  );
});

function _warm(cache, url) {
  return fetch(url, { credentials: 'omit' })
    .catch(function () { return fetch(new Request(url, { mode: 'no-cors' })); })
    .then(function (res) {
      if (!res || (!res.ok && res.type !== 'opaque')) return false;
      return cache.put(url, res).then(function () { return true; });
    })
    .catch(function () { return false; });
}

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        /* Only ever delete caches this worker owns. The app keeps its own
           IndexedDB for slide backgrounds; nothing else here is ours. */
        if (n.indexOf('lhc-offline-') === 0 && MINE.indexOf(n) === -1) return caches.delete(n);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  var kind = _swRoute(req.url, req.method, req.mode === 'navigate');
  if (!kind) return;                       /* untouched: the browser's own */

  if (kind === 'shell') { e.respondWith(_networkFirst('shell', req, 3000)); return; }
  if (kind === 'data')  { e.respondWith(_networkFirst('data',  req, 6000)); return; }
  e.respondWith(_cacheFirst(kind, req));   /* asset, media */
});

/* ------------------------------------------------------------------ *
 * "Download for Sunday"
 *
 * The page sends the list of URLs a service needs; the worker fetches each and
 * files it in the cache _swRoute would read it from, so the download and the
 * live request can never disagree about where something lives. Progress goes
 * back over the message port so the page can show it.
 * ------------------------------------------------------------------ */
self.addEventListener('message', function (e) {
  var d = e.data || {};
  var port = e.ports && e.ports[0];

  if (d.type === 'lhc-sw-info') {
    if (port) port.postMessage({ build: BUILD, caches: MINE });
    return;
  }

  if (d.type === 'lhc-precache' && Array.isArray(d.urls)) {
    var urls = d.urls.filter(Boolean);
    var done = 0, kept = 0, bytes = 0, failed = [];
    var run = urls.map(function (u) {
      var kind = _swRoute(u, 'GET', false);
      if (!kind) { done++; return Promise.resolve(); }
      return caches.open(CACHE_OF[kind]).then(function (c) {
        return _warm(c, u).then(function (ok) {
          done++;
          if (!ok) { failed.push(u); }
          else {
            kept++;
            return c.match(u, { ignoreVary: true }).then(function (hit) {
              if (!hit) return;
              /* Opaque responses report 0; the total is a floor, not a lie. */
              return hit.clone().arrayBuffer().then(function (b) { bytes += b.byteLength; })
                .catch(function () {});
            });
          }
        });
      }).catch(function () { done++; failed.push(u); })
        .then(function () {
          if (port) port.postMessage({ progress: done, total: urls.length });
        });
    });
    e.waitUntil(Promise.all(run).then(function () {
      if (port) port.postMessage({ done: true, kept: kept, bytes: bytes, failed: failed });
    }));
    return;
  }

  if (d.type === 'lhc-clear-offline') {
    e.waitUntil(Promise.all([DATA, MEDIA].map(function (n) { return caches.delete(n); }))
      .then(function () { if (port) port.postMessage({ cleared: true }); }));
  }
});

/* No Node shim here on purpose. tools/offline-service-worker-harness.js
   lifts _swRoute out of this file's TEXT and runs it, the way every other
   harness in tools/ slices a function out of Index.html — so this file stays
   a service worker and nothing else. */
