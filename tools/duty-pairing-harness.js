'use strict';
// Regression harness for who may hold two duties in one service.
//
// WHY THIS EXISTS
// The rules come from the church, not from anything the code can work out, and
// they are asymmetric in ways that look like mistakes until you know the
// building: a Reader may also be on Altar Guild, and may also sing, but an
// Altar Guild member may not assist at Communion. Written as a map of "who may
// also hold what", a single one-sided entry -- altar listing reader while
// reader does not list altar -- would make a clash appear or vanish depending
// on which cell a PIC edited last. Nothing on screen would explain it.
//
// So this asserts the church's list back, rule by rule, in the words it was
// given in, and separately asserts the map is symmetric.
//
// HOW IT WORKS
// Like the other harnesses here, it reimplements nothing: it slices the REAL
// DUTY_PAIRING, DUTY_PAIRS_WITH_ANYTHING and the four methods out of
// Index.html and runs them.
//
// USAGE
//   node tools/duty-pairing-harness.js                 # checks ../Index.html
//   node tools/duty-pairing-harness.js path/to/file.html
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const INDEX = process.argv.slice(2).find(a => !a.startsWith('--')) ||
              path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }

const src = fs.readFileSync(INDEX, 'utf8');
const lines = src.split(/\r?\n/);

const results = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(ok);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'));
}

function extractMember(name) {
  const startIdx = lines.findIndex(l => new RegExp('^    ' + name + ':').test(l));
  if (startIdx < 0) throw new Error('member not found in ' + path.basename(INDEX) + ': ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{' || ch === '[' || ch === '(') { depth++; started = true; }
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced brackets while extracting: ' + name);
}

const members = ['DUTY_PAIRING', 'DUTY_PAIRS_WITH_ANYTHING', 'DUTY_WORD', '_clashDutyCategory',
                 '_dutyPairing', '_isSoloDuty', '_dutiesMayPair', '_catWord',
                 '_pairRefusalReason', '_roleWord', '_serviceOverlaps'];
console.log('Extracted from ' + path.basename(INDEX) + ':');
const sliced = {};
for (const m of members) {
  sliced[m] = extractMember(m);
  console.log('  ' + m + ' @ line ' + sliced[m].line);
}

const engineSrc = 'var RE = {\n' +
  members.map(m => sliced[m].text.replace(/,\s*$/, '')).join(',\n') +
  '\n};\n; return RE;';
const RE = new Function('Object', 'JSON', engineSrc)(Object, JSON);
RE._dutyPairingOverrides = null;
// _roleWord reads this.ROLES for the human label, and _serviceOverlaps walks it
// to find who is on duty -- so every entry carries the type it filters on, and
// the list covers every duty these checks put somebody on. Order matters only in
// that it is the order the real ROLES has, which is the order a card lists.
RE.ROLES = [
  { type: 'role', id: 'preacher', label: 'Preacher' },
  { type: 'role', id: 'liturgist', label: 'Liturgist' },
  { type: 'role', id: 'usher1', label: 'Usher 1' },
  { type: 'role', id: 'usher2', label: 'Usher 2' },
  { type: 'role', id: 'reader1', label: 'Reader 1' },
  { type: 'role', id: 'communion1', label: 'Communion Assistant 1' },
  { type: 'role', id: 'communion2', label: 'Communion Assistant 2' },
  { type: 'role', id: 'altar1', label: 'Altar Guild 1' },
  { type: 'role', id: 'pianist', label: 'Pianist' },
  { type: 'role', id: 'singer1', label: 'Singer 1' },
  { type: 'role', id: 'lcd', label: 'LCD Operator' },
  { type: 'role', id: 'pa', label: 'PA System' },
  { type: 'role', id: 'flowerarrangement', label: 'Flower Arrangement' },
  // A header, to prove the walk filters on type rather than taking every row.
  { type: 'header', id: 'h_music', label: 'MUSIC MINISTRY' }
];

const ID = {
  preacher: 'preacher', liturgist: 'liturgist', usher: 'usher1', reader: 'reader1',
  communion: 'communion2', altar: 'altar1', pianist: 'pianist', guitarist: 'guitarist',
  bassist: 'bassist', drummer: 'drummer', singer: 'singer1', lcd: 'lcd', pa: 'pa',
  livestream: 'streaming', sundayschool: 'ssteacher1', flowerarrangement: 'flowerarrangement'
};
function mayPair(a, b) { return RE._dutiesMayPair.call(RE, ID[a] || a, ID[b] || b); }

