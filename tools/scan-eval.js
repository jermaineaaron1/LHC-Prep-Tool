'use strict';
// Evaluation harness for the song-sheet scanner (app/api/parse-song-sheet).
//
// WHY THIS EXISTS
// The scanner's quality lives in a prompt and a chain of text transformations,
// and both are changed by editing prose. Prose has no type checker. The only
// honest way to know whether a change helped is to run the same sheets through
// before and after and compare the numbers.
//
// The sheets are already there. Every photo the app scans is uploaded to
// Supabase storage *before* the parse call, so `Liturgy Files/song-scans` is a
// growing corpus of exactly the pages this church actually photographs --
// hymnal scores, chord charts, screenshots, whatever came to hand. Nothing
// needs collecting; it accumulates by using the feature.
//
// HOW IT WORKS
//   1. Lists every image under song-scans.
//   2. Derives the vocabularies from the live songs table, the way the app
//      does, so the model is judged under the same constraints it really runs
//      under.
//   3. POSTs each image to the parse endpoint, one at a time, and records what
//      came back with how long it took.
//   4. Writes the run to .scan-eval/ and prints a table.
//
// USAGE
//   node tools/scan-eval.js                     run every sheet against production
//   node tools/scan-eval.js --target local      against http://localhost:3000
//   node tools/scan-eval.js --only screenshot   only sheets whose name matches
//   node tools/scan-eval.js --limit 3           first N sheets
//   node tools/scan-eval.js --compare A.json B.json     diff two saved runs
//
// WHAT IT COSTS
// One Gemini call per sheet, sometimes two when a score escalates. It reads
// from storage and writes nothing to the database -- the parse route never
// does -- so it is safe to run against production, which is the only place the
// API key exists.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.scan-eval');
const BUCKET = 'Liturgy Files';
const PREFIX = 'song-scans';
const PROD = 'https://lhc-prep-tool.vercel.app';
const LOCAL = 'http://localhost:3000';

// ── the app's own credentials ───────────────────────────────────────────────
// Read out of Index.html rather than duplicated here. They are the public anon
// values the browser already ships, so this adds no secret to the repo, and
// scraping them means the harness cannot drift from the app it is testing.
function appConfig() {
  const html = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
  const url = (html.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (html.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9._-]+/) || [])[0];
  const keys = (html.match(/var FIXED_KEYS = (\[[^\]]*\])/) || [])[1];
  if (!url || !key) throw new Error('Could not find the Supabase url/key in Index.html');
  return { url, key, fixedKeys: keys ? eval(keys) : ['C', 'D', 'E', 'F', 'G', 'A', 'B'] };
}

async function sb(cfg, urlPath, init) {
  const res = await fetch(cfg.url + urlPath, {
    ...init,
    headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json', ...(init && init.headers) },
  });
  if (!res.ok) throw new Error(urlPath + ' -> ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

async function listSheets(cfg) {
  const rows = await sb(cfg, '/storage/v1/object/list/' + encodeURIComponent(BUCKET), {
    method: 'POST',
    body: JSON.stringify({ prefix: PREFIX, limit: 500, sortBy: { column: 'created_at', order: 'asc' } }),
  });
  // The same sheet is often scanned several times while someone is getting the
  // photo right. Keep one of each: re-testing a duplicate costs an API call and
  // tells you nothing new.
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r.metadata || !/^image\//.test(r.metadata.mimetype || '')) continue;
    const stem = r.name.replace(/^\d+_/, '');
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push({
      name: r.name,
      label: stem.replace(/\.[a-z]+$/i, '').slice(0, 34),
      kb: Math.round((r.metadata.size || 0) / 1024),
      url: cfg.url + '/storage/v1/object/public/' + encodeURIComponent(BUCKET) + '/' + PREFIX + '/' + encodeURIComponent(r.name),
    });
  }
  return out;
}

// The vocabularies, built the way the song list builds them, so a value the
// library does not use is rejected here exactly as it would be in the app.
async function buildVocab(cfg) {
  const songs = await sb(cfg, '/rest/v1/songs?select=theme,tempo,style,season', {});
  const uniq = (field, split) => {
    const set = new Set();
    for (const s of songs) {
      const raw = s[field];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      for (const part of (split ? raw.split(',') : [raw])) {
        const v = part.trim();
        if (v) set.add(v);
      }
    }
    return [...set].sort();
  };
  return {
    keys: cfg.fixedKeys,
    tempos: uniq('tempo'),
    styles: uniq('style'),
    seasons: uniq('season'),
    themes: uniq('theme', true),
  };
}

// No chord-line detector lives here on purpose. An earlier draft carried a copy
// of the route's regex, which would have quietly drifted the moment the real one
// changed -- and a measuring instrument that disagrees with the thing it
// measures is worse than none. The route already reports chordLines; the lyric
// count is whatever is left over.

async function scanOne(endpoint, sheet, vocab) {
  const started = Date.now();
  try {
    const res = await fetch(endpoint + '/api/parse-song-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sheet.url, vocab }),
    });
    // Read as text first. A function that runs past its time limit is killed by
    // the platform, which answers with an HTML error page -- and res.json() on
    // that throws a parser error that says nothing about what went wrong.
    const text = await res.text();
    const ms = Date.now() - started;
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      const timedOut = ms > 55000 || /FUNCTION_INVOCATION_TIMEOUT|504/i.test(text);
      return {
        label: sheet.label, kb: sheet.kb, ms,
        error: timedOut
          ? 'timed out (' + Math.round(ms / 1000) + 's) -- the endpoint gives up at 60s'
          : 'HTTP ' + res.status + ', not JSON: ' + text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80),
      };
    }
    if (!res.ok || body.error) {
      return { label: sheet.label, kb: sheet.kb, ms, error: body.error || ('HTTP ' + res.status) };
    }
    const lines = (body.lyrics || '').split(/\r?\n/);
    return {
      label: sheet.label,
      kb: sheet.kb,
      ms,
      title: body.title || null,
      artist: body.artist || null,
      key: body.key || null,
      style: body.style || null,
      season: body.season || null,
      themes: body.themes || [],
      chords: body.chordsFound ? 'read' : body.chordsSuggested ? 'suggested' : 'none',
      notation: body.hasMusicNotation === true,
      chordLines: body.chordLines || 0,
      lyricLines: Math.max(0, lines.filter((l) => l.trim() && !/^\[.*\]$/.test(l.trim())).length - (body.chordLines || 0)),
      sections: (body.lyrics.match(/^\[.+\]$/gm) || []).length,
      outOfKey: body.outOfKey || [],
      escalatedTo: body.escalatedTo || null,
      droppedFields: body.droppedFields || [],
      confidence: body.confidence || null,
      notes: body.notes || null,
      lyrics: body.lyrics || null,
    };
  } catch (e) {
    return { label: sheet.label, kb: sheet.kb, ms: Date.now() - started, error: String((e && e.message) || e) };
  }
}

