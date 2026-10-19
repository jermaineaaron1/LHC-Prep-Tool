'use strict';
// Regression harness for deleting a songbook taking its stored work with it.
//
// WHY THIS EXISTS
// Opening a songbook creates an `orders` row called standalone_<songbookId>,
// because a songbook has no column for annotations, transposes, custom
// lyrics or the projection deck. Deleting the songbook deleted only the
// `songbooks` row, so the pseudo-order stayed behind forever.
//
// By October 2026 six of them existed for two songbooks. They were
// invisible -- getOrders filters the prefix out of the saved-orders list --
// but they were COUNTED: a song sitting in one of them read as having been
// used in a worship service, which is how four songs nobody had ever sung
// came to lead the Trending list. Four were removed by
// tools/remove-orphan-songbook-orders.js; this stops them coming back.
//
// THE PART THAT IS EASY TO GET WRONG
// The order of the two deletes is a correctness property, not a style
// choice, and only one of the two orderings is safe:
//
//   Songbook first, pseudo-order second. If the songbook delete fails, the
//   songbook still exists and its annotations must still be there -- one of
//   the two live pseudo-orders carries eighty of them. Deleting the work
//   first and then failing to delete the songbook would leave a songbook
//   that opens empty, which is worse than the bug being fixed.
//
// So this checks the ORDER, and checks that a failed songbook delete leaves
// the work alone. Both are run, not read.
//
// It also pins that the cleanup goes through SBQ.deleteOrder rather than a
// second one written by hand here: the pseudo-order owns order_items, a
// projection_settings row keyed on owner_id, and possibly uploads, and
// deleteOrder already removes all of that.
//
// USAGE
//   node tools/songbook-delete-cleanup-harness.js
//   node tools/songbook-delete-cleanup-harness.js path/to/file.html
//   node tools/songbook-delete-cleanup-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

