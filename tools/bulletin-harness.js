'use strict';
// Regression harness for the Sunday bulletin.
//
// WHY THIS EXISTS
// The bulletin is the one thing in this app that is printed, handed to a
// congregation and not looked at again. Nobody proof-reads it against the
// roster on a Sunday morning. So the failures that matter are the quiet
// ones: a cell that comes out blank because a roster role was renamed, a
// psalm sentinel normalised away, a duty stored in the bulletin that then
// disagrees with the roster nobody thought to re-check.
//
// THE DANGEROUS DIRECTION
// Printing a name that is wrong is worse than printing nothing, and both
// are worse than the page refusing to draw. The checks below care most
// that every role the bulletin reads is a role the roster actually has,
// and that no duty is ever written into the bulletin's own row.
//
// USAGE
//   node tools/bulletin-harness.js                 # ../Index.html
//   node tools/bulletin-harness.js path/to/file.html
//   node tools/bulletin-harness.js <file> --expect-broken
//
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

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log((ok ? '  ok    ' : '  FAIL  ') + label);
  if (!ok) {
    console.log('          got  ' + JSON.stringify(got));
    console.log('          want ' + JSON.stringify(want));
  }
}

// ── slice the module out of the page ───────────────────────────────────
const START = 'var SBQ_BULLETINS = {';
const END = 'window.BLT = BLT;';
const a = SRC.indexOf(START), b = SRC.indexOf(END, a);
if (a < 0 || b < 0) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: the bulletin module is not in this file, as expected.');
    process.exit(0);
  }
  console.error('Could not find the bulletin module in ' + path.basename(INDEX));
  process.exit(1);
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the bulletin module is present.');
  process.exit(1);
}
const MODULE = SRC.slice(a, b).replace(/\r/g, '');

const doc = makeDocument();
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const win = {
  addEventListener() {}, escapeHtml: esc, showToast() {},
  innerWidth: 1200, scrollX: 0, scrollY: 0, document: doc
};
win.window = win;

let BLT;
try {
  BLT = new Function(
    'window', 'document', 'getSupabaseClient', 'SBQ_ROSTER', 'STATE',
    '_loadScript', 'navigator', 'console',
    MODULE + '\nreturn BLT;'
  )(win, doc, () => null, { getData: () => Promise.resolve([]) }, undefined,
    () => Promise.resolve(), {}, console);
} catch (e) {
  console.error('The bulletin module would not run: ' + e.message);
  process.exit(1);
}

