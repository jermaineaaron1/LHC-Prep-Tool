'use strict';
// Harness for the year of an order's service in the Worship Orders module.
//
// An order keeps its service date as "Nov 8" (orders.service_date), with no
// year, and most live orders are titled "Service - Nov 8" with none either.
// _yearForOrder used to fill the year in from the roster the user was looking
// at, then from today's year -- right in the year the order was made, and
// wrong from the first of January: a 2026 "Service - Nov 8" opened in 2027
// read as 8 Nov 2027, a service still to come. _woOrderIsUpcoming is the gate
// in front of everything that writes into an upcoming order by itself (the
// roster's readings, gotcha 48; the Prayer of the Day, gotcha 96; the reading
// mend, gotcha 80) and in front of the offline warm's choice of the next
// service (gotcha 88), so every one of those would have reached back into
// last year's services.
//
// The year now comes from the title when it names one, then the service
// date's own, then the day the order was MADE (orders.created_date): that
// day's year, or the next when the service falls more than 60 days before it
// ("Jan 3" made on 20 December is next January). It is the rule the Memories
// page keeps in _mvOrderIso, and section 4 holds the two together.
//
//   1. The year: a 2026 order opened in 2027, "Jan 3" made in December, a
//      titled year winning, the fallbacks for an order that says nothing.
//   2. When and whether: _woOrderWhen, _woOrderIsUpcoming, _woOrderIso and
//      WO.orderForIso, opened in 2027, over the live orders' own shapes.
//   3. What the gate keeps out: the readings, the prayer, the mend and the
//      offline warm, run for a 2026 order in 2027 -- and still run for the
//      service that IS next.
//   4. One rule: _woOrderIso and the Memories page's _mvOrderIso agree.
//   5. One of each: the functions are defined once (gotcha 42, the second).
//
// Each function is sliced out of Index.html and run under a fake clock.
//
// USAGE
//   node tools/order-year-harness.js
//   node tools/order-year-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
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
const line = re => { const m = SRC.match(re); return m ? m[0] : ''; };
const defs = n => (SRC.match(new RegExp('^\\s*function ' + n + '\\s*\\(', 'gm')) || []).length;

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

// A Date whose "now" is fixed: new Date() and Date.now() say NOW, every other
// form is the real thing.
function fakeDate(nowIso) {
  const RealDate = Date, NOW = RealDate.parse(nowIso);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
    static now() { return NOW; }
  }
  return FakeDate;
}

// The WO functions, as they stand in the source. _woYearMade is new; slicing
// an older source without it leaves the old _yearForOrder, which never asks
// for it, so --expect-broken runs the old rule rather than a missing name.
const WO_FNS = ['_monthFromDateStr', '_woYearMade', '_yearForOrder', '_woOrderWhen', '_woOrderIsUpcoming',
  '_woOrderIso', '_woOrderForIso', '_woAutoOffline', '_woAutoReadings', '_woAutoPrayer', '_woMendReadings'];
const WO_CONSTS = line(/  var _RFR_MONTHS = \[[^\n]*\];/);
const WO_BODIES = WO_FNS.map(fn);
const MISSING = WO_FNS.filter((n, i) => !WO_BODIES[i] && n !== '_woYearMade');

const STUBS = ['Date', 'STATE', 'savedOrders', 'currentOrderData', 'LHC_Offline', 'setTimeout',
  '_loadingOrder', '_sbStandaloneId', '_woLcdInPage', '_lbdIsActive', 'fillReadingsFromRoster',
  'SBQ_PRAYERS', 'window', 'LiturgyModule', '_woReadingGaps', '_woReadingRef', '_woReadingText',
  '_woPrayerIntoData', '_woPrayerIntoLcd'];
const FACTORY = MISSING.length ? null : new Function(STUBS.join(','),
  WO_CONSTS + '\nvar _woAutoReadingsDone = {}, _woAutoPrayerDone = {}, _woMendDone = {}, _woAutoOfflineDone = false;\n' +
  WO_BODIES.filter(Boolean).join('\n') +
  '\nreturn { year: _yearForOrder, when: _woOrderWhen, upcoming: _woOrderIsUpcoming, iso: _woOrderIso,' +
  ' forIso: _woOrderForIso, autoOffline: _woAutoOffline, autoReadings: _woAutoReadings,' +
  ' autoPrayer: _woAutoPrayer, mend: _woMendReadings };');