// SBQ_SONGBOOKS.remove, by name and by the module it sits in -- there is
// more than one `remove:` in the file.
function extractRemove() {
  const modAt = lines.findIndex(l => /^var SBQ_SONGBOOKS = \{/.test(l));
  if (modAt < 0) return null;
  const start = lines.findIndex((l, i) => i > modAt && /^  remove: function\(id\) \{/.test(l));
  if (start < 0) return null;
  let depth = 0, started = false, out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n').replace(/^  remove:\s*/, '');
  }
  throw new Error('unbalanced braces in SBQ_SONGBOOKS.remove');
}

const removeSrc = extractRemove();
console.log('Reading ' + path.basename(INDEX));
console.log('  SBQ_SONGBOOKS.remove  ' + (removeSrc ? 'found' : 'ABSENT') + '\n');
if (!removeSrc) { console.error('Could not slice SBQ_SONGBOOKS.remove.'); process.exit(1); }

// Only "is there a cleanup at all", for the --expect-broken control below.
// Deliberately not matching the exact id expression: whether the right id is
// built is a question for the checks that RUN it, and a gate strict enough to
// notice a wrong id would reject it here as "no cleanup" and never run them.
const cleansUp = /deleteOrder\(/.test(removeSrc);
if (!cleansUp) {
  if (EXPECT_BROKEN) {
    console.log('(pre-change) deleting a songbook removed only the songbooks row;');
    console.log('its standalone_<id> pseudo-order, and everything that row owned,');
    console.log('was left behind to be counted as worship usage forever.');
    console.log('\n--expect-broken: the pre-change shape is what passes');
    process.exit(0);
  }
  console.error('The pseudo-order cleanup is gone — orphans will accumulate again.');
  process.exit(1);
}

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// ---- the stub world --------------------------------------------------------
// `remove` reaches for SBQ_SONGBOOKS._sb() and SBQ.deleteOrder. Both are
// supplied, and every call either of them makes is recorded in order.
function build(opts) {
  opts = opts || {};
  const log = [];
  const client = {
    from(table) {
      return { delete() { return { eq(col, val) {
        log.push({ call: 'delete', table, col, val });
        const err = (opts.songbookDeleteFails && table === 'songbooks')
          ? { message: 'permission denied' } : null;
        // supabase-js hands back a builder that has .then but NOT .catch --
        // attaching a .catch to it directly throws a TypeError, which it did
        // once on the live site. So the stub has no .catch either.
        //
        // Its .then does return a real Promise, though, which is why
        // `.delete().eq().then(fn)` can be followed by .then/.catch and why
        // a throw inside fn becomes a rejection rather than escaping
        // synchronously. The first version of this stub called fn() inline
        // and let the throw out, which made the failure case below look like
        // a crash in the harness rather than the rejection it really is.
        return { then: (fn) => Promise.resolve({ error: err }).then(fn) };
      } }; } };
    }
  };
  const SBQ_SONGBOOKS = { _sb: () => (opts.noClient ? null : client) };
  const SBQ = {
    deleteOrder(id) {
      log.push({ call: 'deleteOrder', id });
      return opts.deleteOrderFails
        ? Promise.reject(new Error('order cleanup blew up'))
        : Promise.resolve({ success: true });
    }
  };
  const warnings = [];
  const fn = new Function('SBQ_SONGBOOKS', 'SBQ', 'console',
    'return (' + removeSrc + ');')(SBQ_SONGBOOKS, SBQ, { warn: (...a) => warnings.push(a.join(' ')) });
  return { fn, log, warnings };
}

// ---------------------------------------------------------------------------
// Did it resolve or reject? Everything stubbed here settles immediately, so
// the tests simply await it and read the answer.
const settle = p => p.then(() => 'resolved', () => 'rejected');
const settleWith = p => p.then(() => ({ state: 'resolved', message: '' }),
                               e => ({ state: 'rejected', message: e.message }));

(async () => {
  console.log('deleting a songbook takes its stored work with it');
{
  const { fn, log } = build();
  let settled;
  settled = await settle(fn('sb_123'));

  check('the songbook row is deleted', log.filter(l => l.table === 'songbooks').length, 1);
  check('by its own id', (log.find(l => l.table === 'songbooks') || {}).val, 'sb_123');
  check('and the pseudo-order goes too', log.filter(l => l.call === 'deleteOrder').length, 1);
  check('under the standalone_ name', (log.find(l => l.call === 'deleteOrder') || {}).id, 'standalone_sb_123');
  check('the caller sees it succeed', settled, 'resolved');

  // THE ordering property. Reversing these two is the unsafe arrangement:
  // a songbook whose work was deleted but which itself survived would open
  // empty, and one of the live ones carries eighty annotations.
  check('the songbook goes FIRST, its work second',
    log.map(l => l.call === 'deleteOrder' ? 'work' : l.table),
    ['songbooks', 'work']);
}

// ---------------------------------------------------------------------------
console.log('\nif the songbook cannot be deleted, its work is left alone');
{
  const { fn, log } = build({ songbookDeleteFails: true });
  let settled, msg;
  const r1 = await settleWith(fn('sb_123')); settled = r1.state; msg = r1.message;

  check('the failure is reported, not swallowed', settled, 'rejected');
  check('and says why', msg, 'permission denied');
  // The guarantee that matters most in this file.
  check('the pseudo-order is NOT touched', log.filter(l => l.call === 'deleteOrder').length, 0);
}

// ---------------------------------------------------------------------------
console.log('\nif the cleanup fails, the delete still counts');
{
  // The operator asked for the songbook to go, and it has gone. Reporting a
  // failure would send them back to delete a songbook that is already
  // deleted -- the same reasoning deleteOrder already applies to its own
  // upload cleanup.
  const { fn, log, warnings } = build({ deleteOrderFails: true });
  let settled;
  settled = await settle(fn('sb_123'));

  check('the songbook delete still reports success', settled, 'resolved');
  check('the songbook really was deleted', log.filter(l => l.table === 'songbooks').length, 1);
  check('and the failure is written down somewhere', warnings.length, 1);
  check('naming the songbook', /sb_123/.test(warnings[0] || ''), true);
}

// ---------------------------------------------------------------------------
console.log('\nthe awkward cases');
{
  const { fn } = build({ noClient: true });
  let settled;
  settled = await settle(fn('sb_123'));
  check('no database connection is a rejection, not a crash', settled, 'rejected');

  // A songbook nobody ever opened has no pseudo-order. Deleting a row that
  // is not there is a no-op in PostgREST, so this costs nothing and must
  // not be special-cased into a bug.
  const b = build();
  let s2;
  s2 = await settle(b.fn('sb_never_opened'));
  check('a songbook that was never opened still deletes cleanly', s2, 'resolved');
  check('and the cleanup is attempted anyway, harmlessly',
    (b.log.find(l => l.call === 'deleteOrder') || {}).id, 'standalone_sb_never_opened');
}

// ---------------------------------------------------------------------------
console.log('\nwhat the cleanup has to cover');
{
  // Not re-asserting behaviour -- pinning that this reuses deleteOrder
  // rather than growing a second, thinner cleanup beside it. The
  // pseudo-order owns order_items and a projection_settings row keyed on
  // owner_id, and deleteOrder is the thing that knows that.
  check('it delegates to deleteOrder', /SBQ\.deleteOrder\(/.test(removeSrc), true);
  check('rather than deleting order_items by hand',
    /from\('order_items'\)/.test(removeSrc), false);
  check('or projection_settings by hand',
    /from\('projection_settings'\)/.test(removeSrc), false);
  check('deleteOrder still clears the settings keyed on owner_id',
    /from\('projection_settings'\)\.delete\(\)\.eq\('owner_id', id\)/.test(raw), true);
  check('and still removes the order_items',
    /from\('order_items'\)\.delete\(\)\.eq\('order_id', id\)/.test(raw), true);

  // The counting must not start depending on the cleanup having run. The
  // prefix exclusion in the usage index is the belt to this braces: an
  // orphan left by a failed cleanup still must not count as worship usage.
  check('the usage index still excludes the prefix on its own',
    /\/\^standalone_\/\.test\(it\.order_id\)/.test(raw), true);
}

// ---------------------------------------------------------------------------
const failed = results.filter(ok => !ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
})();
