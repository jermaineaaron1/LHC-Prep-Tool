'use strict';
// Read-only audit of the LIVE data behind the app: duplicate and orphaned
// rows, damaged lyrics, sort_order integrity, unexpected shapes, and
// anything that looks like leftover test material.
//
// This is deliberately NOT part of `npm run check`. That suite is offline
// and deterministic; this one talks to the production database over the
// network and its result depends on what happens to be stored at the time.
// Run it by hand:
//
//   npm run audit                 # report to the terminal
//   npm run audit -- summary.json # also write a row-count summary
//
// It only ever reads. Nothing here writes, updates or deletes, and it uses
// the same anon key the app ships with, so it sees exactly what the app
// sees -- no more.
//
// Exit code 0 = nothing wrong found, 1 = at least one problem area.
const fs = require('fs');
const path = require('path');
// The app is one file, and it carries its own Supabase credentials, so the
// audit reads them straight out of it rather than keeping a second copy
// that could drift.
const src = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const U = src.match(/LHC_SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const K = src.match(/LHC_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1];
const H = { apikey: K, Authorization: 'Bearer ' + K };

async function all(table, select) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(U + '/rest/v1/' + table + '?select=' + select, {
      headers: Object.assign({}, H, { Range: from + '-' + (from + 999) })
    });
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(table + ': ' + JSON.stringify(rows));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

function tailLines(text) {
  if (typeof text !== 'string' || !text) return 0;
  const lines = text.split(/\r?\n/);
  let n = 0;
  for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].trim() === '') n++; else break; }
  return n;
}

// The longest run of consecutive blank lines ANYWHERE in a field, and where
// it starts.
//
// tailLines() only ever looked at the end of a field, which turned out to be
// a real blind spot. One song carried ten blank lines followed by a stray
// '[Chorus]' twice over, so the field ENDED on text and scored zero. It was
// found by dumping the row out by hand, not by auditing it -- which is a
// poor way to find the next one.
function longestBlankRun(text) {
  if (typeof text !== 'string' || !text) return { len: 0, at: 0, of: 0 };
  const lines = text.split(/\r?\n/);
  let best = { len: 0, at: 0, of: lines.length }, n = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && lines[i].trim() === '') { n++; continue; }
    if (n > best.len) best = { len: n, at: i - n + 1, of: lines.length };
    n = 0;
  }
  return best;
}

// Measured across all 83 stored lyric fields on 2026-10-01: 618 runs of a
// single blank line and 101 of two, both plainly ordinary spacing between
// sections; then a cliff -- three runs of three, and one run of ten.
//
// Two thresholds rather than one, because 'unusual' and 'broken' are not
// the same thing. Each of the three-line runs was looked at by hand and all
// three were ordinary wider spacing before a verse; the run of ten was the
// growth bug, followed by a stray '[Chorus]' twice over.
//
// So anything from three up is listed, because it is worth a glance, but
// only five or more counts as a problem and fails the run. An audit that
// always exits non-zero is an audit people stop reading, and nobody puts
// five blank lines in the middle of a song on purpose.
const BLANK_RUN_REPORT = 3;
const BLANK_RUN_FAIL = 5;

// One word, long, with TWO OR MORE different keys each held down.
//
// A single held key is how singing gets written -- 'Ohhhhhh', 'Whoaaaaaa',
// 'Laaaaa', 'Hallelujaaaaaah' -- so one run is never enough on its own. Two
// separate runs inside one unbroken word is not singing, it is somebody
// leaning on the keyboard.
//
// Checked against all 6,161 lyric lines in the database before being used
// here: two hits, both genuine leftovers from a bug repro, and nothing else.
// The deliberate blind spot is a single held key ('uuuuuu'), which cannot be
// told apart from singing and is not worth a false alarm on every chorus.
function looksMashed(line) {
  const s = String(line == null ? '' : line).trim();
  if (s.length < 8) return false;
  if (/\s/.test(s)) return false;
  const runs = s.match(/([a-z])\1{3,}/gi) || [];
  return new Set(runs.map(r => r[0].toLowerCase())).size >= 2;
}

// Everywhere a song's words are kept, as { where, title, text } -- the
// stored lyrics AND the rendered slides.
//
// The slides were the gap. They were only ever checked for SHAPE, never
// content, so a line of keyboard mash sat in slide 6 of 6 of a real order
// -- the array the projector actually reads -- through two rounds of
// cleaning the lyric fields beside it. What gets projected is the thing
// that matters most, and it was the one thing nothing looked at.
function everyStoredText(songs, items) {
  const out = [];
  songs.forEach(s => out.push({ where: 'songs.lyrics', title: s.title, id: s.id, text: s.lyrics }));
  items.forEach(it => {
    const c = it.customizations;
    if (c && typeof c === 'object') {
      ['lyrics', 'customLyrics', 'masterLyrics'].forEach(k => {
        if (typeof c[k] === 'string') out.push({ where: 'order_items.' + k, title: it.title, id: it.id, text: c[k] });
      });
    }
    if (Array.isArray(it.slides)) {
      it.slides.forEach((s, i) => {
        const text = (typeof s === 'string') ? s : (s && s.content);
        if (typeof text === 'string') out.push({ where: 'slides[' + i + ']', title: it.title, id: it.id, text: text, slide: i });
      });
    }
  });
  return out;
}

