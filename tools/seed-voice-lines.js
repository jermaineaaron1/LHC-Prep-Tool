'use strict';
// Put a two-part arrangement into the library.
//
// WHY THIS IS A SCRIPT AND NOT A FORM
// There is no two-part editor yet. The words of this carol were read off a
// PDF a page at a time and checked bar by bar; typing 46 rows into a form
// that does not exist, twice, is not a better use of anybody's evening. When
// there is an editor, this script stops being needed and should be deleted.
//
// IT WRITES TO PRODUCTION. The anon key is hardcoded in Index.html and there
// is no separate development database, so every write here is a real row in
// the real library. That is why it does nothing without --write.
//
// A song with choir parts is an ORDINARY song, so it needs ordinary lyrics.
// Those are suggested by the app's OWN toPlainLyrics, sliced out of
// Index.html, and written ONCE, when the song is created. Never again: after
// that the lyrics column belongs to whoever edits it in the normal editor,
// and saving the choir parts does not touch it.
//
// USAGE
//   node tools/seed-voice-lines.js                 # dry run, shows everything
//   node tools/seed-voice-lines.js --write         # actually writes
//   node tools/seed-voice-lines.js --file x.json   # a different arrangement
//
// Exit code 0 = fine, 1 = something is wrong (and nothing was written).

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const fileArg = args.indexOf('--file');
const DOC_PATH = fileArg > -1 ? args[fileArg + 1]
  : path.join(__dirname, 'voice-lines', 'do-you-hear-what-i-hear.json');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const U = src.match(/LHC_SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const K = src.match(/LHC_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1];
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' };

// The app's own suggestion for the song's words, so what the seed writes
// is what the app would have offered.
const lines = src.split(/\r?\n/);
const s0 = lines.findIndex(l => /^window\.lhcVoiceLines = \{/.test(l));
const s1 = lines.findIndex((l, i) => i > s0 && l === '};');
if (s0 < 0 || s1 < 0) { console.error('window.lhcVoiceLines not found in Index.html'); process.exit(1); }
const V = new Function('var window = {};\n' + lines.slice(s0, s1 + 1).join('\n') +
                       '\nreturn window.lhcVoiceLines;')();

const DOC = JSON.parse(fs.readFileSync(DOC_PATH, 'utf8'));

async function rest(method, pathAndQuery, body, extraHeaders) {
  const r = await fetch(U + '/rest/v1/' + pathAndQuery, {
    method,
    headers: Object.assign({}, H, extraHeaders || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = text; }
  if (!r.ok) throw new Error(method + ' ' + pathAndQuery + ' -> ' + r.status + ' ' + text);
  return json;
}

(async function main() {
  console.log('\n' + DOC.title + (DOC.subtitle ? '  (' + DOC.subtitle + ')' : ''));
  console.log('source: ' + DOC.source);
  console.log(DOC.lines.length + ' rows, ' + V.group(DOC.lines).length + ' display groups\n');
  (DOC.notes || []).forEach(n => console.log('  note: ' + n));

  // ---- 1. Has the migration landed? -------------------------------------
  // A table that is missing and a table that is there but unreadable through
  // the anon key look different here on purpose: the second is the RLS trap,
  // and it would otherwise look like a successful write into nothing.
  console.log('\nchecking the migration:');
  try {
    await rest('GET', 'song_voice_lines?select=id&limit=1');
    console.log('  ok    song_voice_lines is readable');
  } catch (e) {
    console.error('  FAIL  song_voice_lines: ' + e.message);
    console.error('\nRun migrations/2026-10-27_add_song_voice_lines.sql in the Supabase SQL editor first.');
    process.exitCode = 1; return;
  }
  try {
    await rest('GET', 'songs?select=voice_layout&limit=1');
    console.log('  ok    songs.voice_layout exists');
  } catch (e) {
    console.error('  FAIL  songs.voice_layout: ' + e.message);
    process.exitCode = 1; return;
  }

  // ---- 2. Is it already there? ------------------------------------------
  const existing = await rest('GET',
    'songs?select=id,title,voice_layout&title=eq.' + encodeURIComponent(DOC.title));
  if (existing.length > 1) {
    console.error('\n' + existing.length + ' songs already named "' + DOC.title + '". ' +
      'Sort that out by hand before seeding -- this script will not guess which one.');
    process.exitCode = 1; return;
  }

  const songId = existing.length ? existing[0].id : 'song_' + Date.now();
  const lyrics = V.toPlainLyrics(DOC.lines);

  if (existing.length) {
    console.log('\nsong exists: ' + songId + ' -- its lines will be REPLACED');
  } else {
    console.log('\nnew song: ' + songId);
  }

  console.log('\nthe lyrics this song starts with (editable afterwards):');
  console.log('  ' + lyrics.split('\n').join('\n  '));

  if (!WRITE) {
    console.log('\n--- dry run. Nothing was written. Pass --write to do it. ---');
    return;
  }

  // ---- 3. Write ----------------------------------------------------------
  // Order matters. The lines go in before the flag, so a failure halfway
  // leaves a song that still renders from its lyrics column rather than one
  // flagged two-part with no lines behind it.
  if (!existing.length) {
    await rest('POST', 'songs', [{
      id: songId,
      title: DOC.title,
      artist: DOC.artist || '',
      key: DOC.key || '',
      season: DOC.season || '',
      time_signature: DOC.timeSignature || '',
      bpm: DOC.bpm == null ? null : DOC.bpm,
      lyrics: lyrics,
      youtube: [],
      attachments: [],
      service_suitability: [],
      display_style: {},
      date_added: new Date().toISOString(),
      last_edited: new Date().toISOString(),
    }], { Prefer: 'return=minimal' });
    console.log('\n  wrote songs row ' + songId);
  }

  await rest('DELETE', 'song_voice_lines?song_id=eq.' + encodeURIComponent(songId),
             undefined, { Prefer: 'return=minimal' });

  const rows = DOC.lines.map((ln, i) => ({
    song_id: songId,
    part: ln.part,
    text: ln.text || '',
    bar_start: ln.barStart == null ? null : ln.barStart,
    bar_end: ln.barEnd == null ? null : ln.barEnd,
    section: ln.section || '',
    sort_order: ln.sortOrder == null ? i : ln.sortOrder,
    sustained: !!ln.sustained,
  }));
  await rest('POST', 'song_voice_lines', rows, { Prefer: 'return=minimal' });
  console.log('  wrote ' + rows.length + ' voice lines');

  await rest('PATCH', 'songs?id=eq.' + encodeURIComponent(songId),
    { voice_layout: 'two-part', last_edited: new Date().toISOString() },
    { Prefer: 'return=minimal' });
  console.log('  set voice_layout = two-part');

  // ---- 4. Read it back ---------------------------------------------------
  // Asserting on the rows that came back, not on the absence of an error. A
  // write that lands in a table the anon key cannot read returns 201 and
  // leaves nothing behind.
  console.log('\nreading it back:');
  const back = await rest('GET',
    'song_voice_lines?select=*&song_id=eq.' + encodeURIComponent(songId) + '&order=sort_order');
  const song = await rest('GET',
    'songs?select=id,title,voice_layout,lyrics&id=eq.' + encodeURIComponent(songId));

  let ok = true;
  const say = (good, msg) => { ok = good && ok; console.log('  ' + (good ? 'ok  ' : 'FAIL') + '  ' + msg); };

  say(back.length === rows.length, back.length + ' of ' + rows.length + ' lines are there');
  say(song.length === 1 && song[0].voice_layout === 'two-part', 'voice_layout reads back as two-part');
  say(song.length === 1 && (song[0].lyrics || '').trim().length > 0,
      'the song has lyrics of its own');
  const groups = V.group(back.map(r => ({
    part: r.part, text: r.text, barStart: r.bar_start, barEnd: r.bar_end,
    section: r.section, sortOrder: r.sort_order, sustained: r.sustained,
  })));
  say(groups.length === V.group(DOC.lines).length,
      groups.length + ' display groups, as expected');

  console.log('\n' + (ok ? 'Done. ' + DOC.title + ' is in the library as ' + songId
                         : 'Something did not read back. Check the rows above.'));
  if (!ok) process.exitCode = 1;
  // process.exitCode, never process.exit: exiting while a fetch handle is
  // still open trips a libuv assertion on Windows and prints a crash dump
  // over the top of the report you were meant to read.
})().catch(err => { console.error('\n' + err.message); process.exitCode = 1; });