console.log('\nScenario 1 - the map is symmetric');
{
  // A one-sided entry is the failure mode nobody would diagnose from the UI.
  const asym = [];
  for (const a of Object.keys(RE.DUTY_PAIRING)) {
    for (const b of RE.DUTY_PAIRING[a]) {
      if (!(RE.DUTY_PAIRING[b] || []).includes(a)) asym.push(a + ' lists ' + b + ', not returned');
    }
  }
  check('every pairing is listed from both sides', asym, []);

  const unknown = [];
  for (const a of Object.keys(RE.DUTY_PAIRING)) {
    for (const b of RE.DUTY_PAIRING[a]) if (!(b in RE.DUTY_PAIRING)) unknown.push(a + ' -> ' + b);
  }
  check('no pairing points at a duty that does not exist', unknown, []);

  check('every duty category has an entry',
    Object.keys(ID).filter(c => c !== 'flowerarrangement' && !(c in RE.DUTY_PAIRING)), []);
}

console.log('\nScenario 2 - the rules as the church gave them');
{
  // 1. altar guild + communion assistant -- avoid, they overlap
  check('1. Altar Guild + Communion Assistant is refused', mayPair('altar', 'communion'), false);

  // 2/3/4/6/7/8/10. solo duties
  const solo = { liturgist: 2, preacher: 3, usher: 4, pianist: 6, guitarist: 6,
                 bassist: 6, drummer: 6, pa: 7, lcd: 8, sundayschool: 10 };
  // Liturgist and Usher are solo apart from Communion Assistant, which rule 9
  // names explicitly -- so they are checked against everything else.
  const soloExceptions = { liturgist: ['communion'], usher: ['communion'] };
  for (const duty of Object.keys(solo)) {
    const allowed = Object.keys(ID).filter(other =>
      other !== duty && other !== 'flowerarrangement' &&
      !(soloExceptions[duty] || []).includes(other) &&
      mayPair(duty, other));
    check(solo[duty] + '. ' + duty + ' pairs with nothing else', allowed, []);
  }

  // 5. Bible reader -- singer, altar guild, flower arrangement, live streaming
  const readerPairs = Object.keys(ID).filter(o => o !== 'reader' && mayPair('reader', o)).sort();
  check('5. Reader pairs with exactly singer, altar, flowers, live streaming',
    readerPairs, ['altar', 'flowerarrangement', 'livestream', 'singer']);

  // Live Streaming is otherwise a desk job like PA -- reading is its one
  // exception, so it is worth pinning from both ends.
  const lsPairs = Object.keys(ID).filter(o => o !== 'livestream' && mayPair('livestream', o)).sort();
  check('Live Streaming pairs with exactly reader and flowers',
    lsPairs, ['flowerarrangement', 'reader']);

  // 9. Communion Assistant -- liturgist, singer, flower arranger, usher
  const caPairs = Object.keys(ID).filter(o => o !== 'communion' && mayPair('communion', o)).sort();
  check('9. Communion Assistant pairs with exactly liturgist, singer, usher, flowers',
    caPairs, ['flowerarrangement', 'liturgist', 'singer', 'usher']);
}

console.log('\nScenario 3 - one person twice over');
{
  check('two Ushers is the same person twice', mayPair('usher1', 'usher2'), false);
  check('Reader 1 and Reader 2 is the same person twice', mayPair('reader1', 'reader2'), false);
  check('Communion Assistant 2 and 3 is the same person twice', mayPair('communion2', 'communion3'), false);
  check('Singer 1 and Singer 2 is the same person twice', mayPair('singer1', 'singer2'), false);
  // Liturgist IS Communion Assistant 1 -- the app fills it that way on purpose.
  check('Liturgist and Communion Assistant 1 is the intended pairing',
    mayPair('liturgist', 'communion1'), true);
}

console.log('\nScenario 4 - flower arranging is the day before');
{
  const refused = Object.keys(ID).filter(o => o !== 'flowerarrangement' && !mayPair('flowerarrangement', o));
  check('Flower Arrangement pairs with everything', refused, []);
  check('but not with itself', mayPair('flowerarrangement', 'flowerarrangement'), false);
}

console.log('\nScenario 5 - the refusal says which kind of no it is');
{
  const why = (a, b) => RE._pairRefusalReason
    ? RE._pairRefusalReason.call(RE, ID[a] || a, ID[b] || b) : '(not extracted)';
  check('a solo duty is named as solo', /duty on its own/.test(why('preacher', 'reader')), true);
  // The useful sentence names the stricter side and what it DOES allow, so a
  // PIC knows which of the two cells to change.
  check('a narrow duty names what it does allow',
    why('usher1', 'singer1'), 'Usher 1 only doubles up with Communion Assistant');
  check('Altar Guild names Reader', why('altar', 'communion'),
    'Altar Guild 1 only doubles up with Reader');
  check('the same duty twice says so', /same duty twice/.test(why('usher1', 'usher2')), true);
}

