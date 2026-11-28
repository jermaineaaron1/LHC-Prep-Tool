'use strict';
// Regression harness: an item removed from a worship order STAYS removed.
//
// WHY THIS EXISTS
// `SBQ.saveOrder` is upsert-then-prune, and the prune refuses to delete a
// stored row whose whole item_type is missing from the payload. That guard is
// right -- a kind vanishing from a collection is the shape of a DOM that did
// not draw, not of an edit, and pruning on it destroys work nobody touched.
// The cost is that the ONLY thing which can authorise clearing a kind is the
// removal path saying so, and six of them did not.
//
// Measured on the live 29 Nov 2026 order, which carries exactly one `slides`
// row: removing its presentation produced a payload of 26 items with no
// `slides` and `allowClearTypes` of `{}`, so the row was kept and the deck was
// back on the next refresh. The same omission covered the last content box,
// the last video, the last reading, and -- through the rail's own trash button
// on a final slide -- the last song or liturgy of the order.
//
// So this checks two things that are easy to break again:
//   1. the rule itself (`SBQ._mayClearKind`), run, not matched;
//   2. that every removal path still names the kind it removed.
//
// It also pins the projected-text alignment default to LEFT, which has no
// other test and is one character to undo.
//
// HOW IT WORKS
// Real source text is sliced out of Index.html by brace balance and executed,
// so the code under test is the shipped code.
//
// USAGE
//   node tools/item-removal-persists-harness.js
//   node tools/item-removal-persists-harness.js path/to/file.html
//   node tools/item-removal-persists-harness.js <file> --expect-broken
//
// --expect-broken is the negative control: it asserts the fix is ABSENT, and is
// meant to be pointed at pre-fix source. A harness that passes on broken code
// proves nothing.
//
// Exit 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const src = fs.readFileSync(INDEX, 'utf8');
const lines = src.split('\n');

let failures = 0, passes = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passes++; console.log('  ok   ' + label); }
  else { failures++; console.log('  FAIL ' + label + '\n         got:  ' + JSON.stringify(got) + '\n         want: ' + JSON.stringify(want)); }
}
function section(t) { console.log('\n' + t); }
// "The fix is present". Under --expect-broken the SAME call asserts it is
// absent, so the negative control fails on fixed source instead of quietly
// agreeing with it -- which is the whole point of having one.
function fixPresent(label, got) {
  check((EXPECT_BROKEN ? 'ABSENT: ' : '') + label, !!got, !EXPECT_BROKEN);
}

