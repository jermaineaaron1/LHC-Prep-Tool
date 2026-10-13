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
  const uploaded = [];
  const deleted = [];

  const el = () => ({
    textContent: '', innerHTML: '', disabled: false, value: '',
    // Real elements always have a style object; a stub without one turns
    // `el.style.display = ...` into a TypeError that looks like a product bug.
    style: {},
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
      uploaded.push(i + 1);
      if (opts.failUpload === i) {
        return new Promise((_, rej) => setTimeout(() => rej(new Error('upload failed')), delay));
      }
      return new Promise(res => setTimeout(
        () => res({ url: 'https://store/p' + (i + 1) + '.jpg', path: 'song-scans/p' + (i + 1) + '.jpg' }), delay));
    },
    deleteFromSupabase: p => deleted.push(p),
    Image: function () { this.src = ''; },
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
  return { win, posted, toasts, opened, clicked, nodes, uploaded, deleted };
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

  // ---- one scan per press ------------------------------------------------
  //
  // The tray hides on the first tap, but a double tap on a slow phone lands
  // both before it does. That buys two uploads of every page and two reads of
  // the same song -- money, and two sets of files in a production bucket.
  console.log('\na double tap does not buy two scans');
  {
    const e = makeEnv({ settle: [30, 30] });
    e.win.addSongScan('file', 'chords');
    e.win.asHandleScanFile({ files: [file(1), file(2)] });
    e.win.asRunScan();
    e.win.asRunScan();            // the second tap
    e.win.asRunScan();            // and a third, for good measure
    await new Promise(r => setTimeout(r, 120));
    check('each page uploaded once', e.uploaded.sort().join(','), '1,2');
    check('  and the sheet was read once', e.posted.length, 1);
  }
  {
    // ...but the guard must be released, or the next scan never runs.
    const e = makeEnv({});
    e.win.addSongScan('file', 'chords');
    e.win.asHandleScanFile({ files: [file(1)] });
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 60));
    e.win.addSongScan('file', 'chords');
    e.win.asHandleScanFile({ files: [file(2)] });
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 60));
    check('a second scan afterwards still works', e.posted.length, 2);
  }

  // ---- a failed scan takes its uploads with it ---------------------------
  //
  // The form that opens after a failure is empty, so nothing will ever
  // reference the pages that did upload. Left alone they are litter in a
  // production bucket, four pieces of it per failed four-page scan.
  console.log('\na failed scan does not leave its pages behind');
  {
    const e = makeEnv({ failUpload: 1, settle: [0, 10, 0] });
    e.win.addSongScan('file', 'chords');
    e.win.asHandleScanFile({ files: [file(1), file(2), file(3)] });
    e.win.asRunScan();
    await new Promise(r => setTimeout(r, 120));
    check('the pages that did upload are deleted',
      e.deleted.sort(), ['song-scans/p1.jpg', 'song-scans/p3.jpg']);
    check('  nothing was sent to the model', e.posted.length, 0);
    check('  and the form still opens so the song can be typed in',
      e.opened.length, 1);
    check('  with the guard released for another try', (() => {
      e.win.addSongScan('file', 'chords');
      e.win.asHandleScanFile({ files: [file(1)] });
      e.win.asRunScan();
      return true;
    })(), true);
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

  // The size limit was always there; four pages is what made it reachable.
  // A twelve megapixel photograph is ~4MB, four of them 16MB, and base64
  // adds a third on the way to the model against a 20MB request ceiling. The
  // first version of multi-page raised the cap to 20MB, which put 26.7MB on
  // the wire -- it passed every test here, because the test images are 80KB,
  // and would have failed on the first real four-page scan.
  console.log('\npages are shrunk before they are sent, and the cap sits under the ceiling');
  check('a long-edge limit exists', /var AS_MAX_EDGE = \d+;/.test(raw), true);
  check('  and downscaling runs before the upload',
    /_asDownscale\(f\)\.then\(function\(small\) \{\s*[\r\n]+\s*return uploadToSupabase\(small, 'song-scans'\);/.test(raw), true);
  check('  PDFs and already-small files are left alone',
    /if \(!\/\^image\\\/\/\.test\(file\.type \|\| ''\) \|\| file\.size <= AS_SKIP_RESIZE_UNDER\)/.test(raw), true);
  check('  and a re-encode that grew the file is discarded',
    /if \(!blob \|\| blob\.size >= file\.size\) \{ resolve\(file\); return; \}/.test(raw), true);

  // The button throws a page away, so it follows the same rule as every other
  // destructive control in this file: a phone-sized target. 26px was below
  // the standard the codebase already set for itself.
  check('the tray remove button is finger-sized on a phone',
    /\.aspt-page-del \{\s*[\r\n]+\s*width: 40px; height: 40px;/.test(raw), true);

  // ---- and the names survive being displayed ----------------------------
  //
  // Naming the pages is only worth anything if the name reaches the eye. The
  // document picker truncated at 30 characters from the END, and these names
  // are built with the distinguishing part LAST, so the page number was
  // exactly what went. Every page of every sheet produced the same label:
  // a three-page hymn offered three identical rows to choose between, which
  // is precisely the state the naming was added to fix.
  console.log('\nthe page number survives being shown in a list');
  {
    const m = raw.match(/window\._docLabel = function[\s\S]*?\n\};/);
    if (!m) {
      check('_docLabel exists', false, true);
    } else {
      const docLabel = new Function('var window = {};' + m[0] + '\nreturn window._docLabel;')();
      // Long titles are the hard case; short ones were never at risk.
      ['He Leadeth Me', 'Holy, Holy, Holy', 'All Creatures of Our God and King'].forEach(t => {
        const shown = [1, 2, 3].map(p => docLabel(t + ' — sheet music, p' + p));
        check('three pages of "' + t.slice(0, 22) + '" are told apart',
          new Set(shown).size, 3);
        check('  and each still shows its page number',
          shown.every((s, i) => s.endsWith('p' + (i + 1))), true);
      });
      check('a short name is left exactly as it is', docLabel('chords.pdf'), 'chords.pdf');
      check('nothing blows up on a missing name', docLabel(null) + docLabel(undefined), '');
      check('it does respect the limit', docLabel('x'.repeat(80)).length <= 31, true);
    }

    // All four places that shorten a document label must use it. Three were
    // in the picker and one in the Add Song form's attachment list, and any
    // one left behind puts the identical-rows bug back in that view.
    // Scoped to the two functions that show DOCUMENT labels. A blanket ban on
    // the pattern was wrong: renderYoutubeLinks truncates a video title the
    // same way and should, because video titles differ at the START. The
    // first version of this check failed against correct source for exactly
    // that reason -- the same over-reach the blank-slide harness was caught
    // by when it banned `slides: item.slides || []` everywhere.
    const fnSrc = (name, opener) => {
      const a = raw.indexOf(opener);
      if (a < 0) return '';
      let depth = 0, started = false;
      for (let i = a; i < raw.length; i++) {
        if (raw[i] === '{') { depth++; started = true; }
        else if (raw[i] === '}') { depth--; if (started && depth === 0) return raw.slice(a, i + 1); }
      }
      return '';
    };
    const docViews = fnSrc('renderAttachments', 'function renderAttachments(mode) {') +
                     fnSrc('showLinkSelectorPopup', 'function showLinkSelectorPopup(event, urls, type, title) {');
    check('both document views were found', docViews.length > 400, true);
    check('  and neither truncates a label by hand',
      /substring\(0, 30\)/.test(docViews), false);
    check('  they go through the helper instead',
      (docViews.match(/window\._docLabel\(/g) || []).length >= 4, true);
  }

  console.log('\nthe attachment names say which page is which');
  check('numbered only when there is more than one',
    /_scanUrls\.length > 1 \? ', p' \+ \(i \+ 1\) : ''/.test(raw), true);
  check('document mode names them sheet music',
    /_isDoc \? 'sheet music' : 'scanned sheet'/.test(raw), true);
  check('every page is attached, not just the first',
    /_scanUrls\.forEach\(function\(u, i\) \{/.test(raw), true);

  // ---- pages onto a song that already exists -----------------------------
  //
  // The 65 hymns already in the library get their sheets through this path,
  // and until now it took one photograph at a time, at full size, named
  // IMG_20261012_0933.jpg. Same tray now -- so the same two mistakes are
  // available: losing page order across parallel uploads, and numbering that
  // restarts at p1 when somebody adds two more pages next week.
  console.log('\npages added to a song that already exists');
  {
    const fnSrc = (() => {
      const a = raw.indexOf('function _asAttachPagesToSong(');
      if (a < 0) return null;
      let depth = 0, started = false;
      for (let i = a; i < raw.length; i++) {
        if (raw[i] === '{') { depth++; started = true; }
        else if (raw[i] === '}') { depth--; if (started && depth === 0) return raw.slice(a, i + 1); }
      }
      return null;
    })();

    if (!fnSrc) {
      check('_asAttachPagesToSong exists', false, true);
    } else {
      const run = (song, pageCount, settle) => new Promise(resolve => {
        const batches = [];
        const deleted = [];
        const env = {
          showLoader() {}, showToast() {},
          _asDownscale: f => Promise.resolve(f),
          uploadToSupabase: (f) => {
            const i = Number(String(f.name).replace(/\D/g, '')) - 1;
            if (settle[i] < 0) return new Promise((_, rej) => setTimeout(() => rej(new Error('upload failed')), 5));
            return new Promise(r => setTimeout(
              () => r({ url: 'https://store/d' + (i + 1) + '.jpg', path: 'song-docs/d' + (i + 1) }), settle[i]));
          },
          parseFileUrl: u => ({ url: u }),
          deleteFromSupabase: p => deleted.push(p),
          // Collect every call rather than resolving on the first. Resolving
          // early counted one write even when the code made three, which is
          // precisely the mutation this is here to catch -- and it did not.
          _lpAttachDocs: (infos) => { batches.push(infos); },
          _asClearPages() {}, Promise, setTimeout, Array, Number, String, Math,
        };
        const names = Object.keys(env);
        const f = new Function(...names, 'var _asScanning = true;\n' + fnSrc + '\nreturn _asAttachPagesToSong;');
        const pages = Array.from({ length: pageCount }, (_, i) => ({ name: 'pg' + (i + 1) + '.jpg' }));
        f(...names.map(n => env[n]))(pages, song);
        // Long enough for every upload to settle and any extra writes to land.
        setTimeout(() => resolve({
          calls: batches.length,
          handed: batches.length ? batches[0] : [],
          allHanded: batches.reduce((a, b) => a.concat(b), []),
          deleted
        }), 140);
      });

      // Page 1 slowest again, so a push-based collector would reorder them.
      const fresh = await run({ title: 'Holy, Holy, Holy', attachments: [] }, 3, [50, 20, 0]);
      check('one write, not one per page', fresh.calls, 1);
      check('pages keep their order', fresh.handed.map(i => i.url),
        ['https://store/d1.jpg', 'https://store/d2.jpg', 'https://store/d3.jpg']);
      check('and are named for the song and the page', fresh.handed.map(i => i.name), [
        'Holy, Holy, Holy — sheet music, p1',
        'Holy, Holy, Holy — sheet music, p2',
        'Holy, Holy, Holy — sheet music, p3'
      ]);

      const single = await run({ title: 'He Leadeth Me', attachments: [] }, 1, [0]);
      check('a lone page is not called p1 of nothing', single.handed[0].name,
        'He Leadeth Me — sheet music');

      // Adding more later must carry on, not start again.
      const more = await run({
        title: 'Holy, Holy, Holy',
        attachments: [
          { name: 'Holy, Holy, Holy — sheet music, p1' },
          { name: 'Holy, Holy, Holy — sheet music, p2' }
        ]
      }, 2, [10, 0]);
      check('numbering carries on from the sheets already there',
        more.handed.map(i => i.name), [
          'Holy, Holy, Holy — sheet music, p3',
          'Holy, Holy, Holy — sheet music, p4'
        ]);

      // A song whose other documents are not sheets must not be counted.
      const mixed = await run({
        title: 'Blessed Be Your Name',
        attachments: [{ name: 'chords.pdf' }, { name: 'Google Drive File' }]
      }, 1, [0]);
      check('other kinds of document do not shift the numbering',
        mixed.handed[0].name, 'Blessed Be Your Name — sheet music');

      // A page that fails to upload must take the ones that did with it, or
      // the song gets two of its three pages and nobody notices which.
      const failed = await run({ title: 'Lead Kindly, Light', attachments: [] }, 3, [0, -1, 0]);
      check('an upload that fails attaches nothing at all', failed.calls, 0);
      check('  and deletes the pages that did go up',
        failed.deleted.sort(), ['song-docs/d1', 'song-docs/d3']);
    }
  }

  // ---- upload from device -----------------------------------------------
  //
  // The other half of the existing-song route, and the one that takes the
  // PDFs and scans somebody already has. It shares the single-write and
  // indexed-order properties with the camera path, and -- found by mutation
  // testing, twice -- it shares the exact SOURCE LINES too, which meant a
  // mutation aimed at the camera path silently landed here instead and
  // nothing noticed. Two identical paths need two sets of teeth.
  console.log('\nseveral documents uploaded from the device');
  {
    const fnSrc = (() => {
      const a = raw.indexOf('window.lpHandleDocFile = function(input) {');
      if (a < 0) return null;
      let depth = 0, started = false;
      for (let i = a; i < raw.length; i++) {
        if (raw[i] === '{') { depth++; started = true; }
        else if (raw[i] === '}') { depth--; if (started && depth === 0) return raw.slice(a, i + 1); }
      }
      return null;
    })();

    if (!fnSrc) {
      check('lpHandleDocFile exists', false, true);
    } else {
      const run = (files, settle) => new Promise(resolve => {
        const batches = [], deleted = [], toasts = [];
        const win = {};
        const env = {
          window: win,
          currentLyricsPreviewSong: { id: 's1', title: 'He Leadeth Me', attachments: [] },
          showToast: m => toasts.push(m),
          _asDownscale: f => Promise.resolve(f),
          uploadToSupabase: (f) => {
            const i = Number(String(f.name).replace(/\D/g, '')) - 1;
            if (settle[i] < 0) return new Promise((_, rej) => setTimeout(() => rej(new Error('nope')), 5));
            return new Promise(r => setTimeout(
              () => r({ url: 'https://store/' + f.name, path: 'song-docs/' + f.name }), settle[i]));
          },
          parseFileUrl: u => ({ url: u }),
          deleteFromSupabase: p => deleted.push(p),
          _lpAttachDocs: (infos) => { batches.push(infos); },
          Promise, setTimeout, Array, Number, String, Math,
        };
        const names = Object.keys(env);
        new Function(...names, fnSrc + '\nreturn window.lpHandleDocFile;')(...names.map(n => env[n]));
        win.lpHandleDocFile({ files, value: '' });
        setTimeout(() => resolve({
          calls: batches.length,
          handed: batches.length ? batches[0] : [],
          deleted, toasts
        }), 140);
      });

      const f = n => ({ name: 'doc' + n + '.pdf' });
      // Again with the first file slowest, so a push would reorder them.
      const three = await run([f(1), f(2), f(3)], [50, 20, 0]);
      check('three files, one write', three.calls, 1);
      check('  in the order they were picked', three.handed.map(i => i.url),
        ['https://store/doc1.pdf', 'https://store/doc2.pdf', 'https://store/doc3.pdf']);
      // Somebody named these deliberately; a guessed label would be worse.
      check('  keeping the names they already had', three.handed.map(i => i.name),
        ['doc1.pdf', 'doc2.pdf', 'doc3.pdf']);

      const broke = await run([f(1), f(2), f(3)], [0, -1, 0]);
      check('one failure attaches nothing', broke.calls, 0);
      check('  and removes what did upload', broke.deleted.sort(),
        ['song-docs/doc1.pdf', 'song-docs/doc3.pdf']);
    }
  }

  console.log('\nand the existing-song route is wired to all of it');
  check('Add Doc camera opens the tray', /else if \(act === 'camera'\) lpScanSheetPages\(\);/.test(raw), true);
  check('  which targets the song on screen', /_asTarget = 'song';\s*[\r\n]+\s*_asDocSong = song;/.test(raw), true);
  check('  and asRunScan sends it down the attach path',
    /if \(_asTarget === 'song'\) \{ _asAttachPagesToSong\(pages, _asDocSong\); return; \}/.test(raw), true);
  check('upload from device takes several files',
    /id="lpDocFileInput" multiple/.test(raw), true);
  check('  downscaled like everything else',
    /return _asDownscale\(f\)\.then\(function\(small\) \{\s*[\r\n]+\s*return uploadToSupabase\(small, 'song-docs'\);/.test(raw), true);
  check('a single doc still goes through the same write',
    /function _lpAttachDoc\(info\) \{\s*[\r\n]+\s*_lpAttachDocs\(\[info\]\);/.test(raw), true);

  // ---- a cancelled scan ---------------------------------------------------
  console.log('\na scan whose song was never saved does not keep its photographs');
  check('the form close discards it',
    /modalId === 'addSongModal' && typeof _asDiscardUnsavedScan === 'function'/.test(raw), true);
  check('  a saved song hands its pages over before the close',
    /_asDiscardPagesNotIn\(songData\.attachments\);\s*[\r\n]+\s*closeModal\('addSongModal'\);/.test(raw), true);

  // A page removed from the form before saving.
  //
  // removeAttachment only splices the in-memory list, so the file it had
  // already uploaded stayed in the bucket with nothing pointing at it -- and
  // on a three-page scan, removing the blurred one is the normal case.
  //
  // The decision is made against the attachments actually WRITTEN, never a
  // fresh read of the library: a read that had not caught up with the row
  // just inserted would delete the pages of the song just saved.
  {
    const src = (() => {
      const a = raw.indexOf('function _asDiscardPagesNotIn(kept) {');
      if (a < 0) return '';
      let d = 0, started = false;
      for (let i = a; i < raw.length; i++) {
        if (raw[i] === '{') { d++; started = true; }
        else if (raw[i] === '}') { d--; if (started && d === 0) return raw.slice(a, i + 1); }
      }
      return '';
    })();
    if (!src) {
      check('_asDiscardPagesNotIn exists', false, true);
    } else {
      const run = (pending, kept) => {
        const deleted = [];
        const win = { _asPendingScanPaths: pending.slice() };
        new Function('window', 'deleteFromSupabase', 'JSON', 'String',
          src + '\nreturn _asDiscardPagesNotIn;')(win, p => deleted.push(p), JSON, String)(kept);
        return { deleted, left: win._asPendingScanPaths };
      };
      const P = ['song-scans/a_p1.jpg', 'song-scans/b_p2.jpg', 'song-scans/c_p3.jpg'];

      const kept2 = run(P, [{ url: 'https://s/song-scans/a_p1.jpg' }, { url: 'https://s/song-scans/c_p3.jpg' }]);
      check('the page taken out of the form is deleted', kept2.deleted, ['song-scans/b_p2.jpg']);
      check('  and the two the song kept are not', kept2.deleted.length, 1);
      check('  the pending list is emptied either way', kept2.left, []);

      check('a song that kept everything loses nothing',
        run(P, P.map(p => ({ url: 'https://s/' + p }))).deleted, []);
      check('a song that kept nothing loses all three',
        run(P, []).deleted.length, 3);
      check('an encoded url still counts as keeping the page',
        run(['song-scans/x y.jpg'], [{ url: 'https://s/song-scans/x%20y.jpg' }]).deleted, []);
      check('nothing pending means nothing happens', run([], []).deleted, []);
    }
  }
  // Deleting a file a real song points at breaks that song. Leaving one costs
  // a megabyte. The check against the library is what keeps those apart.
  check('  and nothing is deleted without checking the library first',
    /SBQ_SONGS\.getAll\(\)\.then\(function\(songs\) \{[\s\S]{0,420}?inUse\.indexOf\(name\) !== -1[\s\S]{0,120}?return;/.test(raw), true);
  check('  a library it cannot read means nothing is deleted',
    /\}\)\.catch\(function\(\) \{\s*[\r\n]+\s*\/\/ Could not read the library/.test(raw), true);

  // ---- previewing a page that was just scanned ---------------------------
  //
  // Both of these were reported from a phone, not found here, and neither
  // was in code written for the scan -- they were in an older preview modal
  // that the new flow happens to lead into. That is the shape of this whole
  // feature's bugs: the parts I built were fine, the joins were not.
  console.log('\nthe attachment preview, opened from the Add Song form');
  {
    // 1. It opened BEHIND the form. The form carries an inline z-index and
    //    the preview was left on the .modal-overlay default, so the picture
    //    loaded underneath it.
    const zOf = (re) => {
      const m = raw.match(re);
      return m ? Number(m[1]) : NaN;
    };
    const zPreview = zOf(/id="previewModal" class="modal-overlay" style="z-index:(\d+);"/);
    const zForm    = zOf(/id="addSongModal" class="modal-overlay" style="z-index:(\d+);"/);
    const zTray    = zOf(/id="asPageTray" class="modal-overlay" style="z-index:(\d+);"/);
    check('the preview declares a z-index at all', zPreview > 0, true);
    check('  above the Add Song form (' + zPreview + ' vs ' + zForm + ')', zPreview > zForm, true);
    check('  and above the page tray (' + zPreview + ' vs ' + zTray + ')', zPreview > zTray, true);

    // 2. It put the image in an IFRAME, which lays it out at natural size
    //    pinned top-left. A 1800x2400 photograph on a 375px phone therefore
    //    showed one magnified corner of the page.
    const fn = (() => {
      const a = raw.indexOf('function previewAttachment(url) {');
      if (a < 0) return '';
      let d = 0, started = false;
      for (let i = a; i < raw.length; i++) {
        if (raw[i] === '{') { d++; started = true; }
        else if (raw[i] === '}') { d--; if (started && d === 0) return raw.slice(a, i + 1); }
      }
      return '';
    })();
    check('previewAttachment was found', fn.length > 200, true);
    check('  it tells an image from a document', /var isImage = \/\\\.\(jpe\?g\|png/.test(fn), true);
    check('  an image goes to an <img>, not the frame',
      /wrap\.appendChild\(img\);/.test(fn) && /frame\.style\.display = 'none';/.test(fn), true);
    check('  which is told to fit, by the class the other viewer uses',
      /id="previewImageWrap" class="doc-preview-imgwrap"/.test(raw), true);
    check('  and a document still goes to the frame',
      /frame\.src = url\.replace\('\/edit', '\/preview'\)/.test(fn), true);
    // HEIC renders on an iPhone and almost nowhere else; a broken picture
    // would be worse than whatever the browser makes of it.
    check('  an image that will not decode falls back to the frame',
      /img\.onerror = function\(\) \{/.test(fn), true);
  }

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
    // Raising this above the single-page limit it replaced is the mistake
    // worth pinning: inlineData is base64, so 14MB of pages is 18.7MB on the
    // wire and one request may carry 20MB. 20MB of pages is 26.7MB, and the
    // model refuses the lot with an error that explains nothing.
    const capMb = Number((rt.match(/const MAX_TOTAL_BYTES = (\d+) \* 1024 \* 1024;/) || [])[1]);
    // check() here is (label, actual, expected). Passing a detail string as
    // the third argument compares true against that string and fails -- which
    // is how this very assertion first went red, and the same slip the chord
    // harness was caught by. Numbers belong in the label.
    check('  and it leaves room for base64: ' + capMb + 'MB -> ' + (capMb * 4 / 3).toFixed(1) + 'MB on the wire',
      capMb > 0 && capMb * 4 / 3 < 20, true);

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
