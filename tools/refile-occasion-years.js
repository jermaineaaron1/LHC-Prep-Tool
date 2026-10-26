'use strict';
// Repair: put library items back into the year folders they name.
//
// Run for Good Friday on 2026-10-26. Six more items, across Advent, Easter,
// Palm Sunday, Ash Wednesday and Watchnight, can be re-filed the same way.
//
// WHY
// Items carry an occasion_folder_id naming the year they belong to. For Good
// Friday every one of those folders had been deleted, so the Library showed
// nine items under "Year not set" and, before that was fixed, under six
// separate blocks all headed the same way.
//
// The year looked unrecoverable at first glance: a folder id encodes when
// the folder was created, not what it was called. It is recoverable from the
// items themselves -- their titles and filenames say the year outright
// ("LHC Liturgy - Good Friday 2024", "Abide With Me - SATB_GF 2024.pdf") --
// and the dead folder ids corroborate it exactly: every item sharing a dead
// folder agrees on one year, which is what a year folder is.
//
// So the mapping below is not a guess. It is read off the item names, and
// the script refuses unless the folder grouping agrees with them.
//
// WHAT IT WILL NOT DO
// It touches only occasion_folder_id, only on good-friday items, and only on
// the exact ids listed. It does not rename, move between occasions, delete,
// or touch the file behind an item. An item whose name carries no year is
// left alone rather than filed somewhere plausible -- there is one, a song
// with no year in its title, and guessing for it would be inventing history.
//
// USAGE
//   node tools/refile-occasion-years.js                    # dry run, Good Friday
//   node tools/refile-occasion-years.js --apply            # write
//   node tools/refile-occasion-years.js easter --apply     # another service
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
// Which service to re-file. Good Friday is the default because it is what
// this was written for, but nothing in it is specific to Good Friday: six
// more items across Advent, Easter, Palm Sunday, Ash Wednesday and
// Watchnight name their year the same way.
const OCC = process.argv.find(a => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]) || 'good-friday';
const BACKUP = path.join(__dirname, 'backups', OCC + '-refile.json');

async function req(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  return { ok: res.ok, status: res.status, text, json };
}

// The year an item names, from its title or its filename. Four digits in the
// 20xx range, and only one distinct value -- a name mentioning two years is
// ambiguous and gets no answer rather than the first match.
function yearFromName(item) {
  const hay = (item.title || '') + ' ' + (item.file_name || '');
  const found = [...new Set((hay.match(/\b20\d{2}\b/g) || []))];
  return found.length === 1 ? found[0] : null;
}

let failed = false;
const say = (ok, msg) => { if (!ok) failed = true; console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + msg); };

