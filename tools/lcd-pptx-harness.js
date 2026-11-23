'use strict';
// Harness for PowerPoint in LCD Projection, after the 2026-11-22 round.
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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
