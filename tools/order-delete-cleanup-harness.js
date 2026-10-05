'use strict';
// Regression harness for what a deleted order takes with it.
//
// WHY THIS EXISTS
// Removing an order used to remove exactly two things: its items and the order
// row. Everything else it owned stayed. Measured 2026-10-05: 31 orphaned
// projection_settings rows belonging to orders long gone, and uploads with
// nothing left pointing at them.
//
// Where that ends up is recorded in the sermon-conversion code: "the single
// biggest thing in storage: 49 files and 629 MB, none of them referenced by
// any order". That leak was plugged at the upload end; this is the other end.
//
// THE DANGEROUS DIRECTION
// A cleanup that deletes too much is far worse than one that deletes too
// little. A stale 24MB file is a nuisance; a background removed from under an
// order that is about to be projected is a service with a black screen. So the
// tests that matter most here are the ones proving a SHARED file is kept --
// including the case where a table cannot be read at all, where nothing may be
// deleted because the unreadable table might be the one still using it.
//
// USAGE
//   node tools/order-delete-cleanup-harness.js                 # ../Index.html
//   node tools/order-delete-cleanup-harness.js path/to/file.html
//   node tools/order-delete-cleanup-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show 2e9db28:Index.html > x`).
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

function extract(pattern, name, optional) {
  const startIdx = lines.findIndex(l => pattern.test(l));
  if (startIdx < 0) {
    if (optional) return null;
    throw new Error('not found: ' + name);
  }
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n').replace(/,\s*$/, ''), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces: ' + name);
}

