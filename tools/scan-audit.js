'use strict';
// Audit the scanner against what is actually printed on the page.
//
// WHY THIS EXISTS
// scan-eval.js compares scans with each other. That measures consistency, and
// consistency is not correctness -- the scanner could be reliably wrong. This
// checks scans against ground truth: a small file per sheet saying what a
// person reading the photograph can see on it.
//
// It is also how the scanner gets taught. The model cannot be trained here, so
// accuracy improves in exactly one way: someone notices a sheet read wrongly,
// the prompt gains a rule or a worked example, and something proves the rule
// helped and keeps proving it later. That last part is this. A correction with
// no fixture behind it is a correction that will quietly come undone.
//
// ADDING A SHEET
// Scan it in the app -- that uploads the photo to song-scans, which is where
// this reads from -- then drop a file in tools/scan-truth/ describing it:
//
//   {
//     "match": "1787310611691",        part of the stored filename
//     "describes": "what this page is, for a human reading the failure",
//     "expect": {
//       "title": "Alas! and Did My Savior Bleed",
//       "key": "G# / A♭",              omit if you do not mind
//       "sections": 5,                  verses plus chorus, refrain, bridge
//       "chords": "written",            written | suggested | none
//       "diatonicTo": "Ab",             every chord must belong to this key
//       "mustContain": ["savior bleed"],    lowercase fragments, one per verse
//       "mustNotContain": ["lead-eth"]      faults seen before on this sheet
//     }
//   }
//
// Every field of "expect" is optional. Assert only what you are sure of: a
// fixture that overstates the truth fails for the wrong reason and gets ignored,
// which is worse than not having it.
//
// USAGE
//   node tools/scan-audit.js                 every fixture
//   node tools/scan-audit.js --only alas     fixtures whose file name matches
//   node tools/scan-audit.js --repeat 3      scan each sheet N times, all must pass
//   node tools/scan-audit.js --gap 9000      ms between scans (default 9000)
//
// Scanning back to back trips the provider's rate limit, so the gap is generous
// by default. One Gemini call per sheet per repeat; nothing is written anywhere.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TRUTH_DIR = path.join(__dirname, 'scan-truth');
const BUCKET = 'Liturgy Files';
const PREFIX = 'song-scans';
const ENDPOINT = 'https://lhc-prep-tool.vercel.app';

const HTML = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const SB = (HTML.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
const KEY = (HTML.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9._-]+/) || [])[0];
const FIXED_KEYS = eval((HTML.match(/var FIXED_KEYS = (\[[^\]]*\])/) || [])[1] || '[]');

// The route's own chord-line test, so this agrees with what the app believes.
const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
const SRC = fs.readFileSync(path.join(ROOT, 'app/api/parse-song-sheet/route.ts'), 'utf8');
const grab = (a, b) => { const i = SRC.indexOf(a); const j = SRC.indexOf(b, i); return SRC.slice(i, j + b.length); };
const compiled = ts.transpileModule(
  [grab('const CHORD_ACCIDENTAL', "CHORD_ONE + ')*$');"), grab('const NEARLY_A_CHORD', '\r\n}')].join('\n\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }
).outputText;
const box = { exports: {} };
new Function('module', 'exports', compiled + '\nmodule.exports={isChordLine};')(box, box.exports);
const { isChordLine } = box.exports;

const PITCH = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const rootOf = (tok) => {
  const m = String(tok).replace(/♭/g, 'b').replace(/♯/g, '#').match(/^([A-G])(#|b)?/);
  return m ? PITCH[m[1] + (m[2] || '')] : null;
};
const normKey = (s) => String(s).replace(/♯/g, '#').replace(/♭/g, 'b')
  .replace(/\s*(major|maj)\s*$/i, '').replace(/\s+/g, '').toLowerCase();
const sameKey = (a, b) => {
  const A = [normKey(a), ...String(a).split('/').map(normKey)];
  const B = [normKey(b), ...String(b).split('/').map(normKey)];
  return A.some((x) => x && B.includes(x));
};

const chordsOf = (t) => String(t || '').split('\n').filter(isChordLine).join(' ').match(/\S+/g) || [];
const wordsOf = (t) => String(t || '').split('\n')
  .filter((l) => l.trim() && !isChordLine(l) && !/^\[.*\]$/.test(l.trim()))
  .join(' ').toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function listSheets() {
  const res = await fetch(SB + '/storage/v1/object/list/' + encodeURIComponent(BUCKET), {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: PREFIX, limit: 500 }),
  });
  return (await res.json()).filter((r) => r.metadata && /^image\//.test(r.metadata.mimetype || ''));
}

async function scan(url, vocab) {
  const res = await fetch(ENDPOINT + '/api/parse-song-sheet', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, vocab }),
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { error: 'not JSON (HTTP ' + res.status + ')' }; }
}

