'use strict';
// Harness for the crash journal and its replay.
//
// WHY THIS EXISTS
// `saveCurrentOrder` writes its payload to localStorage before calling
// `SBQ.saveOrder` and clears it on success. If the journal is still there at
// the next boot, the page died mid-flight and the database never got that
// state, so `_replayPendingOrderSave` pushes it. That recovers the "added
// songs don't stick" case -- and it is the single most dangerous write in the
// app, because of what `SBQ.saveOrder` is.
//
// THE HAZARD
// `SBQ.saveOrder` is upsert-then-PRUNE: it deletes every stored row the
// payload does not carry. Whether that is safe rests on rails that live in
// page memory -- `_knownItems` (which rows this client has read),
// `_lastWritten`, `allowClearTypes` -- and a replay runs on a page that has
// just booted and read nothing at all. So two things have to hold:
//
//   1. The replay must only run when NOBODY has written since the journalled
//      save was built. That question used to be answered by comparing two
//      CLIENT CLOCKS: the crashed device's `savedAt` against the order row's
//      `last_edited`, stamped by whichever device wrote last. A phone ten
//      minutes fast read another device's later edit as earlier, replayed its
//      stale payload, and pruned what that edit had added -- the 9:58
//      snapshot deleting the four slides somebody put in at 10:04. It is
//      answered BY VALUE now: the journal records what this device believed
//      was stored (`baseEdited`) and the only safe case is the cloud still
//      holding exactly that.
//
//   2. The replay must not delete anything, whatever the verdict.
//      `_knownItems` left undefined reads as "no record, so prune freely",
//      which on a freshly booted page is the worst possible reading: it has
//      read none of those rows, which is a reason to delete nothing. The
//      replay records an empty set -- exactly true -- so every stored row the
//      journal does not carry is spared, and it strips the permissions
//      (`allowEmptyItems`, `allowClearTypes`) that belonged to a screen that
//      no longer exists.
//
// The verdict is a pure function so this harness can RUN it rather than match
// its source, including the 9:58/10:04 case with the clocks skewed.
//
// USAGE
//   node tools/crash-journal-harness.js                 # ../Index.html
//   node tools/crash-journal-harness.js path/to/file.html
//   node tools/crash-journal-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const ROOT = path.join(__dirname, '..');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(ROOT, 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const SRC = fs.readFileSync(INDEX, 'utf8');
const has = re => re.test(SRC);
// Bounded at the function's own close, never a lazy run across the file
// (CLAUDE.md gotcha 82).
const fn = (name, indent) => {
  const i = indent === undefined ? '  ' : indent;
  const m = SRC.match(new RegExp('\\n' + i + 'function ' + name +
    '\\([^)]*\\) \\{[^]*?\\r?\\n' + i + '\\}'));
  return m ? m[0] : '';
};

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 300) : '')); }
}

// ---------------------------------------------------------------------------
// The verdict, lifted and RUN
// ---------------------------------------------------------------------------
console.log('What to do with a journal left behind by a crash');

const verdictSrc = fn('_replayVerdict');
check('the verdict is a function of its own, so it can be run', !!verdictSrc);

let verdict = null;
if (verdictSrc) {
  try { verdict = new Function(verdictSrc + '\nreturn _replayVerdict;')(); }
  catch (e) { verdict = null; }
}
check('...and runs outside a browser', !!verdict);

