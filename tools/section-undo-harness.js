'use strict';
// Regression harness for the Undo offered after removing a service section.
//
// WHY THIS EXISTS
// Removing a section is destructive and the toast offers Undo. For some time
// that Undo did nothing at all: it called initializeServiceOrder(), which
// rebuilds the service order from the saved state -- and the removal had
// already been saved two lines earlier by autoSaveOrder(). So it rebuilt from
// a state with the section gone, restored nothing, and said "Restored"
// regardless. Measured in the app: 19 sections, remove two, press Undo, reload
// from the backend, 17.
//
// A button that claims to have saved you and has not is worse than no button,
// and the failure is invisible from the screen for four seconds. So it needs a
// test that actually presses Undo and looks at what came back.
//
// HOW IT WORKS
// It slices the REAL removeSection out of Index.html and runs it against
// tools/minidom.js with the module-level dependencies stubbed, capturing the
// toast's onAction the way the toast itself would, then calling it.
//
// USAGE
//   node tools/section-undo-harness.js                 # checks ../Index.html
//   node tools/section-undo-harness.js path/to/file.html
//   node tools/section-undo-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show 53b2854:Index.html > x`).
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');
const { El, makeDocument } = require('./minidom.js');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const lines = fs.readFileSync(INDEX, 'utf8').split('\n');

function extractFn(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('function not found in ' + path.basename(INDEX) + ': ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

const removeSection = extractFn('removeSection');
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  removeSection @ line ' + removeSection.line + '\n');

function build() {
  const doc = makeDocument();
  // Three sections, the middle one carrying slides, so position and content
  // both have to come back.
  const ids = ['wo-section-0', 'wo-section-1', 'wo-section-2'];
  ids.forEach(id => {
    const sec = new El('div', 'wo-worship-section', { id: id });
    const title = new El('div', 'wo-section-badge-title');
    title.textContent = id;
    sec.appendChild(title);
    if (id === 'wo-section-1') {
      for (let i = 0; i < 4; i++) sec.appendChild(new El('div', 'wo-slide-box', { 'data-section': id }));
    }
    doc.root.appendChild(sec);
  });

  const env = {
    document: doc,
    Array, Object, JSON, console,
    $: id => doc.getElementById(id),
    serviceSectionSongs: { 'wo-section-1': [{ id: 'songA' }, { id: 'songB' }] },
    sectionBackgrounds: { 'wo-section-1': { 0: 'bg-one.jpg' } },
    currentOrderData: { sectionLayout: [] },
    saves: 0,
    layoutCaptures: 0,
    railRenders: 0,
    toasts: [],
    autoSaveOrder: () => { env.saves++; },
    updateSectionNumbers: () => {},
    _captureCurrentLayout: () => { env.layoutCaptures++; },
    _lcdRenderCompactRail: () => { env.railRenders++; },
    // The pre-fix version calls this instead of restoring anything.
    initializeServiceOrder: () => { env.reinits = (env.reinits || 0) + 1; },
    showToast: (msg, type, opts) => { env.toasts.push({ msg, type, opts }); }
  };
  const keys = Object.keys(env);
  const api = new Function(...keys, removeSection.text + '\n; return { removeSection };')(...keys.map(k => env[k]));
  return { doc, env, api, ids };
}

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label);
  if (!ok) console.log('          expected ' + e + '\n          actual   ' + a);
}

const sectionIds = doc => doc.root.children
  .filter(c => c.classList.contains('wo-worship-section')).map(c => c.id);

// 1 - removing takes it out
console.log('Scenario 1 - removing a section takes it out');
{
  const { doc, env, api } = build();
  check('three sections to begin with', sectionIds(doc).length, 3);
  api.removeSection('wo-section-1');
  check('the middle one is gone', sectionIds(doc), ['wo-section-0', 'wo-section-2']);
  check('its songs are gone too', env.serviceSectionSongs['wo-section-1'], undefined);
  check('the removal was saved', env.saves, 1);
  check('an Undo was offered', env.toasts[0].opts && env.toasts[0].opts.action, 'Undo');
}

// 2 - the reported bug: pressing Undo
console.log('\nScenario 2 - pressing Undo puts it back where it was');
{
  const { doc, env, api } = build();
  api.removeSection('wo-section-1');
  const undo = env.toasts[0].opts.onAction;
  undo();

  if (EXPECT_BROKEN) {
    check('(pre-fix) the section did NOT come back', sectionIds(doc), ['wo-section-0', 'wo-section-2']);
    check('(pre-fix) it re-initialised instead', env.reinits, 1);
    check('(pre-fix) and claimed success anyway',
      /restored/i.test(env.toasts[env.toasts.length - 1].msg), true);
  } else {
    check('the section is back', sectionIds(doc).indexOf('wo-section-1') >= 0, true);
    check('in its original position', sectionIds(doc), ['wo-section-0', 'wo-section-1', 'wo-section-2']);
    check('with its slides', doc.getElementById('wo-section-1').querySelectorAll('.wo-slide-box').length, 4);
    check('its songs came back', (env.serviceSectionSongs['wo-section-1'] || []).map(s => s.id), ['songA', 'songB']);
    check('its backgrounds came back', env.sectionBackgrounds['wo-section-1'], { 0: 'bg-one.jpg' });
    check('the restore was saved too', env.saves, 2);
    check('the rail was told, both ways', env.railRenders, 2);
    check('and it says so', /restored/i.test(env.toasts[env.toasts.length - 1].msg), true);
  }
}

// 3 - not pressing Undo leaves it removed
console.log('\nScenario 3 - not pressing Undo leaves it removed');
{
  const { doc, env, api } = build();
  api.removeSection('wo-section-2');
  check('still gone when nobody presses anything', sectionIds(doc), ['wo-section-0', 'wo-section-1']);
  check('and only the removal was saved', env.saves, 1);
}

// 4 - each Undo is bound to its own section
console.log('\nScenario 4 - two removals, only the second undone');
{
  const { doc, env, api } = build();
  api.removeSection('wo-section-0');
  api.removeSection('wo-section-2');
  const secondUndo = env.toasts[1].opts.onAction;
  secondUndo();
  if (EXPECT_BROKEN) {
    check('(pre-fix) neither came back', sectionIds(doc), ['wo-section-1']);
  } else {
    check('the first stays gone, the second returns', sectionIds(doc), ['wo-section-1', 'wo-section-2']);
  }
}

// 5 - pressing Undo twice must not duplicate the section
console.log('\nScenario 5 - a second press changes nothing');
{
  const { doc, env, api } = build();
  api.removeSection('wo-section-1');
  const undo = env.toasts[0].opts.onAction;
  undo();
  const after1 = sectionIds(doc).slice();
  undo();
  if (EXPECT_BROKEN) {
    check('(pre-fix) nothing came back either time', sectionIds(doc).length, 2);
  } else {
    check('the same three sections, not four', sectionIds(doc), after1);
    check('no duplicate', sectionIds(doc).filter(x => x === 'wo-section-1').length, 1);
  }
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
