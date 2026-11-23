'use strict';
// Harness for PowerPoint in LCD Projection: the 2026-11-22 round (sections
// 1-5) and the 2026-11-23 one that followed it (section 6).
//
// WHY THIS EXISTS
// From the operator, on a marked-up screenshot of the console:
//   1. a presentation uploaded to the folder is stored in Supabase and usable
//      by everyone;
//   2. two ways into a section -- drag from the folder, or the section's
//      burger menu;
//   3. the projector shows a deck FULL SCREEN, as PowerPoint's own slideshow
//      does ("the slides seem to be reduced in size");
//   4. animations -- NOT possible on this pipeline, see below;
//   5. faster, sharper, more accurate import;
//   6. a phone can upload and put a deck into the slides.
//
// On (4), recorded here because the next person will ask: every deck is
// converted by CloudConvert to a PDF and rasterised by pdf.js, and a flat
// image cannot animate. The only route that could is Google Slides, and
// /api/convert-pptx-to-slides answered "Google OAuth credentials missing" on
// live when this was built. Nothing in this harness pretends otherwise.
//
// What is RUN rather than matched:
//   - _bgShared, the field-name rule. It IS the bug in (1): a document is
//     stored with url/path and the sync read cloudUrl/storagePath, so it
//     returned before writing and every PowerPoint stayed on one device.
//   - _lcdScaleForWidth, the resolution rule behind (5).
//   - _woSlidesFolderItems and _woRememberInFolder, the folder in (2) and (6).
//
// Source checks match STATEMENTS, never a word a comment might also use
// (CLAUDE.md gotcha 82).
//
// USAGE
//   node tools/lcd-pptx-harness.js                 # ../Index.html
//   node tools/lcd-pptx-harness.js path/to/file.html
//   node tools/lcd-pptx-harness.js <file> --expect-broken
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
const has = re => re.test(SRC);
const fn = name => {
  const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}'));
  return m ? m[0] : '';
};

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

// ---------------------------------------------------------------------------
// 1. The folder is shared with everyone
// ---------------------------------------------------------------------------
console.log('A presentation in the folder belongs to the church, not to one laptop');

const sharedSrc = fn('_bgShared');
if (sharedSrc) {
  const _bgShared = new Function(sharedSrc + '\nreturn _bgShared;')();
  // A document, as _lcdIngestTrayFile stores one.
  const doc = { type: 'document', name: 'Sermon.pptx', url: 'https://x.supabase.co/a.pptx', path: 'orders/presentations/a.pptx', data: '' };
  check('a document is found by the url and path the tray actually stores',
    _bgShared(doc).url === 'https://x.supabase.co/a.pptx' && _bgShared(doc).path === 'orders/presentations/a.pptx',
    JSON.stringify(_bgShared(doc)));
  // A picture, as saveBackgrounds' migration stores one.
  const pic = { type: 'image', cloudUrl: 'https://x.supabase.co/b.jpg', storagePath: 'orders/images/b.jpg', data: 'https://x.supabase.co/b.jpg' };
  check('...and a picture by the cloudUrl and storagePath it has always used',
    _bgShared(pic).url === 'https://x.supabase.co/b.jpg' && _bgShared(pic).path === 'orders/images/b.jpg');
  // The rule that stops a 4MB base64 string being pushed into a text column.
  const base64 = { type: 'image', data: 'data:image/jpeg;base64,AAAA' };
  check('a base64 picture is still NOT shared -- it has no address to share',
    _bgShared(base64).url === '' && _bgShared(base64).path === '');
} else {
  check('where a media record\'s address lives is one function (_bgShared)', false);
}

const saveSrc = fn('_sbSaveBackgroundToSupabase');
check('the sync reads that one rule rather than naming fields itself',
  /var where = _bgShared\(bg\);/.test(saveSrc) &&
  /if \(!where\.path && \(!where\.url \|\| where\.url\.indexOf\('http'\) !== 0\)\) return;/.test(saveSrc),
  saveSrc.slice(0, 200));
check('the drawer travels with the file',
  /category: _lcdItemCategory\(bg\)/.test(saveSrc));