if (verdict) {
  const T = t => new Date(t).toISOString();
  const NOW = Date.UTC(2026, 10, 13, 10, 10, 0);
  const items = [{ id: 'i1' }];

  // The shape of a journal written by the save that crashed at 09:58.
  const journal = (over) => Object.assign({
    savedAt: T(Date.UTC(2026, 10, 13, 9, 58, 0)),
    baseEdited: T(Date.UTC(2026, 10, 13, 9, 50, 0)),   // what we believed was stored
    payload: { id: 'order_1', items: items }
  }, over || {});

  const row = le => ({ last_edited: le });

  // --- structure, before any round trip ---
  check('a journal with no payload is dropped', verdict({ savedAt: T(NOW) }, undefined, NOW) === 'drop');
  check('...with no order id', verdict(journal({ payload: { items: items } }), undefined, NOW) === 'drop');
  check('...with no items to put back',
    verdict(journal({ payload: { id: 'order_1', items: [] } }), undefined, NOW) === 'drop');
  check('...with no savedAt at all', verdict(journal({ savedAt: '' }), undefined, NOW) === 'drop');
  check('...and one more than seven days old',
    verdict(journal({ savedAt: T(NOW - 8 * 86400000) }), undefined, NOW) === 'drop');
  check('an otherwise sound journal is worth a round trip',
    verdict(journal(), undefined, NOW) === 'fetch');
  check('the order having been deleted since drops it', verdict(journal(), null, NOW) === 'drop');

  // --- the decision that matters ---
  check('nobody has written since: replay',
    verdict(journal(), row(T(Date.UTC(2026, 10, 13, 9, 50, 0))), NOW) === 'replay');
  check('somebody wrote since: drop',
    verdict(journal(), row(T(Date.UTC(2026, 10, 13, 10, 4, 0))), NOW) === 'drop');
  // The write landed and only the answer was lost: the cloud then holds the
  // timestamp OUR save stamped, which is not what we believed was stored.
  // Dropping is right -- there is nothing left to push.
  check('our own interrupted save landed after all: drop, nothing left to push',
    verdict(journal(), row(T(Date.UTC(2026, 10, 13, 9, 58, 30))), NOW) === 'drop');

  // THE CASE THIS WHOLE CHANGE IS FOR. Another device adds four slides at
  // 10:04. The crashed phone's clock is ten minutes fast, so the save it
  // journalled at 09:58 is stamped 10:08 -- LATER than the edit it must not
  // overwrite. The old rule (cloud > savedAt ? drop : replay) replayed, and
  // the prune took those four slides out.
  const skewed = journal({ savedAt: T(Date.UTC(2026, 10, 13, 10, 8, 0)) });
  const otherDeviceWrote = row(T(Date.UTC(2026, 10, 13, 10, 4, 0)));
  check('a fast clock can no longer make another device\'s edit look older',
    verdict(skewed, otherDeviceWrote, NOW + 3600000) === 'drop');
  check('...and the old clock rule would have said replay',
    new Date(otherDeviceWrote.last_edited).getTime() <= new Date(skewed.savedAt).getTime());
  // The mirror image: our clock is SLOW, nobody else wrote. By the clocks the
  // cloud looks newer than us and the journal would have been thrown away.
  const slow = journal({ savedAt: T(Date.UTC(2026, 10, 13, 9, 40, 0)),
                         baseEdited: T(Date.UTC(2026, 10, 13, 9, 50, 0)) });
  check('a slow clock no longer throws away a recovery nobody contested',
    verdict(slow, row(T(Date.UTC(2026, 10, 13, 9, 50, 0))), NOW) === 'replay');

  // --- a journal from before this change ---
  const legacy = { savedAt: T(Date.UTC(2026, 10, 13, 9, 58, 0)),
                   payload: { id: 'order_1', items: items } };
  check('a journal with no base falls back to the clocks it was written for',
    verdict(legacy, row(T(Date.UTC(2026, 10, 13, 9, 50, 0))), NOW) === 'replay' &&
    verdict(legacy, row(T(Date.UTC(2026, 10, 13, 10, 4, 0))), NOW) === 'drop');
  check('...and still ages out', verdict(
    { savedAt: T(NOW - 8 * 86400000), payload: { id: 'order_1', items: items } },
    row(''), NOW) === 'drop');

  // --- details that bite ---
  // THE WAY THIS COULD HAVE BEEN SILENTLY DEAD. currentOrderData.lastEdited is
  // written from a LOAD ("...+00:00", Postgres) and from a SAVE's own stamp
  // ("...Z", toISOString). Comparing the strings matched the first journal of
  // a session and nothing after it. Caught against the real row, not here --
  // these two cases exist so it cannot come back.
  check('the two ISO spellings of one instant are the same value',
    verdict(journal({ baseEdited: '2026-11-10T17:32:41.881Z' }),
            row('2026-11-10T17:32:41.881+00:00'), NOW) === 'replay');
  check('...and the other way round',
    verdict(journal({ baseEdited: '2026-11-10T17:32:41.881+00:00' }),
            row('2026-11-10T17:32:41.881Z'), NOW) === 'replay');
  check('a different instant is still a different value',
    verdict(journal({ baseEdited: '2026-11-10T17:32:41.881Z' }),
            row('2026-11-10T17:32:41.882+00:00'), NOW) === 'drop');
  check('an unreadable stored value is not a match',
    verdict(journal({ baseEdited: 'not-a-date' }), row('also-not-a-date'), NOW) === 'drop');
  // NaN === NaN is already false, so what the `ca > 0` guard actually buys is
  // refusing a nonsense zero -- a row whose timestamp is the epoch is not a
  // value we last saw, whatever the journal says.
  check('a nonsense stored timestamp is not a match either',
    verdict(journal({ baseEdited: '1970-01-01T00:00:00.000Z' }),
            row('1970-01-01T00:00:00.000Z'), NOW) === 'drop');

  check('an empty stored value is not treated as a match for a real one',
    verdict(journal(), row(''), NOW) === 'drop');
  check('a brand-new order with no stored timestamp matches an empty base',
    verdict(journal({ baseEdited: '' }), row(''), NOW) === 'replay');
  check('the age cap can only make it less willing, never more',
    verdict(journal({ savedAt: T(NOW - 8 * 86400000) }),
            row(T(Date.UTC(2026, 10, 13, 9, 50, 0))), NOW) === 'drop');
}