// One run of the module: the clock at `now`, the roster on `rosterYear`
// (omitted: no STATE at all), the orders list and the order open.
function wo(opts) {
  opts = opts || {};
  const log = { readings: 0, mendLooked: 0, prayerAsked: [], warmed: [] };
  const offline = { autoOn: () => true, ready: () => true, warm: id => log.warmed.push(id) };
  const stubs = {
    Date: fakeDate(opts.now || '2027-01-10T09:00:00'),
    STATE: opts.rosterYear ? { rosterYear: opts.rosterYear } : undefined,
    savedOrders: opts.saved || [],
    currentOrderData: opts.current || null,
    LHC_Offline: offline,
    setTimeout: f => f(),
    _loadingOrder: false,
    _sbStandaloneId: null,
    _woLcdInPage: () => false,
    _lbdIsActive: () => true,
    fillReadingsFromRoster: () => { log.readings++; return 0; },
    SBQ_PRAYERS: { get: iso => { log.prayerAsked.push(iso); return { then: () => {} }; } },
    window: { lhcDayPrayer: {}, LHC_Offline: offline },
    LiturgyModule: { get fetchPassage() { log.mendLooked++; return null; } },
    _woReadingGaps: () => [], _woReadingRef: () => '', _woReadingText: () => '',
    _woPrayerIntoData: () => false, _woPrayerIntoLcd: () => false
  };
  const api = FACTORY.apply(null, STUBS.map(k => stubs[k]));
  api.log = log;
  return api;
}

// The live orders' own shapes, read on 2026-11-14: seven of the twelve
// services have no year in their title, and each was made a few days or
// weeks before its service.
const LIVE = [
  { id: 'o-sep6',  title: 'Service - Sep 6',  serviceDate: 'Sep 6',  createdDate: '2026-09-03T03:12:00.000Z', iso: '2026-09-06' },
  { id: 'o-sep20', title: 'Service - Sep 20', serviceDate: 'Sep 20', createdDate: '2026-09-15T03:12:00.000Z', iso: '2026-09-20' },
  { id: 'o-nov1',  title: 'Service - Nov 1',  serviceDate: 'Nov 1',  createdDate: '2026-10-28T03:12:00.000Z', iso: '2026-11-01' },
  { id: 'o-nov8',  title: 'Service - Nov 8',  serviceDate: 'Nov 8',  createdDate: '2026-11-01T03:12:00.000Z', iso: '2026-11-08' },
  { id: 'o-dec13', title: 'Service - Dec 13', serviceDate: 'Dec 13', createdDate: '2026-11-02T03:12:00.000Z', iso: '2026-12-13' },
  { id: 'o-dec27', title: 'Service - Dec 27', serviceDate: 'Dec 27', createdDate: '2026-11-08T03:12:00.000Z', iso: '2026-12-27' },
  { id: 'o-nov22', title: 'Service - Nov 22', serviceDate: 'Nov 22', createdDate: '2026-11-10T03:12:00.000Z', iso: '2026-11-22' }
];
const NOV8 = LIVE[3];
const JAN3 = { id: 'o-jan3', title: 'Service - Jan 3', serviceDate: 'Jan 3', createdDate: '2026-12-20T10:00:00.000Z' };
const JAN17 = { id: 'o-jan17', title: 'Service - Jan 17', serviceDate: 'Jan 17', createdDate: '2027-01-05T10:00:00.000Z' };