// Every assertion the fixture makes, checked against one scan.
function judge(expect, d) {
  const problems = [];
  const lyrics = d.lyrics || '';

  if (expect.title && !new RegExp(expect.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(d.title || '')) {
    problems.push('title was ' + JSON.stringify(d.title));
  }
  if (expect.key && !(d.key && sameKey(d.key, expect.key))) {
    problems.push('key was ' + JSON.stringify(d.key) + ', wanted ' + expect.key);
  }
  if (expect.sections !== undefined) {
    const n = (lyrics.match(/^\[.+\]$/gm) || []).length;
    if (n !== expect.sections) problems.push('found ' + n + ' sections, wanted ' + expect.sections);
  }
  if (expect.chords) {
    const got = d.chordsFound ? 'written' : d.chordsSuggested ? 'suggested' : 'none';
    if (got !== expect.chords) problems.push('chords were ' + got + ', wanted ' + expect.chords);
  }
  if (expect.diatonicTo) {
    const tonic = PITCH[expect.diatonicTo.replace(/♭/g, 'b').replace(/♯/g, '#')];
    if (tonic === undefined) problems.push('fixture: unknown key ' + expect.diatonicTo);
    else {
      const scale = MAJOR.map((s) => (tonic + s) % 12);
      const strays = [...new Set(chordsOf(lyrics).filter((c) =>
        c.split('/').some((h) => { const r = rootOf(h); return r !== null && !scale.includes(r); })))];
      if (strays.length) problems.push('chords outside ' + expect.diatonicTo + ': ' + strays.join(' '));
    }
  }
  const words = wordsOf(lyrics);
  for (const frag of expect.mustContain || []) {
    if (!words.includes(String(frag).toLowerCase())) problems.push('missing text: "' + frag + '"');
  }
  for (const frag of expect.mustNotContain || []) {
    if (lyrics.toLowerCase().includes(String(frag).toLowerCase())) problems.push('should not appear: "' + frag + '"');
  }
  return problems;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
  const only = flag('only');
  const repeat = Math.max(1, Number(flag('repeat')) || 1);
  const gap = Math.max(0, Number(flag('gap')) || 9000);

  if (!fs.existsSync(TRUTH_DIR)) { console.error('no fixtures at ' + TRUTH_DIR); process.exit(1); }
  let fixtures = fs.readdirSync(TRUTH_DIR).filter((f) => f.endsWith('.json'));
  if (only) fixtures = fixtures.filter((f) => f.toLowerCase().includes(only.toLowerCase()));
  if (!fixtures.length) { console.error('no fixtures matched'); process.exit(1); }

  const sheets = await listSheets();
  const vocab = {
    keys: FIXED_KEYS,
    tempos: ['Ballad', 'Celebratory', 'Fast', 'Meditative', 'Moderate', 'Slow', 'Upbeat'],
    styles: ['Traditional Hymn', 'Contemporary', 'Contemporary Hymn'],
    seasons: ['All Seasons', 'Advent', 'Christmas', 'Lent', 'Easter', 'Pentecost'],
    themes: ['Faith', 'Grace', 'Cross', 'Salvation', 'Praise', 'Hope', 'Peace', 'Comfort'],
  };

  console.log('checking ' + fixtures.length + ' sheet(s) against what is printed on them'
    + (repeat > 1 ? ', ' + repeat + ' scans each' : ''));
  console.log('');

  let failed = 0, total = 0;
  for (const file of fixtures) {
    const fx = JSON.parse(fs.readFileSync(path.join(TRUTH_DIR, file), 'utf8'));
    const hit = sheets.find((s) => s.name.includes(fx.match));
    if (!hit) { console.log('  SKIP  ' + file + ' -- no stored scan matching "' + fx.match + '"'); continue; }
    const url = SB + '/storage/v1/object/public/' + encodeURIComponent(BUCKET) + '/' + PREFIX + '/' + encodeURIComponent(hit.name);

    for (let k = 0; k < repeat; k++) {
      total++;
      const d = await scan(url, vocab);
      const label = file.replace(/\.json$/, '') + (repeat > 1 ? ' #' + (k + 1) : '');
      if (d.error) { failed++; console.log('  FAIL  ' + label + ' -- ' + d.error); }
      else {
        const problems = judge(fx.expect || {}, d);
        if (problems.length) {
          failed++;
          console.log('  FAIL  ' + label);
          for (const p of problems) console.log('          ' + p);
        } else {
          console.log('  OK    ' + label + '  (' + (d.chordLines || 0) + ' chord lines)');
        }
      }
      if (!(k === repeat - 1 && file === fixtures[fixtures.length - 1])) await new Promise((r) => setTimeout(r, gap));
    }
  }

  console.log('');
  console.log('================================');
  console.log(failed ? failed + ' of ' + total + ' scan(s) failed their fixture' : 'all ' + total + ' scan(s) match the page');
  if (failed) {
    console.log('');
    console.log('A failure is a lead, not a verdict: the model varies between runs, so');
    console.log('re-run with --repeat before changing anything on the strength of one.');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