const pad = (s, n) => String(s === null || s === undefined ? '-' : s).slice(0, n).padEnd(n);
const padL = (s, n) => String(s === null || s === undefined ? '-' : s).slice(0, n).padStart(n);

function printRun(rows) {
  console.log('');
  console.log(pad('sheet', 30) + padL('ms', 7) + '  ' + pad('title', 28) + '  ' + pad('key', 9) + pad('chords', 11) + padL('cl', 4) + padL('ly', 4) + padL('sec', 5) + '  ' + pad('conf', 8) + 'flags');
  console.log('-'.repeat(120));
  for (const r of rows) {
    if (r.error) {
      console.log(pad(r.label, 30) + padL(r.ms, 7) + '  ' + 'ERROR  ' + r.error.slice(0, 70));
      continue;
    }
    const flags = [];
    if (r.notation) flags.push('score');
    if (r.escalatedTo) flags.push('escalated');
    if (r.outOfKey.length) flags.push('outOfKey:' + r.outOfKey.join('/'));
    if (r.droppedFields.length) flags.push('dropped:' + r.droppedFields.join('/'));
    if (r.chords !== 'none' && r.chordLines === 0) flags.push('CLAIMED-BUT-EMPTY');
    console.log(
      pad(r.label, 30) + padL(r.ms, 7) + '  ' + pad(r.title, 28) + '  ' + pad(r.key, 9) +
      pad(r.chords, 11) + padL(r.chordLines, 4) + padL(r.lyricLines, 4) + padL(r.sections, 5) + '  ' +
      pad(r.confidence, 8) + flags.join(' ')
    );
  }

  const ok = rows.filter((r) => !r.error);
  const scores = ok.filter((r) => r.notation);
  const withChords = ok.filter((r) => r.chordLines > 0);
  const scoresWithChords = scores.filter((r) => r.chordLines > 0);
  console.log('-'.repeat(120));
  console.log('sheets            ' + rows.length + '  (' + (rows.length - ok.length) + ' errored)');
  console.log('with chords       ' + withChords.length + '/' + ok.length);
  console.log('scores            ' + scores.length + ', of which ' + scoresWithChords.length + ' got chords');
  console.log('titles read       ' + ok.filter((r) => r.title).length + '/' + ok.length);
  console.log('keys read         ' + ok.filter((r) => r.key).length + '/' + ok.length);
  if (ok.length) {
    const times = ok.map((r) => r.ms).sort((a, b) => a - b);
    console.log('time              median ' + times[Math.floor(times.length / 2)] + 'ms, slowest ' + times[times.length - 1] + 'ms');
  }
  const suspicious = ok.filter((r) => r.chords !== 'none' && r.chordLines === 0);
  if (suspicious.length) {
    console.log('');
    console.log('!! ' + suspicious.length + ' sheet(s) claimed chords but returned none. That is the failure');
    console.log('   where the model describes its work instead of doing it -- check the notes.');
  }
}

