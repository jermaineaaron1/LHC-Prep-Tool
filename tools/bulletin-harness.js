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

// ── a DOM small enough to run the sanitiser against ────────────────────
// minidom models elements and classes, but not text nodes, sibling walks
// or innerHTML parsing -- and the sanitiser is nothing but those. Rather
// than assert on its source, which would prove only that it was spelled
// the same way, this parses real HTML into real nodes and runs it.
const VOID = new Set(['BR', 'IMG', 'META', 'LINK', 'HR', 'INPUT', 'SOURCE']);
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, b) => {
    if (b[0] === '#') return String.fromCharCode(parseInt(b[1] === 'x' || b[1] === 'X' ? b.slice(2) : b.slice(1), b[1] === 'x' || b[1] === 'X' ? 16 : 10));
    return ENT[b.toLowerCase()] !== undefined ? ENT[b.toLowerCase()] : m;
  });
}
function relink(el) {
  el.firstChild = el.childNodes[0] || null;
  el.childNodes.forEach((c, i) => { c.nextSibling = el.childNodes[i + 1] || null; });
}
function mkText(v) {
  return { nodeType: 3, nodeValue: v, parentNode: null, nextSibling: null, childNodes: [] };
}
function mkEl(tag) {
  const el = { nodeType: 1, tagName: String(tag).toUpperCase(), childNodes: [], style: {},
               parentNode: null, firstChild: null, nextSibling: null };
  el.appendChild = c => { c.parentNode = el; el.childNodes.push(c); relink(el); return c; };
  el.removeChild = c => {
    const i = el.childNodes.indexOf(c);
    if (i >= 0) { el.childNodes.splice(i, 1); c.parentNode = null; relink(el); }
    return c;
  };
  el.querySelectorAll = sel => {
    const want = new Set(sel.split(',').map(s => s.trim().toUpperCase()));
    const out = [];
    (function walk(n) {
      n.childNodes.forEach(c => { if (c.nodeType === 1) { if (want.has(c.tagName)) out.push(c); walk(c); } });
    })(el);
    return out;
  };
  Object.defineProperty(el, 'innerHTML', {
    get: () => '',
    set(v) { el.childNodes = []; parseInto(el, String(v == null ? '' : v)); relink(el); }
  });
  return el;
}
function parseInto(root, html) {
  const stack = [root];
  const re = /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;
  let at = 0, m;
  const push = n => { const p = stack[stack.length - 1]; p.childNodes.push(n); n.parentNode = p; relink(p); };
  while ((m = re.exec(html))) {
    if (m.index > at) push(mkText(decode(html.slice(at, m.index))));
    at = m.index + m[0].length;
    const tag = m[1].toUpperCase();
    if (m[0][1] === '/') {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag) { stack.length = i; break; }
      }
      continue;
    }
    const el = mkEl(tag);
    const sm = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(m[2] || '');
    if (sm) {
      decode(sm[1] || sm[2] || '').split(';').forEach(decl => {
        const i = decl.indexOf(':');
        if (i < 0) return;
        const k = decl.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (k) el.style[k] = decl.slice(i + 1).trim();
      });
    }
    push(el);
    if (!VOID.has(tag) && !/\/\s*>$/.test(m[0])) stack.push(el);
  }
  if (at < html.length) push(mkText(decode(html.slice(at))));
  return root.childNodes;
}

const doc = makeDocument();
doc.createElement = mkEl;
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
                d.giving.entries.length, d.contacts.length];
BLT.addItem('notice'); BLT.addItem('notice'); BLT.addItem('figure');
BLT.addItem('offering'); BLT.addItem('giving'); BLT.addItem('contact');
check('each list grows',
  [d.notices.length, d.attendance.figures.length, d.offering.length,
   d.giving.entries.length, d.contacts.length],
  [before[0] + 2, before[1] + 1, before[2] + 1, before[3] + 1, before[4] + 1]);
