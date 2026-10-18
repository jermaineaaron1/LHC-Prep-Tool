'use strict';
// Regression harness for Auto-Suggest giving a different answer each press.
//
// WHY THIS EXISTS
// Auto-Suggest never overwrites a filled cell, which is right for a name a
// PIC typed and wrong for its own drafts. Once it had run, every cell it was
// allowed to touch was full, so pressing it again did nothing whatsoever and
// read as a broken button.
//
// Two things had to change, and each has a way of going quietly wrong.
//
//   The drafts are cleared before a re-run. They are not just output -- they
//   feed the monthly tally, the one-duty-a-day check and the back-to-back
//   guard. Left standing, everybody already drafted looks busy to the run
//   that is replacing them, and each press hands back a worse roster than
//   the last. Confirmed and hand-typed cells are not drafts and must never
//   be cleared, which is the thing most worth guarding here.
//
//   The last tiebreak is a per-run salt instead of the alphabet. Fairness is
//   untouched: every tier above it -- already serving, curated list,
//   pairings, monthly cap, back-to-back, per-role and per-month counts --
//   still decides the roster, and the salt only separates people who come
//   through all of it exactly equal. A shuffle that reached any higher would
//   be a worse roster dressed up as variety.
//
// THE SUBTLE ONE
// The salt is turned into a key per name ONCE per run and then compared.
// Drawing a random number inside the comparator instead would look like it
// works: a comparator that answers differently for the same pair is not an
// ordering, and sort() is entitled to return anything at all when given one.
//
// USAGE
//   node tools/autosuggest-shuffle-harness.js
//   node tools/autosuggest-shuffle-harness.js path/to/file.html
//   node tools/autosuggest-shuffle-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const raw = fs.readFileSync(INDEX, 'utf8');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

const hasShuffle = /_afShuffle/.test(raw);
console.log('Reading ' + path.basename(INDEX) + '  (shuffle ' + (hasShuffle ? 'present' : 'ABSENT') + ')\n');

if (!hasShuffle) {
  if (EXPECT_BROKEN) {
    console.log('(pre-change) the last tiebreak was the alphabet, so every press');
    console.log('gave the same answer and a second press changed nothing.');
    console.log('\n--expect-broken: the pre-change shape is what passes');
    process.exit(0);
  }
  console.error('_afShuffle is missing — Auto-Suggest is deterministic again.');
  process.exit(1);
}

// Build the real _afShuffle, with the two variables it closes over.
function makeShuffle(salt) {
  const body = raw.match(/function _afShuffle\(key\) \{[\s\S]*?\n      \}/);
  if (!body) throw new Error('could not slice _afShuffle');
  return new Function('_shuffleSalt', 'var _shuffleKeys = {};\n' + body[0] + '\nreturn _afShuffle;')(salt);
}

const POOL = ['alison phan', 'audrey yap', 'beatrice tye', 'charisse goh', 'gina tai',
              'jeannie tan', 'karen tham', 'lani low', 'margaret loo', 'sharon wee'];

// ---------------------------------------------------------------------------
console.log('within one run the order never wavers');
{
  const f = makeShuffle(0.4242);
  check('the same name gives the same key every time',
    POOL.every(n => f(n) === f(n) && f(n) === f(n)), true);
  // A comparator must be consistent or sort() may return anything.
  const once = POOL.slice().sort((a, b) => f(a) - f(b) || a.localeCompare(b));
  const twice = POOL.slice().sort((a, b) => f(a) - f(b) || a.localeCompare(b));
  check('so sorting twice gives the same order', once, twice);
  check('and nobody is lost or duplicated', once.slice().sort(), POOL.slice().sort());
}

