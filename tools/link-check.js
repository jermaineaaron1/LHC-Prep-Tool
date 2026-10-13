'use strict';
// Do the links in the song library still open?
//
// WHY THIS EXISTS
// A song's documents and videos are the part of the library that lives
// somewhere else. The database can be perfect and the sheet still be gone:
// a Drive file unshared when somebody tidied their folder, a video taken
// down, a chord site that stopped resolving. Nothing in the app notices, and
// the person who finds out is a musician on a Sunday with a dead link.
//
// First run found one: "Hark the Herald Angel Sing" had two documents, one
// of which answered 401. A Christmas hymn, found in October.
//
// DELIBERATELY NOT PART OF `npm run audit`
// The audit talks only to our own database, finishes in seconds, and is meant
// to be run often and without thinking. This makes a request per link to
// Google, YouTube and whatever chord sites the library points at. Folding it
// in would make every audit slow and chatty with other people's servers, and
// a tool people stop running is worth nothing. Run this when it matters:
// before Advent, before a big service, after a tidy-up of the Drive folder.
//
// WHAT 401 MEANS HERE, AND WHAT IT DOES NOT
// The check is anonymous. A Google Drive file shared with named accounts
// answers 401 to a stranger and opens perfectly for the person it was shared
// with -- so 401 means "not public", not necessarily "broken for you". It is
// still worth knowing: a guest musician, or a volunteer who joined last
// month, is exactly the stranger who gets stopped.
//
// A restricted file answers 200 with a sign-in PAGE rather than an error, so
// the status alone proves nothing. The URL the request lands on is what
// tells you, which is why redirects are followed and the final host read.
//
// USAGE
//   npm run links              # everything
//   npm run links -- docs      # just the documents
//   npm run links -- videos    # just the videos
//
// Exit code 0 = everything opened, 1 = something did not.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const U = src.match(/LHC_SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const K = src.match(/LHC_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1];
const H = { apikey: K, Authorization: 'Bearer ' + K };

// Named so a server operator reading their logs can tell what this is and
// that it is not a scraper.
const UA = { 'User-Agent': 'LHC-Worship-Prep link check (church song library)' };

// Enough to be unmistakably polite. The whole run is under two minutes and
// happens a few times a year.
const PAUSE_MS = 250;
const TIMEOUT_MS = 20000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const want = process.argv.slice(2).filter(a => !a.startsWith('-'));
const doDocs = !want.length || want.includes('docs');
const doVids = !want.length || want.includes('videos');

async function checkDoc(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: UA,
                                 signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (/accounts\.google\.com/.test(r.url)) return { state: 'shut', why: 'asks for a Google sign-in' };
    if (r.status === 401 || r.status === 403) return { state: 'shut', why: 'not shared publicly (' + r.status + ')' };
    if (r.status === 404 || r.status === 410) return { state: 'shut', why: 'gone (' + r.status + ')' };
    if (r.status >= 400) return { state: 'shut', why: 'HTTP ' + r.status };
    return { state: 'open', why: 'HTTP ' + r.status };
  } catch (e) {
    // A timeout or a DNS wobble is not evidence the link is dead, so it is
    // reported separately and does not fail the run. Something that is
    // genuinely gone will say so with a status.
    return { state: 'unknown', why: e.name === 'TimeoutError' ? 'timed out' : 'could not reach it' };
  }
}

// oEmbed is the documented, lightweight way to ask whether a video can still
// be played: 200 for a live one, 401 for private or embedding-disabled, 404
// for removed. Far lighter than fetching the watch page and guessing.
async function checkVideo(url) {
  const api = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url);
  try {
    const r = await fetch(api, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status === 200) return { state: 'open', why: 'playable' };
    if (r.status === 401) return { state: 'shut', why: 'private, or embedding turned off' };
    // oEmbed answers 400 for an id it cannot resolve at all and 404 for one
    // that resolved and is gone. Checked against a real library URL and a
    // made-up id: the made-up one is a 400, so saying "removed" there would
    // be wrong in the common case of a mistyped or truncated link.
    if (r.status === 400) return { state: 'shut', why: 'no such video — the link may be wrong' };
    if (r.status === 404) return { state: 'shut', why: 'removed' };
    return { state: 'shut', why: 'HTTP ' + r.status };
  } catch (e) {
    return { state: 'unknown', why: e.name === 'TimeoutError' ? 'timed out' : 'could not reach it' };
  }
}

function section(label) {
  console.log('\n== ' + label + ' ' + '='.repeat(Math.max(0, 62 - label.length)));
}

(async () => {
  const res = await fetch(
    `${U}/rest/v1/songs?select=id,title,attachments,youtube&limit=1000`, { headers: H });
  if (!res.ok) {
    console.error('Could not read the songs: HTTP ' + res.status);
    process.exit(1);
  }
  const songs = await res.json();

  const docs = [], vids = [];
  songs.forEach(s => {
    (s.attachments || []).forEach(a => {
      const u = a && (a.url || a);
      if (typeof u === 'string' && /^https?:\/\//i.test(u)) {
        docs.push({ song: s.title, name: a.name || '', url: u });
      }
    });
    const y = Array.isArray(s.youtube) ? s.youtube : (s.youtube ? [s.youtube] : []);
    y.forEach(u => {
      if (typeof u === 'string' && /^https?:\/\//i.test(u.trim())) {
        vids.push({ song: s.title, url: u.trim() });
      }
    });
  });

  let shut = 0, unknown = 0;

  async function run(label, rows, check, show) {
    section(label + ' (' + rows.length + ')');
    const bad = [];
    for (const row of rows) {
      const r = await check(row.url);
      if (r.state === 'shut') { shut++; bad.push({ row, r }); }
      else if (r.state === 'unknown') { unknown++; bad.push({ row, r }); }
      await sleep(PAUSE_MS);
    }
    if (!bad.length) {
      console.log('  ok   all ' + rows.length + ' opened');
      return;
    }
    console.log('  ' + (rows.length - bad.length) + ' opened, ' + bad.length + ' did not:');
    bad.forEach(({ row, r }) => {
      console.log('       ' + row.song);
      console.log('         ' + r.why + (show(row) ? ' — ' + show(row) : ''));
      console.log('         ' + row.url.slice(0, 96));
    });
  }

  if (doDocs) await run('documents', docs, checkDoc, r => r.name);
  if (doVids) await run('videos', vids, checkVideo, () => '');

  console.log('\n' + '='.repeat(66));
  if (!shut && !unknown) {
    console.log('link check: everything opened');
  } else {
    if (shut) console.log('link check: ' + shut + ' link(s) did not open');
    // Said plainly, because "could not reach it" from one machine on one
    // evening is not the same claim as "this is gone".
    if (unknown) console.log('           ' + unknown + ' could not be reached just now — try again before acting on those');
  }
  // A link that merely could not be reached does not fail the run.
  process.exit(shut ? 1 : 0);
})();
