'use strict';
// Put one order back from a snapshot.
//
// A backup nobody has restored from is a rumour, so this is the other half of
// tools/export-supabase.js and is meant to be run in anger, on a bad day, by
// someone who is not in the mood to read code. It therefore does the least
// surprising thing available:
//
//   * It only ever ADDS. Rows are upserted; nothing is deleted. The worst it
//     can do is put back something you had removed on purpose, which you can
//     then remove again. It cannot make a bad situation worse.
//   * It prints what it would do and stops. Writing needs --apply typed out.
//   * It works on ONE order at a time, named explicitly, because "restore
//     everything" is how a stale snapshot overwrites a week of good work.
//
// USAGE
//   node tools/restore-order.js --list
//   node tools/restore-order.js --order order_1788431452264
//   node tools/restore-order.js --order order_1788431452264 --apply
//
//   --from <dir>   snapshot directory (default: ./backups)
//
// Credentials come from SUPABASE_URL / SUPABASE_ANON_KEY when set, otherwise
// from Index.html, exactly as the exporter does.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };

const FROM = path.resolve(ROOT, val('--from', 'backups'));
const ORDER = val('--order', null);
const APPLY = has('--apply');

function credentials() {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_ANON_KEY;
  if (url && key) return { url, key };
  const src = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
  const u = src.match(/LHC_SUPABASE_URL\s*=\s*'([^']+)'/);
  const k = src.match(/LHC_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
  if (!u || !k) throw new Error('No Supabase credentials in the environment or in Index.html.');
  return { url: u[1], key: k[1] };
}

function readSnapshot(name) {
  const file = path.join(FROM, name + '.json');
  if (!fs.existsSync(file)) throw new Error('Missing ' + file + ' — is --from pointing at a snapshot?');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function live(url, key, table, orderId, column) {
  const res = await fetch(`${url}/rest/v1/${table}?select=id&${column}=eq.${encodeURIComponent(orderId)}`,
    { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} reading current rows`);
  return (await res.json()).map(r => r.id);
}

async function upsert(url, key, table, rows) {
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const res = await fetch(`${url}/rest/v1/${table}?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(batch)
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} writing — ${await res.text()}`);
  }
}

(async function main() {
  const { url, key } = credentials();
  const orders = readSnapshot('orders');
  const items = readSnapshot('order_items');

  if (has('--list') || !ORDER) {
    const manifest = path.join(FROM, '_manifest.json');
    if (fs.existsSync(manifest)) {
      console.log('Snapshot taken ' + JSON.parse(fs.readFileSync(manifest, 'utf8')).takenAt + '\n');
    }
    console.log('Orders in this snapshot:\n');
    orders.forEach(o => {
      const n = items.filter(i => i.order_id === o.id).length;
      console.log('  ' + o.id.padEnd(34) + String(n).padStart(4) + ' items   ' + (o.title || ''));
    });
    if (!ORDER) console.log('\nName one with --order <id> to see what restoring it would do.');
    return;
  }

  const order = orders.find(o => o.id === ORDER);
  if (!order) throw new Error('No order ' + ORDER + ' in this snapshot. Try --list.');
  const mine = items.filter(i => i.order_id === ORDER);

  const liveItemIds = await live(url, key, 'order_items', ORDER, 'order_id');
  const missing = mine.filter(i => liveItemIds.indexOf(i.id) === -1);
  const present = mine.length - missing.length;

  console.log(`Order   ${ORDER}`);
  console.log(`Title   ${order.title || '(untitled)'}`);
  console.log(`Snapshot has ${mine.length} item(s); ${present} already live, ${missing.length} missing.\n`);

  if (!missing.length) {
    console.log('Nothing to put back. (Rows that exist but were edited are left alone:');
    console.log('this only restores what is gone, so it cannot overwrite newer work.)');
    return;
  }
  missing.slice(0, 40).forEach(i => console.log('  + ' + (i.item_type || '?').padEnd(9) + (i.title || i.id)));
  if (missing.length > 40) console.log('  … and ' + (missing.length - 40) + ' more');

  if (!APPLY) {
    console.log('\nDry run. Nothing was written. Add --apply to restore these.');
    return;
  }

  // The order row first, so the items always have a parent to belong to.
  await upsert(url, key, 'orders', [order]);
  await upsert(url, key, 'order_items', missing);
  console.log('\nRestored ' + missing.length + ' item(s) to ' + ORDER + '.');
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
