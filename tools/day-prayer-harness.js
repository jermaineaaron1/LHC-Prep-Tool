'use strict';
// Harness for the Prayer of the Day (2026-11-13). From the operator: a
// document with the "Prayer of the Day", to be applied on every service date
// -- LCD Projection, the Liturgy Builder and the bulletin. Asked, they chose
// that an upcoming order's prayer is REPLACED by the imported one, with Undo
// (several Traditional orders carried one old prayer copied week to week),
// and that the document gives each prayer by date.
//
//   1. The route reads a prayers document (mode 'prayers'), word for word.
//   2. lhcDayPrayer: the words into the order's own Prayer of the Day
//      slides, and when to put them in (run, not matched).
//   3. SBQ_PRAYERS: one row per service key, read back after a save.
//   4. WO: an upcoming order opened in the Builder or LCD gets it, by each
//      step's own path, noted on the order outside the undo snapshot.
//   5. The bulletin: no carry-over of last week's prayer; the date's prayer
//      printed unless the bulletin was given its own after the import.
//   6. The Readings page shows it and imports it.
//
// USAGE
//   node tools/day-prayer-harness.js
//   node tools/day-prayer-harness.js <Index.html> --expect-broken [route.ts]

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const files = args.filter(a => !a.startsWith('--'));
const INDEX = files[0] || path.join(__dirname, '..', 'Index.html');
const ROUTE = files[1] || path.join(__dirname, '..', 'app', 'api', 'parse-lectionary', 'route.ts');
const MIGRATION = path.join(__dirname, '..', 'migrations', '2026-11-13_day_prayers.sql');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const RSRC = fs.existsSync(ROUTE) ? fs.readFileSync(ROUTE, 'utf8') : '';

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

// The pure helpers, as the page defines them.
function loadHelpers() {
  const a = SRC.indexOf('window.lhcDayPrayer = (function() {');
  if (a < 0) return null;
  const b = SRC.indexOf('})();', a);
  const window = {};
  try { new Function('window', SRC.slice(a, b + 5))(window); } catch (e) { return null; }
  return window.lhcDayPrayer || null;
}

const PRAYER = 'Almighty and ever-living God, you anointed your beloved Son to be priest and sovereign forever. ' +
  'Grant that all the people of the earth, now divided by the power of sin, may be united under the glorious and ' +
  'gentle rule of Jesus Christ, our Savior and Lord, who lives and reigns with you and the Holy Spirit, one God, now and forever. Amen.';
// The church's own Prayer of the Day liturgy, as every order is seeded with it.
const TEMPLATE = ['L: The Lord be with you\n  \nC: And also with you.', 'Prayer of The Day\n  \nL: Let us pray\n  \nC :'];
// What several Traditional orders carried, copied week to week.
const STALE = ['L: The LORD be with you\n\nC: And also with you',
  'Prayer of The Day\n\nA: God who calls us into service, Transform us as you have transformed Paul.',
  'Shape us into children who rejoice in knowing and proclaiming you to the world.\n\nAmen'];

