'use strict';
// Harness for the Liturgy Library as the operator's design (2026-11-14).
// From the operator: four screens drawn in ChatGPT -- a landing page
// ("Liturgy Library -- Read. Plan. Remember."), Readings, Services and
// Memories -- to replace the Liturgy page. Asked, they chose: a church photo
// where one is filed and drawn artwork otherwise; no one-line summaries on
// the readings; Favourites (on the device) and new collections, but no
// "My services / Shared with me" (nobody signs in).
//
//   1. The pages: the landing page is where the Liturgy page opens, each
//      panel switcher hides the rest, the nav has Overview.
//   2. The church year (run): which season a liturgical day is in, and the
//      lectionary's year.
//   3. Services (run): favourites, kind, year and words filter the
//      collections; new collections are kept, read back, and join the list.
//   4. Readings: each card's Open / Copy / Use in plan, no summary, the
//      prayer's Copy / Use in plan, the date's Use in plan / Export / Share.
//   5. The order editor lends Readings its exporter and finds a date's order.
//
// USAGE
//   node tools/liturgy-hub-harness.js
//   node tools/liturgy-hub-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const MIGRATION = path.join(__dirname, '..', 'migrations', '2026-11-14_liturgy_collections.sql');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');

function extractFrom(text, startRe) {
  const ls = text.split('\n');
  const startIdx = ls.findIndex(l => startRe.test(l));
  if (startIdx < 0) throw new Error('not found: ' + startRe);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < ls.length; i++) {
    out.push(ls[i]);
    for (const ch of ls[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces: ' + startRe);
}
const fn = n => { try { return extractFrom(SRC, new RegExp('^  function ' + n + '\\s*\\(')); } catch (e) { return ''; } };

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}
const run = (names, env, ret) => {
  const bodies = names.map(fn);
  if (bodies.some(b => !b)) return null;
  const keys = Object.keys(env || {});
  try { return new Function(...keys, bodies.join('\n') + '\nreturn ' + ret + ';')(...keys.map(k => env[k])); }
  catch (e) { return null; }
};

(async () => {
  // ------------------------------------------------------------ 1. pages
  console.log('\n1. The pages');
  check('the landing page and Services are panels of the Liturgy page',
    /<div id="liturgyHubPanel" class="ll-panel" style="display:none;"><\/div>/.test(SRC) &&
    /<div id="liturgyServicesPanel" class="ll-panel" style="display:none;"><\/div>/.test(SRC));
  check('the Liturgy page opens on the landing page',
    /window\.LiturgyModule\.init\(\);\r?\n\s*\/\/[^\n]*\r?\n\s*window\.LiturgyModule\.openHub\(\);/.test(SRC));
  const only = fn('_llShowOnly');
  check('showing one page hides every other one, the old three included',
    /\['liturgyWelcome', 'liturgyOccasionPanel', 'liturgyMemoriesPanel'\]\.concat\(LL_PANELS\)/.test(only) &&
    /el\.style\.display = pid === id \? '' : 'none';/.test(only));
  const hide = fn('_lfHide');
  check('and every older switcher (Readings, a service\'s planning, Memories) hides the new ones',
    /LL_PANELS\.forEach\(function\(id\) \{ var el = document\.getElementById\(id\); if \(el\) el\.style\.display = 'none'; \}\);/.test(hide) &&
    /function selectOccasion\(occasionId\) \{\r?\n\s*_lfHide\(\);/.test(SRC));
  check('the nav (sidebar and phone strip) has Overview, Readings, Services, Memories',
    (SRC.match(/data-libfilter="hub" onclick="LiturgyModule\.openHub\(\)" title="Overview">/g) || []).length === 2 &&
    (SRC.match(/title="Services">/g) || []).length >= 2);
  const head = fn('_llHead');
  check('each page wears the shared header, with tabs back to the others and home',
    /onclick="LiturgyModule\.openHub\(\)" aria-label="Liturgy Library home"/.test(head) &&
    /'LiturgyModule\.selectOccasion\(null\)'/.test(head) && /'LiturgyModule\.openServices\(\)'/.test(head) && /'LiturgyModule\.openMemories\(\)'/.test(head));
  check('a phone shows the section strip, so the header\'s tabs stand down there',
    /@media \(max-width: 768px\), \(max-width: 1200px\) and \(orientation: portrait\) \{\s*\r?\n\s*\/\*[^*]*\*\/\s*\r?\n\s*\.ll-tabs \{ display: none; \}/.test(SRC));

  // ------------------------------------------------------------ 2. year
  console.log('\n2. The church year');
  const Y = run(['_llSeasonOf', '_llCycle'], {}, '{ season: _llSeasonOf, cycle: _llCycle }');
  check('the season and year functions are on the page', !!Y);
  if (Y) {
    const cases = [
      ['25th Sunday after Pentecost', 'ordinary'], ['Christ the King Sunday', 'ordinary'], ['1st Sunday of Advent', 'advent'],
      ['Christmas Eve', 'christmas'], ['Epiphany of Our Lord', 'epiphany'], ['Baptism of Our Lord', 'epiphany'],
      ['Ash Wednesday', 'lent'], ['3rd Sunday in Lent', 'lent'], ['Palm Sunday', 'holyweek'], ['Good Friday', 'holyweek'],
      ['Maundy Thursday', 'holyweek'], ['Easter Sunday', 'easter'], ['5th Sunday of Easter', 'easter'],
      ['Day of Pentecost', 'pentecost'], ['Reformation Sunday', 'ordinary'], ['', '']
    ];
    const bad = cases.filter(c => Y.season(c[0]) !== c[1]);
    check('a liturgical day is placed in its season ("after Pentecost" is not Pentecost; Palm Sunday is Holy Week)',
      bad.length === 0, bad.map(c => c[0] + ' -> ' + Y.season(c[0])).join('; '));
    check('the lectionary year turns at Advent: 15 Nov 2026 is Year A, 29 Nov 2026 Year B',
      Y.cycle('2026-11-15') === 'Year A' && Y.cycle('2026-11-29') === 'Year B' && Y.cycle('2025-11-30') === 'Year A' &&
      Y.cycle('2025-11-29') === 'Year C' && Y.cycle('2027-11-28') === 'Year C' && Y.cycle('') === '',
      [Y.cycle('2026-11-15'), Y.cycle('2026-11-29'), Y.cycle('2025-11-30'), Y.cycle('2025-11-29'), Y.cycle('2027-11-28')].join(','));
  }
  const go = fn('llSeasonGo');
  check('a season\'s tile opens Readings at its next service, from the roster\'s liturgical days',
    /_llSeasonOf\(meta\[k\]\.day\) === key/.test(go) && /lfOpenDay\(next\)/.test(go));

  // ------------------------------------------------------------ 3. services
  console.log('\n3. Services');
  const F = run(['_lsGroup', '_lsFilter'], { LF_ORDINARY: ['ordinary-traditional', 'ordinary-contemporary'], _occasionKind: o => o.kind || 'season' }, '_lsFilter');
  check('the collections filter is on the page', !!F);
  if (F) {
    const occs = [{ id: 'ordinary-traditional', label: 'Traditional Service', desc: 'Standard Sunday liturgy' },
                  { id: 'advent', label: 'Advent Sundays', desc: 'Waiting' },
                  { id: 'good-friday', label: 'Good Friday', desc: 'The Passion' },
                  { id: 'baptism', label: 'Baptism', kind: 'occasional', desc: 'Holy Baptism' },
                  { id: 'col-training', label: 'Worship Training', custom: true, kind: 'custom', desc: '' }];
    const items = [{ occasionId: 'good-friday', occasionFolderId: 'gf25', title: 'Abide With Me SATB' },
                   { occasionId: 'advent', occasionFolderId: null, title: 'Advent Liturgy' }];
    const folders = { 'good-friday': [{ id: 'gf25', name: '2025' }], advent: [{ id: 'ad26', name: '2026' }] };
    const ids = f => F(occs, items, ['advent'], Object.assign({ fav: false, q: '', year: '', type: '' }, f), folders, { baptism: { 2024: true } }).map(o => o.id).join(',');
    check('all of them by default', ids({}) === 'ordinary-traditional,advent,good-friday,baptism,col-training');
    check('favourites only', ids({ fav: true }) === 'advent');
    check('by kind: Sundays, the church year, rites, added collections',
      ids({ type: 'sundays' }) === 'ordinary-traditional' && ids({ type: 'year' }) === 'advent,good-friday' &&
      ids({ type: 'rites' }) === 'baptism' && ids({ type: 'custom' }) === 'col-training');
    check('by year: a thing filed in that year\'s folder, or a whole liturgy saved for it',
      ids({ year: '2025' }) === 'good-friday' && ids({ year: '2024' }) === 'baptism' && ids({ year: '2026' }) === '',
      [ids({ year: '2025' }), ids({ year: '2024' }), ids({ year: '2026' })].join(' | '));
    check('by words: a collection\'s name or description, or any of its items\' names',
      ids({ q: 'abide' }) === 'good-friday' && ids({ q: 'TRAINING' }) === 'col-training' && ids({ q: 'standard sunday' }) === 'ordinary-traditional');
  }
  const fav = fn('llFav'), favs = fn('_llFavs');
  check('favourites are kept on this device, never in the database',
    /localStorage\.setItem\('lhc_lit_favs'/.test(fav) && /localStorage\.getItem\('lhc_lit_favs'/.test(favs) && !/sb\.from/.test(fav));
  const save = fn('llSaveCollection');
  check('a new collection is written, READ BACK, joins the list and opens',
    /sb\.from\('liturgy_collections'\)\.insert\(\[row\]\)/.test(save) &&
    /return sb\.from\('liturgy_collections'\)\.select\('\*'\)\.eq\('id', row\.id\);/.test(save) &&
    /_llAddCollection\(_llCollToOcc\(got\)\);/.test(save) && /openCollection\(got\.id, '', 'services'\);/.test(save));
  check('one called like an existing service is refused', /There is already a service called that\./.test(save));
  const load = fn('_llCollectionsLoad');
  check('collections are added to the list everything files by, and a missing table is said, not retried',
    /_llAddCollection\(_llCollToOcc\(row\)\)/.test(load) && /if \(!sb \|\| _llCollLoaded \|\| _llCollMissing\) return Promise\.resolve\(\);/.test(load) &&
    /OCCASIONS\.push\(occ\);/.test(fn('_llAddCollection')));
  const mig = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';
  check('the migration makes the table, readable by the app',
    /create table if not exists public\.liturgy_collections/.test(mig) && /id\s+text primary key/.test(mig) && /create policy "anon_all_liturgy_collections"/.test(mig));
  const photo = fn('_llPhotoFor');
  check('a service\'s picture is its own photo -- never a planning sheet or a document -- else drawn artwork',
    /i\.category !== 'planning' && i\.category !== 'documents'/.test(photo) && /ll-art__arch/.test(fn('_llArt')));
  const coll = fn('openCollection');
  check('a card opens that collection\'s folder alone, with the way back', /_lf\.solo = true;/.test(coll) && /_lf\.back = from \|\| 'services';/.test(coll));

  // ------------------------------------------------------------ 4. readings
  console.log('\n4. Readings');
  const card = fn('_readingSlotCard');
  check('each reading: its reference opens it, and Open / Copy / Use in plan',
    /LiturgyModule\.openPassage\(' \+ q \+ ',' \+ idx \+ '\)">' \+ escapeHtml\(ref\) \+ '<\/button>/.test(card) &&
    /LiturgyModule\.llCopyReading\(/.test(card) && /LiturgyModule\.llUseInPlan\(/.test(card));
  check('no one-line summary is made up for a reading (the operator: leave them out)', !/summary|fetchSummary|gemini/i.test(card));
  check('"changed / from the lectionary" sits above the card\'s actions',
    /var acts = card\.querySelector\('\.ll-rcard__acts'\);\r?\n\s*if \(acts\) card\.insertBefore\(tag, acts\); else card\.appendChild\(tag\);/.test(SRC));
  const pc = fn('_dayPrayerCard');
  check('the Prayer of the Day: Copy, Use in plan, Share, Edit', /llCopyPrayer/.test(pc) && /llUseInPlan/.test(pc) && /lfShareDay/.test(pc) && /editDayPrayer/.test(pc));
  const acts = fn('_llPaintDayActions');
  check('the date: Use in the service plan, Export PDF, Export Word, Share readings',
    /llUseInPlan/.test(acts) && /llExportReadings\(\\'pdf\\'/.test(acts) && /llExportReadings\(\\'docx\\'/.test(acts) && /lfShareDay/.test(acts));
  const paint = fn('_paintReadings');
  check('...in Day view only', /_llPaintDayActions\(onThisDay\.slice\(\)\.sort\(\)\[0\]\);/.test(paint) && /_llPaintDayActions\(''\);/.test(paint));
  const ctx = fn('_paintDayContext');
  check('the liturgical day goes in the date bar, the season and colour in the band under it',
    /if \(navDay\) navDay\.innerHTML = dayHtml;/.test(ctx) && /_llPaintSeasonBand\(m\);/.test(ctx));
  check('the lectionary\'s year is shown', /cyc\.textContent = _llCycle\(_currentReadingDate\);/.test(fn('renderReadingDateNav')));
  const use = fn('llUseInPlan');
  check('Use in plan opens the date\'s order in the Liturgy Builder, or says there is none',
    /WO\.loadOrder\(id\)/.test(use) && /WO\.selectOrder\('liturgy'\)/.test(use) && /There is no order for/.test(use));

  // ------------------------------------------------------------ 5. orders
  console.log('\n5. The order editor');
  const ofi = fn('_woOrderForIso');
  check('a date\'s order: by the order\'s own date key, never a songbook',
    /String\(o\.id\)\.indexOf\('standalone_'\) !== 0 && _woOrderIso\(o\) === key/.test(ofi));
  const ex = fn('_woExportDoc');
  check('Readings\' export is the Builder\'s own, word for word', /paras: _lbdExportParas\(p\.texts \|\| \[\]\)/.test(ex) &&
    /_lbdExportPdf\(model\)/.test(ex) && /_lbdExportDocx\(model\)/.test(ex));
  check('both are lent to the Liturgy page', /orderForIso: _woOrderForIso, exportDoc: _woExportDoc,/.test(SRC));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
