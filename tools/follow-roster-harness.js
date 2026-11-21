'use strict';
// Harness for an upcoming order following the Roster (2026-11-21). From the
// operator, on 29 Nov 2026: the Roster had been changed (Isaiah 40:3-5,
// Mark 1:1-3, '-' for the Psalm, the 2nd Reading blank) and the LCD still
// projected the lectionary's -- the readings the order took when its
// Liturgy App File was used. The Roster and the Readings page dictate the
// readings and the Prayer of the Day of what is projected; a change there
// reaches an order already open, a running projection included (asked:
// "Also live on open screens"); '-' or a deliberate blank takes a reading out
// (asked); a special liturgy's own readings and prayer win, because Use puts
// them on the Roster and the Readings page; the service page says what
// differs from the original.
//
//   1. What the order does (pure): replace, take out, or leave.
//   2. The builder applies it to its data; LCD Projection to its schedule.
//   3. When: on opening, every 30 seconds while held, at once after a save here.
//   4. The fill no longer notes an old reading as the Roster's.
//   5. The prayer: what a liturgy states as its own, put on the Readings page
//      by Use and taken off by Remove.
//   6. The service page: what differs from the original, and Update now.
//
// USAGE
//   node tools/follow-roster-harness.js
//   node tools/follow-roster-harness.js <file> --expect-broken

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
const fn = n => { try { return extractFn(n); } catch (e) { return ''; } };
const has = re => re.test(SRC);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// ------------------------------------------------------------ 1. the plan
console.log('\n1. What the order does to follow the Roster (pure)');
let P = null;
try {
  P = new Function('function _lbdNormDate(x) { return String(x || "").trim().toLowerCase().replace(/\\s+/g, " "); }\n' +
    'var _WO_READ_ROLES = ["reading1", "psalm", "reading2", "gospel"];\n' +
    ['_woRefTidy', '_woRefKey', '_woRosterRawOf', '_woFollowPlan'].map(fn).join('\n') +
    '\nreturn { tidy: _woRefTidy, key: _woRefKey, raw: _woRosterRawOf, plan: _woFollowPlan };')();
} catch (e) { P = null; }
check('the pieces are there', !!(P && P.plan && P.raw));
if (P) {
  const rows = [
    { roleId: 'reading1', date: 'Nov 29', value: 'Isaiah 40:3-5' }, { roleId: 'psalm', date: 'Nov 29', value: '-' },
    { roleId: 'reading2', date: 'Nov 29', value: '__BLANK__' }, { roleId: 'gospel', date: 'Nov 29', value: 'Mark 1 :1-3' },
    { roleId: 'gospel', date: 'Nov 22', value: 'Matthew 25:31-46' }, { roleId: 'preacher', date: 'Nov 29', value: 'Alwyn Lau' }];
  const raw = P.raw(rows, 'Nov 29');
  check('the Roster for one date: a reference tidied ("Mark 1 :1-3"), \'-\' and a deliberate blank as none; another date and other duties left out',
    JSON.stringify(raw) === JSON.stringify({ reading1: 'Isaiah 40:3-5', psalm: 'none', reading2: 'none', gospel: 'Mark 1:1-3' }), JSON.stringify(raw));
  check('...an empty cell and TBD say nothing', JSON.stringify(P.raw([{ roleId: 'psalm', date: 'Nov 29', value: '' }, { roleId: 'gospel', date: 'Nov 29', value: 'TBD' }], 'Nov 29')) === '{}');
  const have = { reading1: [{ id: 'r1', ref: 'Isaiah 64:1–9' }], psalm: [{ id: 'p', ref: 'Psalm 80:1-7, 17-19' }],
    reading2: [{ id: 'r2', ref: '1 Corinthians 1:3–9' }], gospel: [{ id: 'g', ref: 'Mark 13:24–37' }] };
  const noted = { reading1: 'Isaiah 64:1-9', psalm: 'Psalm 80:1-7, 17-19', reading2: '1 Corinthians 1:3-9', gospel: 'Mark 13:24-37' };
  const plan = P.plan(raw, have, noted, {});
  check('29 Nov: the 1st Reading and the Gospel replaced by the Roster\'s, the Psalm and the 2nd Reading taken out',
    plan.map(a => a.role + ':' + a.act + ':' + (a.ref || '') + ':' + a.ids.join('+')).join(' ') ===
      'reading1:replace:Isaiah 40:3-5:r1 psalm:remove::p reading2:remove::r2 gospel:replace:Mark 1:1-3:g', JSON.stringify(plan));
  check('the same passage written another way is in step (an en dash, "Psalms", spaces)',
    P.plan({ reading1: 'Isaiah 64:1-9', psalm: 'Psalms 80:1-7,17-19' }, { reading1: [{ id: 'a', ref: 'Isaiah 64:1–9' }], psalm: [{ id: 'b', ref: 'Psalm 80:1–7, 17–19' }] }, {}, {}).length === 0);
  check('the order\'s reading as it was given for the Roster\'s reference is in step ("Ps 80" put in as "Psalm 80:1-7"), and so is one noted before titles were kept',
    P.plan({ psalm: 'Ps 80' }, { psalm: [{ id: 'b', ref: 'Psalm 80:1–7' }] }, { psalm: 'Ps 80' }, { psalm: 'Psalm 80:1–7' }).length === 0 &&
    P.plan({ psalm: 'Ps 80' }, { psalm: [{ id: 'b', ref: 'Psalm 80:1–7' }] }, { psalm: 'Ps 80' }, {}).length === 0);
  check('...but an old reading written back over the Roster\'s (a stale save from another device) is replaced again',
    P.plan({ reading1: 'Isaiah 40:3-5' }, { reading1: [{ id: 'a', ref: 'Isaiah 64:1–9' }] }, { reading1: 'Isaiah 40:3-5' }, { reading1: 'Isaiah 40:3–5' }).map(a => a.act).join() === 'replace');
  check('a reading the order lacks is the fill\'s, not this; nothing on the Roster changes nothing',
    P.plan({ gospel: 'Mark 1:1-3' }, {}, {}, {}).length === 0 && P.plan({}, have, noted, {}).length === 0);
  check('taken out once, a reading put back by hand is taken out again while the Roster says none (the Roster dictates)',
    P.plan({ psalm: 'none' }, { psalm: [{ id: 'p2', ref: 'Psalm 23' }] }, { psalm: 'none' }, {}).map(a => a.act).join() === 'remove');
}