// ── 1. every role it reads is a role the roster has ────────────────────
console.log('\nthe bulletin reads roles the roster actually has');
// The roster's own definition list, taken from the page rather than typed
// here -- the point is to compare the two, so a copy would prove nothing.
const ROSTER_IDS = new Set();
const rolesBlock = SRC.slice(SRC.indexOf("{type:'service-type',id:'service_type'"));
const stop = rolesBlock.indexOf('getSpecialDays:');
(rolesBlock.slice(0, stop > 0 ? stop : 40000)
  .match(/\{type:'(?:role|scripture)',id:'([a-z0-9_]+)'/g) || [])
  .forEach(m => ROSTER_IDS.add(/id:'([a-z0-9_]+)'/.exec(m)[1]));
check('the roster role list was found', ROSTER_IDS.size > 20, true);

const named = [];
BLT.ROWS.forEach(r => {
  (r.roles || []).forEach(x => named.push(x));
  if (r.ref) named.push(r.ref);
});
check('every role and scripture slot it names exists',
  named.filter(x => !ROSTER_IDS.has(x)), []);
check('  and it names a fair number of them', named.length >= 20, true);

// Spot-checks of the mapping that a rename would not catch: these are the
// rows where the bulletin's label and the roster's id differ most.
const byKey = {};
BLT.ROWS.forEach(r => { byKey[r.key] = r; });
check('first reading takes the READER and the PASSAGE apart',
  [byKey.read1.roles, byKey.read1.ref], [['reader1'], 'reading1']);
check('second reading likewise',
  [byKey.read2.roles, byKey.read2.ref], [['reader2'], 'reading2']);
check('the psalm row is a passage with no reader',
  [byKey.psalm.roles, byKey.psalm.ref], [undefined, 'psalm']);
check('musicians gathers the whole band and every singer',
  byKey.music.roles,
  ['pianist', 'guitarist', 'bassist', 'drummer', 'singer1', 'singer2', 'singer3', 'singer4']);
check('ushers, communion, altar and Sunday school gather all of theirs',
  [byKey.ushers.roles.length, byKey.communion.roles.length,
   byKey.altar.roles.length, byKey.ssteach.roles.length], [2, 3, 2, 3]);

// ── 2. the two the roster has no role for ──────────────────────────────
console.log('\nthe two duties the roster has no role for');
const manual = BLT.ROWS.filter(r => r.manual).map(r => r.key);
check('acolyte and flower offering are typed, not read', manual, ['acolyte', 'floweroff']);
check('  and nothing else is',
  BLT.ROWS.filter(r => r.manual && !r.roles && !r.ref).length, 2);
check('neither pretends to be a roster role',
  [ROSTER_IDS.has('acolyte'), ROSTER_IDS.has('floweroff')], [false, false]);

// ── 3. no duty is stored in the bulletin ───────────────────────────────
console.log('\nthe bulletin stores no duties');
// A bulletin holding its own copy of the roster is a bulletin that goes
// quietly wrong the week somebody swaps a reader. The only duty-shaped
// thing in the stored shape is `manual`, for the two above.
const blank = BLT._blank();
const stored = JSON.stringify(blank);
check('no roster role id appears in a fresh bulletin',
  [...ROSTER_IDS].filter(id => stored.indexOf('"' + id + '"') > -1), []);
check('the only duty store is the manual one',
  Object.keys(blank).filter(k => /duty|duties|roster|roles/i.test(k)), []);
check('  which starts empty', blank.manual, {});

// ── 4. the psalm sentinel ──────────────────────────────────────────────
console.log('\na bare dash means different things in different slots');
// "-" in a scripture slot is the roster's way of saying this service has
// no psalm. Normalising it away is exactly what the psalm-slot rule
// forbids; dropping it from a NAME is just tidying an empty cell.
check('a dash is kept in a scripture slot', BLT._clean('-', true), '-');
check('a dash is dropped from a name', BLT._clean('-', false), '');
check('__BLANK__ is empty either way',
  [BLT._clean('__BLANK__', true), BLT._clean('__BLANK__', false)], ['', '']);
check('TBD is empty either way',
  [BLT._clean('TBD', true), BLT._clean('TBD', false)], ['', '']);
check('a real passage survives', BLT._clean(' Psalm 70 ', true), 'Psalm 70');
check('a liturgical-day object is unwrapped',
  BLT._clean({ day: 'Christ the King' }, true), 'Christ the King');

console.log('\nthe liturgical day, which the roster stores as JSON');
// Found by looking at the page: the roster keeps that cell as a JSON
// STRING, so unwrapping objects alone put {"day":"25th Sunday after
// Pentecost","color":"Green"} across the masthead.
check('the day is read out of the stored JSON',
  BLT._litDay('{"day":"25th Sunday after Pentecost","color":"Green"}'),
  '25th Sunday after Pentecost');
check('an object is still unwrapped', BLT._litDay({ day: 'Christ the King' }), 'Christ the King');
// A cell somebody typed by hand is not JSON, and must show what it says
// rather than disappearing.
check('plain text is kept as it is', BLT._litDay('Harvest Festival'), 'Harvest Festival');
check('a brace that is not JSON is kept too', BLT._litDay('{not json'), '{not json');
check('nothing is nothing', [BLT._litDay(''), BLT._litDay(null)], ['', '']);
check('JSON without a day reads as empty', BLT._litDay('{"color":"Green"}'), '');
check('and __BLANK__ still comes out empty once cleaned',
  BLT._clean(BLT._litDay('__BLANK__'), true), '');

// ── 5. reading a cell ──────────────────────────────────────────────────
console.log('\nreading one cell out of the roster');
const day = { dateStr: 'Nov 15', year: 2026, date: new Date(2026, 10, 15) };
const cur = { serviceDate: 'Nov 15', year: 2026, title: '', data: BLT._blank() };
cur.data.manual = { acolyte: { 'Nov 15': 'Daniel' } };
BLT._inject([day], 0, cur, {
  'preacher__Nov 15': 'Rev Benedict M.',
  'reader1__Nov 15': 'Gina Phan',
  'reading1__Nov 15': 'Revelation 7:9-17',
  'usher1__Nov 15': 'Karen Ngai',
  'usher2__Nov 15': 'Karen Ngai',
  'communion1__Nov 15': '__BLANK__',
  'psalm__Nov 15': '-'
});
check('a name comes through', BLT._cell(byKey.preacher, day).names, ['Rev Benedict M.']);
check('a reader and a passage land in one cell',
  BLT._cell(byKey.read1, day), { names: ['Gina Phan'], ref: 'Revelation 7:9-17' });
check('the same person rostered twice is listed once',
  BLT._cell(byKey.ushers, day).names, ['Karen Ngai']);
check('a blanked slot leaves nothing',
  BLT._cell(byKey.communion, day).names, []);
check('the no-psalm sentinel is printed, not swallowed',
  BLT._cell(byKey.psalm, day).ref, '-');
check('a typed row comes from the bulletin, keyed by its date',
  BLT._cell(byKey.acolyte, day), { manual: true, text: 'Daniel' });
check('a missing second service reads as empty, it does not throw',
  BLT._cell(byKey.preacher, null), { names: [], ref: '' });

// ── 6. adding and taking away ──────────────────────────────────────────
console.log('\nthe admin adds and takes away items');
const d = cur.data;
const before = [d.notices.length, d.attendance.figures.length, d.offering.length,
                d.giving.lines.length, d.contacts.length];
BLT.addItem('notice'); BLT.addItem('notice'); BLT.addItem('figure');
BLT.addItem('offering'); BLT.addItem('giving'); BLT.addItem('contact');
check('each list grows',
  [d.notices.length, d.attendance.figures.length, d.offering.length,
   d.giving.lines.length, d.contacts.length],
  [before[0] + 2, before[1] + 1, before[2] + 1, before[3] + 1, before[4] + 1]);
d.notices[0].lead = 'Keep me';
d.notices[1].lead = 'Drop me';
BLT.removeItem('notice', 1);
check('the right one goes', d.notices.map(n => n.lead), ['Keep me']);
check('removing a list that does not exist changes nothing',
  (BLT.removeItem('nonsense', 0), d.notices.length), 1);
BLT.addItem('nonsense');
check('  and nor does adding to one', d.notices.length, 1);

// ── 7. an older bulletin still opens ───────────────────────────────────
console.log('\na bulletin saved by an older page still opens');
const old = BLT._sane({ prayer: 'Almighty God', notices: [{ lead: 'LAWA' }] });
check('what it had is kept', [old.prayer, old.notices[0].lead], ['Almighty God', 'LAWA']);
check('what it lacked is filled in',
  [Array.isArray(old.offering), Array.isArray(old.contacts), typeof old.giving.lines],
  [true, true, 'object']);
check('junk does not get through',
  [BLT._sane(null).notices, BLT._sane({ notices: 'nope' }).notices], [[], []]);
check('a notice missing its body still draws',
  BLT._sane({ notices: [{ lead: 'x' }] }).notices[0], { lead: 'x', body: '' });

// ── 8. the small machinery ─────────────────────────────────────────────
console.log('\nwriting a typed field back into the bulletin');
const obj = {};
BLT._setPath(obj, 'verse.text', 'hello');
BLT._setPath(obj, 'notices.0.lead', 'LAWA');
BLT._setPath(obj, 'manual.acolyte.Nov 15', 'Daniel');
check('a nested path is written', obj.verse.text, 'hello');
check('a numeric step makes an array', Array.isArray(obj.notices), true);
check('  and lands in it', obj.notices[0].lead, 'LAWA');
check('a date with a space in it is one key', obj.manual.acolyte['Nov 15'], 'Daniel');

// _textOf walks real DOM nodes -- nodeType, firstChild, nextSibling --
// which minidom does not model, so the tree is built literally here. That
// is the point of the check: a browser hands this walker whatever a paste
// or a backspace left behind, and it has to come back as the typed text.
function tree(kids) {
  for (let i = 0; i < kids.length - 1; i++) kids[i].nextSibling = kids[i + 1];
  return { firstChild: kids[0] || null, nodeType: 1, tagName: 'DIV' };
}
const txt = v => ({ nodeType: 3, nodeValue: v, nextSibling: null });
const el = (tag, kids) => Object.assign(
  tree(kids || []), { nodeType: 1, tagName: tag, nextSibling: null });

check('plain text comes back as it was',
  BLT._textOf(tree([txt('Almighty God')])), 'Almighty God');
check('a <br> is a line break',
  BLT._textOf(tree([txt('one'), el('BR'), txt('two')])), 'one\ntwo');
check('a block element is one too',
  BLT._textOf(tree([txt('one'), el('DIV', [txt('two')])])), 'one\ntwo');
check('nested markup is flattened, not read as HTML',
  BLT._textOf(tree([el('SPAN', [el('B', [txt('LAWA')])]), txt(' gathering')])),
  'LAWA gathering');
check('trailing blank lines are dropped',
  BLT._textOf(tree([txt('one'), el('BR'), el('BR')])), 'one');

// ── 9. the page it prints is the page on screen ────────────────────────
console.log('\nthe PDF is the page you were looking at');
// The sheet is laid out at A4 and scaled to fit the screen. html-to-image
// captures the node it is given AT THAT NODE'S OWN SIZE, so a transform on
// the sheet itself would be baked into the picture -- a bulletin printed
// at whatever fraction the phone happened to be showing.
check('the scale goes on the wrapper', /stage\.style\.transform = 'scale\(/.test(MODULE), true);
check('  and never on the sheet',
  /sheet\.style\.transform\s*=/.test(MODULE), false);
check('the capture asks for A4 at its true size',
  /width: A4_W, height: A4_H/.test(MODULE), true);
check('and it is a real PDF, not a picture called one',
  /doc\.output\('blob'\)/.test(MODULE) && /type: 'application\/pdf'/.test(MODULE), true);
// Sharing a file beats sharing a link: the bulletin lands IN the chat.
check('the file itself goes to WhatsApp where the device allows it',
  /navigator\.canShare\(\{ files: \[file\] \}\)/.test(MODULE), true);
check('  with a saved file and a message where it does not',
  /lhcWhatsAppUrl/.test(MODULE), true);
// The metered render service must stay out of this (it is nearly spent,
// and it is the church's own quota).
check('nothing here goes through the server renderer',
  /render-roster-pdf/.test(MODULE), false);

console.log('\nan A4 page does not grow');
// All three found by capturing the page and looking at it.
//
// The sheet is a fixed A4 box. Before this, a fourth long announcement
// simply fell off the bottom -- silently, and only on paper, which is the
// one place nobody checks before it is handed out.
check('the sheet clips rather than shoving the footer off the page',
  /\.blt-sheet \{\s*\n\s*width: 794px; height: 1123px; box-sizing: border-box; overflow: hidden;/.test(SRC), true);
check('and every draw measures whether it still fits',
  /_fit\(\);\s*\n\s*_warnIfLong\(\);/.test(MODULE), true);
check('  by measuring the part that flexes, not the fixed page',
  /body\.scrollHeight - body\.clientHeight/.test(MODULE), true);
check('  and says so out loud', /Too long for one page/.test(MODULE), true);
// "RM 9,913" wrapped onto two lines and landed on the row beneath it.
check('an offering amount never wraps',
  /\.blt-money__v \{ flex: 0 0 auto; white-space: nowrap;/.test(SRC), true);
check('  the label beside it is what gives way',
  /\.blt-money__row > span:first-child \{ flex: 1 1 auto; min-width: 0;/.test(SRC), true);
// Content piled at the top left a white band above the footer.
check('the duty table takes up the page\'s slack',
  /\.blt-main \.blt-table \{ flex: 1 1 auto; \}/.test(SRC), true);

console.log('\nthe editor does not print itself');
check('the add and remove controls are hidden while capturing',
  /\.blt-capturing \.blt-x, \.blt-capturing \.blt-add \{ display: none !important; \}/.test(SRC), true);
check('and the hover outline is off then too',
  /\.blt-sheet:not\(\.blt-capturing\) \.blt-ed:hover/.test(SRC), true);

// ── 10. the second column, and the table behind it ─────────────────────
console.log('\nthe second column, and the table behind it');
// Opening the bulletin on the last Sunday of a month still needs a NEXT
// Sunday for the right-hand column, so it looks three months out.
check('it looks further than this month', /k < 3; k\+\+/.test(MODULE), true);
check('and sorts what it finds', /out\.sort\(/.test(MODULE), true);

const SQL = path.join(path.dirname(INDEX), 'migrations', '2026-11-10_bulletins.sql');
check('the migration is in the repo', fs.existsSync(SQL), true);
if (fs.existsSync(SQL)) {
  const sql = fs.readFileSync(SQL, 'utf8');
  // Without the unique index the upsert silently inserts a second row
  // every time somebody types, and the bulletin they reopen is a guess.
  check('  it makes one bulletin per service unique',
    /create unique index[\s\S]*?on public\.bulletins \(service_date, year\)/i.test(sql), true);
  check('  the upsert names that pair',
    /onConflict: 'service_date,year'/.test(MODULE), true);
  check('  and RLS is turned on with a policy',
    /enable row level security/i.test(sql) && /create policy/i.test(sql), true);
}

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
