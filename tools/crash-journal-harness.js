'use strict';
// Harness for the crash journal's replay rule (2026-11-13, CLAUDE.md gotcha 95).
//
// saveCurrentOrder journals each save to localStorage before it writes, and
// the next boot replays a journal still there -- unless somebody else saved
// the order since. It used to decide that by comparing the order's stored
// last_edited (the clock of whichever device saved) with the journal's
// savedAt (THIS device's clock): a phone running fast replayed its old
// journal over a later save from another device, and one running slow
// dropped its own unsaved changes. Now the journal carries the stored times
// it knew the order by, and its own stamp, and the replay compares by value.
//
// The real functions are sliced out of Index.html and run on stubs.
//
// USAGE
//   node tools/crash-journal-harness.js
//   node tools/crash-journal-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const fn = name => { const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };
// An SBQ method, "  name: function(...) {...}," as an expression.
const meth = name => { const m = SRC.match(new RegExp('\\n  ' + name + ': (function\\([^)]*\\) \\{[^]*?\\n  \\}),?')); return m ? m[1] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 600) : '')); }
}
const J = JSON.stringify;
process.on('unhandledRejection', e => { check('no unexpected error', false, String(e && e.stack || e)); console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(1); });
const tick = () => new Promise(r => setTimeout(r, 0));

if (!fn('_journalMayReplay')) {
  if (EXPECT_BROKEN) { console.log('--expect-broken: no _journalMayReplay, as expected.'); process.exit(0); }
  console.log('FAIL there is no _journalMayReplay in ' + path.basename(INDEX)); process.exit(1);
}
if (EXPECT_BROKEN) { console.log('\nBUT --expect-broken was given and the fix is present.'); process.exit(1); }

const ms = x => new Date(x).getTime();