(async () => {
  console.log(APPLY ? 'APPLYING\n' : 'DRY RUN  (pass --apply to write)\n');

  const items = (await req(U + '/rest/v1/liturgy_items?select=id,title,file_name,occasion_id,occasion_folder_id&occasion_id=eq.' + OCC, { headers: H })).json || [];
  const folders = (await req(U + '/rest/v1/liturgy_occ_folders?select=*&occasion_id=eq.' + OCC, { headers: H })).json || [];
  const liveIds = new Set(folders.map(f => f.id));
  const byName = {};
  folders.forEach(f => { byName[f.name] = f; });

  console.log(OCC + ': ' + items.length + ' item(s), ' + folders.length + ' existing folder(s) ['
    + folders.map(f => f.name).join(', ') + ']\n');

  // Group the items by the dead folder they share, and check that each
  // group agrees on one year. Agreement is the evidence that these were
  // year folders; without it the mapping would be a guess.
  const groups = {};
  items.forEach(it => {
    const k = it.occasion_folder_id || '__none__';
    (groups[k] = groups[k] || []).push(it);
  });

  const plan = [];      // { item, year }
  const skipped = [];
  const clear = [];     // dangling references to null out

  console.log('what the items say about themselves');
  Object.keys(groups).forEach(k => {
    const mine = groups[k];
    const years = [...new Set(mine.map(yearFromName).filter(Boolean))];
    const resolved = k !== '__none__' && liveIds.has(k);

    if (resolved) {
      console.log('  keep  ' + mine.length + ' item(s) already in "' + byName[Object.keys(byName).find(n => byName[n].id === k)].name + '"');
      return;
    }
    if (!years.length) {
      // No year in the name, so there is nowhere honest to file it. But a
      // pointer at a folder that no longer exists is worse than none: it
      // reads as filed and resolves to nothing. Cleared to null, which is
      // what "no year set" actually means. The screen looks the same either
      // way; the data stops claiming something untrue.
      mine.forEach(it => { skipped.push(it); if (it.occasion_folder_id) clear.push(it); });
      console.log('  skip  ' + mine.length + ' item(s) whose names carry no year');
      mine.forEach(it => console.log('          - ' + JSON.stringify(it.title) +
        (it.occasion_folder_id ? '   (dead folder reference will be cleared)' : '')));
      return;
    }
    if (years.length > 1) {
      say(false, 'items sharing folder ' + k + ' disagree about the year: ' + years.join(', '));
      mine.forEach(it => console.log('          - ' + JSON.stringify(it.title) + ' -> ' + yearFromName(it)));
      return;
    }
    const year = years[0];
    // Every item in the group must name that year, not just one of them.
    const silent = mine.filter(it => !yearFromName(it));
    if (silent.length) {
      say(false, 'folder ' + k + ' resolves to ' + year + ' but ' + silent.length + ' item(s) there say nothing');
      silent.forEach(it => console.log('          - ' + JSON.stringify(it.title)));
      return;
    }
    console.log('  file  ' + mine.length + ' item(s) -> ' + year);
    mine.forEach(it => {
      console.log('          - ' + JSON.stringify(it.title));
      plan.push({ item: it, year });
    });
  });

  if (failed) { console.log('\nREFUSING — nothing written.'); process.exitCode = 1; return; }
  if (!plan.length && !clear.length) { console.log('\nNothing to re-file.'); return; }

  const years = [...new Set(plan.map(p => p.year))].sort();
  const missing = years.filter(y => !byName[y]);
  console.log('\n' + plan.length + ' item(s) into ' + years.length + ' year(s): ' + years.join(', '));
  if (missing.length) console.log('folders to create: ' + missing.join(', '));
  console.log('folders reused:    ' + years.filter(y => byName[y]).join(', ') || 'folders reused:    (none)');

  if (!APPLY) { console.log('\nDry run. Nothing was changed.'); return; }

  // Backed up only now, with the plan validated, and MERGED rather than
  // replaced.
  //
  // The first version refused to write a backup smaller than the one on
  // disk, which is the right instinct -- an earlier script in this repo
  // overwrote six saved rows with none -- but it is the wrong mechanism.
  // A second run that re-files nothing and only clears a dead reference has
  // one item to record and would be blocked by its own safety net.
  //
  // Merging by item id cannot lose anything, so the refusal is not needed.
  // Where an item is already recorded the ORIGINAL `was` is kept: that is
  // the state an undo has to return to, and the value this run sees has
  // already been changed by the last one.
  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  let prior = [];
  if (fs.existsSync(BACKUP)) {
    try { prior = JSON.parse(fs.readFileSync(BACKUP, 'utf8')).items || []; }
    catch (e) { console.error('REFUSING: ' + path.basename(BACKUP) + ' is unreadable; not overwriting it.'); process.exitCode = 1; return; }
  }
  const merged = prior.slice();
  const seen = new Set(prior.map(p => p.id));
  plan.concat(clear.map(it => ({ item: it, year: null })))
    .forEach(p => {
      if (seen.has(p.item.id)) return;
      seen.add(p.item.id);
      merged.push({ id: p.item.id, title: p.item.title, was: p.item.occasion_folder_id, year: p.year });
    });
  fs.writeFileSync(BACKUP, JSON.stringify({
    taken: new Date().toISOString(),
    note: 'occasion_folder_id of the Good Friday liturgy items before they were re-filed into year folders. ' +
          'To undo: PATCH each id back to its `was`. Entries accumulate across runs and the first ' +
          '`was` recorded for an item is kept, because that is the state an undo must reach.',
    items: merged
  }, null, 2));
  console.log('\nbacked up to ' + path.relative(ROOT, BACKUP) +
    '  (' + merged.length + ' item(s) recorded, ' + (merged.length - prior.length) + ' new)');

  // Create the folders that do not exist yet.
  for (const y of missing) {
    const id = 'occ-fold-' + Date.now() + '-' + y;
    const r = await req(U + '/rest/v1/liturgy_occ_folders', {
      method: 'POST', headers: Object.assign({}, H, { Prefer: 'return=representation' }),
      body: JSON.stringify({ id, occasion_id: OCC, name: y, sort_order: 0 })
    });
    if (!r.ok) { say(false, 'could not create folder ' + y + ': ' + r.text.slice(0, 120)); process.exitCode = 1; return; }
    byName[y] = (r.json || [])[0] || { id, name: y };
    console.log('  created folder ' + y);
  }

  // Dangling references on the items that cannot be filed.
  for (const it of clear) {
    const r = await req(U + '/rest/v1/liturgy_items?id=eq.' + encodeURIComponent(it.id), {
      method: 'PATCH', headers: H, body: JSON.stringify({ occasion_folder_id: null })
    });
    if (!r.ok) say(false, 'could not clear ' + JSON.stringify(it.title) + ': ' + r.text.slice(0, 120));
    else console.log('  cleared the dead folder reference on ' + JSON.stringify(it.title));
  }

  // Re-file, one item at a time so a failure names the item it failed on.
  let moved = 0;
  for (const p of plan) {
    const target = byName[p.year];
    const r = await req(U + '/rest/v1/liturgy_items?id=eq.' + encodeURIComponent(p.item.id), {
      method: 'PATCH', headers: H, body: JSON.stringify({ occasion_folder_id: target.id })
    });
    if (!r.ok) { say(false, 'could not move ' + JSON.stringify(p.item.title) + ': ' + r.text.slice(0, 120)); continue; }
    moved++;
  }
  console.log('\nmoved ' + moved + '/' + plan.length);

  // Read it back rather than trusting the writes.
  const after = (await req(U + '/rest/v1/liturgy_items?select=id,title,occasion_folder_id&occasion_id=eq.' + OCC, { headers: H })).json || [];
  const foldersAfter = (await req(U + '/rest/v1/liturgy_occ_folders?select=id,name&occasion_id=eq.' + OCC, { headers: H })).json || [];
  const nameById = {}; foldersAfter.forEach(f => { nameById[f.id] = f.name; });
  console.log('\nGood Friday now reads:');
  const grouped = {};
  after.forEach(it => {
    const label = nameById[it.occasion_folder_id] || 'Year not set';
    (grouped[label] = grouped[label] || []).push(it.title);
  });
  Object.keys(grouped).sort().forEach(y => {
    console.log('  ' + y + '  (' + grouped[y].length + ')');
    grouped[y].forEach(t => console.log('      ' + t));
  });

  const stillOrphan = after.filter(it => it.occasion_folder_id && !nameById[it.occasion_folder_id]);
  say(stillOrphan.length === 0, stillOrphan.length
    ? stillOrphan.length + ' item(s) still point at a folder that does not exist'
    : 'no item points at a folder that does not exist');
  say(moved === plan.length, moved === plan.length ? 'every planned move landed' : 'some moves did not land');
  if (skipped.length) console.log('\nleft alone (no year in the name): ' + skipped.map(s => JSON.stringify(s.title)).join(', '));

  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('FAILED ' + e.message); process.exitCode = 1; });
