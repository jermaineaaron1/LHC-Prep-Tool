'use strict';
// Regression harness for scanning a song that runs over several pages.
//
// WHY THIS EXISTS
// A hymn covers two or three pages more often than not. Photographing them
// one at a time put three separate songs in the library, each holding a third
// of the words, and the person doing it had no way to tell the app they
// belonged together. The pages are now collected first and read as one
// document, so a verse split by a page break comes back as one verse.
//
// WHAT THIS CHECKS, and why each one is here rather than being obvious
//
//   page ORDER survives the upload
//       The four pages upload in parallel, because four sequential round
//       trips to storage on church wifi is most of a minute. Parallel work
//       finishes in whatever order it finishes, so the URLs are written to a
//       fixed index rather than pushed. Push would hand the model page 3,
//       page 1, page 4, page 2 -- and the model would do as it was told and
//       stitch them in that order. The result reads almost right, which is
//       the worst kind of wrong: verse 3 before verse 1 is noticeable, but
//       two chorus repeats swapped is not, and nobody would suspect the
//       upload. This is the single reason this harness exists.
//
//   the page CAP is enforced on the way in
//       Picking twelve photos at once must take four and say so, not send
//       twelve and time out after sixty seconds having lost the lot.
//
//   pages and thumbnails stay in step
//       Removing page 2 must remove thumbnail 2. Off by one here shows the
//       wrong picture against the page number, and the person reorders
//       perfectly good pages to fix a display bug.
//
//   document mode asks for a document
//       The sheet-music route exists so the pages are KEPT, not transcribed.
//       If mode stops reaching the request it silently becomes an ordinary
//       scan: lyrics appear, the musician proofreads a transcription of a
//       sheet they are holding, and the feature is gone without an error.
//
// USAGE
//   node tools/multipage-scan-harness.js                 # ../Index.html
//   node tools/multipage-scan-harness.js path/to/file.html
//   node tools/multipage-scan-harness.js <file> --expect-broken
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
const lines = raw.split('\n').map(l => l.replace(/\r$/, ''));

// The scan machinery is a block of module-scope vars and functions that only
// work together, so it is lifted whole rather than one function at a time.
function sliceBlock(startRe, endLine) {
  const a = lines.findIndex(l => startRe.test(l));
  if (a < 0) return null;
  for (let i = a; i < lines.length; i++) {
    if (lines[i] === endLine && i > a) return lines.slice(a, i + 1).join('\n');
  }
  return null;
}

const block = sliceBlock(/^var AS_MAX_PAGES = /, '};');
const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  scan page block  ' + (block ? block.split('\n').length + ' lines' : 'ABSENT') + '\n');

if (!block) {
  if (EXPECT_BROKEN) {
    console.log('Absent, as expected for pre-feature source.');
    process.exit(0);
  }
  console.error('The multi-page scan block is missing.');
  process.exit(1);
}

// The whole block, up to and including asRunScan.
const upToRun = raw.slice(raw.indexOf('var AS_MAX_PAGES'));
const runEnd = upToRun.indexOf('\r\n};', upToRun.indexOf('window.asRunScan'));
const source = upToRun.slice(0, runEnd + 4).replace(/\r/g, '');

// ---- the environment the block expects ----------------------------------
function makeEnv(opts) {
  opts = opts || {};
  const posted = [];
  const toasts = [];
  const opened = [];
  const clicked = [];

  const el = () => ({
    textContent: '', innerHTML: '', disabled: false, value: '',
    classList: { toggle() {}, add() {}, remove() {} },
    click() { clicked.push(this._id); },
  });
  const nodes = {};
  const doc = {
    getElementById(id) {
      if (!nodes[id]) { nodes[id] = el(); nodes[id]._id = id; }
      return nodes[id];
    },
  };

  const win = {
    URL: {
      createObjectURL: f => 'blob:' + f.name,
      revokeObjectURL() {},
    },
  };

  const env = {
    document: doc,
    URL: win.URL,
    window: win,
    showToast: (m, t) => toasts.push({ m, t }),
    showLoader() {},
    openAddSongForm: d => opened.push(d),
    closeAddSongChooser() {},
    // Resolves in the order opts.settle says, so "parallel uploads finish out
    // of order" is a thing this harness can actually produce.
    uploadToSupabase: (file) => {
      const i = Number(String(file.name).replace(/\D/g, '')) - 1;
      const delay = opts.settle ? opts.settle[i] : 0;
      return new Promise(res => setTimeout(() => res({ url: 'https://store/p' + (i + 1) + '.jpg' }), delay));
    },
    fetch: (url, init) => {
      posted.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(opts.reply || { title: 'A Song', lyrics: 'x' }),
      });
    },
    Promise, setTimeout, Array, Number, String, JSON, Math, Object,
  };

  const names = Object.keys(env);
  const fn = new Function(...names, source + '\nreturn { nodes: arguments };');
  fn(...names.map(n => env[n]));
  return { win, posted, toasts, opened, clicked, nodes };
}