check('a new giving purpose is empty, not a copy of the last',
  d.giving.entries[d.giving.entries.length - 1], { purpose: '', name: '', bank: '', number: '', qr: '' });
BLT.removeItem('giving', d.giving.entries.length - 1);
check('  and can be taken away again', d.giving.entries.length, before[3]);
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
  [Array.isArray(old.offering), Array.isArray(old.contacts), Array.isArray(old.giving.entries)],
  [true, true, true]);
// Giving was two loose lines in the first week this shipped. A bulletin
// written then must still open with its details in it, not blank.
const firstWeek = BLT._sane({ giving: { title: 'Online giving',
  lines: ['Luther House Chapel', 'RHB 2120 6800 0442 29'] } });
check('the first week\'s two loose giving lines are carried over',
  firstWeek.giving.entries,
  [{ purpose: '', name: 'Luther House Chapel', bank: '', number: 'RHB 2120 6800 0442 29', qr: '' }]);
check('a bulletin already on the new shape is left alone',
  BLT._sane({ giving: { entries: [{ purpose: 'Building fund', name: 'LHC', bank: 'RHB', number: '1' }] } })
    .giving.entries[0].purpose, 'Building fund');
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
check('and the block highlight is off then too',
  /\.blt-sheet:not\(\.blt-capturing\) \.blt-sec:hover/.test(SRC), true);
// Unscoped, this printed "The theme verse" and "REFERENCE" across the
// masthead of any bulletin whose verse had not been typed yet. A
// placeholder belongs to the editor, never to the page.
check('an empty field prints nothing at all',
  /\.blt-sheet:not\(\.blt-capturing\) \.blt-view:empty::before \{ content: attr\(data-ph\)/.test(SRC), true);
check('  and no unscoped placeholder rule is left',
  /(?<!\)\s)\.blt-view:empty::before/.test(SRC), false);

console.log('\nzooming in on the small print');
// The page is set at 10px and scaled to fit, so on a laptop it lands
// near 70% and the small print cannot be read, let alone corrected.
check('the stage scrolls once the page is wider than it',
  /\.blt-stage \{ padding: 18px 8px 0; overflow-x: auto; \}/.test(SRC), true);
// Centred overflow runs off BOTH sides, so the left of a zoomed page
// could never be scrolled to. Auto margins centre and still scroll.
check('  and is centred by margin, never justify-content',
  /\.blt-stage__box \{ margin: 0 auto; \}/.test(SRC), true);
check('fitting the window is the state it opens in', /var _zoom = null;/.test(SRC), true);
check('the percentage goes back to fitting', /onclick="BLT\.zoomFit\(\)"/.test(SRC), true);
// Zoom is a view setting; it must never reach the captured page, which
// is always the full A4 sheet.
const pngBody = MODULE.slice(MODULE.indexOf('function _png'), MODULE.indexOf('function _pdfBlob'));
check('the capture never consults the zoom', /_zoom/.test(pngBody), false);
check('  it asks for A4 at its own size, with the transform off',
  /width: A4_W, height: A4_H/.test(pngBody) && /transform: 'none'/.test(pngBody), true);

console.log('\nannouncements are numbered');
// The <ol> marker never showed -- something in the app's own CSS strips
// them -- so the items ran together as plain lines.
check('a counter numbers them, not list-style',
  /\.blt-notices \{[^}]*list-style: none; counter-reset: blt-n;/.test(SRC), true);