function section(label) { console.log('\n== ' + label + ' ' + '='.repeat(Math.max(0, 62 - label.length))); }
let problems = 0;
function say(ok, msg) { console.log('  ' + (ok ? 'ok   ' : 'BAD  ') + msg); if (!ok) problems++; }

(async () => {
  const orders = await all('orders', '*');
  const items = await all('order_items', '*');
  const songs = await all('songs', '*');
  const roster = await all('roster', 'id, role_id, month, year, service_date, value');

  section('row counts');
  console.log('  orders ' + orders.length + '   order_items ' + items.length + '   songs ' + songs.length);

  section('duplicate ids');
  [['orders', orders], ['order_items', items], ['songs', songs]].forEach(([n, rows]) => {
    const seen = new Set(), dup = [];
    rows.forEach(r => { if (seen.has(r.id)) dup.push(r.id); seen.add(r.id); });
    say(dup.length === 0, n + ': ' + dup.length + ' duplicate id(s)' + (dup.length ? ' -> ' + dup.join(', ') : ''));
  });

  section('duplicate items inside one order');
  const byOrder = {};
  items.forEach(it => (byOrder[it.order_id] = byOrder[it.order_id] || []).push(it));
  let dupItems = 0;
  Object.keys(byOrder).forEach(oid => {
    const key = it => [it.item_type, it.source_id || '', (it.title || '').trim()].join('|');
    const seen = {};
    byOrder[oid].forEach(it => { const k = key(it); (seen[k] = seen[k] || []).push(it.id); });
    Object.keys(seen).forEach(k => {
      if (seen[k].length > 1) { dupItems++; console.log('  BAD  ' + oid + '  x' + seen[k].length + '  ' + k); }
    });
  });
  say(dupItems === 0, dupItems + ' duplicated item(s) within an order');

  section('orphans');
  const orderIds = new Set(orders.map(o => o.id));
  const orphanItems = items.filter(it => !orderIds.has(it.order_id));
  say(orphanItems.length === 0, orphanItems.length + ' order_item(s) whose order no longer exists');
  orphanItems.slice(0, 10).forEach(it => console.log('       ' + it.id + ' -> ' + it.order_id));

  const songIds = new Set(songs.map(s => s.id));
  const brokenSrc = items.filter(it => it.item_type === 'song' && it.source_id && !songIds.has(it.source_id));
  say(brokenSrc.length === 0, brokenSrc.length + ' song item(s) pointing at a song that no longer exists');
  brokenSrc.slice(0, 10).forEach(it => console.log('       ' + it.title + ' [' + it.id + '] -> ' + it.source_id));

  section('blank lines at the foot of stored lyrics');
  let tails = 0;
  songs.forEach(s => { if (tailLines(s.lyrics) > 0) { tails++; console.log('  BAD  songs ' + s.title + ' (' + tailLines(s.lyrics) + ')'); } });
  items.forEach(it => {
    const c = it.customizations;
    if (!c || typeof c !== 'object') return;
    ['lyrics', 'customLyrics', 'masterLyrics'].forEach(k => {
      if (typeof c[k] === 'string' && tailLines(c[k]) > 0) {
        tails++; console.log('  BAD  order_items.' + k + ' ' + it.title + ' (' + tailLines(c[k]) + ')');
      }
    });
  });
  say(tails === 0, tails + ' lyric field(s) still ending in blank lines');

  section('runs of blank lines inside stored lyrics');
  let runsBad = 0, runsSeen = 0;
  const seenRun = (where, title, text) => {
    const r = longestBlankRun(text);
    if (r.len < BLANK_RUN_REPORT) return;
    const bad = r.len >= BLANK_RUN_FAIL;
    if (bad) runsBad++; else runsSeen++;
    console.log('  ' + (bad ? 'BAD ' : 'note') + ' ' + where + ' ' + title + ' - ' + r.len +
      ' blank lines at line ' + r.at + ' of ' + r.of);
  };
  const storedText = everyStoredText(songs, items);
  storedText.forEach(f => seenRun(f.where, f.title, f.text));
  if (runsSeen) {
    console.log('  ' + runsSeen + ' field(s) with a run of ' + BLANK_RUN_REPORT + '-' +
      (BLANK_RUN_FAIL - 1) + ' blank lines (informational: wide, but plausible)');
  }
  say(runsBad === 0, runsBad + ' lyric field(s) with a run of ' + BLANK_RUN_FAIL + '+ blank lines');

  section('sort_order integrity');
  let sortBad = 0;
  Object.keys(byOrder).forEach(oid => {
    const rows = byOrder[oid].slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const vals = rows.map(r => r.sort_order);
    const dupes = vals.filter((v, i) => i && v === vals[i - 1]);
    const nulls = vals.filter(v => v == null || Number.isNaN(Number(v)));
    if (dupes.length || nulls.length) {
      sortBad++;
      console.log('  BAD  ' + oid + '  ' + dupes.length + ' tie(s), ' + nulls.length + ' null(s), max ' + Math.max(...vals.map(Number)));
    }
  });
  say(sortBad === 0, sortBad + ' order(s) with tied or missing sort_order');

  section('slides / backgrounds shape');
  let shapeBad = 0;
  items.forEach(it => {
    if (it.slides != null && !Array.isArray(it.slides)) { shapeBad++; console.log('  BAD  slides not an array: ' + it.id); }
    if (it.backgrounds != null && typeof it.backgrounds !== 'object') { shapeBad++; console.log('  BAD  backgrounds not an object: ' + it.id); }
  });
  say(shapeBad === 0, shapeBad + ' item(s) with an unexpected slides/backgrounds shape');

  section('typing left behind in stored text');
  let mashed = 0;
  storedText.forEach(f => {
    String(f.text == null ? '' : f.text).split(/\r?\n/).forEach((line, n) => {
      if (!looksMashed(line)) return;
      mashed++;
      console.log('  BAD  ' + f.where + ' ' + f.title + ' line ' + (n + 1) + ': ' + JSON.stringify(line.trim().slice(0, 48)));
      console.log('       ' + f.id);
    });
  });
  say(mashed === 0, mashed + ' line(s) of keyboard mash in stored text');

  // A slide with nothing on it at all is broken. A slide with no words but a
  // HEADER is usually deliberate -- 'Intro' before the band starts, or a card
  // announcing that the song switches to another arrangement -- so the two are
  // reported apart rather than lumped together.
  //
  // Measured 2026-10-01: both header-only slides in the database were of that
  // deliberate kind, in orders that had already been used in a service. Worth
  // listing, not worth failing over. (Open question for whoever reads this:
  // the slide PREVIEW shows nothing for a header-only slide, so it is worth
  // confirming such a slide projects the way it is meant to.)
  section('slides with no words on them');
  let blankSlides = 0, headerOnly = 0;
  items.forEach(it => {
    if (!Array.isArray(it.slides)) return;
    it.slides.forEach((s, i) => {
      const text = (typeof s === 'string') ? s : (s && s.content);
      if (text != null && String(text).trim() !== '') return;
      const header = (s && typeof s === 'object' && s.header) ? String(s.header).trim() : '';
      if (header) {
        headerOnly++;
        console.log('  note ' + it.title + ' slide ' + i + ' is a header only: ' +
          JSON.stringify(header.slice(0, 44)) + ' [' + it.id + ']');
        return;
      }
      blankSlides++;
      console.log('  BAD  ' + it.title + ' slide ' + i + ' has neither words nor a header [' + it.id + ']');
    });
  });
  if (headerOnly) console.log('  ' + headerOnly + ' header-only slide(s) (informational: probably deliberate)');
  say(blankSlides === 0, blankSlides + ' slide(s) with nothing on them at all');

  // Two rows for one cell is invisible until it bites.
  //
  // The roster is keyed by service_date, which is free text. getData()
  // normalises an ISO date into "Jan 4" on READ, so a row stored as
  // "2026-01-04T08:00:00.000Z" and a row stored as "Jan 4" land on the same
  // cell -- and with no ORDER BY, whichever Postgres returns last wins. The
  // screen shows a different name depending on the day you look at it.
  //
  // Worse, nothing downstream deduplicates: getAllForYear returns the raw
  // rows, so both are counted as duties. Six people had their 2026 duty
  // count inflated by one, and those counts are what runAutoSuggest uses to
  // share duties out fairly.
  //
  // Measured 2026-10-05: 6 such rows, all January 2026, all written within
  // one millisecond of each other -- a bulk import, not anyone's editing.
  // They were reported but left alone, because repairing them needed a human
  // to say who actually led those services.
  //
  // Removed 2026-10-08 once somebody did: the canonical row is correct on
  // both dates, which made four of them plain duplicates and the other two
  // simply wrong. So there is no allowlist here any more -- every
  // non-canonical date and every duplicated cell now fails, because there
  // should not be any. tools/remove-iso-roster-rows.js is what removed them
  // and backups/iso-roster-rows-2026-01.json is what they were.
  section('roster dates');
  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const canonical = s => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}$/.test(String(s).trim());
  // The same normalisation the app does on read, so collisions are counted
  // the way the roster screen actually sees them.
  const normSvc = s => {
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const d = new Date(s); if (!isNaN(d)) return MO[d.getUTCMonth()] + ' ' + d.getUTCDate();
    }
    return String(s).trim();
  };

  const oddDates = roster.filter(r => !canonical(r.service_date));
  say(oddDates.length === 0, oddDates.length + ' roster row(s) whose service_date is not "MMM D"');
  oddDates.slice(0, 12).forEach(r => console.log(
    '       ' + r.year + '  ' + String(r.role_id).padEnd(12) + JSON.stringify(r.service_date) + '  ' + JSON.stringify(r.value)));

  const cells = {};
  roster.forEach(r => {
    const k = r.year + '|' + r.role_id + '|' + normSvc(r.service_date);
    (cells[k] = cells[k] || []).push(r);
  });
  const dupCells = Object.keys(cells).filter(k => cells[k].length > 1);
  // A cell holding two rows that say the same thing is still a duplicate for
  // counting purposes, but it cannot make the screen flicker, so the two are
  // reported apart.
  const conflicting = dupCells.filter(k => new Set(cells[k].map(r => String(r.value))).size > 1);
  say(conflicting.length === 0, conflicting.length + ' roster cell(s) holding CONFLICTING values (the screen picks one at random)');
  conflicting.sort().forEach(k => {
    const [y, role, date] = k.split('|');
    console.log('  BAD    ' + y + ' ' + date.padEnd(8) + String(role).padEnd(12) +
      cells[k].map(r => JSON.stringify(r.value)).join('  vs  '));
  });
  const identical = dupCells.length - conflicting.length;
  if (identical) {
    console.log('  note ' + identical + ' further cell(s) hold duplicate rows that agree -- harmless on screen,');
    console.log('       but each is still counted twice in the serving-frequency totals.');
  }

  // The readings, which the Liturgy page both shows and writes.
  const READING_ROLES = ['reading1', 'psalm', 'reading2', 'gospel'];
  const readingRows = roster.filter(r => READING_ROLES.includes(r.role_id) && String(r.value || '').trim());
  const badReadingDates = readingRows.filter(r => !canonical(r.service_date));
  say(badReadingDates.length === 0, badReadingDates.length + ' reading row(s) on a non-canonical date');
  const readingDates = {};
  readingRows.forEach(r => { (readingDates[r.year + ' ' + normSvc(r.service_date)] = readingDates[r.year + ' ' + normSvc(r.service_date)] || {})[r.role_id] = r.value; });
  console.log('  ' + readingRows.length + ' reading(s) over ' + Object.keys(readingDates).length + ' service date(s) (informational)');
  const partial = Object.keys(readingDates).filter(d => Object.keys(readingDates[d]).length < 4);
  console.log('  ' + partial.length + ' date(s) with fewer than all four readings (informational)');

  section('leftover test material');
  const testish = /zztest|\btest\b|asdf|qwerty|abcdef/i;
  const to = orders.filter(o => testish.test(o.id) || testish.test(o.title || ''));
  const ti = items.filter(it => testish.test(it.id) || testish.test(it.title || ''));
  const ts = songs.filter(s => testish.test(s.id) || testish.test(s.title || ''));
  console.log('  orders: ' + to.length); to.forEach(o => console.log('       ' + o.id + '  ' + o.title));
  console.log('  items:  ' + ti.length); ti.slice(0, 10).forEach(o => console.log('       ' + o.id + '  ' + o.title));
  console.log('  songs:  ' + ts.length); ts.forEach(o => console.log('       ' + o.id + '  ' + o.title));

  section('songs missing the fields the UI reads');
  const missing = songs.filter(s => !s.title || !String(s.title).trim());
  say(missing.length === 0, missing.length + ' song(s) with no title');
  const noLyrics = songs.filter(s => !s.lyrics || !String(s.lyrics).trim());
  console.log('  ' + noLyrics.length + ' song(s) with no lyrics (informational)');
  noLyrics.slice(0, 8).forEach(s => console.log('       ' + s.title + ' [' + s.id + ']'));

  console.log('\n' + '='.repeat(66));
  console.log(problems === 0 ? 'data audit: nothing wrong found' : 'data audit: ' + problems + ' problem area(s)');

  // A summary file only when one is actually asked for. Running the audit
  // should never drop anything into the working tree by itself.
  const out = process.argv[2];
  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      at: new Date().toISOString(),
      orders: orders.length, items: items.length, songs: songs.length,
      problems: problems
    }, null, 1) + '\n');
    console.log('summary written to ' + out);
  }
  process.exit(problems === 0 ? 0 : 1);
})();