// Slice a top-level `  function NAME(` out of an IIFE by brace balance.
function extractFn(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('function not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

// Slice an object METHOD written `  NAME: function(` by brace balance.
function extractMethod(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  ' + name + ':\\s*function\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('method not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) {
      // "  name: function(...) { ... }" -> "function(...) { ... }"
      return out.join('\n').replace(new RegExp('^\\s*' + name + ':\\s*'), '').replace(/,\s*$/, '');
    }
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

// ───────────────────────────────────────────────────────────────────────────
// 1. The prune rule, run.
// ───────────────────────────────────────────────────────────────────────────
section('1. SBQ._mayClearKind -- may a stored row of this kind be pruned?');

let mayClearKind = null;
try {
  // eslint-disable-next-line no-eval
  mayClearKind = eval('(' + extractMethod('_mayClearKind') + ')');
} catch (e) { mayClearKind = null; }
fixPresent('_mayClearKind is defined', mayClearKind);

// Running the rule proves nothing if the prune stops asking it. This is the
// one place in the file that decides whether a stored row lives.
fixPresent('the prune asks _mayClearKind, not its own inline test',
  /if \(!SBQ\._mayClearKind\(x\.item_type, _kindsInPayload, _mayClear, _clearAll\)\) \{/.test(src));

if (mayClearKind) {
  const SLIDES_ONLY = { slides: true };
  const MIXED = { song: true, liturgy: true };

  // The failure this harness exists for: the only deck is removed, so no
  // `slides` is in the payload, and nothing said the operator removed it.
  check('kind missing and nobody asked -> KEEP the stored row',
    mayClearKind('slides', MIXED, {}, false), false);

  // ...and with the removal noted, the row goes.
  check('kind missing and the removal was noted -> prune',
    mayClearKind('slides', MIXED, { slides: true }, false), true);

  // A kind still represented is not missing, so the guard never applies --
  // which is exactly why six paths could omit the note and look fine.
  check('kind still in the payload -> prune (one of several removed)',
    mayClearKind('slides', SLIDES_ONLY, {}, false), true);

  // allowEmptyItems is the stronger claim and has to win, or an order
  // deliberately emptied trips the guard for every kind at once.
  check('allowEmptyItems overrides every per-kind answer',
    mayClearKind('slides', {}, {}, true), true);

  // Shape robustness: the call sites pass objects, but a null must not throw
  // its way out of a save.
  check('null kindsInPayload and mayClear -> KEEP, no throw',
    mayClearKind('slides', null, null, false), false);
  check('null maps with allowEmptyItems -> prune',
    mayClearKind('slides', null, null, true), true);

  // Noting one kind must not authorise clearing another.
  check('a note for one kind does not clear a different kind',
    mayClearKind('video', {}, { slides: true }, false), false);
}

// ───────────────────────────────────────────────────────────────────────────
// 2. _woNoteRemoved, run.
// ───────────────────────────────────────────────────────────────────────────
section('2. _woNoteRemoved -- the one way the flag is set');

let noteFn = null;
try { noteFn = extractFn('_woNoteRemoved'); } catch (e) { noteFn = null; }

fixPresent('_woNoteRemoved is defined', noteFn);
if (noteFn) {
  const sandbox = { _woUserClearedTypes: {} };
  // eslint-disable-next-line no-new-func
  const run = new Function('ctx', 'var _woUserClearedTypes = ctx._woUserClearedTypes;\n' + noteFn +
    '\nreturn _woNoteRemoved;')(sandbox);
  run('slides');
  run('song');
  run('');            // nothing removed: must not create an empty key
  run(undefined);
  check('notes exactly the kinds it was given',
    Object.keys(sandbox._woUserClearedTypes).sort(), ['slides', 'song']);

  if (mayClearKind) {
    check('a noted kind is then prunable through the real rule',
      mayClearKind('song', {}, sandbox._woUserClearedTypes, false), true);
    check('an un-noted kind still is not',
      mayClearKind('content', {}, sandbox._woUserClearedTypes, false), false);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 3. The whole-group removal decides the kind from its own arguments, so it
//    can be run for real.
// ───────────────────────────────────────────────────────────────────────────
section('3. _lcdRemoveWholeGroup -- the last slide takes the item with it');

let groupFn = null;
try { groupFn = extractFn('_lcdRemoveWholeGroup'); } catch (e) { groupFn = null; }

if (!groupFn) {
  failures++; console.log('  FAIL _lcdRemoveWholeGroup not found');
} else if (!/_woNoteRemoved\(/.test(groupFn)) {
  fixPresent('_lcdRemoveWholeGroup notes the kind it removed', false);
} else {
  fixPresent('_lcdRemoveWholeGroup notes the kind it removed', true);
  function removedKind(isLiturgy, source) {
    const noted = {};
    // `container` resolves to null, so the function notes and returns at once.
    const box = { closest: () => null, remove: () => {} };
    // eslint-disable-next-line no-new-func
    const run = new Function('noted', 'box',
      'function _woNoteRemoved(t) { if (t) noted[t] = true; }\n' +
      'var songOrderSections = [];\n' + groupFn +
      '\nreturn _lcdRemoveWholeGroup;')(noted, box);
    run(box, 'sec', 'gid', isLiturgy, source);
    return Object.keys(noted);
  }
  check('a song group notes "song"', removedKind(false, ''), ['song']);
  check('a liturgy group notes "liturgy"', removedKind(true, ''), ['liturgy']);
  check('a reading group notes "scripture"', removedKind(false, 'scripture'), ['scripture']);
  // scripture wins over the liturgy flag: a reading is its own kind whatever
  // else the box claims to be.
  check('source=scripture beats isLiturgy', removedKind(true, 'scripture'), ['scripture']);
}

// ───────────────────────────────────────────────────────────────────────────
// 3b. A path that removed NOTHING must note nothing.
//
//     Found by probe, not by reading: calling _removePptNow for a section with
//     no deck in it still noted 'slides', which hands the prune permission to
//     clear a kind nobody touched -- the guard's own hazard, inverted. These
//     three are small enough to run, so they are run.
// ───────────────────────────────────────────────────────────────────────────
section('3b. a no-op removal notes nothing');

// Run a sliced function with stubs, and report which kinds it noted.
function notedBy(fnName, stubs, invoke) {
  let body;
  try { body = extractFn(fnName); } catch (e) { return { error: e.message }; }
  const noted = {};
  const names = Object.keys(stubs);
  const preamble = "function _woNoteRemoved(t) { if (t) noted[t] = true; }\n";
  // eslint-disable-next-line no-new-func
  const fn = new Function('noted', ...names,
    preamble + body + '\nreturn ' + fnName + ';')(noted, ...names.map(k => stubs[k]));
  invoke(fn);
  return Object.keys(noted);
}

const NOOP = () => {};
const pptStubs = (store) => ({
  currentSermonSlides: store,
  _lcdPushUndo: NOOP,
  removeSlideContainer: NOOP,
  _lcdRenderCompactRail: NOOP,
  autoSaveOrder: NOOP,
  showToast: NOOP,
  document: { querySelector: () => null, querySelectorAll: () => [] }
});

check('_removePptNow on a section with no deck notes nothing',
  notedBy('_removePptNow', pptStubs({}), f => f('wo-section-doc9', null, true)), []);
fixPresent('_removePptNow on a section that has one notes slides',
  notedBy('_removePptNow', pptStubs({ 'wo-section-doc25': { slides: [1, 2], fileName: 'deck.pptx' } }),
    f => f('wo-section-doc25', null, true)).join() === 'slides');

check('deleteContent with no box around the button notes nothing',
  notedBy('deleteContent', { _lcdPushUndo: NOOP, autoSaveOrder: NOOP },
    f => f({ closest: () => null })), []);
fixPresent('deleteContent with a box notes content',
  notedBy('deleteContent', { _lcdPushUndo: NOOP, autoSaveOrder: NOOP },
    f => f({ closest: () => ({ remove: NOOP }) })).join() === 'content');

const vidStubs = (hasVideo) => ({
  $: () => ({
    querySelector: sel => (sel === '.wo-video-container' && hasVideo) ? { remove: NOOP } : null,
    innerHTML: ''
  }),
  autoSaveOrder: NOOP,
  showToast: NOOP
});
check('removeVideo on a section with no video notes nothing',
  notedBy('removeVideo', vidStubs(false), f => f('sec')), []);
fixPresent('removeVideo on a section with one notes video',
  notedBy('removeVideo', vidStubs(true), f => f('sec')).join() === 'video');

// ───────────────────────────────────────────────────────────────────────────
// 4. Every removal path still names its kind, and names the RIGHT one. Two of
//    these touch too much DOM to run; all five are checked on their real
//    sliced source -- the whole body of the named function, not a grep.
// ───────────────────────────────────────────────────────────────────────────
section('4. every removal path names the kind it removed');

const PATHS = [
  ['_removePptNow',           'slides',    'the whole presentation'],
  ['removeSlideContainer',    'slides',    'an iframe presentation, by its own button'],
  ['deleteContent',           'content',   'a content box'],
  ['removeVideo',             'video',     'a video'],
  ['removeScriptureKeepSlot', 'scripture', 'a reading, slot kept']
];

PATHS.forEach(([fn, kind, what]) => {
  let body = null;
  try { body = extractFn(fn); } catch (e) { failures++; console.log('  FAIL ' + fn + ' not found'); return; }
  fixPresent(fn + ' notes ' + kind + ' (' + what + ')',
    body.indexOf("_woNoteRemoved('" + kind + "')") >= 0);
});

// Three of them wrote nothing at all, so the removal was not even attempted
// until some other edit happened to save. autoSaveOrder is debounced, so a
// second caller saving as well costs nothing.
section('5. the paths that saved nothing now save');
[['removeSlideContainer', 'an iframe presentation'],
 ['removeVideo', 'a video'],
 ['removeScriptureKeepSlot', 'a reading']].forEach(([fn, what]) => {
  let body = null;
  try { body = extractFn(fn); } catch (e) { failures++; console.log('  FAIL ' + fn + ' not found'); return; }
  fixPresent(fn + ' saves after removing ' + what, /autoSaveOrder\(\)/.test(body));
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Projected text starts LEFT.
// ───────────────────────────────────────────────────────────────────────────
section('6. the projected words are left-aligned by default');

const ALIGN = [
  ["the setting itself", /var _currentSlideAlign = 'left';/],
  ["the Program preview's fallback", /contentEl\.style\.textAlign = data\.align \|\| 'left';/],
  ["the projector document's stylesheet",
    /\.projection-text \{[^']*text-align: left; \}/],
  ["the projector's last-resort fallback",
    /text-align:" \+ \(data\.align \|\| window\._projAlign \|\| "left"\)/],
  ["the presenter overlay's stylesheet",
    /\.wo-fullscreen-content \{ position: relative; z-index: 1; text-align: left;/],
  ["Align left starts pressed",
    /<button class="wo-align-btn active" id="woAlignLeft"/],
  ["Align centre does not",
    /<button class="wo-align-btn" id="woAlignCenter"/]
];

ALIGN.forEach(([label, re]) => fixPresent(label, re.test(src)));

// Nothing may quietly reintroduce a centre default for the projection text.
fixPresent('no "|| \'center\'" left on an align fallback',
  !/align \|\| ['"]center['"]/.test(src));

console.log('\n' + (failures ? 'FAILED' : 'PASSED') + ': ' + passes + ' check(s) passed, ' + failures + ' failed.');
process.exit(failures ? 1 : 0);