console.log('\n================================');
// ---------------------------------------------------------------------------
// The phone draws the same two facts from a different place.
//
// checkClashes reads the rendered table; the mobile month view has no table and
// reads the roster data instead. Two readings of one Sunday is exactly how the
// two views would come to disagree -- a PIC seeing aqua on a laptop and nothing
// on a phone, with no way to tell which was right -- so _serviceOverlaps asks
// _dutiesMayPair, and this runs it to prove the classification matches the rules
// asserted above rather than merely looking like it does.
console.log('\nWho doubles up in one service, read from the roster data');

function overlaps(byRole) {
  const edits = new Map();
  Object.keys(byRole).forEach(r => edits.set(r + '__Dec_6', byRole[r]));
  const env = {
    STATE: { rosterEdits: edits },
    splitCellPeople: v => String(v).split(' / ').map(s => s.trim()).filter(Boolean),
    _nameNorm: s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    RE, Object, Map, JSON
  };
  const body = 'return RE._serviceOverlaps.call(RE, "Dec_6");';
  const keys = Object.keys(env);
  // _serviceOverlaps reads ROLES, splitCellPeople, _nameNorm and STATE off its
  // own scope, so hand it exactly those and let the real method do the rest.
  const g = new Function(...keys, 'globalThis.STATE = STATE; globalThis.splitCellPeople = splitCellPeople; globalThis._nameNorm = _nameNorm; ' + body);
  return g(...keys.map(k => env[k]));
}
const kindOf = o => Object.keys(o.byRole).sort()
  .map(r => r + '=' + o.byRole[r][0].kind).join(',');

check('nobody doubling up produces nothing at all',
  kindOf(overlaps({ preacher: 'Ann Lee', pianist: 'Ben Ooi' })), '');
check('Liturgist and Communion Assistant is a legitimate double',
  kindOf(overlaps({ liturgist: 'Ann Lee', communion1: 'Ann Lee' })),
  'communion1=ok,liturgist=ok');
check('Usher and Singer is not',
  kindOf(overlaps({ usher1: 'Ann Lee', singer1: 'Ann Lee' })),
  'singer1=clash,usher1=clash');
check('two cells of the SAME duty are one person twice',
  kindOf(overlaps({ usher1: 'Ann Lee', usher2: 'Ann Lee' })),
  'usher1=clash,usher2=clash');
check('Flower Arrangement collides with nothing',
  kindOf(overlaps({ usher1: 'Ann Lee', flowerarrangement: 'Ann Lee' })),
  'flowerarrangement=ok,usher1=ok');
// The mixed case the table pass also handles: one duty clashes, another does
// not, and they are marked differently rather than the whole person condemned.
check('a third duty that clashes does not condemn the pair that does not',
  kindOf(overlaps({ reader1: 'Ann Lee', singer1: 'Ann Lee', pianist: 'Ann Lee' })),
  'pianist=clash,reader1=clash,singer1=clash');
check('Reader and Singer alone is fine',
  kindOf(overlaps({ reader1: 'Ann Lee', singer1: 'Ann Lee' })),
  'reader1=ok,singer1=ok');
check('a mentor/trainee cell counts both people',
  kindOf(overlaps({ lcd: 'Ann Lee / Ben Ooi', pa: 'Ben Ooi' })),
  'lcd=clash,pa=clash');
check('a stray double space is still the same person',
  kindOf(overlaps({ usher1: 'Ann  Lee', singer1: 'Ann Lee' })),
  'singer1=clash,usher1=clash');
check('a blanked cell is not an assignment',
  kindOf(overlaps({ usher1: '__BLANK__', singer1: 'Ann Lee' })), '');
check('only a pair with both ends gets a line',
  overlaps({ liturgist: 'Ann Lee', communion1: 'Ann Lee' }).groups,
  [['liturgist', 'communion1']]);
check('...and a clashing pair gets none',
  overlaps({ usher1: 'Ann Lee', singer1: 'Ann Lee' }).groups, []);
// The leftover: Flower Arrangement pairs with both, but Usher and Singer clash
// with each other, so exactly one duty comes through clean. It is marked -- the
// person IS doubling up -- but a line needs two ends, and one would point at
// nothing.
check('one duty left over is marked but not joined to anything',
  overlaps({ flowerarrangement: 'Ann Lee', usher1: 'Ann Lee', singer1: 'Ann Lee' }).groups, []);
check('...and it is still marked as the legitimate one',
  kindOf(overlaps({ flowerarrangement: 'Ann Lee', usher1: 'Ann Lee', singer1: 'Ann Lee' })),
  'flowerarrangement=ok,singer1=clash,usher1=clash');

const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
