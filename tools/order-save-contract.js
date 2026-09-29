'use strict';
// Regression harness for the one rule that keeps a deleted order deleted.
//
// WHY THIS EXISTS
// SBQ.saveOrder wrote the orders row with an upsert, which cannot tell "create
// this order" from "write to the order I have open". Delete an order on one
// device while somebody else has it open and their next save put it straight
// back: the row returned with its title, template and backgrounds and none of
// its items, because the item rows were gone and the save had nothing to
// rebuild them from. A ghost service that would not stay deleted. It happened
// even on a save that reported "nothing had changed", because that counts item
// rows and the order row was already written by then.
//
// The rule now is: a save may CREATE the row only when the caller asked for a
// new order -- no id at all, or isNewOrder: true. Every other save is an edit,
// and an edit that matches no row refuses instead of building one.
//
// That rule lives in one ternary. Turning it back into an unconditional upsert
// would look like a simplification and would silently restore the bug, so it
// is worth a test that runs the real code.
//
// HOW IT WORKS
// It slices the REAL SBQ.saveOrder out of Index.html and runs it against a
// fake Supabase client that records which call each path makes. No database.
//
// USAGE
//   node tools/order-save-contract.js                 # checks ../Index.html
//   node tools/order-save-contract.js path/to/file.html
//   node tools/order-save-contract.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show dcd484e:Index.html > x`).
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

const lines = fs.readFileSync(INDEX, 'utf8').split('\n');

// Slice `  saveOrder: function(payload) { ... }` out of the SBQ object literal.
function extractMethod(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  ' + name + ': function\\(').test(l));
  if (startIdx < 0) throw new Error('method not found in ' + path.basename(INDEX) + ': ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}

const saveOrder = extractMethod('saveOrder');
console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  SBQ.saveOrder @ line ' + saveOrder.line + '\n');

// A Supabase stand-in that records what was asked of it. `rowsMatched` decides
// whether the orders table still holds the order.
function makeClient(rowsMatched) {
  const calls = [];
  const thenable = value => ({
    then: (f, r) => Promise.resolve(value).then(f, r),
    catch: r => Promise.resolve(value).catch(r),
    select: () => thenable(value),
    eq: () => thenable(value),
    in: () => thenable(value),
    delete: () => thenable({ data: [], error: null })
  });
  const client = {
    from(table) {
      return {
        upsert(row, opts) {
          calls.push({ table, op: 'upsert', id: row && row.id });
          return thenable({ data: [row], error: null });
        },
        update(row) {
          calls.push({ table, op: 'update', id: row && row.id });
          return {
            eq: () => ({
              select: () => thenable({ data: rowsMatched ? [{ id: row.id }] : [], error: null }),
              then: (f, r) => Promise.resolve({ data: rowsMatched ? [{ id: row.id }] : [], error: null }).then(f, r)
            })
          };
        },
        select(cols, opts) {
          calls.push({ table, op: 'select' });
          return {
            eq: () => thenable({ data: [], count: 0, error: null }),
            in: () => thenable({ data: [], count: 0, error: null }),
            then: (f, r) => Promise.resolve({ data: [], count: 0, error: null }).then(f, r)
          };
        },
        delete() {
          calls.push({ table, op: 'delete' });
          return { eq: () => thenable({ data: [], error: null }), in: () => thenable({ data: [], error: null }) };
        },
        insert(rows) { calls.push({ table, op: 'insert' }); return thenable({ data: rows, error: null }); }
      };
    }
  };
  return { client, calls };
}

function run(payload, rowsMatched) {
  const { client, calls } = makeClient(rowsMatched);
  const SBQ = {
    _sb: () => client,
    _noteStored: () => {},
    _itemFromRow: r => r,
    _stableKeys: o => JSON.stringify(o),
    _rowFromItem: i => i
  };
  const body = '(function(){ var SBQ = arguments[0]; return { ' + saveOrder.text + ' }; })';
  const obj = eval(body)(SBQ);
  SBQ.saveOrder = obj.saveOrder;
  return obj.saveOrder.call(SBQ, payload)
    .then(r => ({ resolved: true, result: r, calls }))
    .catch(e => ({ resolved: false, error: e, orderDeleted: !!e.orderDeleted, calls }));
}

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label);
  if (!ok) console.log('          expected ' + e + '\n          actual   ' + a);
}

const BASE = { title: 'T', type: 'traditional', serviceDate: 'Oct 4', template: {}, createdDate: 'x', items: [] };
const ordersOps = calls => calls.filter(c => c.table === 'orders').map(c => c.op);

(async () => {
  // 1 - no id at all: the caller is asking for a new order
  console.log('Scenario 1 - creating an order still builds the row');
  {
    const r = await run(Object.assign({ id: null }, BASE), false);
    check('an id-less payload creates', ordersOps(r.calls), ['upsert']);
    check('and it resolves', r.resolved, true);
  }

  // 2 - the caller made its own id and says it means to create
  console.log('\nScenario 2 - a caller that makes its own id must say so');
  {
    const r = await run(Object.assign({ id: 'order_new_1', isNewOrder: true }, BASE), false);
    check('isNewOrder creates even with an id given', ordersOps(r.calls), ['upsert']);
    check('and it resolves', r.resolved, true);
  }

  // 3 - an ordinary edit to an order that is still there
  console.log('\nScenario 3 - an ordinary edit updates in place');
  {
    const r = await run(Object.assign({ id: 'order_existing' }, BASE), true);
    if (EXPECT_BROKEN) {
      check('(pre-fix) an edit was an upsert too', ordersOps(r.calls), ['upsert']);
    } else {
      check('an edit updates, never upserts', ordersOps(r.calls), ['update']);
    }
    check('and it resolves', r.resolved, true);
  }

  // 4 - the bug: an edit to an order somebody else deleted
  console.log('\nScenario 4 - an edit to a deleted order refuses');
  {
    const r = await run(Object.assign({ id: 'order_deleted' }, BASE), false);
    if (EXPECT_BROKEN) {
      check('(pre-fix) the deleted order was written back', ordersOps(r.calls), ['upsert']);
      check('(pre-fix) and the save reported success', r.resolved, true);
    } else {
      check('nothing is upserted', ordersOps(r.calls).includes('upsert'), false);
      check('the save rejects', r.resolved, false);
      check('and says why', r.orderDeleted, true);
      check('no item rows are touched either',
        r.calls.filter(c => c.table === 'order_items' && c.op !== 'select').length, 0);
    }
  }

  console.log('\n================================');
  const passed = results.filter(Boolean).length;
  console.log(passed + '/' + results.length + ' checks passed');
  if (passed !== results.length) process.exit(1);
})();
