'use strict';
// One-off repair: remove the four `standalone_sb_*` pseudo-orders whose
// songbook no longer exists.
//
// WHY
// Opening a songbook creates a row in `orders` with the id
// `standalone_<songbookId>`, to hold the things a songbook has no column
// for -- annotations, transposes, custom lyrics, the projection deck.
// Deleting the songbook does NOT delete that row, so six pseudo-orders
// existed for two songbooks.
//
// They are invisible: SBQ.getOrders already filters `standalone_` out of
// the saved-orders list, and openSongbookStandalone resolves a songbook
// from the `songbooks` table before it will open one, so a pseudo-order
// whose songbook is gone cannot be reached. They were, however, counted:
// until the usage index landed they were counted as real order usage, and
// they are the reason songs that had never been sung led the Trending list.
//
// The counting is fixed independently of this -- the index excludes them by
// prefix. This removes the rows themselves so there is less to exclude.
//
// WHAT IT WILL NOT DO
// It deletes four exact ids, never a pattern, and before each one it
// re-checks that the songbook really is missing. A pseudo-order whose
// songbook still exists holds live work -- one of the two survivors carries
// 80 annotations -- so if a listed songbook has come back, this refuses and
// deletes nothing. It also refuses if the row's title or its item count is
// not what was surveyed, because that means somebody has been in here since.
//
// The backup is written only AFTER every check has passed, and never over a
// file that holds more rows than this run captured. An earlier script in
// this repo wrote its backup first and unconditionally, and a later
// correctly-refusing run overwrote six saved rows with none.
//
// USAGE
//   node tools/remove-orphan-songbook-orders.js            # dry run
//   node tools/remove-orphan-songbook-orders.js --apply    # delete
//
// Exit code 0 = did what it was asked, 1 = refused or something is wrong.

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const U = src.match(/LHC_SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const K = src.match(/LHC_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1];
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' };
const BACKUP = path.join(__dirname, 'backups', 'orphan-songbook-orders.json');

// Surveyed 2026-10-19. Written out rather than discovered, so this can only
// ever touch these four and a surprise in the data stops it.
const PLAN = [
  { id: 'standalone_sb_1782028427783', title: 'Jubilee Dinner Songs - 15 Aug 2026',          items: 0 },
  { id: 'standalone_sb_1777009093822', title: "Luke's Songbook",                             items: 2 },
  { id: 'standalone_sb_1783304253946', title: 'LHC Jubilee Song - 15 Aug 2026',              items: 0 },
  { id: 'standalone_sb_1783318524170', title: 'LHC Jubilee - 15 Aug 2026',                   items: 1 },
];

// The two that must survive, named so that a mistake in the list above is
// caught rather than acted on.
const KEEP = ['standalone_sb_1783318602918', 'standalone_sb_1787986045766'];

async function get(query) {
  const r = await fetch(U + '/rest/v1/' + query, { headers: H });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(query + ' -> ' + JSON.stringify(j));
  return j;
}

// Ask Postgres for the number. A read caps at 1000 rows and says nothing
// about it, so comparing two reads once reported a successful delete as
// having failed.
async function count(query) {
  const r = await fetch(U + '/rest/v1/' + query, {
    headers: Object.assign({}, H, { Prefer: 'count=exact', Range: '0-0' }) });
  return parseInt((r.headers.get('content-range') || '/0').split('/')[1], 10);
}

async function del(query) {
  const r = await fetch(U + '/rest/v1/' + query, { method: 'DELETE', headers: H });
  if (!r.ok) throw new Error('DELETE ' + query + ' -> ' + r.status + ' ' + (await r.text()));
}

const inList = (col, vals) => col + '=in.(' + vals.map(v => '"' + v + '"').join(',') + ')';

(async () => {
  console.log(APPLY ? 'APPLYING\n' : 'DRY RUN  (pass --apply to delete)\n');

  const books = await get('songbooks?select=id,name');
  const bookIds = new Set(books.map(b => b.id));
  const orders = await get('orders?select=id,title,type,service_date,template,created_date,last_edited,created_by,occasion&' +
    inList('id', PLAN.map(p => p.id).concat(KEEP)));
  const byId = {}; orders.forEach(o => byId[o.id] = o);
  const items = await get('order_items?select=*&' + inList('order_id', PLAN.map(p => p.id)));

  let refuse = [];

  // The survivors must still be there and must still have their songbook.
  for (const id of KEEP) {
    const sbId = id.replace(/^standalone_/, '');
    if (!byId[id]) { console.log('  note  ' + id + ' is already gone (not ours to restore)'); continue; }
    if (!bookIds.has(sbId)) refuse.push(id + ' was expected to keep its songbook, but ' + sbId + ' is missing — the survey is out of date');
    else console.log('  keep  ' + id + '  (songbook "' + (books.find(b => b.id === sbId) || {}).name + '" still exists)');
  }
  console.log('');

  const captured = [];
  for (const p of PLAN) {
    const o = byId[p.id];
    const sbId = p.id.replace(/^standalone_/, '');
    const mine = items.filter(i => i.order_id === p.id);

    if (!o) { console.log('  skip  ' + p.id + '  already gone'); continue; }
    if (bookIds.has(sbId)) { refuse.push(p.id + ': its songbook ' + sbId + ' EXISTS — this is live work, not an orphan'); continue; }
    if ((o.title || '') !== p.title) { refuse.push(p.id + ': title is ' + JSON.stringify(o.title) + ', surveyed as ' + JSON.stringify(p.title)); continue; }
    if (mine.length !== p.items) { refuse.push(p.id + ': has ' + mine.length + ' item(s), surveyed with ' + p.items); continue; }

    console.log('  drop  ' + p.id + '  "' + p.title + '"  (' + mine.length + ' item' + (mine.length === 1 ? '' : 's') +
                ', songbook ' + sbId + ' is gone)');
    mine.forEach(i => console.log('          - ' + i.item_type + ' ' + JSON.stringify(i.title || '')));
    captured.push({ order: o, items: mine });
  }

  if (refuse.length) {
    console.log('\nREFUSING — nothing deleted:');
    refuse.forEach(r => console.log('  ! ' + r));
    process.exit(1);
  }
  if (!captured.length) { console.log('\nNothing to do.'); process.exit(0); }

  const totalItems = captured.reduce((n, c) => n + c.items.length, 0);
  console.log('\n' + captured.length + ' order(s) and ' + totalItems + ' order_item(s) would go.');
  if (!APPLY) { console.log('\nDry run. Nothing was changed.'); process.exit(0); }

  // Backup only now, with every check passed, and never over a fuller file.
  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  if (fs.existsSync(BACKUP)) {
    const prev = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
    if ((prev.rows || []).length > captured.length) {
      console.error('REFUSING: ' + path.basename(BACKUP) + ' already holds ' + prev.rows.length +
                    ' order(s); this run captured ' + captured.length + '. Not overwriting a fuller backup.');
      process.exit(1);
    }
  }
  fs.writeFileSync(BACKUP, JSON.stringify({
    taken: new Date().toISOString().slice(0, 10),
    note: 'The four standalone_sb_* pseudo-orders whose songbook no longer existed, with their order_items. ' +
          'To restore: POST each .order to /rest/v1/orders, then its .items to /rest/v1/order_items. ' +
          'Restoring does NOT bring the songbooks back, so they would be unreachable again.',
    rows: captured
  }, null, 2));
  console.log('\nbacked up to ' + path.relative(ROOT, BACKUP));

  const before = { orders: await count('orders?select=id'), items: await count('order_items?select=id') };

  // Items first: an order row with items pointing at it is the shape the
  // schema expects, and removing it the other way round would leave them
  // dangling if the second delete failed.
  if (totalItems) await del('order_items?' + inList('order_id', captured.map(c => c.order.id)));
  await del('orders?' + inList('id', captured.map(c => c.order.id)));

  const after = { orders: await count('orders?select=id'), items: await count('order_items?select=id') };
  console.log('\norders      ' + before.orders + ' -> ' + after.orders + '   (expected -' + captured.length + ')');
  console.log('order_items ' + before.items + ' -> ' + after.items + '   (expected -' + totalItems + ')');

  const left = await get('orders?select=id&' + inList('id', captured.map(c => c.order.id)));
  const ok = left.length === 0
    && (before.orders - after.orders) === captured.length
    && (before.items - after.items) === totalItems;

  // The survivors are re-read rather than assumed.
  const kept = await get('orders?select=id&' + inList('id', KEEP));
  console.log('survivors still present: ' + kept.length + '/' + KEEP.length);

  console.log(ok && kept.length === KEEP.length ? '\nDone.' : '\nSomething is off — check the numbers above.');
  process.exit(ok && kept.length === KEEP.length ? 0 : 1);
})().catch(e => { console.error('FAILED ' + e.message); process.exit(1); });