// ------------------------------------------------------------ 1. the year
console.log('\n1. The year of an order\'s service');
check('the Worship Orders functions are on the page', !!FACTORY, MISSING.length ? 'missing: ' + MISSING.join(', ') : '');
if (FACTORY) {
  const y27 = wo({ now: '2027-01-10T09:00:00' });
  const y27r = wo({ now: '2027-01-10T09:00:00', rosterYear: 2027 });
  check('a 2026 "Service - Nov 8" opened in January 2027 is still 2026',
    y27.year(NOV8) === 2026, 'got ' + y27.year(NOV8));
  check('...with the roster turned to 2027 as well',
    y27r.year(NOV8) === 2026, 'got ' + y27r.year(NOV8));
  const dec = wo({ now: '2026-12-28T09:00:00', rosterYear: 2026 });
  check('"Jan 3" made on 20 December is next January, whatever month the roster shows',
    dec.year(JAN3) === 2027, 'got ' + dec.year(JAN3));
  check('"Nov 8" made two days after the service is still that year',
    y27.year({ title: 'Service - Nov 8', serviceDate: 'Nov 8', createdDate: '2026-11-10T10:00:00Z' }) === 2026);
  const titled = [
    [{ title: 'Service - 27 Sep 2026', serviceDate: 'Sep 27', createdDate: '2027-03-01T10:00:00Z' }, 2026],
    [{ title: 'Christmas Day 2025', serviceDate: 'Dec 25', createdDate: '2026-11-01T10:00:00Z' }, 2025],
    [{ title: 'Service - 3 Jan 2027', serviceDate: 'Jan 3' }, 2027]
  ];
  const badT = titled.filter(c => y27r.year(c[0]) !== c[1]);
  check('a year in the title wins over when the order was made', badT.length === 0,
    badT.map(c => c[0].title + ' -> ' + y27r.year(c[0]) + ' (wanted ' + c[1] + ')').join('\n        '));
  check('a year in the service date counts when the title has none',
    y27.year({ title: 'Morning service', serviceDate: 'Nov 8 2026', createdDate: '2027-01-02T10:00:00Z' }) === 2026);
  check('created_date as stored (snake case) is read too',
    y27.year({ title: 'Service - Nov 8', serviceDate: 'Nov 8', created_date: '2026-11-01T03:12:00+00:00' }) === 2026);
  // An order that does not say when it was made: what it always was.
  check('no created date: the roster\'s year, as before',
    wo({ now: '2027-01-10T09:00:00', rosterYear: 2026 }).year({ title: 'Service - Nov 8', serviceDate: 'Nov 8' }) === 2026);
  check('no created date and no roster: today\'s year, as before',
    y27.year({ title: 'Service - Nov 8', serviceDate: 'Nov 8', createdDate: 'not a date' }) === 2027);
  check('an order with no service date takes the year it was made',
    y27r.year({ title: 'Untitled Order', serviceDate: '', createdDate: '2026-11-01T10:00:00Z' }) === 2026);
}

// ------------------------------------------------------------ 2. when
console.log('\n2. When the service is, and whether it is still to come');
if (FACTORY) {
  const y27 = wo({ now: '2027-01-10T09:00:00', rosterYear: 2027 });
  const pad = n => (n < 10 ? '0' : '') + n;
  const isoOf = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const badW = LIVE.filter(o => isoOf(y27.when(o)) !== o.iso);
  check('every live order with no year in its title is dated as it was meant (opened in 2027)', badW.length === 0,
    badW.map(o => o.title + ' -> ' + isoOf(y27.when(o)) + ' (wanted ' + o.iso + ')').join('\n        '));
  const up = LIVE.filter(o => y27.upcoming(o));
  check('opened in January 2027, not one of 2026\'s services is upcoming', up.length === 0,
    up.map(o => o.title).join(', '));
  check('...with today passed in as well', !y27.upcoming(NOV8, new Date(2027, 0, 10).getTime()));
  const nov = wo({ now: '2026-11-05T09:00:00' });
  check('opened on 5 Nov 2026, "Service - Nov 8" IS upcoming', nov.upcoming(NOV8));
  check('...and "Service - Nov 1" is not', !nov.upcoming(LIVE[2]));
  const dec = wo({ now: '2026-12-28T09:00:00', rosterYear: 2026 });
  check('opened on 28 Dec 2026, "Jan 3" made in December is upcoming', dec.upcoming(JAN3));
  check('the Readings page\'s key for "Service - Nov 8" is 2026-11-08 in 2027', y27.iso(NOV8) === '2026-11-08',
    'got ' + y27.iso(NOV8));
  check('...and "Jan 3" made in December is 2027-01-03', dec.iso(JAN3) === '2027-01-03', 'got ' + dec.iso(JAN3));
  check('an evening service keeps its |pm',
    y27.iso({ title: 'Watchnight', serviceDate: 'Dec 31 PM', createdDate: '2026-12-01T10:00:00Z' }) === '2026-12-31|pm');
  const w = wo({ now: '2027-01-10T09:00:00', rosterYear: 2027, saved: LIVE.concat([JAN17]) });
  check('"Use in plan" finds 2026\'s Nov 8 by 2026-11-08 in 2027', w.forIso('2026-11-08') === 'o-nov8',
    'got ' + w.forIso('2026-11-08'));
  check('...and does not hand it out as 2027-11-08', w.forIso('2027-11-08') === null, 'got ' + w.forIso('2027-11-08'));
}

