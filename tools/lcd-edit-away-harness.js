'use strict';
// Harness for the LCD Projection slide editor: words held until saved, and a
// click away that shuts the pad -- or asks first.
//
// WHY THIS EXISTS
// From the operator (2026-11-05): a double-click opens the Slide Editor's
// pad (#383); a single click anywhere else should close it, unless
// something was changed, in which case ask to save first. The pad used to
// apply itself half a second after typing stopped, so "unsaved" never
// lasted -- and half-typed lines reached the screen mid-service. Now:
//   - typing changes the pad alone; Apply, or Save in the question, puts
//     the words on the slide, the projector and the order;
//   - a click away with nothing changed shuts the pad, and the click goes
//     on to do what it was for;
//   - a click away with something changed asks Save / Discard / Keep
//     editing, and the click that asked is swallowed -- but never a click
//     in the question itself;
//   - a click inside anything floating (the Text, Background and Barrier
//     dialogs, menus, toasts) or on a scrollbar is not away.
//
// USAGE
//   node tools/lcd-edit-away-harness.js                 # ../Index.html
//   node tools/lcd-edit-away-harness.js path/to/file.html
//   node tools/lcd-edit-away-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 28a37d3:Index.html > x`).
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

console.log('Typing is held until it is saved');
const input = fn('lcdOnLyricsTextareaInput');
check('a keystroke marks the pad changed, and commits nothing',
  /_lcdEditDirty = true;\r?\n\s*_lcdDraftPaint\(\);/.test(input) && !/_lcdAutoApplyTimer = setTimeout/.test(input) && !/_lcdCommitEditorToSlide/.test(input), input.slice(0, 300));
check('...and leaving the pad (a toolbar press is a blur) does not save it either',
  !has(/onblur="WO\.lcdFlushAutoApply\(\)"/) && has(/ onkeydown="WO\.lcdEditorKeydown\(event\)"><\/div>/));
check('a path that does not ask still saves what was typed, as one Undo step',
  /if \(_lcdEditDirty\) \{ _lcdEditDirty = false; _lcdPushUndo\(\); _lcdCommitEditorToSlide\(\); \}/.test(fn('_lcdFlushAutoApply')));
check('the panel says "Unsaved" while it holds words, and rings Apply',
  has(/\.lcd-lyrics-panel\.lcd-draft-dirty #lcdLyricsEditorTitle::after \{\r?\n\s*content: "Unsaved";/) &&
  /panel\.classList\.toggle\('lcd-draft-dirty', !!\(_lcdEditorUnlocked && _lcdEditDirty\)\)/.test(fn('_lcdDraftPaint')));

console.log('\nA click away');
const awaySrc = fn('_lcdClickIsAway');
if (awaySrc) {
  const doc = { documentElement: { tag: 'html' }, body: { tag: 'body' } };
  const away = new Function('document', 'getComputedStyle', awaySrc + '\nreturn _lcdClickIsAway;')(doc, el => ({ position: el.pos || 'static' }));
  const el = (o) => Object.assign({ closest: sel => (o.inside && sel.indexOf(o.inside) > -1) ? {} : null, clientWidth: 200, clientHeight: 100, parentElement: doc.body }, o);
  check('a click on a slide in the list, the projection or the header is away', away({ target: el({}), offsetX: 20, offsetY: 10 }) === true);
  check('...one in the Slide Editor itself, or in the question, is not',
    away({ target: el({ inside: '.lcd-lyrics-panel' }), offsetX: 20, offsetY: 10 }) === false && away({ target: el({ inside: '#lcdDraftAsk' }), offsetX: 20, offsetY: 10 }) === false);
  const floating = el({ pos: 'fixed' }), inModal = el({ parentElement: floating });
  check('...nor one in anything floating over the page: the Text, Background and Barrier dialogs, a menu, a toast',
    away({ target: inModal, offsetX: 20, offsetY: 10 }) === false);
  check('...nor a press on a scrollbar', away({ target: el({}), offsetX: 205, offsetY: 10 }) === false && away({ target: el({}), offsetX: 20, offsetY: 104 }) === false);
} else check('the "is this away?" rule is a function of its own', false);
const down = fn('_lcdOnAwayMouseDown');
check('with nothing changed it shuts the pad, and the click carries on',
  /if \(_lcdEditDirty\) \{[^]*?return;\r?\n\s*\}\r?\n\s*lcdLockEditor\(\);/.test(down) && /if \(!_lcdEditorUnlocked \|\| e\.button !== 0\) return;/.test(down));
check('with something changed it asks, and holds back the click that asked',
  /e\.preventDefault\(\); e\.stopPropagation\(\);\r?\n\s*_lcdSwallowUntil = Date\.now\(\) \+ 1000;\r?\n\s*_lcdAskDraft\(null\);/.test(down) &&
  has(/document\.addEventListener\('mousedown', _lcdOnAwayMouseDown, true\);\r?\n\s*document\.addEventListener\('click', _lcdOnAwayClick, true\);/));
const clickSrc = fn('_lcdOnAwayClick');
if (clickSrc) {
  const C = new Function('var _lcdSwallowUntil = 0;\n' + clickSrc + '\nreturn { click: _lcdOnAwayClick, set: v => { _lcdSwallowUntil = v; } };')();
  const ev = inQuestion => { const e = { stopped: false, target: { closest: s => inQuestion && s.indexOf('#lcdDraftAsk') > -1 ? {} : null } }; e.preventDefault = () => {}; e.stopPropagation = () => { e.stopped = true; }; return e; };
  C.set(Date.now() + 1000); const stray = ev(false); C.click(stray); const next = ev(false); C.click(next);
  check('...the stray click is swallowed once, and the next one is not', stray.stopped && !next.stopped);
  C.set(Date.now() + 1000); const save = ev(true); C.click(save); const after = ev(false); C.click(after);
  check('...and a click in the question is an answer, never swallowed, even straight after', !save.stopped && !after.stopped);
} else check('the click that asked is swallowed by a function of its own', false);

console.log('\nThe question');
const ask = fn('_lcdAskDraft');
check('Save your changes to this slide? -- Save, Discard, Keep editing',
  /Save your changes to this slide\?/.test(ask) && /lcd-ask__save/.test(ask) && /lcd-ask__discard/.test(ask) && /lcd-ask__keep/.test(ask));
check('...Save applies and shuts the pad; Discard puts the slide\'s own words back; Esc keeps editing',
  /if \(choice === 'save'\) \{ _lcdApplySlideEdit\(\); lcdLockEditor\(\); \}/.test(ask) &&
  /else if \(choice === 'discard'\) \{ _lcdDiscardDraft\(\);/.test(ask) && /if \(e\.key === 'Escape'\) \{[^}]*done\('keep'\);/.test(ask) &&
  /_lcdCancelAutoApply\(\);\r?\n\s*var box = _lcdRelocateActiveSlideBox\(\);\r?\n\s*if \(box\) _lcdLoadSlideIntoEditor\(box\);/.test(fn('_lcdDiscardDraft')));
check('Preview shuts the pad too, so it asks the same question',
  /if \(mode === 'preview' && _lcdEditorUnlocked && _lcdEditDirty\) \{ _lcdAskDraft\(function\(\) \{ lcdSetEditorMode\('preview'\); \}\); return; \}/.test(fn('lcdSetEditorMode')));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
