'use strict';
// Verifies that lectionary_sources exists and is reachable through the anon
// key -- the key the app actually uses.
//
// WHY
// A table created in the SQL Editor gets RLS with no policy, and Supabase
// then denies everything by default. Through the anon key that looks exactly
// like an empty table rather than an error, so the app would save readings
// happily and simply never show which file they came from, with nothing in
// the console to say why. This is the check the migration tells you to run.
//
// It writes ONE row with an id of its own making and deletes it again. It
// touches no other row, and never a row it did not create.
//
// USAGE
//   node tools/verify-lectionary-sources.js
//
// Exit code 0 = the table is there and usable, 1 = it is not.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const U = src.match(/LHC_SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const K = src.match(/LHC_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1];
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' };

const ID = 'verify_' + Date.now();
let failed = false;

function say(ok, label, detail) {
  if (!ok) failed = true;
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label + (detail ? '  — ' + detail : ''));
}

// Every response body is read, even the ones nothing needs.
//
// A fetch whose body is never consumed leaves its socket open, and Node then
// aborts at exit with a libuv assertion out of undici -- which on Windows
// replaced this script's exit code with 127. A verification tool whose exit
// code is noise is worse than no tool, and the symptom looks like a crash in
// the thing being verified rather than in the checking of it.
async function req(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON; text is enough */ }
  return { ok: res.ok, status: res.status, text: text, json: json };
}

(async () => {
  console.log('Checking lectionary_sources through the anon key\n');

  // 1. Is it there at all?
  const read = await req(U + '/rest/v1/lectionary_sources?select=id&limit=1', { headers: H });
  if (read.status === 404 || read.status === 400) {
    say(false, 'the table exists', 'HTTP ' + read.status + ' ' + read.text.slice(0, 160));
    console.log('\nRun migrations/2026-10-26_add_lectionary_sources.sql in the Supabase SQL Editor.');
    process.exitCode = 1;
    return;
  }
  say(read.ok, 'the table is readable', read.ok ? '' : 'HTTP ' + read.status);

  // 2. Writable? This is the half that RLS-without-a-policy breaks silently.
  const ins = await req(U + '/rest/v1/lectionary_sources', {
    method: 'POST',
    headers: Object.assign({}, H, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      id: ID,
      file_name: 'verify.pdf',
      file_url: 'https://example.invalid/verify.pdf',
      service_dates: ['2026-01-01'],
      note: 'written by tools/verify-lectionary-sources.js; delete if you find it'
    })
  });
  say(ins.ok, 'a row can be written', ins.ok ? '' : 'HTTP ' + ins.status + ' ' + ins.text.slice(0, 160));

  if (ins.ok) {
    // 3. Readable BACK. A policy can allow the insert and hide the result,
    //    which is the shape that makes the app look merely forgetful.
    const back = await req(U + '/rest/v1/lectionary_sources?select=*&id=eq.' + ID, { headers: H });
    const got = Array.isArray(back.json) && back.json.length === 1 ? back.json[0] : null;
    say(!!got, 'and read back again', got ? '' : 'the insert succeeded but the row is not visible');
    if (got) {
      say(got.file_name === 'verify.pdf', 'with its columns intact');
      say(Array.isArray(got.service_dates) && got.service_dates[0] === '2026-01-01',
        'and service_dates round-trips as a list', 'got ' + JSON.stringify(got.service_dates));
      say(!!got.uploaded_at, 'uploaded_at defaults on insert', String(got.uploaded_at || ''));
    }

    // 4. Clean up. Only the id this script made.
    const del = await req(U + '/rest/v1/lectionary_sources?id=eq.' + ID, { method: 'DELETE', headers: H });
    say(del.ok, 'and the test row deletes', del.ok ? '' : 'HTTP ' + del.status);
    const left = await req(U + '/rest/v1/lectionary_sources?select=id&id=eq.' + ID, { headers: H });
    const stillThere = Array.isArray(left.json) && left.json.length > 0;
    say(!stillThere, 'leaving nothing behind',
      stillThere ? 'row ' + ID + ' is still there — delete it by hand' : '');
  }

  console.log(failed
    ? '\nSomething is wrong. Re-run migrations/2026-10-26_add_lectionary_sources.sql.'
    : '\nlectionary_sources is there and usable.');
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error('FAILED ' + e.message); process.exitCode = 1; });
