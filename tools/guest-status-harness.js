'use strict';
// Regression harness for the Guest rotation status.
//
// WHY THIS EXISTS
// A guest preaches once. A visiting Bishop, a pastor passing through, somebody
// from another church on a combined Sunday. They are not Occasional -- that
// means "invite them when you need them", which is Bro. John Cheah preaching a
// few times a year -- and they are certainly not in the rotation.
//
// Before this status existed, the distinction was being written into the NAME.
// One preacher is recorded as "Pastor Jenna Bergeson (Guest - ELCA Thailand)",
// which keeps the information but makes that person unmatchable against any
// other spelling of themselves, and leaves Auto-Suggest free to propose them
// for an ordinary Sunday.
//
// WHAT THIS CHECKS
// The two halves that have to agree, because they are declared in different
// places and nothing but a test ties them together:
//
//   AUTOSUGGEST_SKIP_STATUS   the list Auto-Suggest consults
//   _rotationTagFor           the badge a PIC sees beside the name
//
// A status in the first but not the second is excluded invisibly -- the PIC
// wonders why that person never comes up. In the second but not the first, the
// badge promises an exclusion that does not happen, which is worse: it reads
// as a guarantee.
//
// It also checks that Guest reaches the Enablers dropdown, since a status
// nobody can select is a status nobody has, and that marking somebody Guest
// does not disturb the statuses either side of it.
//
// USAGE
//   node tools/guest-status-harness.js                 # ../Index.html
//   node tools/guest-status-harness.js path/to/file.html
//   node tools/guest-status-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before this status
// existed (`git show b859e6b:Index.html > x`).
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

const skipLine = (raw.match(/var AUTOSUGGEST_SKIP_STATUS\s*=\s*(\{[^}]*\})/) || [])[1];
const tagFn = extractFunction('_rotationTagFor');
const exclFn = extractFunction('isAutoSuggestExcluded');

console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  AUTOSUGGEST_SKIP_STATUS  ' + (skipLine || 'ABSENT'));
console.log('  _rotationTagFor          ' + (tagFn ? 'found' : 'ABSENT'));
console.log('  isAutoSuggestExcluded    ' + (exclFn ? 'found' : 'ABSENT') + '\n');

if (!skipLine || !tagFn || !exclFn) {
  console.error('The rotation machinery is missing; nothing to check.');
  process.exit(1);
}

const SKIP = new Function('return ' + skipLine + ';')();

// _rotationTagFor and isAutoSuggestExcluded both read getMemberStatus().
let STATUS = {};
const env = {
  getMemberStatus: n => STATUS[n] || {},
  AUTOSUGGEST_SKIP_STATUS: SKIP,
  _suspensionLapsed: (meta, y, m) => false
};
const api = new Function('getMemberStatus', 'AUTOSUGGEST_SKIP_STATUS', '_suspensionLapsed',
  tagFn + '\n' + exclFn + '\nreturn { tag: _rotationTagFor, excluded: isAutoSuggestExcluded };'
)(env.getMemberStatus, env.AUTOSUGGEST_SKIP_STATUS, env._suspensionLapsed);

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

console.log('Auto-Suggest leaves guests alone');
STATUS = { Guest: { status: 'guest' } };
check('a guest is excluded', api.excluded('Guest', 2026, 10), true);
check('  and guest is in the skip list', !!SKIP.guest, true);

console.log('\nthe statuses either side of it are untouched');
STATUS = {
  Reg: { status: 'active' },
  Occ: { status: 'occasional' },
  Inact: { status: 'inactive' },
  Susp: { status: 'suspended' },
  New: { status: 'newly_joined' },
  Blank: {}
};
check('a regular is still picked', api.excluded('Reg', 2026, 10), false);
check('an occasional is still skipped', api.excluded('Occ', 2026, 10), true);
check('an inactive is still skipped', api.excluded('Inact', 2026, 10), true);
check('a suspended is still skipped', api.excluded('Susp', 2026, 10), true);
check('a newly joined is still picked', api.excluded('New', 2026, 10), false);
check('somebody with no status at all is still picked', api.excluded('Blank', 2026, 10), false);

console.log('\nthe badge and the exclusion agree');
// Every status Auto-Suggest skips must say so beside the name, and every
// status that says so must actually be skipped. Declared in two places; this
// is the only thing holding them together.
const ALL = ['active', 'occasional', 'guest', 'inactive', 'suspended', 'newly_joined'];
const mismatches = [];
ALL.forEach(st => {
  STATUS = { X: { status: st } };
  const skipped = api.excluded('X', 2026, 10);
  const badged = !!api.tag('X', 2026, 10);
  if (skipped !== badged) mismatches.push(st + ': skipped=' + skipped + ' badged=' + badged);
});
check('every skipped status carries a badge, and vice versa', mismatches, []);

STATUS = { G: { status: 'guest' } };
const gTag = api.tag('G', 2026, 10);
check('the guest badge says "Guest"', gTag && gTag.label, 'Guest');
check('  with its own class, not Occasional’s', gTag && gTag.cls, 'guest');
check('  and explains itself', /auto-suggest/i.test((gTag && gTag.title) || ''), true);

STATUS = { O: { status: 'occasional' } };
check('occasional keeps its own badge', (api.tag('O', 2026, 10) || {}).label, 'Occasional');

console.log('\nit can actually be chosen and styled');
check('Guest is in the Enablers status dropdown',
  /\['active','occasional','guest','newly_joined','suspended','inactive'\]/.test(raw), true);
check('it has a label', /guest:'Guest/.test(raw), true);
check('the picker badge has a style', /\.roster-np-tag\.guest\s*\{/.test(raw), true);
check('the Enablers badge has a style', /\.enabler-status-guest\s*\{/.test(raw), true);
check('a guest can be switched back to Regular or Occasional',
  /SWITCHABLE\s*=\s*\{[^}]*guest:\s*1/.test(raw), true);

console.log('\n' + '='.repeat(60));
const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN) {
  if (pass === results.length) {
    console.log('\nBUT --expect-broken was given and everything passed.');
    console.log('This harness cannot tell the fix from its absence. Do not trust it.');
    process.exit(1);
  }
  console.log('\nFailures above are expected for pre-fix source.');
  process.exit(0);
}
if (pass === results.length) console.log('A guest stays out of the rotation, and says so where it is picked.');
process.exit(pass === results.length ? 0 : 1);
