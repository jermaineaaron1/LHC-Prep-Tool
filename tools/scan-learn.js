'use strict';
// What does the scanner keep getting wrong, according to the person fixing it?
//
// WHY THIS EXISTS
// The model cannot be trained. Nothing accumulates between scans, and no edit
// made in the app teaches it anything by itself. So the feature improves in
// exactly one way: somebody notices a pattern in what has to be corrected, and
// that pattern becomes a prompt example, a post-processing rule, or a fixture.
//
// The bottleneck was never the analysis -- it was that corrections vanished the
// moment they were made. Nothing recorded what the scan proposed against what
// was actually saved, so there was nothing to find a pattern in. The app now
// writes that pair to scan-corrections/ each time a scanned song is saved, and
// this reads them back.
//
// WHAT IT WILL NOT DO
// It will not change the prompt on its own, and that is deliberate. One
// person's edit on one evening is not a rule -- a title corrected because the
// hymnal spells it differently should not quietly retrain every future scan.
// This surfaces what recurs and how often; turning that into a rule stays a
// decision someone makes, with a fixture behind it to prove it worked.
//
// USAGE
//   node tools/scan-learn.js            summarise every recorded correction
//   node tools/scan-learn.js --field lyrics   show the lyric edits in full
//   node tools/scan-learn.js --limit 200

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUCKET = 'Liturgy Files';
const PREFIX = 'scan-corrections';

const HTML = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const SB = (HTML.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
const KEY = (HTML.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9._-]+/) || [])[0];

// The scan reports these under one name and the song stores them under another.
const PAIRS = [
  ['title', 'title'], ['artist', 'artist'], ['key', 'key'], ['tempo', 'tempo'],
  ['style', 'category'], ['season', 'season'], ['scripture', 'scripture'],
  ['alternateTitle', 'alternateTitle'], ['copyright', 'copyright'],
  ['ccli', 'ccliNumber'], ['timeSignature', 'timeSignature'], ['bpm', 'bpm'],
  ['lyrics', 'lyrics'],
];

const norm = (v) => (v === null || v === undefined ? '' : String(v).trim());

async function listRecords(limit) {
  const res = await fetch(SB + '/storage/v1/object/list/' + encodeURIComponent(BUCKET), {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: PREFIX, limit: limit || 500, sortBy: { column: 'created_at', order: 'desc' } }),
  });
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('could not list ' + PREFIX + ': ' + JSON.stringify(rows).slice(0, 200));
  return rows.filter((r) => r.name.endsWith('.json'));
}

async function fetchRecord(name) {
  const url = SB + '/storage/v1/object/public/' + encodeURIComponent(BUCKET) + '/' + PREFIX + '/' + encodeURIComponent(name);
  const res = await fetch(url);
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

// Line-level differences between two lyric texts, ignoring where lines were
// simply rewrapped -- rewrapping is this app's own doing, not a correction.
function lyricEdits(before, after) {
  const strip = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const a = new Set(strip(before));
  const b = new Set(strip(after));
  const removed = [...a].filter((l) => !b.has(l));
  const added = [...b].filter((l) => !a.has(l));
  return { removed, added };
}

function main_summary(records) {
  console.log('');
  console.log('FIELDS, and how often what was saved differed from what was scanned');
  console.log('');
  console.log('  ' + 'field'.padEnd(16) + 'edited'.padStart(9) + '   examples');
  for (const [scanField, savedField] of PAIRS) {
    let edited = 0, seen = 0;
    const examples = [];
    for (const r of records) {
      const from = norm(r.scan && r.scan[scanField]);
      const to = norm(r.saved && r.saved[savedField]);
      if (!from && !to) continue;
      seen++;
      if (from === to) continue;
      edited++;
      if (scanField !== 'lyrics' && examples.length < 3) {
        examples.push((from || '(blank)') + ' -> ' + (to || '(blank)'));
      }
    }
    if (!seen) continue;
    const rate = edited + '/' + seen;
    console.log('  ' + scanField.padEnd(16) + rate.padStart(9) + '   ' + examples.join('  |  '));
  }

  // Lyrics deserve their own pass: a whole-text comparison says "edited" for a
  // single comma, which tells you nothing about what to fix.
  const removed = new Map();
  const added = new Map();
  let lyricEdited = 0, lyricSeen = 0;
  for (const r of records) {
    const from = norm(r.scan && r.scan.lyrics);
    const to = norm(r.saved && r.saved.lyrics);
    if (!from && !to) continue;
    lyricSeen++;
    if (from === to) continue;
    lyricEdited++;
    const d = lyricEdits(from, to);
    for (const l of d.removed) removed.set(l, (removed.get(l) || 0) + 1);
    for (const l of d.added) added.set(l, (added.get(l) || 0) + 1);
  }

  console.log('');
  console.log('LYRICS: ' + lyricEdited + ' of ' + lyricSeen + ' were edited after scanning');
  const top = (m, label) => {
    const rows = [...m.entries()].filter(([, n]) => n > 1).sort((x, y) => y[1] - x[1]).slice(0, 8);
    if (!rows.length) { console.log('  no ' + label + ' line repeated across songs yet'); return; }
    console.log('  ' + label + ' more than once:');
    for (const [line, n] of rows) console.log('    ' + String(n).padStart(3) + 'x  ' + JSON.stringify(line.slice(0, 70)));
  };
  top(removed, 'lines taken out');
  top(added, 'lines put in');
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
  const limit = Number(flag('limit')) || 500;
  const field = flag('field');

  const files = await listRecords(limit);
  if (!files.length) {
    console.log('');
    console.log('No corrections recorded yet.');
    console.log('');
    console.log('The app writes one each time a song added by scanning is saved, so');
    console.log('this fills up as the feature is used. Scan a few sheets, correct them');
    console.log('the way you want them, save, and run this again.');
    return;
  }

  const records = [];
  for (const f of files) {
    const r = await fetchRecord(f.name);
    if (r && r.scan && r.saved) records.push(r);
  }
  console.log('read ' + records.length + ' correction(s) of ' + files.length + ' file(s)');

  if (field) {
    const pair = PAIRS.find((p) => p[0] === field);
    if (!pair) { console.error('unknown field: ' + field); process.exit(2); }
    for (const r of records) {
      const from = norm(r.scan[pair[0]]), to = norm(r.saved[pair[1]]);
      if (from === to) continue;
      console.log('');
      console.log('--- ' + (r.saved.title || r.songId || 'song'));
      if (field === 'lyrics') {
        const d = lyricEdits(from, to);
        for (const l of d.removed) console.log('  - ' + l);
        for (const l of d.added) console.log('  + ' + l);
      } else {
        console.log('  scanned: ' + (from || '(blank)'));
        console.log('  saved  : ' + (to || '(blank)'));
      }
    }
    return;
  }

  main_summary(records);

  console.log('');
  console.log('A field edited nearly every time is a rule waiting to be written. One');
  console.log('edited once is somebody fixing one song. Tell the difference before');
  console.log('changing the prompt, and add a fixture in tools/scan-truth/ so whatever');
  console.log('you change stays changed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
