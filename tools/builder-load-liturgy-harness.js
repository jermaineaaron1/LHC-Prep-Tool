'use strict';
// Harness for the Liturgy Builder's ribbon and its whole-liturgy loading
// (2026-11-08). From the operator:
//
//   1. Song, Liturgy, Reading, Prayer, Text, Section, Slide and Note are not
//      a row of buttons any more; they are in Add Item.
//   2. Their team: load a past order made by an earlier liturgist and reuse
//      it whole (similar, never quite the same); and Templates loads a WHOLE
//      liturgy for a service (Good Friday, Traditional, Contemporary...) and a
//      year of choice, replacing this order's, not one item at a time.
//
// So the saved liturgies (service_liturgies, gotcha 51) and every past
// service's order are one list, filtered by where they come from, the
// service and the year, and loaded by one step (_svlApply).
//
// USAGE
//   node tools/builder-load-liturgy-harness.js
//   node tools/builder-load-liturgy-harness.js <file> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');

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
function extractVar(name) {
  const l = lines.find(x => new RegExp('^  var ' + name + '\\b').test(x));
  if (!l) throw new Error('var not found: ' + name);
  return l;
}
const fn = n => { try { return extractFn(n); } catch (e) { return ''; } };
const has = re => re.test(SRC);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// ------------------------------------------------------------ 1. the ribbon
console.log('\n1. The ribbon: everything to add is in Add Item');
const rib = fn('_lbdRibbonHtml');
check('no row of Song / Liturgy / Reading / Prayer / Text / Section / Slide / Note buttons', !!rib && !/b\('ins-/.test(rib) && !/aria-label="Insert">' \+\r?\n\s*b\(/.test(rib));
check('Add Item comes first, and its title says what it holds', /data-act="add-item" aria-haspopup="menu" title="Add to the section you are in: a song, liturgy, a reading, a prayer, a text slide, a slide break, a note or a new section"/.test(rib));
const ins = fn('_lbdInsertItems');
check('its menu has the Liturgy menu whole (library, suggestions, your own) and the slide break',
  /full \? \{ label: 'Liturgy', icon: 'fa-solid fa-scroll', sub: _lbdLitMenuItems\(secId\) \}/.test(ins) &&
  /if \(full\) items\.push\(\{ label: 'Slide break at the cursor \(Ctrl\+Enter\)', icon: 'fa-solid fa-scissors', run: _lbdBreakAtCaret \}\);/.test(ins) &&
  /return items;\r?\n\s*\}/.test(fn('_lbdLitMenuItems')) && /_lbdOpenMenu\(anchor, [^\n]*_lbdLitMenuItems\(sec\)\);/.test(fn('_lbdOpenLitMenu')));
check('...and keeps the cursor in the words while open, so the break lands at it',
  /_lbdOpenMenu\(anchor, 'Add to ' \+ _lbdSecTitle\(sec\), _lbdInsertItems\(sec, true\), \{ keepFocus: true \}\);/.test(fn('_lbdAddItem')));
check('the formatting bar keeps its own Slide break', has(/fb\('ins-break', '<i class="fa-solid fa-scissors"/));
check('a section\'s own Insert menu is unchanged (no submenu inside a submenu)', /: \{ label: 'Liturgy', icon: 'fa-solid fa-scroll', run: function\(\) \{ _lbdInsert\('liturgy', secId\); \} \},/.test(ins));

// ------------------------------------------------------------ 2. the list
console.log('\n2. Past services beside the saved liturgies');
let L = null;
try {
  L = new Function('orderStructures', 'LiturgyModule', extractVar('_LLD_MON') + '\n' +
    ['_svlOccasions', '_svlOccLabel', '_svlOccasionFor', '_svlSnapshotOf', '_lldMonthDay', '_lldRosterMap', '_lldOrderMeta', '_lldSnapshotFromOrder', '_svlSources', '_svlFilter'].map(extractFn).join('\n') +
    '\nreturn { md: _lldMonthDay, roster: _lldRosterMap, meta: _lldOrderMeta, snap: _lldSnapshotFromOrder, sources: _svlSources, filter: _svlFilter };')(
    { traditional: [{ title: '1. Invocation', serviceSectionId: 'invocation' }, { title: '2. Confession' }] },
    { getOccasions: () => [{ id: 'ordinary-traditional', label: 'Traditional Service' }, { id: 'good-friday', label: 'Good Friday' }, { id: 'ordinary-contemporary', label: 'Contemporary Service' }] });
} catch (e) { console.log('  (not present: ' + e.message.split('\n')[0] + ')'); }
if (!L) check('the list is built by functions of their own', false);
else {
  check('a date is read the ways the app writes it', L.md('Nov 15').key === 'Nov 15' && L.md('15 Nov 2026').key === 'Nov 15' &&
    L.md('Dec 31 PM').key === 'Dec 31' && L.md('Sept 6').key === 'Sep 6' && L.md('Nov 15').month === 10 && L.md('') === null && L.md('Service') === null);
  const map = L.roster([
    { role_id: 'liturgist', value: 'Margaret Loo', service_date: 'Nov 1', year: 2026 },
    { role_id: 'liturgical', value: '{"day":"All Saints\' Day","color":"White"}', service_date: 'Nov 1', year: 2026 },
    { role_id: 'liturgical', value: 'Good Friday', service_date: 'Apr 3', year: 2026 },
    { role_id: 'liturgist', value: '__BLANK__', service_date: 'Apr 3', year: 2026 }
  ]);
  check('the roster gives each date its liturgist and the day\'s name (the JSON the roster writes, or plain words)',
    map['2026|Nov 1'].liturgist === 'Margaret Loo' && map['2026|Nov 1'].day === 'All Saints\' Day' && map['2026|Apr 3'].day === 'Good Friday' && !map['2026|Apr 3'].liturgist, JSON.stringify(map));
  const m1 = L.meta({ id: 'order_1', title: 'Service - Nov 1', type: 'traditional', service_date: 'Nov 1', created_date: '2026-10-20T00:00:00Z' }, map);
  check('a past order: its date, year, day, liturgist and kind', m1.kind === 'order' && m1.key === 'o:order_1' && m1.date === 'Nov 1 2026' && m1.year === 2026 &&
    m1.day === 'All Saints\' Day' && m1.liturgist === 'Margaret Loo' && m1.occasion === 'ordinary-traditional', JSON.stringify(m1));
  const m2 = L.meta({ id: 'order_2', title: 'Good Friday 2025', type: 'traditional', service_date: 'Apr 18', occasion: '' }, { '2025|Apr 18': { day: 'Good Friday', liturgist: 'Eva' } });
  check('its year from its title; its occasion from its day, as a saved liturgy is filed', m2.year === 2025 && m2.occasion === 'good-friday' && m2.liturgist === 'Eva');
  const m3 = L.meta({ id: 'order_3', title: 'Service - Nov 8', type: 'contemporary', service_date: 'Nov 8', occasion: 'Nov 8', last_edited: '2026-11-07T10:00:00Z' }, {});
  check('an occasion field that is only a date is not taken for the day\'s name', m3.day === '' && m3.year === 2026 && m3.occasion === 'ordinary-contemporary');
  const items = [
    { id: 'a', itemType: 'liturgy', sectionId: 'wo-section-0', title: 'Invocation', slides: [{ content: 'In the Name' }] },
    { id: 'b', itemType: 'scripture', sectionId: 'wo-section-1', title: 'John 1' },
    { id: 'c', itemType: 'content', sectionId: 'wo-section-1', title: 'Welcome' },
    { id: 'd', itemType: 'slides', sectionId: 'wo-section-1', title: 'Sermon slides' },
    { id: 'e', itemType: 'video', sectionId: 'wo-section-1' },
    { id: 'f', itemType: 'blank', title: 'Notes page' },
    { id: 'g', itemType: 'song', sourceId: 'song_9', title: 'Amazing Grace', sectionId: 'wo-section-0', customizations: { transposeSteps: 2, liturgistNotes: 'v1-3' } },
    { id: 'h', itemType: 'song', sourceId: '', title: 'no library song' }
  ];
  const snap = L.snap({ type: 'traditional', template: { sectionLayout: [{ id: 'wo-section-0', title: 'Invocation' }, { id: 'wo-section-1', title: 'Word' }], serviceNotes: 'Lent' } }, items);
  check('a past order\'s liturgy: its sections, its liturgy, text and readings -- not sermon slides, videos or notes pages',
    snap.sectionLayout.length === 2 && snap.items.map(i => i.id).join(',') === 'a,b,c', snap.items.map(i => i.id).join(','));
  check('...its songs by library id, section, key and note, and its service notes',
    snap.songs.length === 1 && snap.songs[0].songId === 'song_9' && snap.songs[0].transposeSteps === 2 && snap.songs[0].sections[0] === 'wo-section-0' &&
    snap.songs[0].liturgistNotes === 'v1-3' && snap.serviceNotes === 'Lent', JSON.stringify(snap.songs));
  const snap2 = L.snap({ type: 'traditional', template: {} }, [items[0]]);
  check('an order that kept no layout has its type\'s template sections', snap2.sectionLayout.map(s => s.id + ':' + s.title).join(',') === 'wo-section-0:1. Invocation,wo-section-1:2. Confession',
    JSON.stringify(snap2.sectionLayout));
  const saved = [{ id: 'sv1', title: 'Good Friday 2025', occasion_id: 'good-friday', year: 2025, order_type: 'traditional', updated_at: '2025-04-01T00:00:00Z', data: {} },
                 { id: 'sv2', title: 'Pentecost 2026', occasion_id: 'pentecost', year: 2026, order_type: 'traditional', data: {} }];
  const all = L.sources(saved, [m1, m2, m3]);
  check('one list, newest year first, a year\'s saved liturgies before its services, and newest first within',
    all.map(x => x.key).join(' ') === 's:sv2 o:order_3 o:order_1 s:sv1 o:order_2', all.map(x => x.key).join(' '));
  check('filtered by where it comes from', L.filter(all, { kind: 'order' }).length === 3 && L.filter(all, { kind: 'saved' }).length === 2 && L.filter(all, { kind: 'all' }).length === 5);
  check('...by the service, and by the year', L.filter(all, { occ: 'good-friday' }).map(x => x.key).join() === 's:sv1,o:order_2' &&
    L.filter(all, { year: 2026 }).length === 3 && L.filter(all, { occ: 'good-friday', year: 2025, kind: 'order' }).map(x => x.key).join() === 'o:order_2');
}
const loadO = fn('_lldLoadOrders');
check('every service\'s order, never a songbook\'s pseudo-order nor this order', /!\/\^standalone_\/\.test\(o\.id\) && !\(currentOrderData && o\.id === currentOrderData\.id\)/.test(loadO));
check('...with the roster\'s liturgist and day for those years in one read', /\.in\('role_id', \['liturgist', 'liturgical'\]\)\.in\('year', ys\)/.test(loadO));
check('a past order is read whole only when it is previewed or loaded, and kept', /if \(_lldData\[id\]\) return Promise\.resolve\(_lldData\[id\]\);/.test(fn('_lldOrderData')) &&
  /return SBQ\.loadOrder\(id\)\.then/.test(fn('_lldOrderData')));

// -------------------------------------------------------- loading it whole
console.log('\nLoading one, whole');
const use = fn('lbdSvlUse'), apply = fn('_svlApply');
check('a saved liturgy and a past service are loaded by the same step', /\(x\.kind === 'order' \? _lldOrderData\(x\.id\) : Promise\.resolve\(x\.data\)\)\.then\(function\(d\) \{ _svlApply\(d \|\| \{\}, x, songs, readings\); \}/.test(use));
check('only into an order of the kind it was made for', /if \(x\.type !== _svlOrderType\(\)\) \{ showToast\('That liturgy was made for another kind of service'/.test(use));
check('it replaces the sections and liturgy as one Undo, songs and readings only when asked',
  /var ok = _lbdChange\(function\(\) \{\r?\n\s*currentOrderData\.sectionLayout = JSON\.parse\(JSON\.stringify\(d\.sectionLayout \|\| \[\]\)\);/.test(apply) &&
  /filter\(function\(it\) \{ return readings \|\| it\.itemType !== 'scripture'; \}\)/.test(apply) && /if \(songs\) \(d\.songs \|\| \[\]\)\.forEach/.test(apply) &&
  /if \(n && _lbdUndoStack\.length === mark \+ 1\) _lbdUndoStack\.splice\(mark, 1\);/.test(apply));
check('the order notes where its liturgy came from: a saved one (Save over is offered) or a past service',
  /\? \{ fromOrder: x\.id, title: x\.title, occasion: x\.occasion, year: x\.year \}\r?\n\s*: \{ id: x\.id, title: x\.title, occasion: x\.occasion, year: x\.year \};/.test(apply) &&
  /isFrom = !!\(from && \(saved \? from\.id === x\.id : from\.fromOrder === x\.id\)\)/.test(fn('_svlCardHtml')));
check('the window: where from, the service, the year, and a search by name, date or liturgist that filters in place',
  /\[\['all', 'All'\], \['saved', 'Saved liturgies'\], \['order', 'Past services'\]\]/.test(fn('_svlDrawList')) &&
  /onchange="WO\.lbdSvlFilter\(\\'occ\\', this\.value\)"/.test(fn('_svlDrawList')) && /onchange="WO\.lbdSvlFilter\(\\'year\\', this\.value\)"/.test(fn('_svlDrawList')) &&
  /oninput="WO\.lbdSvlFind\(this\.value\)"/.test(fn('_svlDrawList')) && /card\.hidden = !ok;/.test(fn('lbdSvlFind')));
check('a past service says its date, day and kind, and its liturgist beside its name', /: \[x\.date, x\.day \|\| _svlOccLabel\(x\.occasion\), _svlTypeName\(x\.type\)\];/.test(fn('_svlCardHtml')) &&
  /\(x\.liturgist \? '<span class="svl-card__lit">[^\n]*Liturgist: <b>' \+ _lbdEsc\(x\.liturgist\) \+ '<\/b><\/span>' : ''\)/.test(fn('_svlCardHtml')));
check('a late read never reopens the window over something else', /&& document\.querySelector\('\.svl-filters'\)\) _svlDrawList\(\);/.test(fn('_svlNeedData')));
check('without the saved-liturgies table, the past services are still listed', /if \(err && err\.message === 'setup'\) \{ _svlNoTable = true; _svlRows = \[\]; return \[\]; \}/.test(fn('lbdServiceLiturgies')));

// ------------------------------------------------------------- the menus
console.log('\nTemplates and Save / Load');
const tpl = fn('_lbdOpenTplMenu');
check('Templates: a whole liturgy for this service, for any service and year, and by service',
  /label: 'A whole liturgy for ' \+ _svlOccLabel\(occ\) \+ '…'/.test(tpl) && /label: 'A whole liturgy: choose the service and year…'/.test(tpl) &&
  /label: 'By service', icon: 'fa-regular fa-calendar-days', sub: _svlOccasions\(\)\.map/.test(tpl));
check('...and one section from a template is still there', /\{ label: 'One section from a template', icon: 'fa-regular fa-file-lines', sub: one \}/.test(tpl) && /lbdAddMissingTemplateSections/.test(tpl));
const svl = fn('_lbdOpenSvlMenu');
check('Save / Load: save, load for this service, from a past service, or all saved', /lbdSvlSaveSheet/.test(svl) &&
  /label: 'From a past service: an earlier liturgist’s order…'[^\n]*lbdServiceLiturgies\('\*', 'order'\)/.test(svl) && /lbdServiceLiturgies\('\*', 'saved'\)/.test(svl));
check('a phone\'s Templates tile and the More menu open the whole-liturgy window', /if \(k === 'templates'\) \{ lbdServiceLiturgies\(null, 'all'\); return; \}/.test(fn('_lbdInsertKind')) &&
  has(/\{ label: 'Templates: a whole liturgy for a service and year', icon: 'fa-regular fa-calendar-days', run: function\(\) \{ lbdServiceLiturgies\(null, 'all'\); \} \}/));
check('the new actions are reachable from the page', has(/lbdSvlFilter: lbdSvlFilter, lbdSvlFind: lbdSvlFind,/));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
