'use strict';
// Regression harness for the per-slide background re-pinning in LCD Projection.
//
// WHY THIS EXISTS
// `orders.template.sectionBackgrounds` is keyed by section id then by *local
// slide index*. Because the key is positional, any insert, delete or reorder
// renumbers every slide after the change point, and a path that mutates slides
// without re-pinning silently moves backgrounds onto the wrong slides. That is
// a data bug you cannot see on screen -- the DOM still looks right -- so it
// needs a test rather than an eyeball.
//
// HOW IT WORKS
// It does not reimplement the functions. It slices their REAL source text out
// of Index.html by brace balance and executes that text against tools/minidom.js
// with the module-level dependencies stubbed. So the code under test is the
// shipped code; if someone edits these functions, this runs the edited version.
//
// USAGE
//   node tools/bg-repin-harness.js                  # checks ../Index.html
//   node tools/bg-repin-harness.js path/to/file.html
//   node tools/bg-repin-harness.js <file> --expect-broken
//
// --expect-broken is the negative control: it asserts the fix is ABSENT and is
// meant to be pointed at pre-fix source (e.g. `git show <rev>:Index.html > x`).
// A harness that passes on broken code proves nothing, so if you extend this,
// keep checking that it still fails without the fix.
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

// Slice a top-level `  function NAME(` out of the WO IIFE by brace balance.
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

const NAMES = ['_lcdCaptureSectionBgs', '_lcdRestoreSectionBgs',
               'removeLiturgyFromSection', 'removeSongFromSection'];
const fns = {};
for (const n of NAMES) fns[n] = extractFn(n);

console.log('Extracted from ' + path.basename(INDEX) + ':');
for (const n of NAMES) console.log('  ' + n + ' @ line ' + fns[n].line);

for (const n of ['removeLiturgyFromSection', 'removeSongFromSection']) {
  const t = fns[n].text;
  for (const need of ['_lcdPushUndo()', '_lcdCaptureSectionBgs(', '_lcdRestoreSectionBgs(']) {
    const has = t.includes(need);
    if (!EXPECT_BROKEN && !has) throw new Error(n + ' is missing ' + need);
    if (EXPECT_BROKEN && has) throw new Error(n + ' unexpectedly already has ' + need);
  }
}
console.log(EXPECT_BROKEN
  ? '  (confirmed pre-fix: neither remove path has PushUndo/Capture/Restore)\n'
  : '  (both remove paths contain PushUndo + Capture + Restore)\n');

// Sandbox the extracted source runs inside. Every module-level dependency the
// functions reach for is stubbed here; add to this list if the functions grow.
function makeEnv() {
  const doc = makeDocument();
  const env = {
    document: doc,
    Array, Object, JSON, console,
    sectionBackgrounds: {},
    serviceSectionSongs: {},
    currentOrderData: { clearedSections: [] },
    undoPushes: 0,
    saves: 0,
    toasts: [],
    $: id => doc.getElementById(id),
    showToast: (m) => env.toasts.push(m),
    autoSaveOrder: () => { env.saves++; },
    saveSlideBackgrounds: () => { env.saves++; },
    _lcdPushUndo: () => { env.undoPushes++; },
    getBackgroundForSlideInSection: (sid, i) => {
      const m = env.sectionBackgrounds[sid];
      return m && m[i] ? m[i] : null;
    },
    event: { stopPropagation() {} }
  };
  const body = NAMES.map(n => fns[n].text).join('\n\n') +
    '\n; return { removeLiturgyFromSection, removeSongFromSection,' +
    ' _lcdCaptureSectionBgs, _lcdRestoreSectionBgs };';
  const keys = Object.keys(env);
  const api = new Function(...keys, body)(...keys.map(k => env[k]));
  return { env, api };
}

// Build one section containing the given groups, in order.
function buildSection(env, sectionId, groups) {
  const c = new El('div', 'wo-content-boxes', { id: sectionId + '-boxes' });
  env.document.root.appendChild(c);
  groups.forEach(g => {
    const idAttr = g.kind === 'liturgy' ? 'data-liturgy-id' : 'data-song-id';
    const bannerCls = g.kind === 'liturgy' ? 'wo-liturgy-banner-bar' : 'wo-song-banner';
    const banner = new El('div', bannerCls, { [idAttr]: g.id });
    c.appendChild(banner);
    g.banner = banner;
    for (let i = 0; i < g.slides; i++) {
      c.appendChild(new El('div', 'wo-slide-box' + (g.kind === 'liturgy' ? ' wo-liturgy-slide' : ''),
        { [idAttr]: g.id, 'data-section': sectionId }));
    }
    c.appendChild(new El('div', 'wo-add-slide-row', { [idAttr]: g.id }));
  });
  return c;
}

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label);
  if (!ok) console.log('          expected ' + e + '\n          actual   ' + a);
}