const pathsIn = extract(/^function _storagePathsIn\(/, '_storagePathsIn', true);
const readAll = extract(/^function _readAllRows\(/, '_readAllRows', true);
const cleanup = extract(/^function _deleteUnreferencedUploads\(/, '_deleteUnreferencedUploads', true);
const delOrder = extract(/^  deleteOrder: function\(id\)/, 'deleteOrder', true);

console.log('Extracted from ' + path.basename(INDEX) + ':');
['_storagePathsIn:' + (pathsIn ? pathsIn.line : 'ABSENT'),
 '_readAllRows:' + (readAll ? readAll.line : 'ABSENT'),
 '_deleteUnreferencedUploads:' + (cleanup ? cleanup.line : 'ABSENT'),
 'deleteOrder:' + (delOrder ? delOrder.line : 'ABSENT')]
  .forEach(s => console.log('  ' + s));
console.log('');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

const BUCKET = 'Liturgy Files';
const urlFor = p => 'https://x.supabase.co/storage/v1/object/public/' +
  encodeURIComponent(BUCKET) + '/' + p;

// A Supabase client just real enough: tables of rows, with delete and paging.
function makeClient(tables, opts) {
  opts = opts || {};
  const deletes = [];
  return {
    deletes,
    client: {
      from(table) {
        const q = { _table: table, _filters: {} };
        q.select = () => q;
        q.eq = (col, val) => { q._filters[col] = val; return q; };
        q.range = (from, to) => {
          if (opts.unreadable && opts.unreadable.indexOf(table) !== -1) {
            return Promise.resolve({ error: { message: 'permission denied' }, data: null });
          }
          const rows = (tables[table] || []).slice(from, to + 1);
          return Promise.resolve({ error: null, data: rows });
        };
        q.delete = () => {
          const d = { _table: table, _filters: {} };
          d.eq = (col, val) => {
            d._filters[col] = val;
            deletes.push({ table, filters: Object.assign({}, d._filters) });
            // Really remove the rows. The cleanup relies on scanning AFTER the
            // order is gone, so a stub that only recorded the call would make
            // the order look like it still referenced its own file.
            tables[table] = (tables[table] || []).filter(r => r[col] !== val);
            return Promise.resolve(
              opts.failDeleteOn === table ? { error: { message: 'nope' } } : { error: null });
          };
          return d;
        };
        // A plain select().eq() that is then awaited.
        q.then = (res, rej) => {
          if (opts.unreadable && opts.unreadable.indexOf(table) !== -1) {
            return Promise.resolve({ error: { message: 'permission denied' }, data: null }).then(res, rej);
          }
          let rows = tables[table] || [];
          Object.keys(q._filters).forEach(col => {
            rows = rows.filter(r => r[col] === q._filters[col]);
          });
          return Promise.resolve({ error: null, data: rows }).then(res, rej);
        };
        return q;
      }
    }
  };
}

function build(tables, opts) {
  const { client, deletes } = makeClient(tables, opts);
  const removed = [];
  const env = {
    LHC_SUPABASE_BUCKET: BUCKET,
    deleteFromSupabase: p => removed.push(p),
    console: { warn: () => {}, log: () => {}, error: () => {} },
    Promise, Object, JSON, String, Error
  };
  env.SBQ = { _sb: () => client };
  const keys = Object.keys(env);
  const body = [pathsIn, readAll, cleanup].filter(Boolean).map(x => x.text).join('\n') +
    '\n; return { pathsIn: _storagePathsIn, readAll: _readAllRows, cleanup: _deleteUnreferencedUploads' +
    (delOrder ? ', SBQ: { _sb: SBQ._sb, ' + delOrder.text + ' }' : '') + ' };';
  const api = new Function(...keys, body)(...keys.map(k => env[k]));
  return { api, removed, deletes };
}

(async () => {
  if (!pathsIn || !cleanup || !delOrder) {
    if (EXPECT_BROKEN) {
      console.log('before the fix');
      check('(pre-fix) the order delete cleaned nothing up', !!cleanup, false);
    } else {
      check('the cleanup helpers exist', false, true);
    }
  } else {
    console.log('paths are read out of the rows');
    {
      const { api } = build({});
      const rows = [[{ id: 'o1', bg: urlFor('orders/images/123_a.png') }],
                    [{ id: 'i1', slides: [{ background: urlFor('backgrounds/456_b.jpeg') }] }]];
      const got = api.pathsIn(rows).sort();
      check('both are found, without the bucket',
        got, ['backgrounds/456_b.jpeg', 'orders/images/123_a.png']);
      check('nothing is invented from rows with no files', api.pathsIn([[{ id: 'x' }]]), []);
      check('an empty input is fine', api.pathsIn([]), []);
    }

    console.log('\na file nothing uses is removed');
    {
      const { api, removed } = build({
        orders: [], order_items: [], songs: [], songbooks: [], song_layouts: [],
        liturgy_items: [], lhc_backgrounds: [], projection_versions: [],
        projection_settings: [], order_media_links: [], song_recordings: []
      });
      const res = await api.cleanup(api.SBQ._sb(), ['orders/images/123_a.png']);
      check('it is deleted', removed, ['orders/images/123_a.png']);
      check('and reported as deleted', res.deleted.length, 1);
      check('nothing is kept', res.kept.length, 0);
    }

    console.log('\na file something else still uses is KEPT');
    for (const [where, rows] of [
      ['the background library', { lhc_backgrounds: [{ id: 'bg1', url: urlFor('orders/images/123_a.png') }] }],
      ['another order', { orders: [{ id: 'o2', bg: urlFor('orders/images/123_a.png') }] }],
      ['another order\'s items', { order_items: [{ id: 'i9', slides: [{ background: urlFor('orders/images/123_a.png') }] }] }],
      ['the liturgy library', { liturgy_items: [{ id: 'l1', fileUrl: urlFor('orders/images/123_a.png') }] }],
      ['a saved projection version', { projection_versions: [{ id: 'v1', deck: urlFor('orders/images/123_a.png') }] }]
    ]) {
      const base = {
        orders: [], order_items: [], songs: [], songbooks: [], song_layouts: [],
        liturgy_items: [], lhc_backgrounds: [], projection_versions: [],
        projection_settings: [], order_media_links: [], song_recordings: []
      };
      const { api, removed } = build(Object.assign(base, rows));
      const res = await api.cleanup(api.SBQ._sb(), ['orders/images/123_a.png']);
      check('still used by ' + where + ' -> kept', removed.length === 0 && res.kept.length === 1, true);
    }

    console.log('\nwhen it cannot be sure, it deletes nothing');
    {
      const base = {
        orders: [], order_items: [], songs: [], songbooks: [], song_layouts: [],
        liturgy_items: [], lhc_backgrounds: [], projection_versions: [],
        projection_settings: [], order_media_links: [], song_recordings: []
      };
      const { api, removed } = build(base, { unreadable: ['liturgy_items'] });
      const res = await api.cleanup(api.SBQ._sb(), ['orders/images/123_a.png']);
      check('an unreadable table stops all deletion', removed.length, 0);
      check('and every path is reported as kept', res.kept.length, 1);
    }

    console.log('\nthe order takes its belongings with it');
    {
      const base = {
        orders: [{ id: 'order_1', bg: urlFor('orders/images/123_a.png') }],
        order_items: [{ id: 'i1', order_id: 'order_1' }],
        songs: [], songbooks: [], song_layouts: [], liturgy_items: [],
        lhc_backgrounds: [], projection_versions: [], projection_settings: [],
        order_media_links: [], song_recordings: []
      };
      const { api, removed, deletes } = build(base);
      const out = await api.SBQ.deleteOrder('order_1');
      const tables = deletes.map(d => d.table);
      check('it reports success', out, { success: true });
      check('the items go', tables.indexOf('order_items') !== -1, true);
      check('the order goes', tables.indexOf('orders') !== -1, true);
      check('its projection settings go', tables.indexOf('projection_settings') !== -1, true);
      const ps = deletes.find(d => d.table === 'projection_settings');
      check('keyed on owner_id, which IS the order id', ps && ps.filters.owner_id, 'order_1');
      check('and its unreferenced upload goes', removed, ['orders/images/123_a.png']);
    }
    {
      // A cleanup failure must not look like a failed delete.
      const base = {
        orders: [{ id: 'order_1' }], order_items: [], songs: [], songbooks: [],
        song_layouts: [], liturgy_items: [], lhc_backgrounds: [],
        projection_versions: [], projection_settings: [], order_media_links: [],
        song_recordings: []
      };
      const { api } = build(base, { unreadable: ['songs'] });
      const out = await api.SBQ.deleteOrder('order_1');
      check('a cleanup that cannot run still reports the delete as done', out, { success: true });
    }
  }

  console.log('\nthe source still says so');
  {
    const clearsSettings = /from\('projection_settings'\)\.delete\(\)\.eq\('owner_id', id\)/.test(raw);
    if (EXPECT_BROKEN) {
      check('(pre-fix) settings were left behind', clearsSettings, false);
    } else {
      check('projection_settings is cleared on delete', clearsSettings, true);
    }
  }

  console.log('\n================================');
  const passed = results.filter(Boolean).length;
  console.log(passed + '/' + results.length + ' checks passed');
  if (passed !== results.length) process.exit(1);
})();