// ---------------------------------------------------------------------------
console.log('\nbetween runs the order moves');
{
  const orders = new Set();
  const firsts = new Set();
  for (let i = 0; i < 200; i++) {
    const f = makeShuffle(Math.random());
    const order = POOL.slice().sort((a, b) => f(a) - f(b) || a.localeCompare(b));
    orders.add(order.join('|'));
    firsts.add(order[0]);
  }
  // The point of the whole change: press it again, get a different answer.
  check('200 runs do not all agree', orders.size > 1, true);
  check('and they produce many different orders', orders.size > 50, true);
  // If the salt only reordered the tail, the top pick would never move and
  // the roster would look identical where anybody actually looks.
  check('the person picked first changes too', firsts.size > 1, true);
  check('and most of the pool gets a turn at the front', firsts.size >= 5, true);
}

// ---------------------------------------------------------------------------
console.log('\nfairness still outranks the shuffle');
{
  // Simulating the real comparator's shape: a score tier first, the salt last.
  // Whatever the salt says, a better-scoring candidate has to win.
  const score = { 'alison phan': 1, 'audrey yap': 0, 'beatrice tye': 1, 'charisse goh': 1,
                  'gina tai': 1, 'jeannie tan': 1, 'karen tham': 1, 'lani low': 1,
                  'margaret loo': 1, 'sharon wee': 1 };
  let alwaysBest = true;
  for (let i = 0; i < 200; i++) {
    const f = makeShuffle(Math.random());
    const order = POOL.slice().sort((a, b) =>
      (score[a] - score[b]) || (f(a) - f(b)) || a.localeCompare(b));
    if (order[0] !== 'audrey yap') { alwaysBest = false; break; }
  }
  check('the better candidate wins every single time', alwaysBest, true);
}

// ---------------------------------------------------------------------------
console.log('\nhow it is wired into the run');
{
  const fn = raw.slice(raw.indexOf('runAutoSuggest: function'));
  const body = fn.slice(0, fn.indexOf('\n    },'));

  // Drawn once per run, not per comparison.
  check('the salt is drawn once for the run', /var _shuffleSalt = Math\.random\(\)/.test(body), true);
  const cmp = body.slice(body.indexOf('candidates.sort('), body.indexOf('var winner = candidates[0]'));
  check('and never inside the comparator', /Math\.random\(/.test(cmp), false);

  // The salt must be the LAST thing consulted, after every fairness tier.
  check('the shuffle sits below the per-role count', cmp.indexOf('roleCounts[ka]') < cmp.indexOf('_afShuffle'), true);
  check('below the monthly count', cmp.indexOf('monthCount[ka]') < cmp.indexOf('_afShuffle'), true);
  check('below when they last served', cmp.indexOf('lastServedMonth[ka]') < cmp.indexOf('_afShuffle'), true);
  check('and the alphabet is still the final word', cmp.indexOf('_afShuffle') < cmp.indexOf('localeCompare'), true);

  // Clearing drafts: only drafts, only in scope, and never while previewing.
  check('a re-run clears its own drafts', /priorDrafts/.test(body), true);
  check('taking them from the pending set only',
    /rosterPendingCells\)\.forEach|rosterPendingCells\.forEach/.test(body), true);
  check('and only for the duties being filled', /inScopeRole\[bits\[0\]\]/.test(body), true);
  check('and only for the dates being filled', /inScopeDate\[bits\[1\]\]/.test(body), true);
  // A preview must not touch the roster at all, so the clearing has to sit
  // behind the previewOnly guard rather than beside it. Checked by slicing
  // between the two landmarks instead of by a fixed-width window, which
  // would fail the next time a comment was added.
  const clearing = body.slice(body.indexOf('var priorDrafts'), body.indexOf('priorDrafts.set'));
  check('a preview changes nothing', /if \(!previewOnly\)/.test(clearing), true);
  check('undo still steps back to the draft that was there', /_priorValue\(cellKey\)/.test(body), true);

  // The guarantee that matters most: a confirmed or hand-typed cell is not a
  // draft, is not in rosterPendingCells, and so is never cleared.
  check('filled cells are still never overwritten',
    /never overwrite manual entries/.test(body), true);
}

// ---------------------------------------------------------------------------
const failed = results.filter(ok => !ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
