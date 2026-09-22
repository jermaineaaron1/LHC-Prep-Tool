'use strict';
// Find and (optionally) delete storage files that nothing in the database
// points at.
//
// WHY
// Measured on this project: 68 MB in the bucket, of which 57 MB was orphaned.
// The cause is duplicate uploads -- the same Lectionary PDF stored five times,
// one background image five times, twenty projection snapshots from a single
// afternoon in April. Nothing links to them and nothing ever will.
//
// HOW IT DECIDES
// It takes a fresh snapshot of every table, then asks of each stored file: does
// this filename appear ANYWHERE in the database? Anywhere at all -- in a URL,
// in a template blob, in a slide. That is a deliberately generous test: it errs
// towards calling a file "used", because the cost of keeping a stray file is a
// few megabytes and the cost of deleting a live one is somebody's sheet music.
//
// WHAT IT CANNOT KNOW
// A file referenced only from a browser's localStorage, or pasted into a
// message, will look orphaned. Nothing in this project stores bucket paths that
// way, but it is the reason --apply prints the list and makes you confirm.
//
// USAGE
//   node tools/prune-storage.js                 # list orphans, delete nothing
//   node tools/prune-storage.js --folder snapshots
//   node tools/prune-storage.js --apply         # delete them
//   node tools/prune-storage.js --folder lectionary-uploads --apply

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BACKUPS = path.join(ROOT, 'backups');
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ONLY = (() => { const i = argv.indexOf('--folder'); return i !== -1 ? argv[i + 1] : null; })();

const BUCKET = 'Liturgy Files';
const FOLDERS = ['backgrounds', 'documents', 'lectionary-uploads', 'liturgy',
                 'orders', 'snapshots', 'song-docs', 'song-scans', 'songbook'];

function credentials() {
  let url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (url && key) return { url, key };
  const src = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
  return {
    url: src.match(/LHC_SUPABASE_URL\s*=\s*'([^']+)'/)[1],
    key: src.match(/LHC_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1]
  };
}

// The reference check is only as good as the snapshot it reads, so take a fresh
// one. Deleting against a stale copy of the database is how a file that was
// linked ten minutes ago gets thrown away.
function freshSnapshot() {
  process.stdout.write('Taking a fresh snapshot of the database first... ');
  execFileSync('node', [path.join(__dirname, 'export-supabase.js')], { cwd: ROOT, stdio: 'pipe' });
  console.log('done.');
}

function referencedNames() {
  let blob = '';
  for (const f of fs.readdirSync(BACKUPS)) {
    if (f.startsWith('.')) continue;
    const p = path.join(BACKUPS, f);
    // Only the table snapshots. backups/ can also hold directories -- an
    // archive of files pulled out before a prune, for one -- and reading a
    // directory as text throws.
    if (!fs.statSync(p).isFile() || !f.endsWith('.json')) continue;
    blob += fs.readFileSync(p, 'utf8');
  }
  return blob;
}

async function listFolder(url, key, folder) {
  const res = await fetch(`${url}/storage/v1/object/list/${encodeURIComponent(BUCKET)}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: folder + '/', limit: 1000 })
  });
  if (!res.ok) throw new Error(`${folder}: HTTP ${res.status} listing`);
  return (await res.json()).map(o => ({
    name: o.name, full: folder + '/' + o.name,
    size: (o.metadata && o.metadata.size) || 0
  })).filter(o => o.name);
}

async function remove(url, key, paths) {
  const res = await fetch(`${url}/storage/v1/object/${encodeURIComponent(BUCKET)}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths })
  });
  if (!res.ok) throw new Error(`delete failed: HTTP ${res.status} — ${await res.text()}`);
}

const MB = b => (b / 1048576).toFixed(2) + ' MB';

(async function main() {
  const { url, key } = credentials();
  freshSnapshot();
  const blob = referencedNames();

  const folders = ONLY ? [ONLY] : FOLDERS;
  const orphans = [];
  let keptBytes = 0, keptCount = 0;

  for (const folder of folders) {
    for (const f of await listFolder(url, key, folder)) {
      if (blob.indexOf(f.name) !== -1) { keptCount++; keptBytes += f.size; }
      else orphans.push(f);
    }
  }

  orphans.sort((a, b) => b.size - a.size);
  const total = orphans.reduce((n, o) => n + o.size, 0);

  console.log(`\nIn use : ${keptCount} file(s), ${MB(keptBytes)}`);
  console.log(`Orphan : ${orphans.length} file(s), ${MB(total)}\n`);
  if (!orphans.length) { console.log('Nothing to clean up.'); return; }

  orphans.forEach(o => console.log(`  ${MB(o.size).padStart(9)}  ${o.full}`));

  if (!APPLY) {
    console.log(`\nDry run — nothing deleted. Add --apply to free ${MB(total)}.`);
    return;
  }

  console.log(`\nDeleting ${orphans.length} file(s)...`);
  for (let i = 0; i < orphans.length; i += 50) {
    await remove(url, key, orphans.slice(i, i + 50).map(o => o.full));
  }
  console.log(`Freed ${MB(total)}.`);
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