check('  the number is drawn from that counter',
  /\.blt-notices li::before \{ content: counter\(blt-n\) "\."/.test(SRC), true);
check('  and sits in a column of its own, words beside it',
  /\.blt-notices li \{ counter-increment: blt-n; display: flex;/.test(SRC) &&
  /\.blt-notices__t \{ flex: 1 1 auto; min-width: 0; \}/.test(SRC), true);
check('the words are wrapped so the number cannot collide with them',
  /<li><div class="blt-notices__t">/.test(MODULE), true);

// ── 10. the second column, and the table behind it ─────────────────────
console.log('\nthe page sits in the middle');
// `margin: 0 auto` was cancelled by a negative marginRight that _fit set
// to give the scaled sheet the right footprint: an auto LEFT margin
// against a fixed RIGHT one pushes a box right, and the bulletin sat off
// centre at every zoom. The footprint belongs to a wrapper now.
check('the footprint is the wrapper\'s, the scaling the inner\'s',
  /box\.style\.width = Math\.round\(A4_W \* scale\)/.test(MODULE), true);
check('  so nothing sets a margin that cancels the centring',
  /stage\.style\.margin(Right|Bottom)/.test(MODULE), false);

console.log('\nformatting the words, and what survives a save');
const rich = BLT._richClean.bind(BLT);
check('bold, italic and underline are kept',
  rich('<b>a</b><i>b</i><u>c</u>'), '<b>a</b><i>b</i><u>c</u>');
check('a colour or a face is kept',
  rich('<span style="color: rgb(1, 2, 3); font-family: Cinzel;">x</span>'),
  '<span style="color:rgb(1, 2, 3);font-family:Cinzel;">x</span>');
// Everything else a browser or a paste leaves behind keeps its WORDS and
// loses its markup -- the words are what somebody typed.
check('a pasted table keeps its words and loses itself',
  rich('<table><tr><td>Gotong Royong</td></tr></table>'), 'Gotong Royong');
check('a font tag is unwrapped', rich('<font color="red">x</font>'), 'x');
check('a script cannot reach the bulletin', rich('<script>alert(1)</script>hi'), 'hi');
check('  nor an image, nor an event handler',
  rich('<img src=x onerror="alert(1)"><b onclick="alert(1)">y</b>'), '<b>y</b>');
check('a stray background or size is dropped, the words stay',
  rich('<span style="background:#000;font-size:90px">big</span>'), 'big');
check('angle brackets somebody typed stay text',
  rich('a &lt; b'), 'a &lt; b');
check('line breaks survive', rich('one<br>two'), 'one<br>two');
check('a div becomes a break, not a block',
  rich('one<div>two</div>'), 'one<br>two');
// A paste must never carry the site it came from, even into a rich field.
check('a paste into the form is still inserted as plain text',
  /execCommand\('insertText', false,/.test(MODULE), true);
check('  so no formatting rides in from the site it was copied off',
  /getData\('text\/plain'\)/.test(MODULE), true);

console.log('\nundo and redo');
// Rendering replaces the sheet's HTML and takes the browser's own undo
// stack with it, so the bulletin keeps its own.
check('there are two stacks', /var _undo = \[\], _redo = \[\]/.test(MODULE), true);
check('a run of typing is one step, not one per key',
  /now - _typeAt > 1400/.test(MODULE), true);
check('  and the snapshot is taken BEFORE the keystroke is written',
  /_noteTyping\(\);\s*\n\s*_setPath\(_cur\.data, el\.dataset\.p/.test(MODULE), true);
check('adding and removing an item are each one step',
  (MODULE.match(/_flushTyping\(\); _pushUndo\(\);/g) || []).length >= 2, true);
check('the history does not grow without bound', /UNDO_MAX = 60/.test(MODULE), true);
check('opening another bulletin starts a fresh history',
  /_undo\.length = 0; _redo\.length = 0; _typeSnap = null;/.test(MODULE), true);
check('Ctrl+Z and Ctrl+Shift+Z are wired',
  /if \(e\.shiftKey\) redo\(\); else undo\(\);/.test(MODULE), true);
// What comes back off the stack goes through the same reader as a stored
// row, so an undo can never put a shape on the page that a load could not.
check('an undone state is read back through _sane',
  /_cur\.data = _sane\(JSON\.parse\(_undo\.pop\(\)\)\);/.test(MODULE), true);
// execCommand fires an input event of its own. Reaching the typing
// handler, it opened a TYPING undo step on top of the formatting one, so
// undoing a single Bold took two presses. Found by pressing it.
check('one formatting change is one undo step',
  /if \(_applying\) return;/.test(MODULE) && /_applying = true;/.test(MODULE), true);
check('  and the flag is always put down again',
  /\} finally \{ _applying = false; \}/.test(MODULE), true);
// Removing is a labelled button in the form now, rather than a
// backspace on a field that no longer exists on the sheet.
check('an item is removed by a button that says so',
  /class="blt-dlg__drop" onclick="BLT\.dlgRemove/.test(MODULE), true);

console.log('\nthe account, and the QR code');
check('the name is bold, on its own line',
  /\.blt-give__name \{ font-family: 'Poppins', sans-serif; font-weight: 700;/.test(SRC), true);
check('the bank is a line of its own', /class="blt-give__bank"/.test(MODULE), true);
check('and the number is labelled', /A\/C No :/.test(MODULE), true);
check('the chapel\'s account is what a new bulletin starts with',
  [BLT._blank().giving.entries[0].name, BLT._blank().giving.entries[0].bank,
   BLT._blank().giving.entries[0].number],
  ['Luther House Chapel', 'RHB Bank', '2120-68000-44-22-9']);
// A QR travels in the row so it reaches the PDF without a second trip to
// storage -- which is only safe if it is an image and a small one.
check('a QR is kept with its entry', 'qr' in BLT._blank().giving.entries[0], true);
check('only an image data URL is read back',
  [BLT._sane({ giving: { entries: [{ qr: 'javascript:alert(1)' }] } }).giving.entries[0].qr,
   BLT._sane({ giving: { entries: [{ qr: 'https://example.com/x.png' }] } }).giving.entries[0].qr,
   BLT._sane({ giving: { entries: [{ qr: 'data:image/png;base64,AAA' }] } }).giving.entries[0].qr],
  ['', '', 'data:image/png;base64,AAA']);
check('there is a ceiling on what may be stored', /QR_MAX = 350 \* 1024/.test(MODULE), true);
check('the empty slot does not print', /\.blt-capturing \.blt-qr--empty/.test(SRC), true);

console.log('\nputting a QR on the bulletin');
// The slot opened a file picker all along, but a 55px box labelled "QR
// code" reads as a placeholder, not a button -- so it was never used.
check('the slot says what it does', /<span>Add QR<\/span>/.test(MODULE), true);
check('  and says it again on hover', /title="Choose a QR picture, or drop or paste one here"/.test(MODULE), true);
// Three ways in, because a QR is as likely to be on the clipboard --
// copied out of a banking app -- as in a file.
check('it can be clicked', /onclick="BLT\.pickQr\(/.test(MODULE), true);
check('it can be dropped on', /ondrop="BLT\.dropQr\(/.test(MODULE), true);
check('  and a drop is stopped from navigating the page',
  /function dropQr\(ev, i\) \{\s*\n\s*ev\.preventDefault\(\);/.test(MODULE), true);
check('it can be pasted into', /document\.addEventListener\('paste', _qrPaste\);/.test(MODULE), true);
check('  the paste lands on the slot that has focus',
  /a\.closest\('\.blt-qr'\)/.test(MODULE) && /slot\.dataset\.qrI/.test(MODULE), true);
check('all three go through one door',
  (MODULE.match(/_qrAccept\(/g) || []).length >= 4, true);

// A photograph of a QR is a megapixel file; refusing it outright was
// the old behaviour and it is the commonest thing somebody would try.
check('a big picture is scaled down rather than refused', /QR_SIDE = 512/.test(MODULE), true);
check('  PNG first, so a plain QR keeps its edges',
  /var out = c\.toDataURL\('image\/png'\);/.test(MODULE), true);
check('  then JPEG, which PNG cannot do for a photographed one',
  /c\.toDataURL\('image\/jpeg', 0\.85\)/.test(MODULE) && /c\.toDataURL\('image\/jpeg', 0\.6\)/.test(MODULE), true);
// A transparent PNG over the gold block has no quiet zone and will not
// scan, and JPEG has no alpha at all.
check('  on a white ground, so it still scans',
  /g\.fillStyle = '#ffffff';\s*\n\s*g\.fillRect\(0, 0, c\.width, c\.height\);/.test(MODULE), true);
check('anything that is not a picture is turned away',
  /if \(!\/\^image\\\/\/\.test\(file\.type \|\| ''\)\)/.test(MODULE), true);

console.log('\nthe sheet is read, not typed into');
// Two ways to write one field meant two code paths for it, and the
// in-place one was 10px type you could not aim at on a phone. The page
// is now a page; the form is where it changes.
check('no field on the sheet is editable',
  /contenteditable/.test(MODULE.slice(MODULE.indexOf('function _ed('), MODULE.indexOf('function _x('))), false);
check('  they are shown through one class', /class="blt-view /.test(MODULE), true);
// The FORM's fields must still be editable, or nothing can be typed.
check('the form\'s fields still are',
  /'blt-dlg__f blt-ed' \+ \(f\.rich \? ' blt-ed--rich' : ''\)/.test(MODULE) ||
  /class="blt-dlg__f blt-ed/.test(MODULE), true);
check('  and still say which are rich',
  /contenteditable="' \+ \(f\.rich \? 'true' : 'plaintext-only'\)/.test(MODULE), true);

console.log('\ndouble click, and double TAP');
// `dblclick` never fires on a phone: the page allows zooming, so a
// double tap is a zoom and the browser keeps it (gotcha 28). The roster
// hit this same wall; a desktop-only binding would have left the form
// unreachable on the phones this is mostly read on.
check('a block opens on double click', /el\.ondblclick = function/.test(MODULE), true);
check('  and on a double TAP, which is a different event entirely',
  /addEventListener\('touchend'/.test(MODULE), true);
check('  within the same window the roster uses',
  /\(now - _tapAt\) < 400/.test(MODULE), true);
// Without preventDefault the second tap is swallowed as a zoom.
check('  and the second tap is stopped from zooming the page',
  /e\.preventDefault\(\); +\/\/ or the second tap is a zoom/.test(MODULE), true);
check('  the listener is not passive, or it could not',
  /\{ passive: false \}/.test(MODULE), true);
// Every block, not just the ones somebody remembered.
const stamped = (MODULE.match(/_secAttr\('(\w+)'\)/g) || []).map(m => /_secAttr\('(\w+)'\)/.exec(m)[1]).sort();
check('every section is reachable by it', stamped, Object.keys(BLT.SECTIONS).sort());
check('  and the binder runs after every draw',
  /sheet\.innerHTML = h;\s*\n\s*_bindOpeners\(\);/.test(MODULE), true);
// Tapping the QR slot or a +/x must not also open the form.
check('the controls inside a block are not swallowed',
  (MODULE.match(/closest\('\.blt-qr, \.blt-x, \.blt-add, \.blt-pen'\)/g) || []).length >= 2, true);
// A touch screen has no hover, so the pencil would never appear there.
check('the pencil shows where there is no hover',
  /@media \(hover: none\) \{ \.blt-pen \{ opacity: \.9; \} \}/.test(SRC), true);

console.log('\nthe form opens in the middle');
check('centred, not slid up from the bottom',
  /\.blt-dlg \{[^}]*align-items: center;/.test(SRC), true);
// Scoped to this card: that radius is used by four other components
// in the app, so searching the whole file proved nothing.
check('  with no bottom-sheet corners left on THIS card',
  /\.blt-dlg__card \{[^}]*border-radius: 16px;/.test(SRC), true);
check('  and no width-based override putting it back',
  /@media \(min-width: 640px\) \{\s*\n\s*\.blt-dlg \{ align-items: center; \}/.test(SRC), false);

console.log('\nthe duty labels give their width to the names');
// table-layout:fixed with no colgroup splits three columns evenly, so
// the labels -- which are short -- had as much room as the names, which
// run two and three to a cell.
check('the columns are declared, not left to split evenly',
  /<colgroup><col style="width:28%"><col style="width:36%"><col style="width:36%"><\/colgroup>/.test(MODULE), true);
check('  and the two name columns are the wider pair',
  (function () {
    const m = /width:(\d+)%"><col style="width:(\d+)%"><col style="width:(\d+)%/.exec(MODULE);
    return m ? (Number(m[2]) > Number(m[1]) && Number(m[2]) === Number(m[3])) : false;
  })(), true);

console.log('\nevery block opens a dialogue');
// An A4 page set at 10px can be typed on, but it is squinting work. The
// same fields open at a size a person can read.
const secKeys = Object.keys(BLT.SECTIONS);
check('there is one for each block on the sheet',
  secKeys, ['verse', 'prayer', 'notices', 'giving', 'figures', 'contacts']);
check('each one is titled and has something to edit',
  secKeys.filter(k => !BLT.SECTIONS[k].title || !(BLT.SECTIONS[k].blocks || []).length), []);
// A list in a dialogue adds and removes through the SAME two functions
// the sheet uses, so there is one definition of what an item is.
const addKeys = [];
secKeys.forEach(k => (BLT.SECTIONS[k].blocks || []).forEach(b => { if (b.list) addKeys.push(b.addKey); }));
check('every list says which kind of item it holds',
  addKeys.sort(), ['contact', 'figure', 'giving', 'notice', 'offering']);
check('  and those are the kinds addItem knows',
  addKeys.filter(k => !new RegExp("what === '" + k + "'").test(MODULE)), []);
check('adding from the dialogue goes through addItem',
  /function dlgAdd\(what\) \{ addItem\(what\); _dlgRefresh\(\); \}/.test(MODULE), true);
check('  and removing through removeItem',
  /function dlgRemove\(what, i\) \{ removeItem\(what, i\); _dlgRefresh\(\); \}/.test(MODULE), true);
// Typing in the dialogue should move the page behind it: the sheet is
// what is being edited, not a separate preview.
check('the sheet redraws while you type in the dialogue',
  /_dlgPaint = setTimeout\(function\(\) \{ render\(\); \}, 220\);/.test(MODULE), true);
check('a dialogue field is the same kind of field as the sheet\'s',
  /class="blt-dlg__f blt-ed/.test(MODULE) || /'blt-dlg__f blt-ed'/.test(MODULE), true);
check('  so the formatting bar reaches it',
  /blt-ed--rich/.test(MODULE), true);
// The bar belongs where the words are.
check('the formatting bar is in the dialogue',
  /<div class="blt-dlg__bar">/.test(MODULE), true);
check('  and no longer in the toolbar', /id="bltFmt"/.test(SRC), false);
check('undo and redo stay in the toolbar, being about the whole bulletin',
  /id="bltUndo"/.test(SRC) && /id="bltRedo"/.test(SRC), true);
check('the dialogue closes on Escape and on the backdrop',
  /e\.key === 'Escape'/.test(MODULE) && /if \(e\.target === bd\) closeSection\(\)/.test(MODULE), true);
check('a dialogue never prints', /\.blt-capturing \.blt-pen/.test(SRC), true);

console.log('\na phone opens close enough to read');
// Fitting an A4 page to a phone lands near 45%, which is a picture of a
// bulletin rather than something you can correct.
check('a phone opens at 87%', /PHONE_ZOOM = 0\.87/.test(MODULE), true);
check('  only on arrival, so a chosen size is not taken away',
  /if \(_zoom == null && _isPhone\(\)\) _zoom = PHONE_ZOOM;/.test(MODULE), true);
check('  and a coarse pointer counts as a phone, not just a narrow window',
  /\(hover: none\) and \(pointer: coarse\)/.test(MODULE), true);
// Centred, a phone would open in the middle of the duty table.
check('it starts at the left edge, where the typed blocks are',
  /sc\.scrollLeft = 0; sc\._bltScrolled = true;/.test(MODULE), true);

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
