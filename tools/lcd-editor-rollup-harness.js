'use strict';
// Harness for the LCD Projection Slide Editor rolling up to its title bar.
//
// WHY THIS EXISTS
// From the operator (2026-11-06): when the Slide Editor is not being used to
// edit, the whole panel should roll up and leave only its "Slide Editor"
// title bar; in edit mode it should appear. The words are already on the
// projection beside it, so the shut editor was a second copy of them taking
// half the row. Now:
//   - shut and not previewing, the panel is its header alone
//     (.lcd-editor-rolled, set by _lcdApplyEditorRoll);
//   - opening the pad (Edit, or a double-click) rolls it down, shutting it
//     (a click away, Save, Discard) rolls it back up;
//   - Preview shows its surface, and a second press on it rolls it up again;
//   - the row is sized as if the editor were open, so rolling moves nothing
//     else on the console -- the Media Tray once dropped 49px the first time
//     the editor opened.
// And one fix found while testing it: in Fixed layout the Song Library's
// "show" tab showed beside an OPEN library, a fourth grid item in three
// tracks, which squeezed Program / Live into a 180px strip.
//
// USAGE
//   node tools/lcd-editor-rollup-harness.js                 # ../Index.html
//   node tools/lcd-editor-rollup-harness.js path/to/file.html
//   node tools/lcd-editor-rollup-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 1f70f0c:Index.html > x`).
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
const fn = name => { const m = SRC.match(new RegExp('  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

// A stand-in for the panel and the two mode buttons: classList, attributes,
// and the header the roll writes its hint on.
function makeEl() {
  const cls = new Set(), attrs = {};
  return {
    cls,
    classList: {
      contains: c => cls.has(c),
      add: c => cls.add(c),
      remove: c => cls.delete(c),
      toggle: (c, on) => { const want = on === undefined ? !cls.has(c) : !!on; if (want) cls.add(c); else cls.delete(c); return want; },
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: k => (k in attrs ? attrs[k] : null),
    removeAttribute: k => { delete attrs[k]; },
    attrs,
  };
}

console.log('Rolled up unless it is being used');
const rollSrc = fn('_lcdApplyEditorRoll');
const modeSrc = fn('lcdSetEditorMode');
if (rollSrc && modeSrc) {
  const panel = makeEl(), header = makeEl(), editBtn = makeEl(), prevBtn = makeEl();
  Object.defineProperty(header, 'title', { get: () => header.attrs.title || '', set: v => { header.attrs.title = String(v); } });
  panel.querySelector = sel => (sel === '.lcd-panel-header' ? header : null);
  const doc = {
    querySelector: sel => (sel === '.lcd-lyrics-panel' ? panel : null),
    getElementById: id => ({ lcdSegEditBtn: editBtn, lcdSegPreviewBtn: prevBtn }[id] || null),
    body: makeEl(),
  };
  const calls = [];
  const api = new Function('document', 'calls', [
    'var _lcdEditorUnlocked = false, _lcdEditDirty = false;',
    'function _lcdAskDraft(after) { calls.push("ask"); }',
    'function _lcdFlushAutoApply() { calls.push("flush"); }',
    'function _lcdApplyEditorLock() { panel().classList.toggle("lcd-editor-locked", !_lcdEditorUnlocked); _lcdApplyEditorRoll(); }',
    'function _lcdSizeWorkspaceColumns() { calls.push("size"); }',
    'function setTimeout(f) { f(); }',
    'function panel() { return document.querySelector(".lcd-lyrics-panel"); }',
    rollSrc,
    modeSrc,
    'return { roll: _lcdApplyEditorRoll, mode: lcdSetEditorMode,',
    '  open: function() { lcdSetEditorMode("edit"); _lcdEditorUnlocked = true; _lcdApplyEditorLock(); },',
    '  shut: function() { _lcdEditorUnlocked = false; _lcdApplyEditorLock(); } };',
  ].join('\n'))(doc, calls);

  api.shut();
  check('shut, the Slide Editor is rolled up to its title bar', panel.classList.contains('lcd-editor-rolled'));
  check('...and its title bar says how to open it', /Press Edit, or double-click/.test(header.title), header.title);
  api.open();
  check('opened (Edit, or a double-click), it rolls down', !panel.classList.contains('lcd-editor-rolled'));
  check('...and the hint goes, since it is open', !header.title);
  api.shut();
  check('shut again (a click away, Save, Discard), it rolls back up', panel.classList.contains('lcd-editor-rolled'));
  api.mode('preview');
  check('Preview, chosen on purpose, shows its surface: not rolled',
    panel.classList.contains('lcd-mode-preview') && !panel.classList.contains('lcd-editor-rolled') && prevBtn.classList.contains('active'));
  api.mode('preview');
  check('a second press on Preview rolls it back up, with Edit the button to press',
    !panel.classList.contains('lcd-mode-preview') && panel.classList.contains('lcd-editor-rolled') &&
    editBtn.classList.contains('active') && !prevBtn.classList.contains('active'));
  api.mode('preview'); api.open();
  check('Edit from Preview opens the pad, rolled down', !panel.classList.contains('lcd-mode-preview') && !panel.classList.contains('lcd-editor-rolled'));
  api.shut();
} else {
  check('the roll is a function of its own (_lcdApplyEditorRoll)', false);
}
check('every change to the lock goes through the roll', /_lcdApplyEditorRoll\(\);/.test(fn('_lcdApplyEditorLock')));
check('...and every change of mode', /_lcdApplyEditorRoll\(\);\r?\n  \}$/.test(modeSrc));

console.log('\nWhat rolls, and what stays');
check('rolled, the panel stops stretching to the row and has no floor',
  has(/\.lcd-outputs-row \.lcd-lyrics-panel\.lcd-editor-rolled \{ align-self: flex-start; min-height: 0; \}/));
check('...its body goes (beating the Full Screen rule that shows it)',
  has(/\.lcd-lyrics-panel\.lcd-editor-rolled \.lcd-lyrics-body \{ display: none; \}/) &&
  !/\.lcd-lyrics-body[^{]*\{[^}]*display:[^;}]*!important/.test(SRC));
check('...and Apply, which has nothing to apply while shut; All Slides and Delete stay',
  has(/\.lcd-lyrics-panel\.lcd-editor-rolled \.lcd-lyrics-actions \.lcd-mini-btn\.primary \{ display: none; \}/) &&
  !/lcd-editor-rolled[^{]*(#lcdAllSlidesBtn|\.danger)/.test(SRC));
check('it unrolls with a short animation, and none for reduced motion',
  has(/\.lcd-lyrics-panel:not\(\.lcd-editor-rolled\) \.lcd-lyrics-body \{ animation: lcdEditorUnroll/) &&
  has(/@media \(prefers-reduced-motion: reduce\) \{\r?\n\s*\.lcd-lyrics-panel \.lcd-lyrics-body \{ animation: none; \}/));

console.log('\nNothing else moves');
const size = fn('_lcdSizeWorkspaceColumns');
check('the row is sized from the editor OPEN, so rolling it moves nothing else',
  /if \(_rolled\) _lyrPanel\.classList\.remove\('lcd-editor-rolled'\);\r?\n\s*var _clip = _lyrBody\.scrollHeight - _lyrBody\.clientHeight;\r?\n\s*if \(_rolled\) _lyrPanel\.classList\.add\('lcd-editor-rolled'\);/.test(size), size.slice(0, 200));

console.log('\nThe Song Library tab in Fixed layout');
check('the "show the library" tab shows only while the library is shut',
  has(/body\.lcd-fixed-layout \.wo-main-content:not\(\.wo-song-order\)\.lcd-library-hidden #lcdLibReopen \{ display: flex; \}/) &&
  has(/body\.lcd-fixed-layout \.wo-main-content:not\(\.wo-song-order\):not\(\.lcd-library-hidden\) #lcdLibReopen \{ display: none; \}/));
check('...never beside an open library, where it took the schedule\'s column',
  !has(/body\.lcd-fixed-layout \.wo-main-content:not\(\.wo-song-order\) #lcdLibReopen \{ display: flex; \}/));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