// 1 - the originally reported reproduction
console.log('Scenario 1 - remove the last liturgy item (owns slide index 5)');
{
  const { env, api } = makeEnv();
  const SID = 'sec1';
  const groups = [
    { kind: 'liturgy', id: 'litA', slides: 3 },
    { kind: 'liturgy', id: 'litB', slides: 2 },
    { kind: 'liturgy', id: 'litC', slides: 1 }
  ];
  const c = buildSection(env, SID, groups);
  env.sectionBackgrounds[SID] = { 2: 'bg-two.jpg', 5: 'bg-five.jpg' };

  check('precondition: 6 slides', c.querySelectorAll('.wo-slide-box').length, 6);
  api.removeLiturgyFromSection(groups[2].banner, SID, 'litC');
  check('5 slides remain', c.querySelectorAll('.wo-slide-box').length, 5);
  check('bg map re-pinned to {2}', env.sectionBackgrounds[SID], { 2: 'bg-two.jpg' });
  check('stale #5 entry gone', Object.keys(env.sectionBackgrounds[SID] || {}), ['2']);
  check('_lcdPushUndo called once', env.undoPushes, 1);
}

// 2 - middle removal shifts later slides down
console.log('\nScenario 2 - remove a middle liturgy group (indices shift down)');
{
  const { env, api } = makeEnv();
  const SID = 'sec2';
  const groups = [
    { kind: 'liturgy', id: 'litA', slides: 3 },
    { kind: 'liturgy', id: 'litB', slides: 2 },
    { kind: 'liturgy', id: 'litC', slides: 1 }
  ];
  const c = buildSection(env, SID, groups);
  env.sectionBackgrounds[SID] = { 2: 'bg-two.jpg', 5: 'bg-five.jpg' };

  api.removeLiturgyFromSection(groups[1].banner, SID, 'litB');
  check('4 slides remain', c.querySelectorAll('.wo-slide-box').length, 4);
  check('bg follows its slide 5->3', env.sectionBackgrounds[SID], { 2: 'bg-two.jpg', 3: 'bg-five.jpg' });
  check('_lcdPushUndo called once', env.undoPushes, 1);
}

// 3 - the song path has its own copy of this logic
console.log('\nScenario 3 - remove a middle SONG group (indices shift down)');
{
  const { env, api } = makeEnv();
  const SID = 'sec3';
  const groups = [
    { kind: 'song', id: 'songA', slides: 3 },
    { kind: 'song', id: 'songB', slides: 2 },
    { kind: 'song', id: 'songC', slides: 1 }
  ];
  const c = buildSection(env, SID, groups);
  env.sectionBackgrounds[SID] = { 2: 'bg-two.jpg', 5: 'bg-five.jpg' };
  env.serviceSectionSongs[SID] = [{ id: 'songA' }, { id: 'songB' }, { id: 'songC' }];

  api.removeSongFromSection(groups[1].banner, SID, 'songB');
  check('4 slides remain', c.querySelectorAll('.wo-slide-box').length, 4);
  check('bg follows its slide 5->3', env.sectionBackgrounds[SID], { 2: 'bg-two.jpg', 3: 'bg-five.jpg' });
  check('_lcdPushUndo called once', env.undoPushes, 1);
  check('song dropped from serviceSectionSongs',
    env.serviceSectionSongs[SID].map(s => s.id), ['songA', 'songC']);
}

// 4 - emptying a section must clear the key, not leave an empty object
console.log('\nScenario 4 - remove the only group (section empties, map cleared)');
{
  const { env, api } = makeEnv();
  const SID = 'sec4';
  const groups = [{ kind: 'liturgy', id: 'litOnly', slides: 3 }];
  const c = buildSection(env, SID, groups);
  env.sectionBackgrounds[SID] = { 0: 'a.jpg', 2: 'c.jpg' };

  api.removeLiturgyFromSection(groups[0].banner, SID, 'litOnly');
  check('0 slides remain', c.querySelectorAll('.wo-slide-box').length, 0);
  check('section key deleted entirely', env.sectionBackgrounds[SID], undefined);
  check('placeholder box restored', c.querySelectorAll('.wo-content-box').length, 1);
  check('clearedSections recorded', env.currentOrderData.clearedSections.length, 1);
}

// 5 - a section with no pins must not gain one
console.log('\nScenario 5 - section with no backgrounds stays absent from the map');
{
  const { env, api } = makeEnv();
  const SID = 'sec5';
  const groups = [
    { kind: 'liturgy', id: 'litA', slides: 2 },
    { kind: 'liturgy', id: 'litB', slides: 2 }
  ];
  buildSection(env, SID, groups);

  api.removeLiturgyFromSection(groups[0].banner, SID, 'litA');
  check('no section key created', Object.keys(env.sectionBackgrounds), []);
  check('_lcdPushUndo still called', env.undoPushes, 1);
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
if (passed !== results.length) process.exit(1);
