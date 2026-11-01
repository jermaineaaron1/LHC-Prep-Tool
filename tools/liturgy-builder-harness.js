'use strict';
// Harness for the order of worship as data: the Liturgy Builder and what it
// shares with the other views.
//
// WHY THIS EXISTS
// The Liturgy Builder edits an order without the LCD schedule on screen, and
// everything it writes reaches the projection only by surviving a save made
// from outside that schedule and a rebuild of it afterwards. Three things
// along that road were quietly wrong before the builder existed:
//
//   * a reading was rebuilt from its own joined text every time the LCD
//     schedule was drawn, so it gained a response slide per load -- one
//     stored Gospel had twenty-six;
//   * a text box saved from outside the schedule got an id from its position,
//     so the next save wrote it twice;
//   * every view decided for itself which section a song belonged to, and
//     two of them listed one song under two sections of the same kind.
//
// Each is checked here against the shipped functions, sliced out of
// Index.html by brace balance and run with their dependencies stubbed.
//
// USAGE
//   node tools/liturgy-builder-harness.js
//   node tools/liturgy-builder-harness.js path/to/file.html
//   node tools/liturgy-builder-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix.
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');
const { makeDocument } = require('./minidom.js');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');

function extractFn(name, optional) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) {
    if (optional) return null;
    throw new Error('function not found in ' + path.basename(INDEX) + ': ' + name);
  }
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

// A one-line `var NAME = ...;` inside the module.
function extractVar(name, optional) {
  const l = lines.find(x => new RegExp('^  var ' + name + '\\s*=').test(x));
  if (!l) {
    if (optional) return null;
    throw new Error('var not found in ' + path.basename(INDEX) + ': ' + name);
  }
  return l;
}

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

