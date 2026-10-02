'use strict';
// Regression harness for drawing the service card on the device.
//
// WHY THIS EXISTS
// The card used to be drawn by a metered conversion service. On 2026-10-02
// the allowance ran out and BOTH share buttons stopped working, with no way
// to get a card out until it reset. It is now drawn in the browser, which
// costs nothing and cannot run out.
//
// WHAT IS EASY TO GET WRONG
// The capture only works on an element that is genuinely on screen -- drawn
// off-screen, or at opacity 0.01, it comes back as a single flat colour
// (measured: 1860x2922 pixels of exactly one shade). So a preview overlay is
// put up over the whole app while the picture is taken.
//
// That overlay is the hazard this harness exists for. If it is ever left
// behind -- in particular when the capture THROWS -- the operator is locked
// out of the app behind a full-screen panel, mid-service, with no way back.
// Every path through the function has to take it down again, so every path
// is tried here.
//
// USAGE
//   node tools/local-card-render-harness.js                 # ../Index.html
//   node tools/local-card-render-harness.js path/to/file.html
//   node tools/local-card-render-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 1589c28:Index.html > x`).
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

function extractMethod(name, optional) {
  const startIdx = lines.findIndex(l => new RegExp('^    ' + name + ':\\s*function\\s*\\(').test(l));
  if (startIdx < 0) {
    if (optional) return null;
    throw new Error('method not found: ' + name);
  }
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n').replace(/,\s*$/, ''), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

const fn = extractMethod('_renderCardToBlob', true);
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _renderCardToBlob @ ' + (fn ? 'line ' + fn.line : 'ABSENT') + '\n');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// A browser just real enough to run the function and watch the overlay.
function makeEnv(capture) {
  const attached = [];
  function El(tag) {
    this.tagName = tag;
    this.style = { cssText: '', transform: '', width: '', height: '', transformOrigin: '' };
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.children = [];
    this.offsetHeight = 2277;
  }
  El.prototype.appendChild = function (c) { this.children.push(c); return c; };
  El.prototype.remove = function () {
    const i = attached.indexOf(this);
    if (i >= 0) attached.splice(i, 1);
  };
  El.prototype.querySelector = function () {
    if (!this._frame) { this._frame = new El('div'); this._frame.className = 'rmp-share-frame'; }
    return this._frame;
  };

  const captureCalls = [];
  const env = {
    document: {
      createElement: tag => new El(tag),
      body: { appendChild: el => { attached.push(el); return el; } }
    },
    window: {
      innerWidth: 420,
      htmlToImage: {
        toBlob: (target, opts) => {
          captureCalls.push({ targetClass: target && target.className, opts: opts });
          return capture();
        }
      }
    },
    _loadScript: src => { env._scriptRequested = src; return Promise.resolve(); },
    Promise: Promise, Math: Math, setTimeout: setTimeout, Error: Error
  };
  env._attached = attached;
  env._captureCalls = captureCalls;
  return env;
}

function build(capture) {
  const env = makeEnv(capture);
  const keys = Object.keys(env).filter(k => ['_attached', '_captureCalls', '_scriptRequested'].indexOf(k) === -1);
  const api = new Function(...keys, 'return {' + fn.text + '};')(...keys.map(k => env[k]));
  api._rmpCardShareCSS = () => '.rmp-share-frame{width:1080px}';
  api.escapeHtml = s => String(s);
  return { api, env };
}

async function settle(p) {
  try { return { value: await p, rejected: false }; }
  catch (e) { return { rejected: true, reason: e }; }
}

const fakeCard = { outerHTML: '<div class="rmp-service-ledger">card</div>' };

(async () => {
  console.log('the preview goes up and comes down again');
  if (!fn) {
    if (EXPECT_BROKEN) check('(pre-change) the card was not drawn on the device', true, true);
    else check('_renderCardToBlob exists', false, true);
  } else {
    {
      const blob = { size: 412000, type: 'image/png' };
      const { api, env } = build(() => Promise.resolve(blob));
      const out = await settle(api._renderCardToBlob(fakeCard, 'Generated now'));
      check('the blob comes back', out.value, blob);
      check('nothing is left on screen afterwards', env._attached.length, 0);
      check('the library is fetched lazily', /html-to-image/.test(env._scriptRequested || ''), true);
      check('the capture is pointed at the share frame', env._captureCalls[0].targetClass, 'rmp-share-frame');
      // 1.5 puts it at roughly 1620px across: wider than WhatsApp keeps after
      // its own compression, at about half the bytes of 2, which matters on a
      // phone sharing over mobile data.
      check('it is captured at one and a half times the size', env._captureCalls[0].opts.pixelRatio, 1.5);
      // The library otherwise inlines every stylesheet, fails on the
      // cross-origin ones and logs a SecurityError per attempt. Pointless
      // here: it rasterises in the browser that already has the fonts.
      // Measured 5396ms -> 1324ms, byte-identical.
      check('fonts are not inlined, the page already has them',
        env._captureCalls[0].opts.skipFonts, true);
    }

    // The capture rejects -- the overlay must still come down.
    {
      const { api, env } = build(() => Promise.reject(new Error('canvas tainted')));
      const out = await settle(api._renderCardToBlob(fakeCard, 'Generated now'));
      check('a failed capture rejects', out.rejected, true);
      check('the operator is not left behind an overlay', env._attached.length, 0);
      check('the reason survives', /tainted/.test(String(out.reason && out.reason.message)), true);
    }

    // The capture throws synchronously.
    {
      const { api, env } = build(() => { throw new Error('boom'); });
      const out = await settle(api._renderCardToBlob(fakeCard, 'Generated now'));
      check('a synchronous throw also rejects', out.rejected, true);
      check('and still takes the overlay down', env._attached.length, 0);
    }

    // An empty blob is a failure, not a picture.
    {
      const { api, env } = build(() => Promise.resolve(null));
      const out = await settle(api._renderCardToBlob(fakeCard, 'Generated now'));
      check('an empty picture is treated as a failure', out.rejected, true);
      check('the overlay comes down for that too', env._attached.length, 0);
    }

    // The library failing to load must not strand an overlay either.
    {
      const env = makeEnv(() => Promise.resolve({ size: 1 }));
      env._loadScript = () => Promise.reject(new Error('offline'));
      const keys = Object.keys(env).filter(k => ['_attached', '_captureCalls', '_scriptRequested'].indexOf(k) === -1);
      const api = new Function(...keys, 'return {' + fn.text + '};')(...keys.map(k => env[k]));
      api._rmpCardShareCSS = () => '';
      api.escapeHtml = s => String(s);
      const out = await settle(api._renderCardToBlob(fakeCard, 'now'));
      check('a library that will not load rejects', out.rejected, true);
      check('and puts no overlay up at all', env._attached.length, 0);
    }
  }

  console.log('\nthe card no longer goes to the server');
  {
    const cardCallsLocal = /_renderCardToBlob\(cardClone, stamp\)/.test(raw);
    const cardFetchesPng = /format: 'png'/.test(raw);
    const rosterStillFetches = /JSON\.stringify\(\{ html: fullHtml \}\)/.test(raw);
    if (EXPECT_BROKEN) {
      check('(pre-change) the card posted a PNG to the server', cardFetchesPng, true);
      check('(pre-change) nothing rendered on the device', cardCallsLocal, false);
    } else {
      check('the card renders on the device', cardCallsLocal, true);
      check('no PNG is posted anywhere', cardFetchesPng, false);
      check('the roster PDF is untouched and still server-drawn', rosterStillFetches, true);
    }
  }

  // A second tap during the few seconds a picture takes used to raise a
  // second preview on top of the first. Both came down, so nothing was
  // stranded, but two stacked full-screen panels is not what was asked for.
  console.log('\nonly one picture is taken at a time');
  {
    const guards = /if \(this\._cardShotInFlight\) return Promise\.resolve\(\);/.test(raw);
    const raises = /this\._cardShotInFlight = true;/.test(raw);
    // Cleared on BOTH paths, or one failure locks the button for good.
    const clears = (raw.match(/self\._cardShotInFlight = false;/g) || []).length;
    if (EXPECT_BROKEN) {
      check('(pre-change) a second tap started a second picture', guards, false);
    } else {
      check('a second tap while one is in flight is ignored', guards, true);
      check('the flag goes up when a picture starts', raises, true);
      check('and comes down on success AND on failure', clears, 2);
    }
  }

  // The app's own stylesheet reaches the clone now that the picture is drawn
  // on the page. The server's self-contained stylesheet never defined these,
  // so they never used to show, and they must not start.
  console.log('\nplanning marks stay out of the picture');
  {
    const finds = /querySelectorAll\('\.rmp-clash, \.rmp-double-ok'\)/.test(raw);
    const removes = /classList\.remove\('rmp-clash', 'rmp-double-ok'\)/.test(raw);
    if (EXPECT_BROKEN) {
      check('(pre-change) nothing needed stripping', finds, false);
    } else {
      check('clash and double-duty marks are found', finds, true);
      check('and taken off before the picture is taken', removes, true);
    }
  }

  console.log('\nthe badge fits at the smaller size');
  {
    const nowrap = /\.rmp-service-status \{ flex:0 0 auto; white-space:nowrap;/.test(raw);
    if (EXPECT_BROKEN) check('(pre-change) the badge could wrap', nowrap, false);
    else check('"2 open" cannot break across two lines', nowrap, true);
  }

  console.log('\n================================');
  const passed = results.filter(Boolean).length;
  console.log(passed + '/' + results.length + ' checks passed');
  if (passed !== results.length) process.exit(1);
})();