const file = n => ({ name: 'page' + n + '.jpg' });

// ---- page order ----------------------------------------------------------
console.log('page order survives parallel uploads');
{
  // Page 1 is the SLOWEST to upload, so anything that collects URLs as they
  // arrive puts it last. This is the exact shape of the bug being guarded.
  const e = makeEnv({ settle: [40, 10, 0, 20] });
  e.win.addSongScan('file', 'chords');
  e.win.asHandleScanFile({ files: [file(1), file(2), file(3), file(4)] });
  e.win.asRunScan();
  return (async () => {
    await new Promise(r => setTimeout(r, 120));
    const body = e.posted[0] && e.posted[0].body;
    check('four pages were sent', body && body.urls.length, 4);
    check('in the order they were taken, not the order they uploaded',
      body && body.urls,
      ['https://store/p1.jpg', 'https://store/p2.jpg', 'https://store/p3.jpg', 'https://store/p4.jpg']);
    check('as `urls`, not a single `url`', body && body.url === undefined, true);
    await rest();
  })();
}

async function rest() {
  // ---- the cap -----------------------------------------------------------
  console.log('\nthe page cap holds at the door');
  {
    const e = makeEnv({});
    e.win.addSongScan('file', 'chords');
    e.win.asHandleScanFile({ files: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(file) });
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 60));
    const body = e.posted[0] && e.posted[0].body;
    check('twelve pages picked at once become four', body && body.urls.length, 4);
    check('  and it says so rather than dropping them in silence',
      e.toasts.some(t => /only the first 4/i.test(t.m)), true);
    check('  keeping the first four, not the last',
      body && body.urls[0], 'https://store/p1.jpg');
  }

  // ---- adding one at a time ---------------------------------------------
  console.log('\npages add up across separate shots');
  {
    const e = makeEnv({});
    e.win.addSongScan('camera', 'chords');
    e.win.asHandleScanFile({ files: [file(1)] });
    e.win.asHandleScanFile({ files: [file(2)] });
    e.win.asHandleScanFile({ files: [file(3)] });
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 60));
    check('three separate shots make three pages',
      e.posted[0] && e.posted[0].body.urls.length, 3);
  }

  console.log('\nbacking out of the camera does not lose what is already taken');
  {
    const e = makeEnv({});
    e.win.addSongScan('camera', 'chords');
    e.win.asHandleScanFile({ files: [file(1)] });
    e.win.asHandleScanFile({ files: [] });      // cancelled the second shot
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 60));
    check('page 1 is still there', e.posted[0] && e.posted[0].body.urls.length, 1);
  }

  // ---- removing a page ---------------------------------------------------
  console.log('\nremoving a page removes its thumbnail, not a neighbour');
  {
    const e = makeEnv({});
    e.win.addSongScan('file', 'chords');
    e.win.asHandleScanFile({ files: [file(1), file(2), file(3)] });
    e.win.asRemovePage(1);                       // drop page 2
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 60));
    const body = e.posted[0] && e.posted[0].body;
    check('two pages remain', body && body.urls.length, 2);
    check('  and they are pages 1 and 3', body && body.urls,
      ['https://store/p1.jpg', 'https://store/p3.jpg']);
  }

  // ---- mode --------------------------------------------------------------
  console.log('\nthe sheet-music route asks for a document, not a transcription');
  {
    const e = makeEnv({});
    e.win.addSongScan('camera', 'document');
    e.win.asHandleScanFile({ files: [file(1), file(2)] });
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 60));
    check('mode travels with the request', e.posted[0] && e.posted[0].body.mode, 'document');
  }
  {
    const e = makeEnv({});
    e.win.addSongScan('camera', 'chords');
    e.win.asHandleScanFile({ files: [file(1)] });
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 60));
    check('the chord scan still says chords', e.posted[0] && e.posted[0].body.mode, 'chords');
  }
  {
    const e = makeEnv({});
    e.win.addSongScan('file', 'chords');
    e.win.asHandleScanFile({ files: [file(1)] });
    e.win.asToggleScanMode();
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 60));
    check('switching in the tray changes what is asked for',
      e.posted[0] && e.posted[0].body.mode, 'document');
  }

  // ---- what comes back ---------------------------------------------------
  console.log('\nthe pages reach the form');
  {
    const e = makeEnv({});
    e.win.addSongScan('camera', 'document');
    e.win.asHandleScanFile({ files: [file(1), file(2)] });
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 60));
    const d = e.opened[0];
    check('every page url is handed on', d && d.__scanUrls.length, 2);
    check('  with the mode it was read in', d && d.__scanMode, 'document');
  }

  // ---- source-level wiring ----------------------------------------------
  //
  // The block above runs in isolation. These check it is actually reachable
  // and that the pieces it hands off to have kept their side of the bargain.
  console.log('\nand it is wired into the page');
  check('the chooser offers the sheet-music route',
    /addSongScan\(&#39;camera&#39;,&#39;document&#39;\)/.test(raw), true);
  check('the chord route still exists',
    /addSongScan\(&#39;camera&#39;,&#39;chords&#39;\)/.test(raw), true);
  check('the picker takes several files at once',
    /id="asScanFile"[^>]*\bmultiple\b/.test(raw), true);
  check('the tray is in the document',
    /id="asPageTray"/.test(raw), true);

  // Document mode leaves chordsFound and chordsSuggested both false, which is
  // indistinguishable from a chord scan that found nothing. The banner has to
  // tell them apart, or it announces "no chord symbols were printed" about a
  // page nobody intended to transcribe -- which reads as a failure and sends
  // somebody back to rephotograph a sheet that scanned perfectly.
  console.log('\ndocument mode is not reported as a chord scan that failed');
  check('the banner knows which mode it is in', /var _docMode = d\.__scanMode === 'document';/.test(raw), true);
  check('  and says the pages were kept', /<b>Kept as sheet music\.<\/b>/.test(raw), true);
  check('  with the no-chords warning behind that branch',
    /if \(_docMode\) \{[\s\S]{0,220}\} else if \(d\.chordsSuggested\) \{/.test(raw), true);
  check('  while a real chord scan still gets warned',
    /\} else if \(!d\.chordsFound\) \{\s*[\r\n]+\s*bits\.push\('<span class="asm-scan-warn">No chord symbols/.test(raw), true);

  console.log('\nthe attachment names say which page is which');
  check('numbered only when there is more than one',
    /_scanUrls\.length > 1 \? ', p' \+ \(i \+ 1\) : ''/.test(raw), true);
  check('document mode names them sheet music',
    /_isDoc \? 'sheet music' : 'scanned sheet'/.test(raw), true);
  check('every page is attached, not just the first',
    /_scanUrls\.forEach\(function\(u, i\) \{/.test(raw), true);

  // ---- the route ---------------------------------------------------------
  //
  // Source-level, because the route is a Next handler that needs a running
  // server and a model key to execute. These are the properties a refactor
  // could lose without any test noticing.
  console.log('\nthe route reads pages, and refuses the ones it should');
  const ROUTE = path.join(__dirname, '..', 'app', 'api', 'parse-song-sheet', 'route.ts');
  if (!fs.existsSync(ROUTE)) {
    check('route.ts found', false, true);
  } else {
    const rt = fs.readFileSync(ROUTE, 'utf8');

    check('it accepts a page list', /const \{ url, urls, vocab, mode \} = await req\.json\(\)/.test(rt), true);
    check('  and still accepts the single url it always did',
      /\(typeof url === 'string' && url \? \[url\] : \[\]\)/.test(rt), true);
    check('a page cap exists', /const MAX_PAGES = \d+;/.test(rt), true);
    check('  and is enforced', /pageUrls\.length > MAX_PAGES/.test(rt), true);
    check('a total size cap exists', /totalBytes > MAX_TOTAL_BYTES/.test(rt), true);

    // The storage check is what stops this endpoint fetching anything
    // reachable from the deployment and reading it back. With several pages
    // it has to run over EVERY one, and before any of them is fetched --
    // validating only page 1 would let page 2 be an internal address.
    const loop = rt.slice(rt.indexOf('for (const p of pageUrls)'), rt.indexOf('let pageFiles'));
    check('every page is checked against our own storage',
      /for \(const p of pageUrls\)/.test(rt) && /isOwnStorage\(p\)/.test(loop), true);
    check('  and the file type of every page', /MIME_TYPES\[extFromUrl\(p\)\]/.test(loop), true);
    check('  before a single one is fetched',
      rt.indexOf('for (const p of pageUrls)') < rt.indexOf('await fetch(p'), true);

    check('one image part per page, in order',
      /\.\.\.pageFiles\.map\(f => \(\{\s*inlineData: \{ mimeType: f\.mime, data: f\.buf\.toString\('base64'\) \},\s*\}\)\),/.test(rt), true);
    check('the pages come before the instructions',
      rt.indexOf('...pageFiles.map') < rt.indexOf('{ text: promptText }'), true);

    check('document mode is a separate prompt', /const documentPrompt = \[/.test(rt), true);
    check('  chosen by the mode', /readMode === 'document' \? documentPrompt : chordPrompt/.test(rt), true);
    check('  and it forbids transcribing', /Leave `lyrics` null\./.test(rt), true);
    check('several pages are declared as one song',
      /pages 1 to \$\{n\} of ONE song/.test(rt), true);
    check('  with verse numbering running on', /never restart at 1/.test(rt), true);
  }

  console.log('\n' + '='.repeat(60));
  const pass = results.filter(Boolean).length;
  console.log(pass + '/' + results.length + ' checks passed');
  if (EXPECT_BROKEN) {
    if (pass === results.length) {
      console.log('\nBUT --expect-broken was given and everything passed.');
      process.exit(1);
    }
    console.log('\nFailures above are expected for pre-feature source.');
    process.exit(0);
  }
  if (pass === results.length) console.log('Three photographs make one song, in the right order.');
  process.exit(pass === results.length ? 0 : 1);
}