(async () => {
  // ------------------------------------------------------------ 1. route
  console.log('\n1. The route reads a prayers document');
  check('a prayers mode, beside calendar', /const isPrayers = mode === 'prayers';/.test(RSRC));
  check('its schema asks for the prayer word for word, by date',
    /const PRAYERS_SCHEMA = \{[\s\S]*?prayer: \{ type: Type\.STRING, description: 'The Prayer of the Day exactly as printed, word for word/.test(RSRC) &&
    /required: \['date', 'prayer'\]/.test(RSRC));
  check('and that schema is the one sent in prayers mode',
    /responseSchema: isPrayers \? PRAYERS_SCHEMA : isCalendar \? CALENDAR_SCHEMA : RESPONSE_SCHEMA/.test(RSRC));
  check('dates the browser cannot key on, and empty prayers, never come back',
    /if \(isPrayers\) \{[\s\S]*?\.filter\(\(e\) => \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(e\.date\)\)[\s\S]*?\.filter\(\(e\) => e\.prayer\.length > 0\)/.test(RSRC));
  check('a model that will not run without thinking is asked again without the setting',
    /response = await ask\(isPrayers\);[\s\S]*?if \(!isPrayers \|\| !\/think\/i\.test\([\s\S]*?response = await ask\(false\);/.test(RSRC));

  // ------------------------------------------------------------ 2. helpers
  console.log('\n2. lhcDayPrayer: the words into the order\'s own slides');
  const D = loadHelpers();
  check('the helpers are on the page, outside the modules', !!D);
  if (D) {
    const parts = D.split(PRAYER);
    check('split at sentence ends, a long sentence at its commas, Amen on its own line',
      parts.length === 3 && /forever\.$/.test(parts[0]) && /Jesus Christ,$/.test(parts[1]) && /\n\nAmen\.$/.test(parts[2]), JSON.stringify(parts));
    check('the first part, which shares the heading slide, is the shorter', parts[0].length <= 140 && parts.slice(1).every(p => p.length <= 230));
    const out = D.slides(TEMPLATE, PRAYER);
    check('the church\'s template: the greeting kept, the prayer after "C" on the heading slide',
      out.length === 4 && out[0] === TEMPLATE[0] && /^Prayer of The Day\n  \nL: Let us pray\n\nC: Almighty and ever-living God/.test(out[1]), JSON.stringify(out));
    const st = D.slides(STALE, 'Short prayer here. Amen.');
    check('an old prayer is replaced, its speaker (A) kept, its second slide gone',
      st.length === 2 && st[1] === 'Prayer of The Day\n\nA: Short prayer here.\n\nAmen.', JSON.stringify(st));
    check('an item with no heading slide gets the church\'s heading',
      JSON.stringify(D.slides(['L: The Lord be with you\n\nC: And also with you.'], 'X. Amen.')) ===
      JSON.stringify(['L: The Lord be with you\n\nC: And also with you.', 'Prayer of The Day\n\nL: Let us pray\n\nC: X.\n\nAmen.']));
    check('an order never given it: replaced', D.plan(null, TEMPLATE, PRAYER) === 'apply' && D.plan(null, STALE, PRAYER) === 'apply');
    check('an order that already says it: noted, nothing changed', D.plan(null, out, PRAYER) === 'note');
    check('given it before, and edited since: left alone -- the words are the liturgist\'s', D.plan({ text: PRAYER }, STALE, PRAYER) === 'keep');
    check('...until the imported prayer itself changes',
      D.plan({ text: 'An older wording.' }, D.slides(TEMPLATE, 'An older wording.'), PRAYER) === 'apply');
    check('no prayer: nothing to do', D.plan(null, TEMPLATE, '  ') === 'none');
    const t = D.target([{ id: 's0', title: 'Invocation' }, { id: 's5', title: 'Prayer of the Day' }],
      [{ id: 'a', itemType: 'liturgy', sectionId: 's0', title: 'Invocation', slides: [] },
       { id: 'b', itemType: 'text', sectionId: 's5', title: 'Note', slides: [] },
       { id: 'c', itemType: 'liturgy', sectionId: 's5', title: 'Opening', slides: [{ content: 'Prayer of The Day' }] }]);
    check('the target is the liturgy in the section named Prayer of the Day', t && t.sectionId === 's5' && t.item && t.item.id === 'c');
    check('an order with no such section (a Special service) is not touched', D.target([{ id: 's0', title: 'Scripture Readings' }], []) === null);
    check('a typed prayer\'s HTML is read as its words', D.plain('<b>Almighty</b> God,<br>you &amp; me') === 'Almighty God, you & me');
  }

  // ------------------------------------------------------------ 3. store
  console.log('\n3. SBQ_PRAYERS');
  const sbq = (() => { try { return extractFrom(SRC, /^var SBQ_PRAYERS = \{/); } catch (e) { return ''; } })();
  check('one store, on the page, not a roster row', !!sbq && /sb\.from\('day_prayers'\)/.test(sbq));
  check('a range reaches the last day\'s evening service', /\.lte\('service_key', String\(toIso\) \+ '\|~'\)/.test(sbq));
  check('an evening key with no prayer of its own falls back to the day\'s', /return rows\[key\] \|\| rows\[day\] \|\| null;/.test(sbq));
  check('a save is read back before it is counted',
    /upsert\(b, \{ onConflict: 'service_key' \}\)[\s\S]*?select\('\*'\)\.in\('service_key', keys\)[\s\S]*?String\(row\.prayer \|\| ''\) === want\.prayer/.test(sbq));
  check('a missing table says so once, and reads as no prayer', /SBQ_PRAYERS\._missing = true;\s*\r?\n\s*return fallback;/.test(sbq));
  const mig = fs.existsSync(MIGRATION) ? fs.readFileSync(MIGRATION, 'utf8') : '';
  check('the migration makes the table, keyed by service, readable by the app',
    /create table if not exists public\.day_prayers/.test(mig) && /service_key\s+text primary key/.test(mig) && /create policy "anon_all_day_prayers"/.test(mig));

  // ------------------------------------------------------------ 4. orders
  console.log('\n4. An upcoming order gets its date\'s prayer');
  const sel = fn('selectOrder');
  check('the Builder asks, after its readings', /_woAutoReadings\('liturgy'\);\r?\n\s*_woAutoPrayer\('liturgy'\);/.test(sel));
  check('LCD Projection asks, after its readings', /_woAutoReadings\('service'\);\r?\n\s*_woAutoPrayer\('service'\);/.test(sel));
  const auto = fn('_woAutoPrayer');
  check('only an upcoming order, never a songbook, once per order and step',
    /_sbStandaloneId \|\| String\(o\.id\)\.indexOf\('standalone_'\) === 0\) return;/.test(auto) &&
    /if \(_woAutoPrayerDone\[key\] \|\| !_woOrderIsUpcoming\(o\)\) return;/.test(auto));
  check('LCD Projection waits for its schedule to be in the page', /if \(step === 'service' && !_woLcdInPage\(\)\)/.test(auto));
  const intoData = fn('_woPrayerIntoData');
  check('the Builder: never while the LCD schedule is in the page (gotcha 35)', /if \(currentOrderData !== order \|\| _woLcdInPage\(\) \|\| !_lbdIsActive\(\)\) return false;/.test(intoData));
  check('the Builder: one undoable change, with Undo on the toast', /var done = _lbdChange\(function\(\) \{/.test(intoData) && /'success', _woUndoOpts\(\)\);/.test(intoData));
  const intoLcd = fn('_woPrayerIntoLcd');
  check('LCD: the schedule\'s own undo step before any box changes',
    intoLcd.indexOf('_lcdPushUndo();') > 0 && intoLcd.indexOf('_lcdPushUndo();') < intoLcd.indexOf('_lcdWriteSlideText(box, text)'));
  check('LCD: never under words held in the slide editor', /_lcdEditDirty/.test(intoLcd));
  check('LCD: backgrounds re-pinned after slides are added or taken away',
    /var bgs = _lcdCaptureSectionBgs\(sec\);[\s\S]*?_lcdRestoreSectionBgs\(sec, bgs\);/.test(intoLcd));
  check('LCD: no slide is opened for editing (addSlideBoxAfter would)', !/addSlideBoxAfter\(/.test(intoLcd));
  const snap = fn('_lbdSnapshot');
  check('the note is not in the Builder\'s undo snapshot, so Undo keeps the order\'s own words', !!snap && !/dayPrayer/.test(snap));

  // Run the Builder path against a stub of the module.
  if (D && intoData) {
    const mk = (slides, noted) => {
      const st = { toasts: [], saves: 0, changes: 0 };
      const order = { id: 'order_1', template: noted ? { dayPrayer: noted } : {},
        allItems: [{ id: 'pd', itemType: 'liturgy', sectionId: 'wo-section-5', title: 'Prayer of the Day',
                     slides: slides.map((c, i) => ({ index: i, content: c, background: i === 1 ? 'bg1.jpg' : '' })) }] };
      st.order = order;
      const env = {
        window: { lhcDayPrayer: D }, currentOrderData: order,
        _woLcdInPage: () => false, _lbdIsActive: () => true,
        _woSectionList: () => [{ id: 'wo-section-5', title: 'Prayer of the Day' }],
        _lbdItem: id => order.allItems.find(x => x.id === id),
        _lbdChange: f => { const r = f(); if (r === false) return false; st.changes++; return true; },
        autoSaveOrder: () => { st.saves++; },
        showToast: (m, k, o) => { st.toasts.push(m); st.undo = o; },
        _woUndoOpts: () => ({ action: 'Undo' }),
        _woPrayerWhen: () => '15 Nov'
      };
      const names = Object.keys(env);
      const body = [fn('_woPrayerNoted'), fn('_woNotePrayer'), intoData, 'return _woPrayerIntoData;'].join('\n');
      st.run = new Function(...names, body)(...names.map(n => env[n]));
      return st;
    };
    let st = mk(TEMPLATE);
    st.run(st.order, { prayer: PRAYER, sourceFile: 'Prayers 2026.pdf' }, '2026-11-15');
    const s = st.order.allItems[0].slides;
    check('the prayer goes into the order, one change, toast with Undo',
      st.changes === 1 && s.length === 4 && /C: Almighty and ever-living God/.test(s[1].content) && /from Prayers 2026\.pdf/.test(st.toasts[0]) && st.undo.action === 'Undo',
      JSON.stringify({ c: st.changes, s, t: st.toasts }));
    check('each slide keeps the background of the slide in its place', s[1].background === 'bg1.jpg' && s[2].background === '');
    check('and the order notes what it was given', st.order.template.dayPrayer && st.order.template.dayPrayer.iso === '2026-11-15' && st.order.template.dayPrayer.text === PRAYER);
    st = mk(STALE, { iso: '2026-11-15', text: PRAYER });
    st.run(st.order, { prayer: PRAYER }, '2026-11-15');
    check('noted already: the order\'s words are left as they are', st.changes === 0 && st.order.allItems[0].slides.length === 3);
    st = mk(STALE, { iso: '2026-11-08', text: PRAYER });
    st.run(st.order, { prayer: PRAYER }, '2026-11-15');
    check('noted for a different date (the order was moved): given this date\'s', st.changes === 1);
  }

  const iso = fn('_woOrderIso');
  if (iso) {
    const f = new Function('_woOrderWhen', iso + '\nreturn _woOrderIso;');
    const at = (y, m, d) => () => new Date(y, m, d).getTime();
    check('the order\'s date keyed as the Readings page keys it',
      f(at(2026, 10, 15))({ serviceDate: 'Nov 15' }) === '2026-11-15' && f(at(2026, 11, 31))({ serviceDate: 'Dec 31 PM' }) === '2026-12-31|pm' &&
      f(() => NaN)({ serviceDate: '' }) === '');
  } else check('the order\'s date keyed as the Readings page keys it', false, 'no _woOrderIso');

  // ------------------------------------------------------------ 5. bulletin
  console.log('\n5. The bulletin');
  const carry = fn('_carry');
  check('a new bulletin does not carry last week\'s prayer', /d\.prayer = ''; d\.prayerDoc = '';/.test(carry));
  check('the sheet prints the bulletin\'s own prayer, else the date\'s',
    /_edRich\('prayer', _prayerHtml\(d\), 'The prayer of the day'\)/.test(SRC));
  check('the date\'s prayer is read with the roster on every open', /_loadRoster\(\[_days\[_pick\], _days\[_pick \+ 1\]\]\),\r?\n\s*_prayerFor\(day\)/.test(SRC));
  const apply = fn('_applyDayPrayer'), ph = fn('_prayerHtml');
  if (D && apply && ph) {
    const mkB = (prayer, prayerDoc, imported) => {
      const st = { saves: 0, undos: 0, toasts: [], pushed: 0 };
      const env = {
        window: { lhcDayPrayer: D, showToast: 1 }, _cur: { data: { prayer, prayerDoc } },
        _dayPrayer: imported ? { prayer: imported, sourceFile: 'Prayers 2026.pdf' } : null,
        _queueSave: () => { st.saves++; }, _pushUndo: () => { st.pushed++; }, undo: () => { st.undos++; },
        showToast: (m, k, o) => { st.toasts.push(m); st.undo = o; }, _esc: x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      };
      const names = Object.keys(env);
      const fns = new Function(...names, apply + '\n' + ph + '\nreturn { apply: _applyDayPrayer, html: _prayerHtml };')(...names.map(n => env[n]));
      st.data = env._cur.data; st.fns = fns;
      return st;
    };
    let b = mkB('', '', PRAYER); b.fns.apply();
    check('a bulletin with no prayer prints the date\'s, quietly', b.data.prayer === '' && b.data.prayerDoc === PRAYER && !b.toasts.length && b.fns.html(b.data) === PRAYER);
    b = mkB('<b>Almighty God</b>, you have knit your people together.', '', PRAYER); b.fns.apply();
    check('one given another prayer before the import is given the imported one, with Undo',
      b.data.prayer === '' && b.pushed === 1 && /Prayers 2026\.pdf/.test(b.toasts[0]) && b.undo && b.undo.action === 'Undo');
    b.undo.onAction();
    check('Undo keeps the bulletin\'s own prayer, noted so it is not replaced again', b.undos === 1 && b.data.prayerDoc === PRAYER);
    b = mkB('Typed after the import.', PRAYER, PRAYER); b.fns.apply();
    check('a prayer typed after the import is the bulletin\'s own, and printed', b.data.prayer === 'Typed after the import.' && !b.toasts.length && b.fns.html(b.data) === 'Typed after the import.');
    b = mkB('', '', null); b.fns.apply();
    check('no imported prayer for the date: nothing changes', b.data.prayerDoc === '' && b.saves === 0 && b.fns.html(b.data) === '');
  } else check('the bulletin\'s prayer rule is on the page', false);

  // ------------------------------------------------------------ 6. Readings
  console.log('\n6. The Readings page');
  const home = fn('renderLectionaryHome');
  // Since 2026-11-14 the imports are under the Readings page's one Import button.
  check('Import prayers sits beside Import lectionary',
    /LiturgyModule\.openLectionaryImportModal\(\)[\s\S]{0,300}LiturgyModule\.openPrayerImportModal\(\)/.test(fn('llReadingTools')) &&
    /LiturgyModule\.llReadingTools\(this\)/.test(home));
  check('the date\'s prayer has a place under the readings', /<div id="lectionaryDayPrayer"><\/div>/.test(home));
  const paint = fn('_paintReadings');
  check('Day view paints it for each service of the day; Week and Month clear it',
    /_paintDayPrayer\(onThisDay\.slice\(\)\.sort\(\)\);/.test(paint) && /_paintDayPrayer\(\[\]\);/.test(paint));
  const save = fn('savePrayerImport');
  check('the import saves only what is ticked, and says when some did not read back',
    /input\[type="checkbox"\]\[data-pi\]:checked, input\[type="radio"\]\[value="use"\]\[data-pi\]:checked/.test(save) && /saved < picked\.length/.test(save));
  const review = fn('_renderPrayImportReview');
  check('a prayer saved that the document words differently: both shown, the saved one kept',
    /name="pi_' \+ i \+ '" value="keep" checked/.test(review));
  check('the module exports what its buttons call',
    ['openPrayerImportModal', 'runPrayerImport', 'savePrayerImport', 'editDayPrayer', 'saveDayPrayer', 'removeDayPrayer']
      .every(n => new RegExp('    ' + n + ': ' + n + ',').test(SRC)));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