(async () => {
  console.log('\n1. The rule, by value');
  const may = new Function(fn('_journalMayReplay') + '\nreturn _journalMayReplay;')();
  // This device's clock runs five minutes FAST: it journalled at what its
  // clock called 10:10, really 10:05. Another device saved at 10:07 (its
  // clock right). The old rule saw 10:07 < 10:10 and replayed the old
  // journal over that save.
  const fast = { savedAt: '2026-11-13T10:10:00.000Z', known: [ms('2026-11-13T09:00:00.000Z'), ms('2026-11-13T10:10:00.000Z')] };
  check('a save made elsewhere since is not written over, however this device\'s clock runs',
    may(ms('2026-11-13T10:07:00.000Z'), fast, []) === false);
  // This device's clock runs five minutes SLOW: it read the other device's
  // 10:07 save, built on it, and journalled at "10:04". The old rule saw
  // 10:07 > 10:04 and dropped this device's unsaved changes.
  const slow = { savedAt: '2026-11-13T10:04:00.000Z', known: [ms('2026-11-13T10:07:00.000Z'), ms('2026-11-13T10:04:00.000Z')] };
  check('a journal built on the save that is stored is replayed, however this device\'s clock runs',
    may(ms('2026-11-13T10:07:00.000Z'), slow, []) === true);
  check('this save\'s own stamp stored (its order row landed, its items did not): replayed',
    may(ms('2026-11-13T10:10:00.000Z'), fast, []) === true);
  check('one of this device\'s own later writes stored (the Songbook\'s quick sync): replayed',
    may(ms('2026-11-13T10:11:00.000Z'), fast, [ms('2026-11-13T10:11:00.000Z')]) === true);
  check('a journal from before keeps the old rule', may(ms('2026-11-13T10:07:00.000Z'), { savedAt: '2026-11-13T10:10:00.000Z' }, []) === true &&
    may(ms('2026-11-13T10:12:00.000Z'), { savedAt: '2026-11-13T10:10:00.000Z' }, []) === false);
  check('a stored order with no time: replayed, as before', may(0, fast, []) === true);

  console.log('\n2. What the device knows, and keeps across a crash');
  const store = {};
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const SBQ = new Function('localStorage', 'var SBQ = { _ownEdits: {}, _seenEdits: {} };\n' +
    ['_noteOwnEdit', '_isOwnEdit', '_ownEditsKept', '_noteSeenEdit', '_knownEditsFor'].map(n => 'SBQ.' + n + ' = ' + meth(n) + ';').join('\n') +
    '\nreturn SBQ;')(localStorage);
  SBQ._noteSeenEdit('o1', '2026-11-13T09:00:00.000Z');
  SBQ._noteSeenEdit('o1', '2026-11-13T09:00:00.000+00:00');   // the same time as Postgres writes it
  SBQ._noteOwnEdit('o1', '2026-11-13T09:30:00.000Z');
  check('times read and times written are both known, each once', J(SBQ._knownEditsFor('o1')) === J([ms('2026-11-13T09:00:00.000Z'), ms('2026-11-13T09:30:00.000Z')]), J(SBQ._knownEditsFor('o1')));
  check('this device\'s own are kept on the device, for the next boot', J(SBQ._ownEditsKept('o1')) === J([ms('2026-11-13T09:30:00.000Z')]));
  for (let i = 0; i < 50; i++) SBQ._noteOwnEdit('o2', new Date(ms('2026-11-13T10:00:00.000Z') + i * 1000).toISOString());
  check('...at most 40 an order', SBQ._ownEditsKept('o2').length === 40 && SBQ._ownEditsKept('o2')[39] === ms('2026-11-13T10:00:49.000Z'));
  for (let i = 0; i < 25; i++) SBQ._noteOwnEdit('x' + i, '2026-11-13T11:00:00.000Z');
  check('...for the 20 orders written last', Object.keys(JSON.parse(store.lhc_order_own_edits)).length === 20 && SBQ._ownEditsKept('x24').length === 1 && SBQ._ownEditsKept('o1').length === 0);
  check('a time that is not one is ignored', (SBQ._noteSeenEdit('o3', ''), SBQ._noteSeenEdit('o3', 'nonsense'), SBQ._knownEditsFor('o3').length === 0));

  console.log('\n3. The save journals its stamp and what it knew');
  const sco = fn('saveCurrentOrder');
  check('the stamp is decided before the journal', /var _saveAt = new Date\(\)\.toISOString\(\);\n\s*if \(orderPayload\.id && itemsForSave\.length\) \{/.test(sco));
  check('the journal carries it and the known times', /savedAt: _saveAt,[^]*?at: _saveAt,\n\s*known: SBQ\._knownEditsFor\(orderPayload\.id\)\.concat\(\[new Date\(_saveAt\)\.getTime\(\)\]\),\n\s*payload: _jPayload/.test(sco));
  check('the save writes that very stamp', /SBQ\.saveOrder\(orderPayload, \{ at: _saveAt \}\)\.then/.test(sco) &&
    /saveOrder: function\(payload, opts\) \{[^]*?var now = \(opts && typeof opts\.at === 'string' && Date\.parse\(opts\.at\) > 0\) \? opts\.at : new Date\(\)\.toISOString\(\);/.test(SRC));
  check('a save that lands clears only its own journal, not a newer save\'s', /_pj\.payload\.id === _savedOrderId && \(!_pj\.at \|\| _pj\.at === _saveAt\)/.test(sco));
  check('a load notes the stored time it read', /if \(!or\.data\) throw new Error\('Order not found: ' \+ id\);\n\s*SBQ\._noteSeenEdit\(id, or\.data\.last_edited\);/.test(SRC));
  check('...and so does the Songbook\'s poll', /SBQ\._noteSeenEdit\(oid, r\.data\.last_edited\);/.test(fn('_sbPollChanged')));

  console.log('\n4. The replay at boot');
  const run = async (journal, cloudIso, own) => {
    const st = { lhc_pending_order_save: JSON.stringify(journal) };
    const ctx = { saved: [], toasts: [] };
    const R = new Function('ctx', 'st', 'cloudIso', 'own', `
      var localStorage = { getItem: function(k) { return k in st ? st[k] : null; }, removeItem: function(k) { delete st[k]; } };
      var console = { log: function() {}, warn: function() {} };
      function getSupabaseClient() { return { from: function() { var api = { select: function() { return api; }, eq: function() { return api; },
        maybeSingle: function() { return Promise.resolve({ error: null, data: { last_edited: cloudIso } }); } }; return api; } }; }
      var SBQ = { _ownEditsKept: function() { return own || []; }, saveOrder: function(p, o) { ctx.saved.push([p.id, o]); return Promise.resolve({ success: true }); } };
      function showToast(m) { ctx.toasts.push(m); }
      ${fn('_journalMayReplay')}
      ${fn('_replayPendingOrderSave')}
      return _replayPendingOrderSave;`)(ctx, st, cloudIso, own);
    R(); await tick(); await tick(); await tick();
    return { ctx, left: 'lhc_pending_order_save' in st };
  };
  const now = new Date();
  const recent = iso => new Date(now.getTime() - 60000 + (ms(iso) - ms('2026-11-13T10:00:00.000Z'))).toISOString();
  const payload = { id: 'o1', title: 'Service', items: [{ id: 'i1' }] };
  // Times near "now", so the seven-day rule keeps the journal.
  const t0 = recent('2026-11-13T09:59:00.000Z'), tMine = recent('2026-11-13T10:00:00.000Z'), tOther = recent('2026-11-13T09:59:30.000Z');
  let r = await run({ savedAt: tMine, at: tMine, known: [ms(t0), ms(tMine)], payload }, t0, []);
  check('nobody saved since: replayed, the journal cleared, and it says so', J(r.ctx.saved) === J([['o1', undefined]]) && !r.left && r.ctx.toasts.length === 1, J(r));
  check('...with a fresh stamp, not the crashed save\'s', r.ctx.saved[0][1] === undefined);
  r = await run({ savedAt: tMine, at: tMine, known: [ms(t0), ms(tMine)], payload }, tOther, []);
  check('another device saved since (its stamp EARLIER than this device\'s journal): not replayed, journal dropped',
    r.ctx.saved.length === 0 && !r.left, J(r));
  r = await run({ savedAt: tMine, at: tMine, known: [ms(t0), ms(tMine)], payload }, recent('2026-11-13T10:00:20.000Z'), [ms(recent('2026-11-13T10:00:20.000Z'))]);
  check('this device\'s own quick sync stored since: replayed', r.ctx.saved.length === 1, J(r));
  r = await run({ savedAt: tMine, payload }, tOther, []);
  check('a journal from before: the old rule (an earlier stamp is replayed)', r.ctx.saved.length === 1, J(r));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
