'use strict';
// Regression harness for the lay-preacher form of address.
//
// WHY THIS EXISTS
// At LHC a lay preacher is addressed as Bro or Sis; ordained ministers carry
// Rev / Pastor / Bishop in the name already. The obvious way to record that is
// to type it into the name, and that is exactly what had been happening -- and
// it is how one person becomes several.
//
//   "Alwyn Lau"       13 duties
//   "Bro Alwyn Lau"    2 duties     a different person, as far as the database
//                                   was concerned: separate duty counts,
//                                   invisible to each other in the statistics
//
// Benedict Muthusamy had four spellings. Ashley Teter had four. All of them
// were merged by hand.
//
// So the form of address is NOT in the name. It lives beside it, and is applied
// at the moment of display.
//
// THE RULE THIS PROTECTS
// It belongs to the PREACHING, not to the person. Alwyn Lau preaches and also
// plays the piano: Bro Alwyn Lau in the pulpit, Alwyn Lau at the keyboard. A
// change that applies it to every role would look like a tidy simplification
// and would be wrong, which is why it is worth a test.
//
// The quieter cases matter too. A cell can hold two names ("Audrey Yap / Karen
// Tham") or a name somebody already typed a title into, and prefixing either
// produces nonsense -- "Bro Audrey Yap / Karen Tham", "Bro Rev. Benedict
// Muthusamy".
//
// USAGE
//   node tools/addressed-name-harness.js                 # ../Index.html
//   node tools/addressed-name-harness.js path/to/file.html
//   node tools/addressed-name-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

function extractFunction(name) {
  const start = lines.findIndex(l => new RegExp('^\\s*function ' + name + '\\s*\\(').test(l));
  if (start < 0) return null;
  let depth = 0, started = false;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces in ' + name);
}

const fn = extractFunction('addressedName');
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  addressedName  ' + (fn ? 'found' : 'ABSENT') + '\n');

if (!fn) {
  if (EXPECT_BROKEN) {
    console.log('addressedName is absent, as expected for pre-fix source.');
    process.exit(0);
  }
  console.error('addressedName is missing.');
  process.exit(1);
}

let PEOPLE = {};
const api = new Function('getMemberStatus',
  fn + '\nreturn addressedName;')(n => PEOPLE[n] || {});

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

PEOPLE = {
  'Alwyn Lau': { addressAs: 'Bro' },
  'Aaron Jayaraj': { addressAs: 'Bro' },
  'Jane Tui': { addressAs: 'Sis' },
  'Margaret Loo': {},
  'Rev. Benedict Muthusamy': { addressAs: 'Bro' },
  'Bro. John Cheah': { addressAs: 'Bro' },
  'Audrey Yap / Karen Tham': { addressAs: 'Bro' }
};

console.log('it belongs to the preaching, not to the person');
check('Alwyn Lau preaching', api('preacher', 'Alwyn Lau'), 'Bro Alwyn Lau');
check('  the same man at the piano', api('pianist', 'Alwyn Lau'), 'Alwyn Lau');
check('  and on the PA', api('pa', 'Alwyn Lau'), 'Alwyn Lau');
check('  and as liturgist', api('liturgist', 'Alwyn Lau'), 'Alwyn Lau');
check('Aaron Jayaraj preaching', api('preacher', 'Aaron Jayaraj'), 'Bro Aaron Jayaraj');
check('  Aaron Jayaraj as liturgist', api('liturgist', 'Aaron Jayaraj'), 'Aaron Jayaraj');
check('Sis works the same way', api('preacher', 'Jane Tui'), 'Sis Jane Tui');

console.log('\nnobody gets a title they were not given');
check('a preacher with none set', api('preacher', 'Margaret Loo'), 'Margaret Loo');
check('somebody not on file at all', api('preacher', 'A Visitor'), 'A Visitor');

console.log('\nno doubling up on a name that already carries a title');
check('an ordained minister', api('preacher', 'Rev. Benedict Muthusamy'), 'Rev. Benedict Muthusamy');
check('a name with the title already typed in', api('preacher', 'Bro. John Cheah'), 'Bro. John Cheah');
PEOPLE['Pastor Ashley Teter'] = { addressAs: 'Sis' };
check('Pastor is left alone', api('preacher', 'Pastor Ashley Teter'), 'Pastor Ashley Teter');
PEOPLE['Bishop Thomas Low'] = { addressAs: 'Bro' };
check('Bishop is left alone', api('preacher', 'Bishop Thomas Low'), 'Bishop Thomas Low');

console.log('\ncells that are not one person');
check('two names in one cell', api('preacher', 'Audrey Yap / Karen Tham'), 'Audrey Yap / Karen Tham');
PEOPLE['Eva Muthusamy & Charisse Goh'] = { addressAs: 'Sis' };
check('an ampersand pair', api('preacher', 'Eva Muthusamy & Charisse Goh'), 'Eva Muthusamy & Charisse Goh');
PEOPLE['Rev Benedict\n(W/ someone)'] = { addressAs: 'Bro' };
check('a value carrying a note on a second line',
  api('preacher', 'Rev Benedict\n(W/ someone)'), 'Rev Benedict\n(W/ someone)');

console.log('\nempty and odd values pass through untouched');
check('empty string', api('preacher', ''), '');
check('null', api('preacher', null), null);
check('undefined', api('preacher', undefined), undefined);
check('a blank sentinel is not a name', api('preacher', '__BLANK__'), '__BLANK__');

console.log('\n' + '='.repeat(60));
const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN) {
  if (pass === results.length) {
    console.log('\nBUT --expect-broken was given and everything passed.');
    process.exit(1);
  }
  console.log('\nFailures above are expected for pre-fix source.');
  process.exit(0);
}
if (pass === results.length) console.log('Bro belongs to the pulpit, and stays out of the name.');
process.exit(pass === results.length ? 0 : 1);
