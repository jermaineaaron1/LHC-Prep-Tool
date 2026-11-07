'use strict';
// Harness for the Worship Enablers directory's self-service pieces: the
// Calendar tab's month, a person's duties, the duty card and its WhatsApp
// link, and a phone or email that anyone may add.
//
// WHY THIS EXISTS
// Asked for on 2026-11-07, with three faults in a screenshot of the duty card:
//
//   - its dates ran backwards. They were sorted as TEXT, and "Nov 15" sorts
//     before "Nov 8". It also walked STATE.rosterEdits, which keeps every
//     month opened this session under keys with no year, so October's duties
//     could appear on November's card.
//   - its last line ended in U+FFFD. The sign-off emoji (U+1F64F) sits
//     outside the Basic Multilingual Plane, and wa.me's redirect to
//     api.whatsapp.com broke it; the em dash and bullet beside it survived.
//   - only a PIC could fill in a phone or an email.
//
// WHAT IS EASY TO GET WRONG
//   - Saving a phone must not blank the email: the write names the one field
//     (an upsert writes every column it is handed).
//   - The row a name is kept under may differ from the picker's spelling by a
//     space or a capital; writing under the picker's spelling makes a second
//     row that nothing reads back.
//   - A mentor/trainee cell and a group cell ("All Teachers") are duties of
//     the people in them, as the serving history counts them.
//   - The Watchnight ("Dec 31 PM") is its own service, after that morning's.
//
// USAGE
//   node tools/enablers-calendar-harness.js                 # ../Index.html
//   node tools/enablers-calendar-harness.js path/to/file.html
//   node tools/enablers-calendar-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 520b2f5:Index.html > x`).

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n').map(l => l.replace(/\r$/, ''));

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const r = { label, ok: a === e, a, e };
  results.push(r);
  console.log((r.ok ? '  ok    ' : '  FAIL  ') + label);
  if (!r.ok) console.log('        got      ' + a + '\n        expected ' + e);
}
function truthy(label, v) { check(label, !!v, true); }