function escapeHtml(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// The helpers under test, evaluated together in one scope. `exportsExtra`
// names more of that scope to hand back -- a setter for module state.
// ---------------------------------------------------------------------------
function buildModule(fnTexts, prelude, exportsExtra) {
  const names = fnTexts.map(t => (/function\s+([A-Za-z0-9_$]+)/.exec(t) || [])[1]).filter(Boolean)
    .concat(exportsExtra || []);
  return (prelude || '') + '\n' + fnTexts.join('\n') + '\n' +
    'return {' + names.map(n => n + ':' + n).join(',') + '};';
}

const ORDER_STRUCTURES = {
  traditional: [
    { title: '1. Invocation', serviceSectionId: 'welcome' },
    { title: '2. Confession', serviceSectionId: 'opening-prayer' },
    { title: '3. Entrance Hymn', serviceSectionId: 'preparation' },
    { title: '4. Prayer of the Day', serviceSectionId: 'opening-prayer' },
    { title: '5. Scripture Readings', type: 'group', subsections: ['First Reading', 'Psalm Reading', 'Second Reading', 'Gospel Reading'], serviceSectionId: 'scripture' }
  ]
};

let sectionTools = null;
try {
  const fns = ['_woStripNum', '_woSectionList', '_woSongSectionIds', '_woSectionItems', '_woUniqueItems', '_woDedupeItems', '_woSSIFromItems']
    .map(n => extractFn(n));
  const fnText = buildModule(fns,
    'var orderStructures = ctx.orderStructures; var currentOrderType = "traditional";' +
    'var currentOrderData = null; function __set(o) { currentOrderData = o; }', ['__set']);
  sectionTools = new Function('ctx', fnText)({ orderStructures: ORDER_STRUCTURES });
} catch (e) {
  sectionTools = null;
  console.log('  (section helpers not present: ' + e.message.split('\n')[0] + ')');
}

console.log('\nSections and songs');
if (!sectionTools) {
  check('the shared section helpers exist', false, 'no _woSectionList / _woSongSectionIds in this source');
} else {
  const T = sectionTools;
  // Template order, no layout yet.
  T.__set({ sectionLayout: [] });
  const tplList = T._woSectionList();
  check('with no layout the template supplies the sections, ordinals stripped',
    tplList.length === 5 && tplList[0].id === 'wo-section-0' && tplList[0].title === 'Invocation',
    JSON.stringify(tplList[0]));

  // A layout that renamed, moved, removed and added sections.
  T.__set({ sectionLayout: [
    { id: 'wo-section-0', title: '1. Invocation', serviceSectionId: 'welcome' },
    { id: 'wo-section-3', title: 'Prayer of the Day', serviceSectionId: 'opening-prayer' },
    { id: 'wo-section-1', title: 'Confession', serviceSectionId: 'opening-prayer', notes: 'Kneel' },
    { id: 'wo-section-1790000000000', title: 'Baptism', serviceSectionId: '' }
  ] });
  const list = T._woSectionList();
  check('the layout is the section list, in its own order',
    list.map(s => s.id).join(',') === 'wo-section-0,wo-section-3,wo-section-1,wo-section-1790000000000');
  check('a section keeps its notes', list[2].notes === 'Kneel');

  const ids = (song) => T._woSongSectionIds(song, list).join(',');
  check('a song stored against a section id is in exactly that section',
    ids({ serviceSections: ['wo-section-1'] }) === 'wo-section-1');
  check('two sections of one kind do not both claim a song placed in one of them',
    ids({ serviceSections: ['wo-section-3'] }) === 'wo-section-3');
  check('a bare section kind goes to the FIRST section of that kind (as the LCD places it)',
    ids({ serviceSections: ['opening-prayer'] }) === 'wo-section-3');
  check('an id for a section no longer in the order places the song nowhere',
    ids({ serviceSections: ['wo-section-2'] }) === '');
  check('a song with no list falls back to its sectionId',
    ids({ serviceSections: [], sectionId: 'wo-section-1790000000000' }) === 'wo-section-1790000000000');
  check('a song in two sections is in both, in its own order',
    ids({ serviceSections: ['wo-section-1790000000000', 'wo-section-0'] }) === 'wo-section-1790000000000,wo-section-0');
  check('a blank page is in no section', ids({ itemType: 'blank', sectionId: 'wo-section-0' }) === '');

  // Items: each once, liturgy once per source.
  T.__set({ sectionLayout: [], allItems: [
    { id: 'a', itemType: 'liturgy', sectionId: 's1', sourceId: 'L1' },
    { id: 'b', itemType: 'liturgy', sectionId: 's1', sourceId: 'L1' },
    { id: 'a', itemType: 'liturgy', sectionId: 's1', sourceId: 'L1' },
    { id: 'c', itemType: 'scripture', sectionId: 's1' },
    { id: 'd', itemType: 'song', sectionId: 's1' },
    { id: 'e', itemType: 'liturgy', sectionId: 's2', sourceId: 'L1' }
  ] });
  check('a section lists each item once and no songs',
    T._woSectionItems('s1').map(i => i.id).join(',') === 'a,c');
  const ord = { allItems: [
    { id: 'a', itemType: 'liturgy', sectionId: 's1', sourceId: 'L1' },
    { id: 'b', itemType: 'liturgy', sectionId: 's1', sourceId: 'L1' },
    { id: 'a', itemType: 'liturgy', sectionId: 's1', sourceId: 'L1' },
    { id: 'e', itemType: 'liturgy', sectionId: 's2', sourceId: 'L1' }
  ] };
  T.__set(ord);
  T._woDedupeItems();
  check('deduplication keeps the first of each, as the save does',
    ord.allItems.map(i => i.id).join(',') === 'a,e');

  const ssi = T._woSSIFromItems([
    { id: 'x', itemType: 'scripture', sectionId: 's9', title: 'John 3:16', content: { subLabel: 'Gospel' }, slides: [{ content: 'For God so loved' }] },
    { id: 'y', itemType: 'content', sectionId: 's9', content: { text: 'Please stand' } }
  ]);
  check('serviceSectionItems carries a reading with its slot',
    ssi.s9 && ssi.s9[0].type === 'scripture' && ssi.s9[0].subLabel === 'Gospel');
  check('serviceSectionItems carries a text box under its own id',
    ssi.s9 && ssi.s9[1].type === 'content' && ssi.s9[1].id === 'y');
}

// ---------------------------------------------------------------------------
// A text box saved from outside the LCD schedule keeps its id
// ---------------------------------------------------------------------------
console.log('\nSaving away from the schedule');
(function() {
  const collectSrc = extractFn('collectOrderItems');
  let uniqueSrc = '';
  try { uniqueSrc = extractFn('_woUniqueItems'); } catch (e) { uniqueSrc = 'function _woUniqueItems(l) { return l; }'; }
  const box = { id: 'o1__content_s1_7', type: 'content', sectionId: 's1', text: 'Please be seated' };
  function collect(ssiList) {
    const ctx = {
      document: makeDocument(),
      window: { serviceSectionItems: { 's1': ssiList } },
      currentOrderData: { id: 'o1', allItems: [{ id: 'o1__content_s1_7', itemType: 'content', sectionId: 's1', content: { text: 'Please be seated' } }] }
    };
    const fn = new Function('document', 'window', 'currentOrderData',
      'var songOrderSections = []; var console = { log: function() {} };' +
      'function $(id) { return document.getElementById(id); }' +
      'var _woSongsTakenOutOfSections = {}; var songOriginalLyrics = {}; var songTransposeSemitones = {};' +
      'var sbTextAnnots = {}; var songOriginalRichLyrics = {}; var currentSermonSlides = {};' +
      uniqueSrc + '\n' + collectSrc + '\nreturn collectOrderItems();');
    return fn(ctx.document, ctx.window, ctx.currentOrderData).filter(i => i.itemType === 'content');
  }
  const content = collect([box]);
  check('one text box in, one text box out', content.length === 1,
    'collected ' + content.length + ': ' + content.map(c => c.id).join(', '));
  check('and it keeps the id it was stored under', content[0] && content[0].id === 'o1__content_s1_7');
  // After a save made away from the schedule, every item used to come back
  // listed twice; the LCD then drew each text box twice and saved both.
  const twice = collect([box, Object.assign({}, box)]);
  check('a text box listed twice is collected once', twice.length === 1,
    'collected ' + twice.length);
})();

// ---------------------------------------------------------------------------
// Readings: the LCD's insert is unchanged, and a restore draws what was saved
// ---------------------------------------------------------------------------
console.log('\nReadings');
function scriptureModule(src) {
  const L = src.split('\n');
  const get = (name) => {
    const i = L.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
    if (i < 0) return null;
    let depth = 0, started = false, out = [];
    for (let k = i; k < L.length; k++) {
      out.push(L[k]);
      for (const ch of L[k]) { if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--; }
      if (started && depth === 0) return out.join('\n');
    }
    return null;
  };
  const getVar = (name) => L.find(x => new RegExp('^  var ' + name + '\\s*=').test(x)) || '';
  const parts = ['insertScriptureIntoBox', 'addScriptureToSection', '_buildSlideBoxHeader', '_slideLineHtml',
    '_woScriptureSlides', '_woScriptureSlideKind', '_woScriptureFromSaved', '_woScriptureGroupHtml', '_woScripturePlanHasBg']
    .map(get).filter(Boolean);
  const vars = ['_BLANK_SLIDE_LINE', '_SCR_ALLELUIA', '_SCR_GOSPEL_RESPONSE', '_SCR_READING_RESPONSE'].map(getVar).join('\n');
  const body =
    'var escapeHtml = ctx.escapeHtml; var document = ctx.document;' +
    'function updatePreview() {} function autoSaveOrder() {} function updateSlideBgIndicators() {}' +
    vars + '\n' + parts.join('\n') +
    '\nreturn { insert: insertScriptureIntoBox, add: addScriptureToSection };';
  return new Function('ctx', body)({ escapeHtml: escapeHtml, document: { getElementById: function(id) { return ctx2.byId[id] || null; } } });
}
// A box and a container that record what is put next to or into them.
const ctx2 = { byId: {} };
function slot(subLabel, section) {
  const box = { html: '', removed: false, dataset: { subLabel: subLabel || '', section: section || 'wo-section-4' } };
  box.insertAdjacentHTML = function(pos, h) { box.html += h; };
  box.remove = function() { box.removed = true; };
  return box;
}
function container(id) {
  const c = { html: '', querySelector: function() { return null; } };
  c.insertAdjacentHTML = function(pos, h) { c.html += h; };
  ctx2.byId[id + '-boxes'] = c;
  return c;
}

const PASSAGE = '[16] But Jesus said, "They need not go away."\n[17] They said to him, "We have only five loaves."\n[18] And he said, "Bring them here to me."';
const PSALM = '[1] Vindicate me, O LORD,\n[2] Prove me, O LORD, and try me;\n[3] For your steadfast love is before my eyes';

const NEW = scriptureModule(SRC);
const cases = [
  ['Gospel with the Alleluia', 'Gospel Reading', 'Matthew 14:16-18', PASSAGE, true],
  ['Gospel without it', 'Gospel', 'Matthew 14:16-18', PASSAGE, false],
  ['First Reading', 'First Reading', 'Isaiah 5:1-7', PASSAGE, false],
  ['Psalm Reading', 'Psalm Reading', 'Psalm 26:1-3', PSALM, false],
  ['Psalm', 'Psalm', 'Psalm 26:1-3', PSALM, false],
  ['an unlabelled slot', '', 'Romans 12:9', PASSAGE, false]
];

// What the LCD's insert drew for each case BEFORE the slide plan was shared
// with the Liturgy Builder (commit 77235e3), as sha256 prefixes. A new
// reading must still draw byte for byte the same; only the restore changed.
const GOLDEN = {
  'Gospel with the Alleluia': '8e1941e43b4bd9ff',
  'Gospel without it': 'f015d9d0f903dd1a',
  'First Reading': '133f323a480a63d8',
  'Psalm Reading': 'a1563a8d90a9bcfc',
  'Psalm': '491099acd87148a9',
  'an unlabelled slot': '4a8ecb8d96e369c5',
  'from a section header': '137e18bd91195eb0'
};
const sha = (s) => require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 16);
cases.forEach(function(c) {
  const b = slot(c[1]);
  b.dataset.section = 'wo-section-4';
  NEW.insert(b, { title: c[2], content: c[3], singAlleluia: c[4] });
  check('a new reading draws exactly as before: ' + c[0], sha(b.html) === GOLDEN[c[0]], 'got ' + sha(b.html));
});
(function() {
  const c = container('sec');
  NEW.add('sec', { title: 'Romans 12:9', content: PASSAGE });
  check('a reading added from a section header draws exactly as before',
    sha(c.html) === GOLDEN['from a section header'], 'got ' + sha(c.html));
})();