// ---------------------------------------------------------------------------
// The journal carries what the verdict needs
// ---------------------------------------------------------------------------
console.log('\nThe journal records what this device believed was stored');
check('baseEdited is written beside the payload',
  has(/baseEdited: \(currentOrderData && currentOrderData\.lastEdited\) \|\| '',/));
check('...from the value a load and a save both keep up to date',
  has(/currentOrderData\.lastEdited = result\.lastEdited;/) &&
  has(/currentOrderData\.lastEdited = r\.lastEdited;/));
check('the saved projection decks are still left out of the journal',
  has(/delete _jTpl\.projectionVersions;/));

// ---------------------------------------------------------------------------
// A replay adds and updates; it never deletes
// ---------------------------------------------------------------------------
console.log('\nA replay cannot delete, whatever the verdict says');
const replaySrc = fn('_replayPendingOrderSave');
check('the replay can be found', !!replaySrc);
// _knownItems left undefined reads as "no record, prune freely". On a page
// that has just booted that is the worst possible reading.
check('it records that this page has read NONE of the order\'s rows',
  replaySrc.indexOf("SBQ._knownItems[payload.id] = SBQ._knownItems[payload.id] || {};") !== -1);
check('...without discarding what a load in this session already recorded',
  /SBQ\._knownItems\[payload\.id\] \|\| \{\}/.test(replaySrc));
check('it strips the permission to empty the order',
  replaySrc.indexOf('delete payload.allowEmptyItems;') !== -1 &&
  replaySrc.indexOf('delete payload.allowClearTypes;') !== -1);
check('the verdict is what decides, not a clock comparison in here',
  /_replayVerdict\(pending, row, Date\.now\(\)\) !== 'replay'/.test(replaySrc) &&
  replaySrc.indexOf('cloudEdited') === -1);
check('a read that failed leaves the journal for the next boot',
  replaySrc.indexOf('if (res && res.error) return;') !== -1);
check('nothing is asked of the database for a journal already beyond use',
  /_replayVerdict\(pending, undefined, Date\.now\(\)\) !== 'fetch'/.test(replaySrc));

// The prune this all guards, still as it was.
console.log('\nThe prune it guards');
check('saveOrder still spares rows this client has never read',
  has(/if \(!seen \|\| seen\[x\.id\]\) stale\.push\(x\.id\);\s*\r?\n\s*else spared\.push\(x\.id\);/));
check('...which is what an empty _knownItems turns into "spare them all"',
  has(/var seen = SBQ\._knownItems\[id\];/));

// ---------------------------------------------------------------------------
console.log('\nIndex.html and dist/index.html still match');
const DIST = path.join(ROOT, 'dist', 'index.html');
const OWN = path.resolve(INDEX) === path.resolve(path.join(ROOT, 'Index.html'));
if (!OWN) console.log('  --   skipped (not this repo\'s Index.html)');
else if (fs.existsSync(DIST)) check('byte-identical', fs.readFileSync(DIST, 'utf8') === SRC);
else check('dist/index.html exists', false);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