// ------------------------------------------------------------ 3. the gate
console.log('\n3. What the gate keeps out of last year\'s services');
if (FACTORY) {
  const past = wo({ now: '2027-01-10T09:00:00', rosterYear: 2027, current: NOV8 });
  past.autoReadings('liturgy');
  check('the roster\'s readings are not filled into 2026\'s Nov 8 opened in 2027', past.log.readings === 0,
    past.log.readings + ' fill(s)');
  past.autoPrayer('liturgy');
  check('nor is a Prayer of the Day looked up for it', past.log.prayerAsked.length === 0,
    'asked for ' + past.log.prayerAsked.join(', '));
  past.mend();
  check('nor are its readings mended', past.log.mendLooked === 0);

  const next = wo({ now: '2027-01-10T09:00:00', rosterYear: 2027, current: JAN17 });
  next.autoReadings('liturgy');
  next.autoPrayer('liturgy');
  next.mend();
  check('the service that IS next still gets its readings, its prayer and its mend',
    next.log.readings === 1 && next.log.prayerAsked[0] === '2027-01-17' && next.log.mendLooked >= 1,
    JSON.stringify(next.log));

  const warm = wo({ now: '2027-01-10T09:00:00', rosterYear: 2027, saved: LIVE.concat([JAN17]) });
  warm.autoOffline();
  check('the offline warm keeps 17 Jan 2027, not 2026\'s Sep 6, on the device', warm.log.warmed[0] === 'o-jan17',
    'warmed ' + JSON.stringify(warm.log.warmed));
  const none = wo({ now: '2027-01-10T09:00:00', rosterYear: 2027, saved: LIVE });
  none.autoOffline();
  check('with only last year\'s services, it downloads none of them', none.log.warmed.length === 0,
    'warmed ' + JSON.stringify(none.log.warmed));
}

// ------------------------------------------------------------ 4. one rule
console.log('\n4. One rule, here and on the Memories page');
const MV_CONST = line(/  var MV_MON = \[[^\n]*\];/);
const MV_BODIES = ['_mvPad', '_mvOrderIso'].map(fn);
let mvIso = null;
try {
  if (MV_CONST && MV_BODIES.every(Boolean)) mvIso = new Function(MV_CONST + '\n' + MV_BODIES.join('\n') + '\nreturn _mvOrderIso;')();
} catch (e) { mvIso = null; }
check('the Memories page\'s _mvOrderIso is on the page', !!mvIso);
if (FACTORY && mvIso) {
  const cases = LIVE.concat([
    JAN3, JAN17, NOV8,
    { title: 'Service - Nov 8', serviceDate: 'Nov 8', createdDate: '2026-11-10T10:00:00Z' },
    { title: 'Service - 15 Nov 2026', serviceDate: 'Nov 15', createdDate: '2026-11-08T04:38:26Z' },
    { title: 'Watchnight', serviceDate: 'Dec 31 PM', createdDate: '2026-12-01T10:00:00Z' },
    { title: 'Service - Feb 1', serviceDate: 'Feb 1', createdDate: '2026-11-30T10:00:00Z' },
    { title: 'Service - Sep 1', serviceDate: 'Sep 1', createdDate: '2026-11-02T10:00:00Z' }
  ]);
  // Opened years later, with the roster on another year again: neither
  // may matter.
  const later = wo({ now: '2028-06-01T09:00:00', rosterYear: 2028 });
  const bad = cases.filter(o => later.iso(o) !== mvIso(o));
  check('_woOrderIso and _mvOrderIso give the same date for every order that says when it was made', bad.length === 0,
    bad.map(o => o.title + ' made ' + o.createdDate.slice(0, 10) + ': ' + later.iso(o) + ' vs ' + mvIso(o)).join('\n        '));
}

// ------------------------------------------------------------ 5. one of each
console.log('\n5. Defined once');
['_yearForOrder', '_woYearMade', '_woOrderWhen', '_woOrderIso'].forEach(n => {
  check(n + ' is defined exactly once (a second would silently take the first one\'s callers)', defs(n) === 1,
    defs(n) + ' definitions');
});
check('_yearForOrder asks when the order was made before it asks the roster',
  /_woYearMade\(order\)[\s\S]*STATE\.rosterYear/.test(fn('_yearForOrder')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