// Slide texts as the DOM collector would read them back: one per box, the
// heading and footnote excluded.
function readBack(html) {
  const boxes = html.split('<div class="wo-slide-box"').slice(1);
  return boxes.map(function(b) {
    const ls = [];
    const re = /<div class="wo-slide-line"[^>]*>([^<]*)<\/div>/g;
    let m;
    while ((m = re.exec(b))) ls.push(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    return { content: ls.join('\n') };
  });
}

(function() {
  const first = slot('Gospel Reading');
  NEW.insert(first, { title: 'Matthew 14:16-18', content: PASSAGE, singAlleluia: true });
  const saved1 = readBack(first.html);
  const again = slot('Gospel Reading');
  NEW.insert(again, { title: 'Matthew 14:16-18', content: saved1.map(s => s.content).join('\n'), savedSlides: saved1 });
  const saved2 = readBack(again.html);
  const third = slot('Gospel Reading');
  NEW.insert(third, { title: 'Matthew 14:16-18', content: saved2.map(s => s.content).join('\n'), savedSlides: saved2 });
  const saved3 = readBack(third.html);
  const responses = (s) => s.filter(x => /^P: This is the Gospel of our Lord/.test(x.content)).length;
  check('a reading drawn back from its saved slides gains nothing (3 loads)',
    JSON.stringify(saved1) === JSON.stringify(saved3) && responses(saved3) === 1,
    'slides ' + saved1.length + ' -> ' + saved2.length + ' -> ' + saved3.length + ', responses ' + responses(saved3));
  check('and keeps its Alleluia, passage and response in order',
    /^Alleluia Lord/.test(saved3[0].content) && /^P: The Gospel is according to/.test(saved3[1].content) &&
    /^P: This is the Gospel/.test(saved3[saved3.length - 1].content));

  const psalm1 = slot('Psalm Reading');
  NEW.insert(psalm1, { title: 'Psalm 26:1-3', content: PSALM });
  const ps1 = readBack(psalm1.html);
  const psalm2 = slot('Psalm Reading');
  NEW.insert(psalm2, { title: 'Psalm 26:1-3', content: ps1.map(s => s.content).join('\n'), savedSlides: ps1 });
  const ps2 = readBack(psalm2.html);
  check('a Psalm drawn back is not prefixed L:/C: a second time',
    JSON.stringify(ps1) === JSON.stringify(ps2) && !/L: L: |C: C: |L: C: |C: L: /.test(JSON.stringify(ps2)),
    JSON.stringify(ps2).slice(0, 200));

  // The order damaged in the wild: a Gospel stored with 26 responses.
  const damaged = [{ content: '[16] But Jesus said' }, { content: '[18] And he said' }];
  for (let i = 0; i < 26; i++) damaged.push({ content: 'P: This is the Gospel of our Lord\nC: Praise to You, O Christ' });
  const healed = slot('Gospel');
  NEW.insert(healed, { title: 'Matthew 14:16-19', content: '', savedSlides: damaged });
  const hs = readBack(healed.html);
  check('a reading stored with twenty-six responses comes back with one',
    hs.length === 3 && /^P: This is the Gospel/.test(hs[2].content), 'slides: ' + hs.length);
  check('the response keeps its own heading, not the reference',
    /data-scripture-title="Gospel Response"/.test(healed.html) && /<div class="wo-slide-scripture-title">Gospel Response<\/div>/.test(healed.html));

  const bg = slot('First Reading');
  NEW.insert(bg, { title: 'Isaiah 5:1', content: '', savedSlides: [{ content: 'One\nTwo', background: 'https://x/bg.jpg' }, { content: 'P: The Word of the Lord\nC: Thanks be to God' }] });
  check('a saved background comes back on its own slide', /data-background="https:\/\/x\/bg.jpg"/.test(bg.html));
})();

// ---------------------------------------------------------------------------
// The builder's model: what it writes is what the other views read
// ---------------------------------------------------------------------------
console.log('\nThe Liturgy Builder');
(function() {
  let B;
  try {
    const fns = ['_captureCurrentLayout', '_woStripNum', '_woSectionList', '_woTemplateFor', '_woEnsureLayout',
      '_woSongSectionIds', '_woScriptureSlides', '_lbdSortSongsByService', '_lbdLiturgyItem', '_lbdReadingItem',
      '_lbdPfx', '_lbdUid'].map(n => extractFn(n));
    const vars = ['_LBD_SLIDE_BREAK', '_SCR_ALLELUIA', '_SCR_GOSPEL_RESPONSE', '_SCR_READING_RESPONSE'].map(n => extractVar(n));
    const text = buildModule(fns,
      vars.join('\n') +
      '\nvar orderStructures = ctx.orderStructures; var currentOrderType = "traditional";' +
      'var currentOrderData = null; var songOrderSections = []; var document = ctx.document;' +
      'function __set(o, songs) { currentOrderData = o; if (songs) songOrderSections = songs; }' +
      'function __songs() { return songOrderSections; }', ['__set', '__songs']);
    B = (ctx) => new Function('ctx', text)(ctx);
  } catch (e) {
    check('the builder\'s model functions exist', false, e.message.split('\n')[0]);
    return;
  }

  // A schedule on screen, as the LCD draws it: two sections, one renamed.
  const doc = makeDocument();
  [['wo-section-0', '1. Invocation', 'welcome'], ['wo-section-1790000000000', 'Welcome', '']].forEach(function(d) {
    const sec = new (require('./minidom.js').El)('div', 'wo-worship-section', { id: d[0], 'data-service-section-id': d[2] });
    const t = new (require('./minidom.js').El)('div', 'wo-section-title');
    t.textContent = d[1];
    sec.appendChild(t);
    doc.root.appendChild(sec);
  });
  const docWithSchedule = {
    querySelectorAll: function(sel) { return doc.querySelectorAll(sel); },
    querySelector: function(sel) { return sel === '#woWorshipOrder .wo-worship-section' ? doc.querySelector('.wo-worship-section') : doc.querySelector(sel); }
  };
  const M = B({ orderStructures: ORDER_STRUCTURES, document: docWithSchedule });
  const order = { sectionLayout: [
    { id: 'wo-section-0', title: 'Invocation', serviceSectionId: 'welcome', notes: 'Pastor at the font' },
    { id: 'wo-section-9', title: 'Gone', serviceSectionId: '', notes: 'never mind' }
  ] };
  M.__set(order);
  M._captureCurrentLayout();
  check('capturing the schedule keeps a section\'s notes',
    order.sectionLayout[0].notes === 'Pastor at the font', JSON.stringify(order.sectionLayout[0]));
  check('and drops a section no longer on screen, notes and all',
    order.sectionLayout.length === 2 && !order.sectionLayout.some(l => l.id === 'wo-section-9'));

  // No schedule on screen: the template is the truth, ordinals stripped.
  const empty = { querySelectorAll: () => [], querySelector: () => null };
  const M2 = B({ orderStructures: ORDER_STRUCTURES, document: empty });
  const fresh = { sectionLayout: [] };
  M2.__set(fresh);
  M2._woEnsureLayout();
  check('a fresh order\'s layout is made from its template',
    fresh.sectionLayout.length === 5 && fresh.sectionLayout[4].id === 'wo-section-4' && fresh.sectionLayout[4].serviceSectionId === 'scripture');
  check('without the template\'s "5. " ordinals', fresh.sectionLayout[4].title === 'Scripture Readings', fresh.sectionLayout[4].title);

  // The running order of songs follows the service, stably.
  const songs = [
    { id: 'a', title: 'A', serviceSections: ['wo-section-3'] },
    { id: 'b', title: 'B', serviceSections: ['wo-section-1'] },
    { id: 'c', title: 'C', serviceSections: [] },
    { id: 'd', title: 'D', serviceSections: ['wo-section-1'] },
    { id: 'e', title: 'E', serviceSections: ['wo-section-3', 'wo-section-0'] }
  ];
  M2.__set({ sectionLayout: [] }, songs);
  M2._lbdSortSongsByService();
  check('songs run in service order, section by section, stably, unplaced last',
    M2.__songs().map(s => s.id).join('') === 'ebdac', M2.__songs().map(s => s.id).join(''));
  check('the running order is sorted in place (other views hold the same array)', M2.__songs() === songs);

  // A liturgy from the library becomes one item with the collector's id.
  M2.__set({ id: 'order_1', sectionLayout: [] }, []);
  const BREAK = new Array(36).join('═');
  const lit = M2._lbdLiturgyItem('wo-section-0', 'lit-9', { title: 'Kyrie', type: 'liturgy', content: 'L: Lord, have mercy\n' + BREAK + '\nC: Christ, have mercy' });
  check('a library liturgy keeps the id both collectors give it',
    lit.id === 'order_1__liturgy_lit-9_wo-section-0' && lit.sourceId === 'lit-9');
  check('and its slides split where the library splits them',
    lit.slides.length === 2 && lit.slides[1].content === 'C: Christ, have mercy');
  const blank = M2._lbdLiturgyItem('wo-section-0', 'lbd_x', { title: 'New liturgy', content: '' });
  check('a liturgy written from nothing starts with one empty slide', blank.slides.length === 1 && blank.slides[0].content === '');

  // A reading is planned exactly as the LCD's own insert plans it.
  const r = M2._lbdReadingItem('wo-section-4', { title: 'Matthew 14:16-18', subLabel: 'Gospel Reading', text: PASSAGE, singAlleluia: true });
  const plan = M2._woScriptureSlides('Gospel Reading', 'Matthew 14:16-18', PASSAGE, true);
  check('a reading added in the builder carries the LCD\'s own slide plan',
    JSON.stringify(r.slides.map(s => s.content)) === JSON.stringify(plan.map(s => s.text)) && r.content.subLabel === 'Gospel Reading');
})();

// ---------------------------------------------------------------------------
// Names written into attributes are escaped, quotes included
// ---------------------------------------------------------------------------
// The WO module's own escapeHtml goes through textContent / innerHTML, which
// escapes & < > and leaves quotes alone. The builder writes song, liturgy and
// section names into title=, aria-label= and value=, so _lbdEsc must escape
// the quotes itself: a name with a double quote in it otherwise ends the
// attribute and starts one of its own.
console.log('[escaping]');
(function() {
  let esc;
  try {
    const fn = extractFn('_lbdEsc');
    // As the WO module's escapeHtml behaves: & < > only.
    const woEscape = 'function escapeHtml(t) { if (!t) return ""; return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }';
    esc = new Function(woEscape + fn + ' return _lbdEsc;')();
  } catch (e) {
    check('the builder has its own escaper', false, e.message.split('\n')[0]);
    return;
  }
  const hostile = 'Hymn" onmouseover="alert(1)" x=\'';
  const out = esc(hostile);
  check('a double quote in a name cannot end an attribute', out.indexOf('"') === -1, out);
  check('nor can a single quote', out.indexOf("'") === -1, out);
  check('and the name still reads the same once parsed',
    out.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') === hostile, out);
  check('nothing at all comes out as nothing', esc(null) === '' && esc(undefined) === '');
})();

// ---------------------------------------------------------------------------
// This date's readings, put in by themselves when an upcoming order opens.
// A reading on the roster and not in the order goes in; one the order has
// had from the roster, and somebody took out, stays out -- unless the roster
// now names a different passage. A past order is never touched.
// ---------------------------------------------------------------------------
console.log('\n[readings put in by themselves]');
(function() {
  let R;
  try {
    R = new Function(buildModule([
      extractFn('_monthFromDateStr'), extractFn('_yearForOrder'), extractFn('_woReadingsNoted'),
      extractFn('_woReadingsTodo'), extractFn('_woNoteReadings'), extractFn('_woOrderIsUpcoming')
    ], "var _RFR_MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']; var STATE = { rosterYear: 2026 };"))();
  } catch (e) {
    check('the automatic readings helpers exist', false, e.message.split('\n')[0]);
    return;
  }
  const W = ['reading1', 'psalm', 'reading2', 'gospel'].map(r => ({ role: r, label: r }));
  const roster = { reading1: 'Revelation 7:9-17', psalm: 'Psalm 34:1-10, 22', reading2: '1 John 3:1-3', gospel: 'Matthew 5:1-12' };
  const roles = l => l.map(w => w.role).join(',');
  check('an order with none gets all four', roles(R._woReadingsTodo(W, roster, {}, {})) === 'reading1,psalm,reading2,gospel');
  check('an order missing one gets that one', roles(R._woReadingsTodo(W, roster, { reading1: 1, psalm: 1, gospel: 1 }, {})) === 'reading2');
  check('one the roster does not have is not asked for', roles(R._woReadingsTodo(W, { gospel: 'John 1:1-5' }, {}, {})) === 'gospel');
  check('one the order had from the roster and somebody took out stays out',
    roles(R._woReadingsTodo(W, roster, { reading1: 1, psalm: 1, gospel: 1 }, { reading2: '1 John 3:1-3' })) === '');
  check('the same reference however it is spaced or cased is the same reading',
    roles(R._woReadingsTodo(W, roster, { reading1: 1, psalm: 1, gospel: 1 }, { reading2: ' 1 john  3:1-3 ' })) === '');
  check('but a different passage on the roster is a new reading, and goes in',
    roles(R._woReadingsTodo(W, roster, { reading1: 1, psalm: 1, gospel: 1 }, { reading2: '1 John 4:7-12' })) === 'reading2');
  const o = { template: { rosterReadings: { psalm: 'Psalm 1' } } };
  R._woNoteReadings(o, [{ role: 'reading1' }, { role: 'gospel' }], roster);
  check('what an order had is noted on it, by role, with the roster\'s reference, keeping what was noted before',
    JSON.stringify(o.template.rosterReadings) === JSON.stringify({ psalm: 'Psalm 1', reading1: 'Revelation 7:9-17', gospel: 'Matthew 5:1-12' }),
    JSON.stringify(o.template.rosterReadings));
  const bare = {}; R._woNoteReadings(bare, [{ role: 'psalm' }], roster);
  check('an order with no template yet gets one', bare.template && bare.template.rosterReadings.psalm === 'Psalm 34:1-10, 22');
  const now = new Date(2026, 10, 1, 15, 30);
  check('a service today is upcoming, all day', R._woOrderIsUpcoming({ serviceDate: 'Nov 1', title: 'Service - Nov 1' }, now) === true);
  check('next week is upcoming', R._woOrderIsUpcoming({ serviceDate: 'Nov 8', title: 'Service - 8 Nov 2026' }, now) === true);
  check('last week is a record, not touched', R._woOrderIsUpcoming({ serviceDate: 'Oct 25', title: 'Service - 25 Oct 2026' }, now) === false);
  check('the year in the title wins over the roster\'s', R._woOrderIsUpcoming({ serviceDate: 'Nov 8', title: 'Service - 8 Nov 2025' }, now) === false);
  check('an order with no service date is left alone', R._woOrderIsUpcoming({ serviceDate: '', title: 'Christmas' }, now) === false &&
    R._woOrderIsUpcoming({ serviceDate: 'TBC' }, now) === false);
})();

(function() {
  const has = re => re.test(SRC);
  check('opening the builder or LCD Projection puts them in',
    has(/lbdRender\(\);\r?\n\s*_woAutoReadings\('liturgy'\);/) && has(/_lcdUpdateProgramBarrier\(\);\r?\n\s*_woAutoReadings\('service'\);/));
  check('the builder\'s fill never edits the data under the LCD schedule (gotcha 35)',
    has(/if \(_woLcdInPage\(\)\) return 0;\r?\n\s*var added = 0, labels = \[\];/));
  check('and puts them in by itself only where the order has a place for readings',
    has(/if \(opts\.auto && !secId\) return 0;/) && has(/var sid = _lbdScriptureSection\(!opts\.auto\);/));
  check('the LCD\'s fill leaves out what was taken out, and notes what it dealt with',
    has(/wanted = _woReadingsTodo\(wanted, byRole, null, _woReadingsNoted\(currentOrderData\)\);/) &&
    has(/_woNoteReadings\(currentOrderData, dealt, byRole\);/));
  check('a standalone songbook is never given readings', has(/if \(!o \|\| !o\.id \|\| _sbStandaloneId \|\| String\(o\.id\)\.indexOf\('standalone_'\) === 0\) return;/));
})();

// ---------------------------------------------------------------------------
// Service liturgies: a whole liturgy kept for its occasion, used whole by a
// later year's order of the same kind, and saved over or copied.
// ---------------------------------------------------------------------------
console.log('\n[service liturgies]');
(function() {
  let V;
  try {
    V = new Function(buildModule([extractFn('_woStripNum'), extractFn('_svlOccasionFor'), extractFn('_svlSnapshotOf'),
      extractFn('_svlOutline'), extractFn('_svlCounts')]))();
  } catch (e) {
    check('the service liturgy helpers exist', false, e.message.split('\n')[0]);
    return;
  }
  const occ = (d, t) => V._svlOccasionFor(d, t || 'traditional');
  check('the Day of Pentecost is Pentecost', occ('Day of Pentecost') === 'pentecost' && occ('Pentecost Sunday') === 'pentecost');
  check('a Sunday after Pentecost is an ordinary Sunday', occ('5th Sunday after Pentecost') === 'ordinary-traditional' &&
    occ('3rd Sunday after Pentecost', 'contemporary') === 'ordinary-contemporary');
  check('Holy Trinity is not Pentecost, and Easter\'s Sundays are Easter', occ('The Holy Trinity') === 'holy-trinity' && occ('2nd Sunday of Easter') === 'easter');
  check('the days of Holy Week and Christmas are told apart', occ('Palm Sunday') === 'palm-sunday' && occ('Maundy Thursday') === 'maundy-thursday' &&
    occ('Good Friday') === 'good-friday' && occ('Christmas Eve') === 'christmas-eve' && occ('Christmas Day') === 'christmas-day');
  check('a day it does not know, or none, is the ordinary service of its kind', occ('All Saints Sunday') === 'ordinary-traditional' && occ('', 'contemporary') === 'ordinary-contemporary');

  const order = {
    sectionLayout: [{ id: 'wo-section-0', title: '1. Invocation' }, { id: 'wo-section-6', title: 'Scripture Readings', notes: 'Read slowly' }],
    clearedSections: ['wo-section-3'],
    allItems: [
      { id: 'o__lit1', itemType: 'liturgy', sectionId: 'wo-section-0', title: 'Invocation', slides: [{ content: 'In the name of the Father' }] },
      { id: 'o__lit1', itemType: 'liturgy', sectionId: 'wo-section-0', title: 'Invocation', slides: [] },
      { id: 'o__sc1', itemType: 'scripture', sectionId: 'wo-section-6', title: 'Acts 2:1-21' },
      { id: 'o__song1', itemType: 'song', title: 'kept apart' }
    ],
    template: { serviceNotes: 'Red paraments' }
  };
  const songs = [{ songId: 's1', title: 'Spirit of God', transposeSteps: '2', serviceSections: ['wo-section-6'], liturgistNotes: 'Verse 1 only' },
                 { itemType: 'blank', songId: '' }, { title: 'no song id' }];
  const snap = V._svlSnapshotOf(order, songs, s => s.serviceSections);
  check('it keeps the sections, as they are, with their notes', snap.sectionLayout.length === 2 && snap.sectionLayout[1].notes === 'Read slowly' && snap.clearedSections[0] === 'wo-section-3');
  check('and every liturgy and reading once, but no song item', snap.items.map(i => i.id).join(',') === 'o__lit1,o__sc1', snap.items.map(i => i.id).join(','));
  check('the songs by library id, section and key, and nothing that is not a song', snap.songs.length === 1 &&
    snap.songs[0].songId === 's1' && snap.songs[0].transposeSteps === 2 && snap.songs[0].sections[0] === 'wo-section-6' && snap.songs[0].liturgistNotes === 'Verse 1 only');
  check('and the notes for the whole service', snap.serviceNotes === 'Red paraments');
  check('a copy, not the order\'s own objects', snap.items[0] !== order.allItems[0] && snap.sectionLayout[0] !== order.sectionLayout[0]);
  const out = V._svlOutline(snap);
  check('its outline: each section, without its number, and what is in it', out[0].title === 'Invocation' && out[0].items[0].kind === 'liturgy' &&
    out[1].items.map(x => x.kind + ':' + x.title).join(',') === 'reading:Acts 2:1-21,song:Spirit of God', JSON.stringify(out));
  const c = V._svlCounts(snap);
  check('and its counts', c.sections === 2 && c.liturgy === 1 && c.readings === 1 && c.songs === 1);
  check('an empty or broken one is nothing, not a crash', V._svlOutline(null).length === 0 && V._svlCounts(undefined).sections === 0);
})();

(function() {
  const has = re => re.test(SRC);
  check('using one replaces the order\'s liturgy as one undoable change, each item with an id of this order',
    has(/var ok = _lbdChange\(function\(\) \{\r?\n\s*currentOrderData\.sectionLayout = JSON\.parse\(JSON\.stringify\(d\.sectionLayout \|\| \[\]\)\);/) &&
    has(/\.map\(function\(it\) \{ it\.id = _lbdPfx\(\) \+ 'svl_' \+ _lbdUid\(\); return it; \}\);/));
  check('its readings and songs come only when asked; else this date\'s readings come from the roster, in the same undo step',
    has(/filter\(function\(it\) \{ return readings \|\| it\.itemType !== 'scripture'; \}\)/) && has(/if \(songs\) \(d\.songs \|\| \[\]\)\.forEach/) &&
    has(/if \(n && _lbdUndoStack\.length === mark \+ 1\) _lbdUndoStack\.splice\(mark, 1\);/));
  check('only by an order of the kind it was made for', has(/if \(\(r\.order_type \|\| 'traditional'\) !== _svlOrderType\(\)\) \{ showToast\('That liturgy was made for another kind of service'/));
  check('the order remembers where its liturgy came from, and undo forgets it with the rest',
    has(/currentOrderData\.template\.serviceLiturgy = \{ id: r\.id, title: r\.title, occasion: r\.occasion_id, year: r\.year \};/) &&
    has(/svl: JSON\.stringify\(\(o\.template && o\.template\.serviceLiturgy\) \|\| null\),/) && has(/if \(svl\) currentOrderData\.template\.serviceLiturgy = svl; else delete currentOrderData\.template\.serviceLiturgy;/));
  check('saving over the one it came from, or as a copy, and read back before it is reported',
    has(/\? sup\.from\('service_liturgies'\)\.update\(row\)\.eq\('id', from\.id\)\.select\(\) : sup\.from\('service_liturgies'\)\.insert\(row\)\.select\(\);/) &&
    has(/return sup\.from\('service_liturgies'\)\.select\('id'\)\.eq\('id', saved\.id\)/));
  check('the occasions are the Liturgy page\'s own', has(/getOccasions: function\(\) \{ return OCCASIONS\.map\(/));
  check('it is offered in the ribbon, on a phone\'s Add sheet, and in More', has(/b\('menu-svl', 'fa-solid fa-book-bookmark', 'Service liturgies'/) &&
    has(/\['svl', 'fa-solid fa-book-bookmark', 'Service liturgies'\]/) && has(/label: 'Service liturgies: use one, or save this'/));
  const MIG = path.join(__dirname, '..', 'migrations', '2026-11-01_service_liturgies.sql');
  const sql = fs.existsSync(MIG) ? fs.readFileSync(MIG, 'utf8') : '';
  check('the migration makes the table, readable through the app\'s key',
    /create table if not exists public\.service_liturgies/.test(sql) && /occasion_id\s+text not null/.test(sql) && /data\s+jsonb not null/.test(sql) &&
    /create policy "anon_all_service_liturgies"/.test(sql));
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) {
    console.log('--expect-broken: nothing failed, so this source already has the fix (or the harness has no teeth)');
    process.exit(1);
  }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