// ------------------------------------------------------------ 2. applied
console.log('\n2. Applied where the order is held');
try {
  const order = { id: 'o', template: { rosterReadings: { reading1: 'Isaiah 64:1-9', psalm: 'Psalm 80' } }, allItems: [
    { id: 'r1', itemType: 'scripture', sectionId: 's0', title: 'Isaiah 64:1–9', content: { reference: 'Isaiah 64:1–9', subLabel: 'First Reading' },
      slides: [{ content: 'old one', background: 'bg-a.jpg' }, { content: 'old two', background: '' }] },
    { id: 'p', itemType: 'scripture', sectionId: 's2', title: 'Psalm 80', content: { subLabel: 'Psalm' }, slides: [{ content: 'L: x' }] },
    { id: 'l', itemType: 'liturgy', sectionId: 's1', title: 'Kyrie', slides: [] }] };
  const cleared = {};
  const A = new Function('order', 'cleared',
    'var currentOrderData = order, _woUserClearedTypes = cleared;' +
    'function _lbdChange(f) { return f() !== false; }' +
    'function _woScriptureSlideKind() { return { kind: "" }; }' +
    'function _woScriptureSlides(sub, title, text) { return text.split("|").map(function(t) { return { text: t }; }); }' +
    fn('_woReadingsNoted') + fn('_woReadingTitles') + fn('_woNoteFollow') + fn('_woFollowIntoData') + '\nreturn _woFollowIntoData;')(order, cleared);
  const done = A(order, [{ role: 'reading1', act: 'replace', ids: ['r1'], ref: 'Isaiah 40:3-5' }, { role: 'psalm', act: 'remove', ids: ['p'], ref: '' }],
    { reading1: { title: 'Isaiah 40:3–5', text: 'new one|new two|new three' } });
  const r1 = order.allItems.filter(x => x.id === 'r1')[0];
  check('the builder: the reading keeps its id, section and slot, takes the new passage, each slide keeping the background of its place',
    r1 && r1.sectionId === 's0' && r1.title === 'Isaiah 40:3–5' && r1.content.reference === 'Isaiah 40:3–5' && r1.content.subLabel === 'First Reading' &&
    r1.slides.map(x => x.content + '/' + x.background).join(',') === 'new one/bg-a.jpg,new two/,new three/', JSON.stringify(r1));
  check('...the Psalm is taken out (and a save may clear the last reading); what was done is noted with the title put in',
    !order.allItems.some(x => x.id === 'p') && cleared.scripture === true && done.length === 2 &&
    JSON.stringify(order.template.rosterReadings) === JSON.stringify({ reading1: 'Isaiah 40:3-5', psalm: 'none' }) &&
    JSON.stringify(order.template.rosterReadingTitles) === JSON.stringify({ reading1: 'Isaiah 40:3–5' }), JSON.stringify(order.template));
  const none = A(order, [{ role: 'gospel', act: 'replace', ids: ['zz'], ref: 'Mark 1:1-3' }], { gospel: { title: 'Mark 1:1–3', text: 'x' } });
  check('...a reading whose passage could not be looked up, or that is not there, changes nothing',
    none.length === 0 && A(order, [{ role: 'reading1', act: 'replace', ids: ['r1'], ref: 'X 1:1' }], {}).length === 0);
} catch (e) { check('the builder\'s apply runs', false, e.stack); }
const lcd = fn('_woFollowIntoLcd');
check('LCD Projection: by its own remove and insert, into the slot the banner leaves (a reading the schedule drew has no data-section), one undo step, backgrounds put back, saved',
  /var at = Array\.prototype\.indexOf\.call\(host\.children, b\);\s*removeScriptureKeepSlot\(btn\);\s*var slot = host\.children\[at\];/.test(lcd) &&
  /insertScriptureIntoBox\(slot, \{ title: got\[a\.role\]\.title, content: got\[a\.role\]\.text,/.test(lcd) && /\} else slot\.remove\(\);/.test(lcd) &&
  /if \(!pushed\) \{ _lcdPushUndo\(\); pushed = true; \}/.test(lcd) && /_lcdRestoreSectionBgs\(sx, bgs\[sx\]\)/.test(lcd) && /autoSaveOrder\(\);/.test(lcd) &&
  /if \(did\) done\.push/.test(lcd));
check('...never the reading on the wall (it waits until it is not), never under words held in the slide editor; the slide selected goes back in the preview',
  /if \(sel && onAir && bs\.some\(function\(b\) \{ var g = groupOf\(b\); return g && g\.contains\(sel\); \}\)\) return;/.test(lcd) &&
  /_lcdEditDirty/.test(lcd) && /if \(sel && sel\.isConnected\) \{ try \{ selectSlideBox\(sel\); \} catch \(e\) \{\} \}/.test(lcd));
check('the prayer, too, waits while its slide is on the wall',
  /if \(typeof _lcdOnAir === 'function' && _lcdOnAir\(\) && t\.item\.boxes\.some\(function\(b\) \{ return b\.classList\.contains\('selected'\); \}\)\) return false;/.test(fn('_woPrayerIntoLcd')));

// ------------------------------------------------------------ 3. when
console.log('\n3. When: on opening, every 30 seconds while held, at once after a save here');
const fol = fn('_woFollow'), tick = fn('_woFollowTick');
check('on every opening, what the Roster changed first, then what is missing (the other way round the fill would note the old reading)',
  /var filled = _woFollow\('open'\)\.then\(function\(\) \{ return fillReadingsFromRoster\(\{ quiet: true, auto: true \}\); \}\);/.test(fn('_woAutoReadings')) &&
  /if \(_woAutoReadingsDone\[key\]\) \{ _woFollowSoon\(\); return; \}/.test(fn('_woAutoReadings')));
check('every 30 seconds while an upcoming order is held -- a hidden tab only while something is on the wall -- the follow, the fill, then the prayer',
  has(/setInterval\(_woFollowTick, 30000\);/) && /document\.visibilityState !== 'visible' && !\(typeof _lcdOnAir === 'function' && _lcdOnAir\(\)\)/.test(tick) &&
  /_woFollow\('tick'\)\.then\(function\(\) \{[\s\S]*?fillReadingsFromRoster\(\{ quiet: true, auto: true \}\)[\s\S]*?\}\)\.then\(function\(\) \{ return _woFollowPrayer\(step\); \}\);/.test(tick));
check('held means LCD Projection in the page or the builder open, on an upcoming order that is not a songbook\'s; never under typing',
  /if \(_woLcdInPage\(\)\) return 'service';\s*if \(_lbdIsActive\(\)\) return 'liturgy';/.test(fn('_woFollowHeld')) && /!_woOrderIsUpcoming\(o\)/.test(fn('_woFollowHeld')) &&
  /standalone_/.test(fn('_woFollowHeld')) && /_lbdTypingNow\(\)/.test(fol));
check('a save of a reading or a prayer here says so, and an open order follows at once',
  has(/window\.addEventListener\('lhc:readings-changed', _woFollowSoon\);/) && has(/window\.addEventListener\('lhc:prayers-changed', _woFollowSoon\);/) &&
  has(/if \(up && up\.error\) throw new Error\(up\.error\.message\);\s*try \{ window\.dispatchEvent\(new CustomEvent\('lhc:readings-changed'/) &&
  has(/rows\.some\(function\(x\) \{ return \/\^\(reading1\|psalm\|reading2\|gospel\)\$\/\.test\(x\.role_id\); \}\)/) &&
  (SRC.match(/new CustomEvent\('lhc:prayers-changed'/g) || []).length === 2);
check('the Roster is read fresh, the four readings\' rows only; the prayer fresh too',
  /\.in\('role_id', _WO_READ_ROLES\)/.test(fn('_woRosterRawFor')) && /SBQ_PRAYERS\.get\(iso, \{ fresh: true \}\)/.test(fn('_woFollowPrayer')));
check('the service page\'s Update now opens it in the Builder, which follows; the Builder\'s own way in too',
  has(/followRosterNow: function\(\) \{ return _woFollow\('manual'\)/) && /_llOpenInBuilder\(d\.order\.id, function\(\) \{ WO\.followRosterNow\(\); \}\);/.test(fn('spoFollow')));

// ------------------------------------------------------------ 4. the fill
console.log('\n4. The fill notes a reading as the Roster\'s only when it is');
check('the builder\'s fill: a reading had is noted only when it IS the Roster\'s; what it puts in is noted with its title',
  /if \(role && !have\[role\]\) have\[role\] = _woReadingRef\(it\) \|\| true;/.test(fn('_lbdFillReadings')) &&
  /return have\[w\.role\] && _woRefKey\(have\[w\.role\]\) === _woRefKey\(byRole\[w\.role\]\);/.test(fn('_lbdFillReadings')) &&
  /if \(w\.title\) t\[w\.role\] = w\.title;/.test(fn('_woNoteReadings')));
check('...and the LCD\'s, by the banner in the slot',
  /if \(_woRefKey\(_woLcdHadRef\(want\.role\)\) === _woRefKey\(ref\)\) dealt\.push\(want\);/.test(fn('fillReadingsFromRoster')) &&
  /dealt\.push\(Object\.assign\(\{\}, want, \{ title: slideTitle \}\)\);/.test(fn('fillReadingsFromRoster')));

// ------------------------------------------------------------ 5. the prayer
console.log('\n5. The prayer a liturgy states, put on the Readings page by Use, taken off by Remove');
let D = null;
try {
  const a = SRC.indexOf('window.lhcDayPrayer = (function() {');
  const b = SRC.indexOf('})();', a);
  const w = {};
  new Function('window', SRC.slice(a, b + 5))(w);
  D = w.lhcDayPrayer || null;
} catch (e) { D = null; }
if (D && D.words) {
  const slides = ['L: The Lord be with you.\nC: And also with you.', 'Prayer of The Day\n\nL: Let us pray\n\nC: Holy God, open our ears to your word, that we may hear it gladly',
    'and keep it in our hearts, through Jesus Christ our Lord. Amen.'];
  check('the words a Prayer of the Day part says: after "Let us pray", speakers and the Amen aside',
    D.words(slides) === 'Holy God, open our ears to your word, that we may hear it gladly and keep it in our hearts, through Jesus Christ our Lord.', D.words(slides));
  check('...and none for a template\'s empty "C :"', D.words(['Prayer of The Day\n\nL: Let us pray\n\nC :']) === '');
} else check('lhcDayPrayer.words is there', false);
try {
  const F = new Function('window', fn('_spFilePrayer') + '\nreturn _spFilePrayer;')({ lhcDayPrayer: D });
  const data = { sectionLayout: [{ id: 's5', title: '5. Prayer of the Day' }], items: [{ itemType: 'liturgy', sectionId: 's5', title: 'Collect',
    slides: [{ content: 'Prayer of The Day\n\nL: Let us pray\n\nC: Stir up your power, Lord, and come, now and forever.' }] }] };
  check('a Liturgy App File\'s own prayer: its part in the Prayer of the Day section, or named so', F(data) === 'Stir up your power, Lord, and come, now and forever.' &&
    F({ items: [{ itemType: 'liturgy', title: 'Prayer of the Day', slides: [{ content: 'Prayer of the Day\n\nC :' }] }] }) === '' && F({}) === '');
} catch (e) { check('_spFilePrayer runs', false, e.message); }
const go = fn('spUseGo'), s2 = fn('_spUseStep2');
check('Use: the liturgy\'s prayer goes on the Readings page for that date when chosen (the default), what it replaced noted on the order for Remove',
  /if \(fp && u\.prayFrom !== 'readings' && typeof SBQ_PRAYERS !== 'undefined'\)/.test(go) &&
  /SBQ_PRAYERS\.set\(row\.key, fp, \{ occasion: row\.day \|\| null, sourceFile: f\.title \|\| 'Liturgy App File' \}\)/.test(go) &&
  /prayer: prayRec \} \}\) : null;/.test(go) &&
  has(/prayer: useRec\.prayer \? \{ text: String\(useRec\.prayer\.text \|\| ''\), was: useRec\.prayer\.was == null \? null : String\(useRec\.prayer\.was\),/));
check('...its Readings step offers This liturgy\'s or The Readings page\'s, or says the page has it already',
  /LiturgyModule\.spUsePrayFrom\(this\.value\)/.test(s2) && /The Readings page already has this liturgy’s prayer\./.test(s2) && has(/spUsePrayFrom: spUsePrayFrom/));
try {
  const U = new Function(fn('_spRefKey') + fn('_spUnusePlan') + '\nreturn _spUnusePlan;')();
  const rec = { made: false, back: true, roster: 'Contemporary', readings: [], prayer: { text: 'The liturgy’s own prayer.', was: 'The imported one.', wasFile: 'YearB.pdf' } };
  const a = U(rec, 'Special', {}, 'The  liturgy’s own prayer. ');
  const b = U(rec, 'Special', {}, 'Typed since on the Readings page.');
  check('Remove: the prayer goes back while it is still the liturgy\'s; one changed since stays and is said to',
    a.pray && a.pray.was === 'The imported one.' && !a.prayKept && !b.pray && b.prayKept === true && U(Object.assign({}, rec, { prayer: null }), '', {}, 'x').pray === null);
} catch (e) { check('_spUnusePlan runs', false, e.message); }
check('...by putting the old one back, or taking it off when there was none',
  /\(w\.was \? SBQ_PRAYERS\.set\(key, w\.was, \{ occasion: w\.wasOcc \|\| null, sourceFile: w\.wasFile \|\| null \}\) : SBQ_PRAYERS\.remove\(key\)\)/.test(fn('spoRemoveGo') || SRC));

// ------------------------------------------------------------ 6. the service page
console.log('\n6. The service page says what differs from the original');
try {
  const CV = "var CV_ROLES = [['reading1', '1st Reading'], ['psalm', 'Psalm'], ['reading2', '2nd Reading'], ['gospel', 'Gospel']];";
  const mk = (row, d) => new Function('row', 'window',
    CV + 'function _spTpl(d) { return d.tpl; } function _spOrigRow() { return row; }' +
    'function _spFileReadings(r) { return (r && r.data && r.data.readings) || []; } function _spFilePrayer(data) { return (data && data.prayer) || ""; }' +
    'function _cvReadingRole(label) { return /first/i.test(label) ? "reading1" : /psalm/i.test(label) ? "psalm" : /second/i.test(label) ? "reading2" : /gospel/i.test(label) ? "gospel" : ""; }' +
    fn('_spRefKey') + fn('_spFollowData') + '\nreturn _spFollowData;')(row, { lhcDayPrayer: { norm: t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase() } })(d);
  const d = { tpl: { serviceLiturgy: { id: 'f' } }, order: { id: 'o' }, reads: { reading1: 'Isaiah 40:3-5', psalm: '-', reading2: '__BLANK__', gospel: 'Mark 1 :1-3' },
    lect: { reading1: 'Isaiah 64:1-9', psalm: 'Psalm 80:1-7', reading2: '1 Corinthians 1:3-9', gospel: 'Mark 13:24-37' },
    orderItems: [{ itemType: 'scripture', title: 'Isaiah 64:1–9', content: { subLabel: 'First Reading' } }], prayer: 'Stir up your power.' };
  const f = mk({ id: 'f', data: {} }, d);
  check('the readings against the lectionary\'s where the liturgy names none: each that differs, with its original; a Roster reference shown tidied',
    f.from === 'lectionary' && f.diffs.map(x => x.role + '=' + (x.now || 'none') + '<' + x.was).join(' ') ===
      'reading1=Isaiah 40:3-5<Isaiah 64:1-9 psalm=none<Psalm 80:1-7 reading2=none<1 Corinthians 1:3-9 gospel=Mark 1:1-3<Mark 13:24-37', JSON.stringify(f.diffs));
  check('...the order still holding the old reading is said (Update the order now)', f.lag === true);
  const g = mk({ id: 'f', data: { readings: [{ role: 'reading1', ref: 'Isaiah 40:3-5' }], prayer: 'The liturgy’s own.' } }, d);
  check('...against the liturgy\'s own where it names them; its own prayer against the Readings page\'s',
    g.from === 'liturgy' && g.diffs.map(x => x.role).join() === 'gospel' && g.pray === true && g.prayWas === 'The liturgy’s own.', JSON.stringify(g));
} catch (e) { check('_spFollowData runs', false, e.stack); }
check('the card shows it under the comparison with the original, for a liturgy in use',
  /_spDiffHtml\(cmp\) \+ \(used \? _spFollowHtml\(d\) : ''\) \+ reads \+ acts \+ change/.test(fn('_spInUseHtml')) &&
  /Readings from the Roster<\/b>/.test(fn('_spFollowHtml')) && /Update the order now/.test(fn('_spFollowHtml')) && /Prayer of the Day from the Readings page<\/b>/.test(fn('_spFollowHtml')) &&
  /SBQ_LECT_SOURCES\.getLatest\(\)/.test(fn('_spLoad')) && /SBQ_PRAYERS\.get\(next\.key, \{ fresh: true \}\)/.test(fn('_spLoad')));

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