check('...and a Supabase without that column still gets the file, once it has said so',
  /if \(withCategory && \/category\/i\.test\(res\.error\.message \|\| ''\)\) \{/.test(saveSrc) &&
  /_bgCatColumn = false;\r?\n\s*send\(false\);/.test(saveSrc));
check('the READ falls back the same way, because one missing column fails the whole select',
  /_bgCatColumn = false;\r?\n\s*pull\(false\);/.test(fn('loadBackgroundsFromSupabase')) &&
  /var cols = withCategory \? 'id,type,name,url,storage_path,category' : 'id,type,name,url,storage_path';/.test(fn('loadBackgroundsFromSupabase')));
check('a shared document comes back with the url and path it is expanded and deleted by',
  /url: rowb\.url,\r?\n\s*path: rowb\.storage_path,/.test(fn('loadBackgroundsFromSupabase')));
check('adding one to the tray shares it there and then',
  /if \(typeof _sbSaveBackgroundToSupabase === 'function'\) _sbSaveBackgroundToSupabase\(rec\);/.test(fn('_lcdIngestTrayFile')));
check('the migration that adds the column is in the repo',
  fs.existsSync(path.join(__dirname, '..', 'migrations', '2026-11-22_lhc_backgrounds_category.sql')));

// ---------------------------------------------------------------------------
// 2. Two ways into a section
// ---------------------------------------------------------------------------
console.log('\nTwo ways to put a deck in a section');
check('dragging one out of the folder still expands it where it is dropped',
  /if \(_lcdIsDocItem\(bg\)\) _lcdExpandDocIntoSection\(sectionId, bg, t\);/.test(fn('_lcdDropTrayItem')));
check('the section\'s burger offers the folder as a tab of its own',
  has(/<button class="wo-slides-tab active" data-tab="folder" onclick="WO\.switchSlidesTab\('folder'\)">/) &&
  has(/<div class="wo-slides-tab-content" id="woSlidesTabFolder"><\/div>/));
check('...and opens on it when there is something in it, on Upload when there is not',
  /switchSlidesTab\(_woSlidesFolderItems\(\)\.length \? 'folder' : 'upload'\);/.test(fn('addPowerPointSlides')));
check('picking one adds it to the section the burger was opened on',
  /_lcdExpandDocIntoSection\(sectionId, bg, \{\}\);/.test(fn('slidesFolderPick')));
check('Add Slides is hidden on the folder, which adds on a click',
  /addBtn\.style\.display = tab === 'folder' \? 'none' : '';/.test(fn('switchSlidesTab')));
check('...and it is exported for its inline handler',
  has(/slidesFolderPick: slidesFolderPick,/));

const itemsSrc = fn('_woSlidesFolderItems');
if (itemsSrc && sharedSrc) {
  const run = new Function('savedBackgrounds', [
    'function _lcdIsDocItem(bg) { return !!(bg && (bg.type === "document" || /\\.(pptx?|pdf|docx?|key|odp)$/i.test(bg.name || ""))); }',
    sharedSrc, itemsSrc,
    'return _woSlidesFolderItems;',
  ].join('\n'));
  const list = run([
    { id: 'a', type: 'document', name: 'Sermon.pptx', url: 'https://x/a.pptx', path: 'p/a' },
    { id: 'b', type: 'image', name: 'wall.jpg', cloudUrl: 'https://x/b.jpg' },
    { id: 'c', type: 'document', name: 'Notices.pdf', url: 'https://x/c.pdf', path: 'p/c' },
    { id: 'd', type: 'document', name: 'Lost.pptx' },           // no stored copy
  ])();
  check('the folder lists the documents that have a stored copy, newest first',
    list.length === 2 && list[0].id === 'c' && list[1].id === 'a', JSON.stringify(list.map(x => x.id)));
  check('...and never a picture, which is not a presentation',
    !list.some(x => x.id === 'b'));
  check('...nor one with nothing to expand from, which would fail on the click',
    !list.some(x => x.id === 'd'));
}

const rememberSrc = fn('_woRememberInFolder');
if (rememberSrc) {
  const S = { shared: [], saved: 0 };
  const make = () => {
    const savedBackgrounds = [];
    const api = new Function('savedBackgrounds', 'S', [
      'function saveBackgrounds() { S.saved++; }',
      'function _sbSaveBackgroundToSupabase(r) { S.shared.push(r); }',
      'function _lcdRenderMediaTray() {}',
      rememberSrc,
      'return _woRememberInFolder;',
    ].join('\n'))(savedBackgrounds, S);
    return { api, savedBackgrounds };
  };
  let t = make();
  t.api({ url: 'https://x/a.pptx', path: 'orders/presentations/a.pptx' }, 'Sermon.pptx');
  check('a deck imported through the burger joins the shared folder too',
    t.savedBackgrounds.length === 1 && t.savedBackgrounds[0].category === 'presentation' &&
    t.savedBackgrounds[0].type === 'document' && S.shared.length === 1,
    JSON.stringify(t.savedBackgrounds));
  // The same file imported twice must not make a second folder entry.
  t.api({ url: 'https://x/a.pptx', path: 'orders/presentations/a.pptx' }, 'Sermon.pptx');
  check('...once, however many times the same file is imported',
    t.savedBackgrounds.length === 1);
  t = make();
  t.api({ url: 'https://x/p.jpg', path: 'orders/images/p.jpg' }, 'photo.jpg');
  check('a picture or a video does not land in the presentation folder',
    t.savedBackgrounds.length === 0);
}

// A file ALREADY in the folder, expanded into a section, must not be filed
// again. Expanding re-uploads it, so the new storage path defeats the
// path-based dedupe above -- one drag out of the tray made a second identical
// tile in the drawer (the operator, 2026-11-22).
console.log('\nExpanding a file that is already in the folder does not file it twice');
check('the import takes an opts, and only files an upload that did not come from there',
  /function addSlidesFromFiles\(sectionId, files, opts\) \{/.test(SRC) &&
  /if \(!opts\.fromFolder\) _woRememberInFolder\(result, _capFileName\);/.test(SRC));
check('...and the folder\'s own expansion says so',
  /addSlidesFromFiles\(sectionId, \[file\], \{ fromFolder: true \}\);/.test(fn('_lcdExpandDocIntoSection')));
check('an upload from the burger or a dropped file still files itself',
  /addSlidesFromFiles\(sectionId, pendingSlidesFiles\);/.test(SRC) &&
  !/addSlidesFromFiles\(sectionId, pendingSlidesFiles, \{ fromFolder: true \}\)/.test(SRC));

console.log('\nRemoving one asks in the app\'s own look, not the browser\'s');
check('the Media Tray asks with lhcAskToast',
  /window\.lhcAskToast\(\{/.test(fn('lcdDeleteMedia')) && !/window\.confirm\(/.test(fn('lcdDeleteMedia')));
check('...and so does taking a presentation out of a section',
  /window\.lhcAskToast\(\{/.test(fn('removePptFile')) && !/confirm\(/.test(fn('removePptFile')));
check('the removal itself is split out, so the question does not block the page',
  /\}\)\.then\(function\(yes\) \{ if \(yes\) _removePptNow\(sectionId, containerId, silent\); \}\);/.test(fn('removePptFile')) &&
  /function _removePptNow\(sectionId, containerId, silent\) \{/.test(SRC));
// `name` was left behind by that split and resolved to window.name -- the
// empty string -- so the toast read '"" removed' and never threw.
check('...and it still knows the name it reports',
  /var name = \(data && data\.fileName\) \? data\.fileName : 'This presentation';/.test(fn('_removePptNow')));
check('removing a presentation takes its stored file with it, which nothing else uses',
  /if \(_goneDoc && _gone && typeof deleteFromSupabase === 'function'\) \{/.test(fn('deleteBackground')) &&
  /var _p = _gone\.path \|\| _gone\.storagePath;/.test(fn('deleteBackground')) &&
  // The CALL, not just the path it would be given: without this the setup
  // reads as a cleanup that never happens.
  /if \(_p\) \{ try \{ deleteFromSupabase\(_p\); \}/.test(fn('deleteBackground')));
// The guard is on _goneDoc: a picture's file is referenced by slides in saved
// orders, so that one is left exactly where it is.
check('...and a picture, whose file saved orders still point at, is left alone',
  /if \(_goneDoc && _gone/.test(fn('deleteBackground')) &&
  !/if \(_gone && typeof deleteFromSupabase/.test(fn('deleteBackground')));
check('the toast after a tray delete names what actually went',
  /var _goneDoc = _lcdIsDocItem\(/.test(fn('deleteBackground')) &&
  /showToast\(_goneDoc \? 'Presentation removed from the folder' : 'Background deleted', 'info'\);/.test(SRC));
const toastSrc = SRC.match(/window\.lhcAskToast = function\(o\) \{[^]*?\n  \};/);
const tst = toastSrc ? toastSrc[0] : '';
check('only the action button answers yes -- Escape, Cancel and a tap away are no',
  /done\(b\.getAttribute\('data-ask'\) === 'yes'\)/.test(tst) &&
  /if \(e\.key === 'Escape'\) \{[^}]*done\(false\); \}/.test(tst) &&
  /if \(el\.contains\(e\.target\)\) return;\r?\n\s*done\(false\);/.test(tst));
check('...and the tap that dismissed it is swallowed, not passed to the tile underneath',
  /document\.addEventListener\('click', eat, true\);/.test(tst));
check('its CSS is at the top level, not inside a width band',
  /\n\.lhc-asktoast \{\r?\n\s*position: fixed; z-index: 10062;/.test(SRC));

// ---------------------------------------------------------------------------
// 3. Full screen on the projector
// ---------------------------------------------------------------------------
console.log('\nThe projector shows a deck full screen');
check('a slide has a layer of its own, outside the safe-zone barrier',
  has(/'#projSlide \{ position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 2; display: none;/) &&
  has(/'<div id="projSlide"><\/div>' \+/));
check('...which fills it, letterboxed rather than cropped',
  has(/'#projSlide img \{ width: 100%; height: 100%; object-fit: contain; display: block; \}' \+/));
check('the slide branch puts it there and leaves .projection-content empty',
  has(/'    content\.innerHTML = "";' \+\r?\n\s*'    content\.style\.padding = "0";' \+\r?\n\s*'    _showProjSlide\(data\.data\);' \+/));
check('the old inset-and-clipped image is gone',
  !has(/class=\\\\"projection-slide\\\\"/) && !has(/'\.projection-slide \{/));
// Every branch that replaces the words takes the slide layer with them --
// and the ones that arrive DURING a deck must not.
check('text, video and clear hide the slide layer',
  has(/'  \} else if \(data\.type === "text"\) \{' \+\r?\n\s*'    _hideProjSlide\(\);' \+/) &&
  has(/'  \} else if \(data\.type === "video"\) \{' \+\r?\n\s*'    _hideProjSlide\(\);' \+/) &&
  has(/'  \} else if \(data\.type === "clear"\) \{' \+\r?\n\s*'    _hideProjSlide\(\);' \+/));
check('...and a background, a barrier change or an alignment change does NOT -- they arrive mid-deck',
  !has(/'  \} else if \(data\.type === "background"\) \{' \+\r?\n\s*'    _hideProjSlide\(\);' \+/) &&
  !has(/'  \} else if \(data\.type === "barrierUpdate"\) \{' \+\r?\n\s*'    _hideProjSlide\(\);' \+/) &&
  !has(/'  \} else if \(data\.type === "videoBackground"\) \{' \+\r?\n\s*'    _hideProjSlide\(\);' \+/));
check('Blank still covers it: #projBlank sits above at 99999',
  has(/blankEl\.style\.cssText = "position:fixed;inset:0;background:#000;z-index:99999/));

// ---------------------------------------------------------------------------
// 4. Import: sharper, and bounded
// ---------------------------------------------------------------------------
console.log('\nImport at the projector\'s own resolution');
const scaleSrc = fn('_lcdScaleForWidth');
if (scaleSrc) {
  const _scale = new Function(scaleSrc + '\nreturn _lcdScaleForWidth;')();
  // A 16:9 deck exports as a 720x405pt PDF page.
  const s169 = _scale(720, 1920);
  check('a 16:9 deck renders at the projector\'s width, not at a fixed 2x',
    Math.abs(s169 - 1920 / 720) < 0.001 && Math.round(720 * s169) === 1920,
    '720pt -> scale ' + s169 + ' = ' + Math.round(720 * s169) + 'px');
  check('...which is sharper than the 1440px the old fixed 2x gave',
    Math.round(720 * s169) > Math.round(720 * 2));
  check('a page already wider than the projector is not rendered smaller than 1.5x',
    _scale(4000, 1920) === 1.5);
  check('a tiny page is capped, so no deck asks for a 10,000px canvas',
    _scale(100, 1920) === 4);
  check('a page of no width falls back rather than dividing by zero',
    _scale(0, 1920) === 2 && _scale(-5, 1920) === 2);
}
const extract = SRC.match(/function extractPdfPages[^]*?\n  \}/);
const ext = extract ? extract[0] : '';
check('pages render a few at a time, not all at once',
  /for \(var _p = 0; _p < Math\.min\(_LCD_PAGE_POOL, totalPages\); _p\+\+\) _renderNext\(\);/.test(ext) &&
  !/for \(var pageNum = 1; pageNum <= totalPages; pageNum\+\+\)/.test(ext), ext.slice(0, 120));
check('...and each canvas is released as soon as its JPEG is out',
  /canvas\.width = canvas\.height = 0;/.test(ext));
// The recovery has to be REACHED, so the warn is matched as the catch's first
// statement rather than merely present: `return;` above it leaves the line in
// the source and the import stuck on its bar for ever (CLAUDE.md gotcha 82).
check('one page that will not render does not strand the whole import',
  /\}\)\.catch\(function\(e\) \{\r?\n\s*console\.warn\('\[PPT\] page ' \+ pn \+ ' failed to render:', e\);\r?\n[^]*?pagesProcessed\+\+;/.test(ext) &&
  /_lcdImportClear\(sectionId\);\r?\n\s*if \(callback\) callback\(\);\r?\n\s*return;\r?\n\s*\}\r?\n\s*_renderNext\(\);\r?\n\s*\}\);/.test(ext),
  ext.slice(ext.indexOf('}).catch(function(e)'), ext.indexOf('}).catch(function(e)') + 160));
check('Cancel still stops it before the expensive part',
  /if \(_lcdImportCancelled\[sectionId\]\) return;/.test(ext));
check('the three figures are named, not buried in the arithmetic',
  has(/var _LCD_PAGE_WIDTH = 1920;/) && has(/var _LCD_PAGE_POOL = 3;/) && has(/var _LCD_PAGE_QUALITY = 0\.92;/));

// ---------------------------------------------------------------------------
// 5. A phone
// ---------------------------------------------------------------------------
console.log('\nA phone can do it too');
// The Media Tray is display:none below 1201px (the console gives that band to
// the schedule), so the burger is a phone's ONLY way to the folder.
check('the Media Tray is still hidden on a phone -- so the burger is the way in',
  has(/#worshipOrderView\.lcd-mode \.lcd-lower-row \{ display: none !important; \}/));
check('the burger\'s Add presentation is in the section menu at every width',
  has(/\{ icon: 'fa-file-powerpoint',  label: 'Add presentation',  fn: 'addPowerPointSlides' \}/));
check('the window it opens is moved to <body>, so no ancestor can hide or clip it',
  /_ensureSlidesModalAtBody\(\);/.test(fn('addPowerPointSlides')));
check('the folder\'s rows are one column of names, which is what a phone has room for',
  has(/\.wo-slides-folder-list \{ display: flex; flex-direction: column;/) &&
  has(/\.wo-slides-folder-name \{ flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/));

// ---------------------------------------------------------------------------
// 6. A deck projects -- from where it was selected, filling the screen
// ---------------------------------------------------------------------------
// The round after the one above. The operator reported, of the same console:
//   1. Project on a selected presentation page opened at the START of the
//      liturgy instead of at that page;
//   2. folding a section jumped the rail back to whatever is live;
//   3. a page showed as "a small card at the center" rather than full screen;
//   4. "a seamless experience ... just like Easy Worship".
//
// One root cause under 1, 3 and most of 4: the app renders presentation pages
// as .wo-ppt-page and has done for a while, but the three projection paths
// were each still asking about .wo-ppt-slide (and _buildWofsSlides about the
// .wo-local-slides container), neither of which anything renders any more. So
// a page was carried along as an anonymous slide box: Project could not find
// it, the presenter overlay drew it as an empty slide, and arrowing out of the
// liturgy into a sermon deck put NOTHING on the wall. Measured before the fix,
// on a 19-page deck in a real order: arrow into the deck -> the Program box
// held no slide image at all.
//
// What is RUN rather than matched: _isPptPageEl, _pptPageAt, _wofsKeys, and
// the slide-picking prefix of _doFullscreenOverlay -- which IS bug 1.
console.log('\nA presentation page reaches the three projection paths');

// A DOM element, as much of one as these four functions touch.
function el(cls, attrs) {
  const a = attrs || {};
  const list = String(cls).split(' ');
  return {
    nodeType: 1,
    classList: { contains: c => list.indexOf(c) >= 0 },
    getAttribute: k => (Object.prototype.hasOwnProperty.call(a, k) ? a[k] : null)
  };
}

const pptHelpers = fn('_isPptPageEl') + '\n' + fn('_pptPageAt') + '\n' + fn('_wofsKeys');
let isPptPageEl = null, pptPageAt = null, wofsKeys = null;
if (fn('_isPptPageEl') && fn('_pptPageAt') && fn('_wofsKeys')) {
  try {
    const made = new Function('sermon', pptHelpers +
      '\nvar currentSermonSlides = sermon;' +
      '\nreturn { isPptPageEl: _isPptPageEl, pptPageAt: _pptPageAt, wofsKeys: _wofsKeys };');
    const deck = { 'sec-9': { slides: [{ data: 'a' }, { data: 'b' }, { data: 'c' }], currentIndex: 0 } };
    const api = made(deck);
    isPptPageEl = api.isPptPageEl; pptPageAt = api.pptPageAt; wofsKeys = api.wofsKeys;
  } catch (e) { /* reported by the checks below */ }
}

check('_isPptPageEl, _pptPageAt and _wofsKeys all lift out and run',
  !!(isPptPageEl && pptPageAt && wofsKeys));

if (isPptPageEl && pptPageAt && wofsKeys) {
  const page = el('wo-content-box wo-slide-box wo-ppt-page',
    { 'data-section': 'sec-9', 'data-ppt-section': 'sec-9', 'data-ppt-idx': '2' });
  const legacy = el('wo-slide-box wo-ppt-slide', { 'data-section': 'sec-9', 'data-ppt-idx': '1' });
  const text = el('wo-content-box wo-slide-box wo-liturgy-slide',
    { 'data-section': 'sec-1', 'data-liturgy-id': 'lit7' });

  // The layout in use. This is the one every path was missing.
  check('a .wo-ppt-page is read as a presentation page', isPptPageEl(page) === true);
  // The layout it replaced: an order saved under it has to keep working.
  check('...and so is the .wo-ppt-slide it replaced', isPptPageEl(legacy) === true);
  check('an ordinary slide box is not', isPptPageEl(text) === false);
  check('and neither is nothing at all',
    isPptPageEl(null) === false && isPptPageEl(undefined) === false);

  const at = pptPageAt(page);
  check('_pptPageAt gives back the section, the index and the page itself',
    !!at && at.sectionId === 'sec-9' && at.idx === 2 && at.slide.data === 'c');
  check('...reading data-ppt-section first, which is the attribute a page carries',
    (pptPageAt(el('wo-ppt-page', { 'data-ppt-section': 'sec-9', 'data-ppt-idx': '0' })) || {}).sectionId === 'sec-9');
  // Index 0 is a real page. `!idx` would throw away the first page of every
  // deck -- the one Project lands on most often.
  check('...and page 0 is a page, not a missing one',
    (pptPageAt(el('wo-ppt-page', { 'data-section': 'sec-9', 'data-ppt-idx': '0' })) || {}).idx === 0);
  check('a page whose deck is not loaded is nothing, rather than a half-answer',
    pptPageAt(el('wo-ppt-page', { 'data-section': 'gone', 'data-ppt-idx': '0' })) === null);
  check('a page past the end of its deck likewise',
    pptPageAt(el('wo-ppt-page', { 'data-section': 'sec-9', 'data-ppt-idx': '9' })) === null);
  check('an ordinary slide box is not a page', pptPageAt(text) === null);

  // _wofsKeys names each entry so the slide being shown can be found again in
  // a list rebuilt from new nodes. A page carries no data-song-id and no
  // data-liturgy-id, so keyed as an ordinary box every page in the order came
  // out 'box::1', 'box::2', ... sharing the empty key with any other keyless
  // box -- and a rebuild landed on the wrong slide.
  const keys = wofsKeys([text, page, legacy, { type: 'ppt', sectionId: 'sec-2', slideIndex: 4 }]);
  check('a page keys by its deck and its page number',
    keys[1] === 'ppt:sec-9:2' && keys[2] === 'ppt:sec-9:1', keys.join(' | '));
  check('...never as an anonymous box, which every page would have shared',
    keys.filter(k => k.indexOf('box::') === 0).length === 0, keys.join(' | '));
  check('an ordinary slide box and a legacy ppt entry are unchanged',
    keys[0] === 'box:lit7:1' && keys[3] === 'ppt:sec-2:4', keys.join(' | '));
}

// --- bug 1: where Project starts -------------------------------------------
// The prefix of _doFullscreenOverlay, up to the point it touches the DOM: the
// whole of the decision it was getting wrong.
const fsMatch = SRC.match(/\n  function _doFullscreenOverlay\(\) \{([^]*?)\n    var overlay = \$\('woFullscreenOverlay'\);/);
let pickStart = null;
if (fsMatch) {
  try {
    pickStart = new Function('s', [
      'var _wofsIdx = 0;',
      'var _wofsSlides = s.list;',
      'var _selectedPptContainer = s.container;',
      'var activeNavigationMode = s.mode;',
      'var selectedSlideBox = s.box;',
      'var currentSermonSlides = s.sermon;',
      fsMatch[1],
      'return _wofsIdx;'
    ].join('\n'));
  } catch (e) { /* reported below */ }
}
check('the slide Project starts on is decided by code that lifts out and runs', !!pickStart);

if (pickStart) {
  const pageEl = n => el('wo-content-box wo-slide-box wo-ppt-page',
    { 'data-section': 'sec-9', 'data-ppt-section': 'sec-9', 'data-ppt-idx': String(n) });
  const textEl = n => el('wo-content-box wo-slide-box', { 'data-liturgy-id': 'lit' + n });
  const sermon = { 'sec-9': { slides: [{}, {}, {}], currentIndex: 2 } };

  // THE REPORTED BUG. A page is selected, so the mode is 'ppt-local' and the
  // first lookup is entered -- but _buildWofsSlides makes { type: 'ppt' }
  // entries only for the legacy .wo-local-slides container, so there was
  // nothing for it to match, and the selectedSlideBox fallback sat behind an
  // `else`. The index stayed 0: the start of the liturgy.
  const p0 = pageEl(0), p1 = pageEl(1), p2 = pageEl(2);
  const list = [textEl(1), textEl(2), p0, p1, p2];
  check('Project on a selected presentation page starts AT that page',
    pickStart({ list: list, container: p2, mode: 'ppt-local', box: p2, sermon: sermon }) === 4,
    'got ' + pickStart({ list: list, container: p2, mode: 'ppt-local', box: p2, sermon: sermon }));
  check('...the first page of a deck included, which reads as index 0',
    pickStart({ list: list, container: p0, mode: 'ppt-local', box: p0, sermon: sermon }) === 2);

  // The legacy container layout still answers through the first lookup.
  const legacyList = [textEl(1), { type: 'ppt', sectionId: 'sec-9', slideIndex: 2 },
                                  { type: 'ppt', sectionId: 'sec-9', slideIndex: 3 }];
  const legacyBox = el('wo-local-slides', { 'data-section': 'sec-9' });
  check('a deck in the older container layout still starts where it was left',
    pickStart({ list: legacyList, container: legacyBox, mode: 'ppt-local', box: null, sermon: sermon }) === 1);

  // Unchanged behaviour, which the fallback must not have disturbed.
  check('an ordinary slide still starts at itself',
    pickStart({ list: list, container: null, mode: 'slides', box: list[1], sermon: sermon }) === 1);
  check('nothing selected still starts at the top',
    pickStart({ list: list, container: null, mode: 'slides', box: null, sermon: sermon }) === 0);
  check('a selection that is no longer in the list starts at the top, not at -1',
    pickStart({ list: list, container: null, mode: 'slides', box: pageEl(7), sermon: sermon }) === 0);
}

// --- bug 3: full screen, and bug 4's blank wall -----------------------------
console.log('\nA page fills the frame, wherever it is drawn');

// selectSlideBox is what the arrow keys and the rail call. Asking the question
// of .wo-ppt-slide alone let a page fall through to the text branch below,
// which looks for .wo-slide-line, finds none, and projects an empty slide.
check('selectSlideBox asks _pptPageAt, not the class the app stopped rendering',
  /var _pp = _pptPageAt\(box\);/.test(fn('selectSlideBox')) &&
  !/if \(box\.classList\.contains\('wo-ppt-slide'\)\) \{/.test(fn('selectSlideBox')));
// selectSlideBox turns the editor back on for an in-system slide before it
// finds out it is holding a page, and a page has nothing for it to act on
// (CLAUDE.md gotcha 105). projectPptPage already shuts it; the arrow keys
// reach the same place by another road and have to do the same.
check('...and shuts the Slide Editor, which has nothing to act on there',
  /if \(_pp\) \{\r?\n(?:\s*\/\/[^\n]*\r?\n)*\s*if \(typeof _lcdSetEditorVisible === 'function'\) _lcdSetEditorVisible\(false\);/
    .test(fn('selectSlideBox')));
check('...and projects that page, so arrowing into a deck is not a blank wall',
  /sendToProjectionWindow\(\{ type: 'slide', data: _pp\.slide\.data, slideNum: pptIdx \+ 1, totalSlides: pptData\.slides\.length \}\);/
    .test(fn('selectSlideBox')));

const wofsRenderSrc = fn('_wofsRender');
check('the presenter overlay asks the same question',
  /var _pp2 = _pptPageAt\(box\);/.test(wofsRenderSrc) &&
  !/box\.classList\.contains\('wo-ppt-slide'\)/.test(wofsRenderSrc));
// width/height, not max-*: a page smaller than the screen would otherwise sit
// at its own size in the middle of it -- the "small card" itself.
check('...and draws the page at the size of the screen, not at its own',
  !/max-width:100vw;max-height:100vh;object-fit:contain/.test(wofsRenderSrc) &&
  (wofsRenderSrc.match(/width:100vw;height:100vh;object-fit:contain/g) || []).length === 2,
  (wofsRenderSrc.match(/width:100vw[^"']*/g) || []).join(' | '));

// The presenter filmstrip labels an element from its .wo-slide-line text, and
// a page has none -- so a 19-page deck came out as 19 blank numbered thumbs.
check('the presenter filmstrip shows a page as its picture, not a blank thumb',
  /var _fp = _pptPageAt\(item\);/.test(fn('_wofsRenderFilmstrip')) &&
  /<img src="' \+ escapeHtml\(_fp\.slide\.data \|\| ''\) \+ '"/.test(fn('_wofsRenderFilmstrip')));

// The Program box is padded 30px for words. Measured at 1158px before the fix:
// a 1920x1080 page drew 246x139 inside a 356x200 box -- 47.9% of it. After:
// 354x199, 98.8%, the rest being the box's own border.
check('the Program mirror lays a page over its box, not inside the padding',
  /img\.className = 'wo-preview-slide-img lcd-slide-bleed';\r?\n\s*img\.src = data\.data;/.test(fn('_lcdMirrorToProgramOutput')));
check('the Projection Preview does the same',
  /img\.className = 'wo-preview-slide-img lcd-slide-bleed';\r?\n\s*img\.src = slide\.data;/.test(fn('updateProjectionWithSlide')));
// Four call sites zeroed this padding inline and not one ever put it back, so
// the first TEXT slide after a deck lost its margins in the preview too.
check('...and gives the padding back, rather than zeroing it for good',
  /screen\.style\.padding = '';\r?\n\s*\r?\n?\s*var img = document\.createElement\('img'\);/.test(fn('updateProjectionWithSlide')) &&
  !/screen\.style\.padding = '0';\r?\n\s*\r?\n?\s*var img = document\.createElement\('img'\);/.test(SRC));

// At the TOP level, not inside an @media: the same trap the toast fell into
// last round, where a two-space-indented anchor matched the phone copy of a
// rule and everything rendered unstyled.
const bleedAt = SRC.indexOf('\n  .wo-preview-screen .wo-preview-slide-img.lcd-slide-bleed {');
const styleAt = SRC.lastIndexOf('<style', bleedAt);
// Depth, not "is there an @media earlier" -- this sheet has plenty, all of
// them long closed. Last round a two-space-indented anchor put a whole rule
// inside the phone's @media and the assert still passed, because there was
// exactly one match at that indentation; everything then rendered unstyled.
const before = bleedAt > 0 ? SRC.slice(styleAt, bleedAt) : '';
const depth = (before.split('{').length - 1) - (before.split('}').length - 1);
check('the bleed rule exists, at the top level of its stylesheet (depth 0)',
  bleedAt > 0 && depth === 0, 'index ' + bleedAt + ', depth ' + depth);
check('...and covers the box, overriding the max-width that sized it to fit',
  /position: absolute; top: 0; right: 0; bottom: 0; left: 0;\s*\r?\n\s*width: 100%; height: 100%; max-width: none; max-height: none;\s*\r?\n\s*object-fit: contain; background: #000;/
    .test(SRC));

// --- bug 2: folding a section ----------------------------------------------
console.log('\nFolding a section leaves the rail where the operator put it');
// Rewriting the rail clamps its scroller to the top, and the watcher then
// reveals the SELECTED row -- so folding anything threw the operator back to
// whatever is live. CLAUDE.md gotcha 73: the position has to be held BEFORE
// the change, because it is only right until then.
const collapseSrc = fn('lcdToggleSectionCollapse');
check('the scroll is held before the rail is rewritten',
  /if \(typeof _lcdRailHoldScroll === 'function'\) _lcdRailHoldScroll\(\);[^]*_lcdRenderCompactRail\(\);/.test(collapseSrc),
  collapseSrc);
const holdAt = collapseSrc.indexOf('_lcdRailHoldScroll()');
const stateAt = collapseSrc.indexOf('_lcdCollapsedSections[sectionId]');
// Both have to be FOUND: indexOf answers -1 for a call that is not there, and
// -1 is less than every real index, so `holdAt < stateAt` alone passed on the
// source that did not hold the scroll at all (CLAUDE.md gotcha 82).
check('...first of all, before the state it renders from even changes',
  holdAt > 0 && stateAt > 0 && holdAt < stateAt,
  'hold at ' + holdAt + ', state at ' + stateAt);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