// ---------------------------------------------------------------- slicing
const engineAt = lines.findIndex(l => /^  var RosterEngine = \{/.test(l));
if (engineAt < 0) { console.error('RosterEngine not found'); process.exit(1); }

function block(startIdx) {
  let depth = 0, started = false;
  const out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{' || ch === '[') { depth++; started = true; }
      else if (ch === '}' || ch === ']') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced block at line ' + (startIdx + 1));
}
function method(name) {
  const re = new RegExp('^    ' + name.replace(/\$/g, '\\$') + ':\\s*function\\s*\\(');
  const i = lines.findIndex((l, k) => k > engineAt && re.test(l));
  return i < 0 ? null : block(i).replace(/,\s*$/, '');
}
function prop(name) {
  const re = new RegExp('^    ' + name + ':\\s*');
  const i = lines.findIndex((l, k) => k > engineAt && re.test(l));
  return i < 0 ? null : block(i).replace(/,\s*$/, '');
}
function top(re) {
  const i = lines.findIndex(l => re.test(l));
  if (i < 0) return null;
  return /[{\[]/.test(lines[i]) && !/;\s*$/.test(lines[i]) ? block(i) : lines[i];
}

const METHODS = ['escapeHtml', '_roleWord', 'calculateEaster', 'getSpecialDays', 'getServiceDays', 'getDefaultDayText',
  '_enablersGroupLabelsFor', '_waPhone', 'getCalendarSubscribeUrl', 'buildDutyCardMessage', 'getDutiesForMember',
  '_enGuideUrl', '_enDateOf', '_enRoleOrder', '_enDutiesIn', '_enLitMonth', '_enMonthGrid', '_enDateLabel', '_enWaUrl',
  '_enCleanContact', '_enMetaKey', '_enMeta', '_enWaHtml', '_enRowsNow', '_enCardText', '_enContactWrite', '_enCtHtml'];
const PROPS = ['MONTHS_SHORT', 'SEASONS', 'DEFAULT_COLORS', 'ROLES'];
const missing = [];
const parts = [];
PROPS.forEach(p => { const t = prop(p); if (t) parts.push(t); else missing.push(p); });
METHODS.forEach(m => { const t = method(m); if (t) parts.push(t); else missing.push(m); });

const decls = [
  top(/^  var _nameNorm = /),
  top(/^  var _PAIR_SEP = /),
  top(/^  var ROSTER_GROUP_LABELS = /),
  top(/^  function splitCellPeople\(/),
  top(/^  var _re = \{/)
];
if (decls.some(d => !d)) { console.error('module helpers not found'); process.exit(1); }

const holder = { sb: null };
let R = null;
try {
  const src = decls.join('\n') + '\n' +
    'var STATE = { picMode: false, rosterYear: 2026, rosterMonth: 10 };\n' +
    'var R = {\n' + parts.join(',\n') + '\n};\n' +
    'return R;';
  const win = {
    location: { origin: 'https://lhc-prep-tool.vercel.app' },
    LITURGICAL_COLOURS: { Green: { swatch: '#16a34a' }, White: { swatch: '#f8fafc', border: '#cbd5e1' } }
  };
  R = new Function('window', 'getSupabaseClient', src)(win, function() { return holder.sb; });
} catch (e) {
  console.error('could not build RosterEngine slice: ' + e.message);
}
const has = n => !!(R && typeof R[n] === 'function');
const call = (n, ...a) => { if (!has(n)) return undefined; try { return R[n](...a); } catch (e) { return 'THREW ' + e.message; } };

console.log('Extracted from ' + path.basename(INDEX) + (missing.length ? ' -- missing: ' + missing.join(', ') : ' -- everything found') + '\n');

// ---------------------------------------------------------------- dates
console.log('a roster date sorts as a date');
const d8 = call('_enDateOf', 'Nov 8', 2026), d15 = call('_enDateOf', 'Nov 15', 2026);
check('"Nov 8" is the 8th of November', d8 && [d8.y, d8.m, d8.d, d8.pm], [2026, 10, 8, false]);
truthy('  "Nov 15" comes after "Nov 8" (as text it came before)', d8 && d15 && d15.t > d8.t);
const am = call('_enDateOf', 'Dec 31', 2026), pm = call('_enDateOf', 'Dec 31 PM', 2026);
truthy('  the Watchnight comes after that morning, and is its own service', am && pm && pm.pm && pm.t > am.t && pm.key !== am.key);
const iso = call('_enDateOf', '2026-01-04T08:00:00.000Z', 2025);
check('  an old ISO row reads by its own date', iso && [iso.y, iso.m, iso.d], [2026, 0, 4]);
check('  nonsense is no date', [call('_enDateOf', 'TBD', 2026), call('_enDateOf', '', 2026), call('_enDateOf', 'Nov 32', 2026)], [null, null, null]);

// ---------------------------------------------------------------- duties
const ROWS = [
  { role_id: 'pianist', month: 10, year: 2026, service_date: 'Nov 15', value: 'Ada Example' },
  { role_id: 'singer1', month: 10, year: 2026, service_date: 'Nov 8', value: 'Ada Example' },
  { role_id: 'liturgist', month: 10, year: 2026, service_date: 'Nov 8', value: 'ada  example' },
  { role_id: 'usher1', month: 9, year: 2026, service_date: 'Oct 4', value: 'Ada Example' },
  { role_id: 'usher1', month: 10, year: 2025, service_date: 'Nov 9', value: 'Ada Example' },
  { role_id: 'reading1', month: 10, year: 2026, service_date: 'Nov 22', value: 'Ada Example' },
  { role_id: 'lcd', month: 10, year: 2026, service_date: 'Nov 22', value: 'Ben Sample / Ada Example' },
  { role_id: 'ssteacher1', month: 10, year: 2026, service_date: 'Nov 29', value: 'All Teachers' },
  { role_id: 'drummer', month: 10, year: 2026, service_date: 'Nov 1', value: 'Ada Example Junior' },
  { role_id: 'pianist', month: 10, year: 2026, service_date: 'Nov 1', value: 'Ben Sample' },
  { role_id: 'liturgical', month: 10, year: 2026, service_date: 'Nov 8', value: '{"day":"22nd Sunday after Pentecost","color":"Green"}' },
  { role_id: 'liturgical', month: 10, year: 2026, service_date: 'Nov 15', value: 'not json' },
  { role_id: 'liturgical', month: 10, year: 2026, service_date: 'Nov 22', value: '{"color":"White"}' },
  { role_id: 'service_type', month: 10, year: 2026, service_date: 'Nov 8', value: 'Traditional' }
];
const ADA = { name: 'Ada Example', labels: ['all teachers'] };
const BEN = { name: 'Ben Sample', labels: [] };
const flat = list => (Array.isArray(list) ? list : []).map(e => e.date + ':' + e.duties.map(d => d.who + d.roleId).join('+'));

console.log('\na person\'s duties in a month, earliest first');
check('one entry a service, in date order, a trainee and a group counted',
  flat(call('_enDutiesIn', ROWS, [ADA], 2026, 10)), ['Nov 8:0liturgist+0singer1', 'Nov 15:0pianist', 'Nov 22:0lcd', 'Nov 29:0ssteacher1']);
check('  without the group, the group duty is not theirs',
  flat(call('_enDutiesIn', ROWS, [{ name: 'Ada Example', labels: [] }], 2026, 10)), ['Nov 8:0liturgist+0singer1', 'Nov 15:0pianist', 'Nov 22:0lcd']);
check('  two people on one calendar, each with their own index',
  flat(call('_enDutiesIn', ROWS, [ADA, BEN], 2026, 10)), ['Nov 1:1pianist', 'Nov 8:0liturgist+0singer1', 'Nov 15:0pianist', 'Nov 22:0lcd+1lcd', 'Nov 29:0ssteacher1']);
check('  another month and another year are not this one',
  flat(call('_enDutiesIn', ROWS, [ADA], 2026, 9)), ['Oct 4:0usher1']);

// ---------------------------------------------------------------- the month's services
console.log('\nthe month\'s services, as the roster names them');
const lit = call('_enLitMonth', ROWS, 2026, 10) || [];
check('November 2026 has its five Sundays', Array.isArray(lit) ? lit.map(x => x.date) : lit, ['Nov 1', 'Nov 8', 'Nov 15', 'Nov 22', 'Nov 29']);
check('  a saved day and colour are used', lit[1] && [lit[1].day, lit[1].color, lit[1].serviceType], ['22nd Sunday after Pentecost', 'Green', 'Traditional']);
check('  a cell that is not JSON is shown as the text it is', lit[2] && lit[2].day, 'not json');
check('  a colour without a day keeps the roster\'s fallback name', lit[3] && [lit[3].color, /^4th Sunday - /.test(lit[3].day)], ['White', true]);
const dec = call('_enLitMonth', [], 2026, 11) || [];
check('  December has Christmas Eve, Christmas Day and the Watchnight',
  Array.isArray(dec) ? dec.map(x => x.date) : dec, ['Dec 6', 'Dec 13', 'Dec 20', 'Dec 24', 'Dec 25', 'Dec 27', 'Dec 31 PM']);
const wn = dec[dec.length - 1];
check('  the Watchnight is an evening, traditional service', wn && [wn.at && wn.at.pm, wn.serviceType], [true, 'Traditional']);

// ---------------------------------------------------------------- the grid
console.log('\nthe month as weeks, Sunday first');
const shape = (y, m) => {
  const g = call('_enMonthGrid', y, m);
  if (!Array.isArray(g)) return g;
  const inMonth = [].concat(...g).filter(c => c.inMonth).map(c => c.d);
  return { weeks: g.length, sevens: g.every(w => w.length === 7), sundays: g.every(w => new Date(w[0].y, w[0].m, w[0].d).getDay() === 0),
    days: inMonth.length, inOrder: inMonth.every((d, i) => d === i + 1) };
};
check('November 2026 starts on a Sunday and takes five weeks', shape(2026, 10), { weeks: 5, sevens: true, sundays: true, days: 30, inOrder: true });
check('  February 2026 fits four exactly', shape(2026, 1), { weeks: 4, sevens: true, sundays: true, days: 28, inOrder: true });
const jan = call('_enMonthGrid', 2026, 0);
check('  January 2026 opens with the last days of 2025', jan && jan[0] && [jan[0][0].y, jan[0][0].m, jan[0][0].d, jan[0][0].inMonth], [2025, 11, 28, false]);

// ---------------------------------------------------------------- the card
console.log('\nthe duty card');
if (R) { R._enablersYear = 2026; R._enablersRowsOk = true; R._enablersFreqCache = ROWS; R._enablersCatsCache = { 'ada example': { sundayschool: true } }; }
const card = call('_enCardText', 'Ada Example', 2026, 10, ROWS);
const cl = typeof card === 'string' ? card.split('\n') : [];
const at = t => cl.findIndex(l => l.indexOf(t) !== -1);
truthy('its dates come earliest first', at('Sun 8 Nov') >= 0 && at('Sun 8 Nov') < at('Sun 15 Nov') && at('Sun 15 Nov') < at('Sun 22 Nov') && at('Sun 22 Nov') < at('Sun 29 Nov'));
truthy('  two duties on one Sunday share its line', at('Sun 8 Nov') >= 0 && /Liturgist, Singer 1$/.test(cl[at('Sun 8 Nov')]));
truthy('  a Sunday\'s liturgical day is under it', cl[at('Sun 8 Nov') + 1] && cl[at('Sun 8 Nov') + 1].trim() === '_22nd Sunday after Pentecost_');
truthy('  October\'s duty is not on November\'s card', typeof card === 'string' && card.indexOf('Oct') === -1);
truthy('  it names the month and the person', typeof card === 'string' && card.indexOf('November 2026') !== -1 && card.indexOf('Ada Example') !== -1);
truthy('  it carries the calendar page\'s link', typeof card === 'string' && card.indexOf('https://lhc-prep-tool.vercel.app/?view=subscribe&name=Ada%20Example') !== -1);
check('  every character is in the Basic Multilingual Plane', typeof card === 'string' && !/[\uD800-\uDFFF]/.test(card), true);
const none = call('buildDutyCardMessage', 'Ben Sample', 11, 2026, [], '');
truthy('  a month with no duties says so', typeof none === 'string' && none.indexOf('no duties') !== -1 && !/[\uD800-\uDFFF]/.test(none));
const old = call('getDutiesForMember', 'Ada Example', 10, 2026);
check('  the older reader of duties gives them in date order too', Array.isArray(old) ? old.map(d => d.date) : old, ['Nov 8', 'Nov 8', 'Nov 15', 'Nov 22', 'Nov 29']);

// ---------------------------------------------------------------- WhatsApp
console.log('\nthe WhatsApp link');
check('to a number saved in local form', call('_enWaUrl', '012-345 6789', 'hi'), 'https://api.whatsapp.com/send?phone=60123456789&text=hi');
check('  to a number saved in international form', call('_enWaUrl', '+60 12-345 6789', 'hi'), 'https://api.whatsapp.com/send?phone=60123456789&text=hi');
check('  with no number, WhatsApp asks which chat', call('_enWaUrl', '', 'a b'), 'https://api.whatsapp.com/send?text=a%20b');
const msg = 'Line one\n*bold* — _it_ 🙏 & ?=';
const u = call('_enWaUrl', '', msg);
truthy('  the text comes back exactly, emoji and all', typeof u === 'string' && decodeURIComponent(u.split('text=')[1]) === msg);
truthy('  not by wa.me, whose redirect broke the emoji', typeof u === 'string' && u.indexOf('wa.me') === -1);
const preview = call('_enWaHtml', '*Sun 8 Nov* — <b>x</b>\n      _22nd Sunday_\nsnake_case_name https://x.test/?a=1&b=2');
truthy('  the preview shows bold and italic, and escapes what was typed', typeof preview === 'string' &&
  preview.indexOf('<b>Sun 8 Nov</b>') !== -1 && preview.indexOf('&lt;b&gt;x&lt;/b&gt;') !== -1 && preview.indexOf('<i>22nd Sunday</i>') !== -1 &&
  preview.indexOf('snake_case_name') !== -1 && preview.indexOf('&amp;b=2') !== -1);

// ---------------------------------------------------------------- contacts
console.log('\na phone or an email, as typed');
const cc = (f, v) => { const r = call('_enCleanContact', f, v); return r && (r.ok ? 'ok:' + r.value : 'no'); };
check('a phone in local form, spaces tidied', cc('phone', '  012-345   6789 '), 'ok:012-345 6789');
check('  in international form', cc('phone', '+60 12-345 6789'), 'ok:+60 12-345 6789');
check('  letters, or too few digits, are refused', [cc('phone', 'call me'), cc('phone', '12345')], ['no', 'no']);
check('  an empty one takes it off', cc('phone', '   '), 'ok:');
check('  an email', [cc('email', 'a.person@example.com'), cc('email', 'a@b'), cc('email', 'a b@c.com')], ['ok:a.person@example.com', 'no', 'no']);
check('the row a name is kept under, by its own spelling',
  [call('_enMetaKey', { 'Ada  Example': {} }, 'Ada Example'), call('_enMetaKey', { 'Ada Example': {} }, 'Ada Example'), call('_enMetaKey', {}, ' New   Person ')],
  ['Ada  Example', 'Ada Example', 'New Person']);
const ct = call('_enCtHtml', "Kit O'Example", 'phone', '');
truthy('  a missing phone has an Add button, for anyone', typeof ct === 'string' && /data-en-ct="1"/.test(ct) && /No phone saved/.test(ct) && ct.indexOf("O'Neil") === -1);

// The save, against a database that answers as asked.
function fakeDb(answer) {
  const calls = [];
  return { calls, from(table) { return { upsert(row, opts) { calls.push({ table, row: Object.assign({}, row), opts }); return { select() { return Promise.resolve(answer(row)); } }; } }; } };
}
const echo = row => ({ data: [Object.assign({ phone: 'kept', email: 'kept@x.co' }, row)], error: null });

(async () => {
  console.log('\nsaving a contact');
  if (R) R._enablersMetaCache = { 'Ada  Example': { name: 'Ada  Example', phone: '', email: 'ada@example.com' } };
  holder.sb = fakeDb(echo);
  let out = 'not run';
  try { await R._enContactWrite('Ada Example', { phone: '012-345 6789' }); out = 'saved'; } catch (e) { out = 'refused: ' + e.message; }
  const c0 = holder.sb.calls[0];
  check('a phone is saved', out, 'saved');
  check('  under the row\'s own spelling, with the phone alone', c0 && [c0.table, c0.row.name, Object.keys(c0.row).sort(), c0.opts && c0.opts.onConflict],
    ['roster_member_meta', 'Ada  Example', ['name', 'phone', 'updated_at'], 'name']);
  check('  the email beside it is untouched', R && R._enablersMetaCache['Ada  Example'] && [R._enablersMetaCache['Ada  Example'].phone, R._enablersMetaCache['Ada  Example'].email],
    ['012-345 6789', 'ada@example.com']);

  holder.sb = fakeDb(() => ({ data: null, error: { message: 'permission denied' } }));
  try { await R._enContactWrite('Ada Example', { email: 'new@example.com' }); out = 'saved'; } catch (e) { out = 'refused: ' + e.message; }
  check('  the database\'s refusal is reported, not "saved"', out, 'refused: permission denied');
  check('  and nothing on screen changes', R && R._enablersMetaCache['Ada  Example'].email, 'ada@example.com');

  holder.sb = fakeDb(() => ({ data: [], error: null }));
  try { await R._enContactWrite('Ada Example', { email: 'new@example.com' }); out = 'saved'; } catch (e) { out = 'refused'; }
  check('  a write that came back with no row did not happen', out, 'refused');

  holder.sb = fakeDb(row => ({ data: [{ name: row.name, phone: 'something else' }], error: null }));
  try { await R._enContactWrite('Ada Example', { phone: '019-000 0000' }); out = 'saved'; } catch (e) { out = 'refused'; }
  check('  nor did one whose row says otherwise', out, 'refused');

  holder.sb = fakeDb(echo);
  try { await R._enContactWrite('Ben Sample', { phone: '012-111 2222', email: 'bea@example.com' }); out = 'saved'; } catch (e) { out = 'refused'; }
  check('  a PIC\'s card saves both, under a new row', holder.sb.calls[0] && [out, holder.sb.calls[0].row.name, Object.keys(holder.sb.calls[0].row).sort()],
    ['saved', 'Ben Sample', ['email', 'name', 'phone', 'updated_at']]);

  holder.sb = null;
  try { await R._enContactWrite('Ada Example', { phone: '012-345 6789' }); out = 'saved'; } catch (e) { out = 'refused'; }
  check('  with no database, nothing is reported saved', out, 'refused');

  // ---------------------------------------------------------------- wiring
  console.log('\nwhat the screens call');
  const all = method('_renderEnablersAll') || '';
  truthy('anyone gets the add/change rows on a card', /\} else \{\s*\n\s*html \+= '<div class="en-ct-group">' \+ self\._enCtHtml\(name, 'phone', phone\) \+ self\._enCtHtml\(name, 'email', email\)/.test(all));
  truthy('  the duty card and calendar buttons are on every card, not only a PIC\'s or one with a phone',
    /^        html \+= '<button type="button" class="en-act en-act--wa" data-en-card=/m.test(all) && /^        html \+= '<button type="button" class="en-act en-act--cal" data-en-cal-for=/m.test(all));
  const sends = ['sendDutyCardWhatsApp', 'sendSubscribeLinkWhatsApp', 'openDutyCard'].map(n => method(n) || '');
  truthy('  every roster WhatsApp send goes by _enWaUrl, none by wa.me', sends.every(t => t && t.indexOf('_enWaUrl(') !== -1 && t.indexOf('wa.me') === -1));
  truthy('  the Calendar tab draws the month', /_enMonthGrid\(/.test(method('_enCalFill') || '') && /_enDutiesIn\(/.test(method('_enCalFill') || ''));

  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' passed');
  if (EXPECT_BROKEN) {
    console.log(failed.length ? 'negative control: failed as expected' : 'negative control: everything PASSED against source expected to be broken');
    process.exit(failed.length ? 0 : 1);
  }
  process.exit(failed.length ? 1 : 0);
})();