function compare(aPath, bPath) {
  const a = JSON.parse(fs.readFileSync(aPath, 'utf8'));
  const b = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  const byLabel = (run) => Object.fromEntries(run.rows.map((r) => [r.label, r]));
  const A = byLabel(a), B = byLabel(b);
  const labels = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();

  console.log('');
  console.log('A  ' + path.basename(aPath) + '   ' + a.startedAt);
  console.log('B  ' + path.basename(bPath) + '   ' + b.startedAt);
  console.log('');
  console.log(pad('sheet', 34) + pad('chords', 22) + pad('chord lines', 16) + pad('title', 20) + 'ms');
  console.log('-'.repeat(110));

  let better = 0, worse = 0;
  for (const label of labels) {
    const x = A[label], y = B[label];
    const f = (r, k) => (r ? (r.error ? 'ERR' : r[k]) : '-');
    const chordsMoved = f(x, 'chords') !== f(y, 'chords');
    const linesMoved = f(x, 'chordLines') !== f(y, 'chordLines');
    const titleMoved = f(x, 'title') !== f(y, 'title');
    const dl = (Number(f(y, 'chordLines')) || 0) - (Number(f(x, 'chordLines')) || 0);
    if (dl > 0) better++; else if (dl < 0) worse++;
    if (!chordsMoved && !linesMoved && !titleMoved) {
      console.log(pad(label, 34) + pad('(unchanged)', 22));
      continue;
    }
    console.log(
      pad(label, 34) +
      pad(chordsMoved ? f(x, 'chords') + ' -> ' + f(y, 'chords') : f(y, 'chords'), 22) +
      pad(linesMoved ? f(x, 'chordLines') + ' -> ' + f(y, 'chordLines') : String(f(y, 'chordLines')), 16) +
      pad(titleMoved ? 'CHANGED' : 'same', 20) +
      (f(x, 'ms') + ' -> ' + f(y, 'ms'))
    );
  }
  console.log('-'.repeat(110));
  console.log('sheets gaining chord lines: ' + better + ', losing: ' + worse);
  // Said plainly because it is easy to read a green number as proof. More
  // chord lines is not automatically better -- a model can pad a page with
  // chords nobody asked for. The count says something moved; the lyrics in
  // the saved run say whether it moved the right way.
  console.log('A higher count means more chords, not necessarily better ones. Read the');
  console.log('lyrics in the saved run before believing it.');
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? (argv[i + 1] || true) : null;
  };

  if (flag('compare')) {
    const i = argv.indexOf('--compare');
    const [a, b] = [argv[i + 1], argv[i + 2]];
    if (!a || !b) { console.error('--compare needs two run files'); process.exit(2); }
    compare(a, b);
    return;
  }

  const endpoint = flag('target') === 'local' ? LOCAL : PROD;
  const cfg = appConfig();
  console.log('endpoint  ' + endpoint);

  const vocab = await buildVocab(cfg);
  console.log('vocab     ' + Object.entries(vocab).map(([k, v]) => k + ':' + v.length).join('  '));
  // Worth knowing when reading the results: the app itself never fills
  // songMeta.styles, so a real scan sends an empty style list and the style
  // field can never come back filled. The harness sends the library's real
  // styles, so this measures the scanner rather than that client-side gap.
  if (vocab.styles.length) console.log('          (the app currently sends no styles; this run does)');

  let sheets = await listSheets(cfg);
  const only = flag('only');
  if (typeof only === 'string') sheets = sheets.filter((s) => s.name.toLowerCase().includes(only.toLowerCase()));
  const limit = Number(flag('limit'));
  if (limit > 0) sheets = sheets.slice(0, limit);
  console.log('sheets    ' + sheets.length);

  const rows = [];
  for (let i = 0; i < sheets.length; i++) {
    process.stdout.write('  [' + (i + 1) + '/' + sheets.length + '] ' + sheets[i].label + ' ... ');
    const r = await scanOne(endpoint, sheets[i], vocab);
    rows.push(r);
    console.log(r.error ? 'ERROR' : (r.ms + 'ms, ' + r.chordLines + ' chord lines'));
    // A gap between calls. The endpoint falls back between models when one is
    // busy, and a burst is the surest way to make every model busy at once.
    if (i < sheets.length - 1) await new Promise((r2) => setTimeout(r2, 1500));
  }

  printRun(rows);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUT_DIR, 'run-' + stamp + '.json');
  fs.writeFileSync(file, JSON.stringify({ startedAt: new Date().toISOString(), endpoint, vocab, rows }, null, 2));
  console.log('');
  console.log('saved  ' + path.relative(ROOT, file));
  console.log('diff   node tools/scan-eval.js --compare <old> <new>');
}

main().catch((e) => { console.error(e); process.exit(1); });
