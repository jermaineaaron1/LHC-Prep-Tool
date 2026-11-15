'use strict';
// Harness for the operator's request of 2026-11-15, on two marked-up
// screenshots of the Songbook on a laptop:
//
//   1. "Allow to collapse that song list so that more width space is given
//      to the main layout" -- laptop and tablet (the wide layout). Folded,
//      the list is a rail of the songs' numbers and the song column takes
//      the width it gave back.
//   2. "Expand it by 15px" -- asked: the song column, 15px on each side
//      (max-width 1060 -> 1090).
//   3. "Colour Navy blue" -- asked: the controls card (key, view mode,
//      notes, font, the tiles), on the wide layout.
//
// USAGE
//   node tools/songbook-side-fold-harness.js
//   node tools/songbook-side-fold-harness.js <file> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');

function extractFn(name) {
  const startIdx = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) throw new Error('function not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces while extracting: ' + name);
}
function extractVar(name) {
  const l = lines.find(x => new RegExp('^  var ' + name + '\\b').test(x));
  if (!l) throw new Error('var not found: ' + name);
  return l;
}
const fn = n => { try { return extractFn(n); } catch (e) { return ''; } };
const has = re => re.test(SRC);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}
const ESC = 'function escapeHtml(t) { return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\'/g, "&#39;"); }\n';
const unHtml = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ------------------------------------------------------------ 1. the list and its rail
console.log('\n1. The song list folds into a rail of the songs\' numbers');
let side = null;
try {
  side = new Function('_sbmOrderBook', '_woMedleys', '_sbmSectionLabel',
    ESC + extractFn('escapeJsArg') + '\n' + extractFn('_woUnits') + '\n' + extractFn('_sbmSideHtml') + '\nreturn _sbmSideHtml;');
} catch (e) { check('the list can be built', false, e.message); }
const songs = [
  { id: 's1', title: 'Do You Hear What I Hear' },
  { id: 's2', title: 'Make Room' },
  { id: "s3'x", title: "Mary's Boy Child" },
  { id: 's4', title: 'Holy Holy Holy' },
  { id: 's5', title: 'Joy to the World' },
];
const medleys = [{ id: 'm1', songs: ["s3'x", 's4'] }];
let html = '';
try { html = side ? side(() => true, () => medleys, () => '')(songs, songs[2]) : ''; } catch (e) { check('the list draws', false, e.message); }
const fullAt = html.indexOf('class="sbm-side__full"'), railAt = html.indexOf('class="sbm-side__rail"');
check('the list is drawn whole AND as a rail, side by side, so folding needs no redraw', fullAt >= 0 && railAt > fullAt, html.slice(0, 200));
const full = railAt > 0 ? html.slice(fullAt, railAt) : '', rail = railAt > 0 ? html.slice(railAt) : '';
check('the list\'s header has the fold button: hide the list', /class="sbm-side__hdr">[\s\S]*<button type="button" class="sbm-side__fold" onclick="WO\.sbmSideFold\(true\)"[^>]*aria-label="Hide the song list"/.test(full));
check('the rail starts with the button that brings it back', /^class="sbm-side__rail"><button type="button" class="sbm-side__unfold" onclick="WO\.sbmSideFold\(false\)"[^>]*aria-label="Show the song list"/.test(rail));
const dots = rail.match(/<button class="sbm-side__dot[^"]*"[^>]*>[^<]*<\/button>/g) || [];
check('a number for every song, in order', dots.length === 5 && dots.map(d => d.replace(/<[^>]+>/g, '')).join(',') === '1,2,3,4,5', dots.join('\n'));
check('...the song in front marked, and no other', dots.filter(d => /sbm-side__dot is-on/.test(d)).length === 1 && /is-on/.test(dots[2] || ''));
check('...each named on hover and to a screen reader', /title="1\. Do You Hear What I Hear" aria-label="Song 1: Do You Hear What I Hear"/.test(dots[0] || '') &&
  /title="3\. Mary&#39;s Boy Child"/.test(dots[2] || ''));
check('a medley\'s songs kept together on the rail, as in the list', /<div class="sbm-side__rail-md" title="Medley"><button class="sbm-side__dot[^>]*>3<\/button><button class="sbm-side__dot[^>]*>4<\/button><\/div>/.test(rail), rail);
// The handler must come back as the right id after the attribute is decoded (gotcha 47).
let picked = null;
try {
  const m = (dots[2] || '').match(/onclick="([^"]*)"/);
  new Function('WO', unHtml(m[1]))({ sbmSelectSong: id => { picked = id; } });
} catch (e) { picked = 'threw: ' + e.message; }
check('a number opens its song, an id with an apostrophe included', picked === "s3'x", String(picked));
check('Add a song is on the rail too, for a service\'s book', /sbm-side__dot sbm-side__dot--add" onclick="WO\.sbmAddSong\(\)"/.test(rail));
let html2 = '';
try { html2 = side ? side(() => false, () => [], () => '')(songs, songs[0]) : ''; } catch (e) {}
check('...and not for a book that cannot add songs', !!html2 && !/sbm-side__dot--add/.test(html2) && !/sbm-side__add/.test(html2));

// ------------------------------------------------------------ 2. folding
console.log('\n2. Folding is a class on the layout, kept on this device');
function harness(storageThrows) {
  const store = {};
  const ls = {
    getItem: k => { if (storageThrows) throw new Error('no storage'); return k in store ? store[k] : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('no storage'); store[k] = String(v); },
    removeItem: k => { if (storageThrows) throw new Error('no storage'); delete store[k]; },
  };
  const classes = new Set(['sbm-wide']);
  const focused = [];
  const btn = cls => ({ cls, focus: () => focused.push(cls) });
  const wrap = { classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); } }, querySelector: s => btn(s) };
  const doc = { querySelector: s => (s === '#sbmRoot .sbm-wide' ? wrap : null) };
  const calls = { marks: 0, guide: 0, timers: [] };
  const api = new Function('localStorage', 'document', '_sbmMarksQueue', '_sbmGuideCheck', 'setTimeout',
    extractVar('_SBM_SIDE_KEY') + '\n' + extractVar('_sbmSideShut') + '\n' + extractFn('_sbmSideClosed') + '\n' + extractFn('sbmSideFold') +
    '\nreturn { closed: _sbmSideClosed, fold: sbmSideFold };')(ls, doc, () => calls.marks++, () => calls.guide++, (f, ms) => { calls.timers.push(ms); f(); });
  return { api, store, classes, focused, calls };
}
let H = null;
try { H = harness(false); } catch (e) { check('folding can be run', false, e.message); }
if (H) {
  check('open by default', H.api.closed() === false && !H.classes.has('is-side-closed'));
  H.api.fold(true);
  check('fold: the layout gets is-side-closed, kept on this device', H.classes.has('is-side-closed') && H.store.lhc_sbm_side_closed === '1' && H.api.closed() === true);
  check('...the column changed width, so the chords are fitted and the drawings repainted again, and the floater asked', H.calls.marks === 1 && H.calls.guide === 1);
  check('...and the focus goes to the button that brings it back', H.focused[H.focused.length - 1] === '.sbm-side__unfold');
  H.api.fold(false);
  check('unfold: the class comes off and nothing is kept', !H.classes.has('is-side-closed') && !('lhc_sbm_side_closed' in H.store) && H.api.closed() === false &&
    H.focused[H.focused.length - 1] === '.sbm-side__fold');
}
let H2 = null;
try { H2 = harness(true); } catch (e) { check('folding without storage can be run', false, e.message); }
if (H2) {
  let threw = '';
  try { H2.api.fold(true); } catch (e) { threw = e.message; }
  check('a browser that keeps nothing still folds, and remembers it in the page', !threw && H2.classes.has('is-side-closed') && H2.api.closed() === true, threw);
}
const render = fn('_sbmRender');
check('the layout is drawn folded when this device folded it', /'<div class="sbm-wide' \+ \(_sbmSideClosed\(\) \? ' is-side-closed' : ''\) \+ '"><aside class="sbm-side">' \+ _sbmSideHtml\(list, song\)/.test(render || SRC));
check('WO offers it to the buttons', has(/sbmSideFold: sbmSideFold,/));

// ------------------------------------------------------------ 3. the widths
console.log('\n3. The song column: 15px more each side, and the list\'s width when folded');
check('beside the list, the column is 1090px at most (1060 + 15 + 15)', has(/\n\.sbm-main \{ max-width: 1090px; width: 100%; margin: 0 auto;/) && !has(/\.sbm-main \{ max-width: 1060px/));
check('folded, the rail is 56px and the column may take what the list gave back (1090 + 272 - 56)',
  has(/\n\.sbm-wide\.is-side-closed \{ grid-template-columns: 56px minmax\(0, 1fr\); \}/) && has(/\n\.sbm-wide\.is-side-closed \.sbm-main \{ max-width: 1306px; \}/));
check('the rail is hidden until the list is folded, the list hidden once it is', has(/\n\.sbm-side__rail \{ display: none; \}/) &&
  has(/\n\.sbm-wide\.is-side-closed \.sbm-side__full \{ display: none; \}/) && has(/\n\.sbm-wide\.is-side-closed \.sbm-side__rail \{ display: flex;/));
check('the Phone view\'s narrow desk still hides the whole list (its rule outranks the fold\'s)',
  has(/body\.sbm-phone-narrow #sbmRoot\.sbm--wide \.sbm-wide \{ grid-template-columns: minmax\(0, 1fr\); \}/) &&
  has(/body\.sbm-phone-narrow #sbmRoot\.sbm--wide \.sbm-side \{ display: none; \}/) && !/is-side-closed[^{}]*\{[^}]*!important/.test(SRC));

// ------------------------------------------------------------ 4. the navy card
console.log('\n4. The controls card in navy, on a desk or a tablet');
check('the controls card is named', has(/html \+= '<div class="sbm-card sbm-card--controls"><div class="sbm-two">' \+/));
check('...navy as the top bar, on the wide layout only (a phone keeps its white card)',
  has(/\n\.sbm--wide \.sbm-card--controls \{ background: linear-gradient\(135deg, var\(--sbm-navy-ink\), var\(--sbm-navy-2\)\);/) &&
  !/\n\.sbm-card--controls \{/.test(SRC) && !/#sbmRoot:not\(\.sbm--wide\) \.sbm-card--controls/.test(SRC));
check('...its labels and the key\'s hint turn light', has(/\.sbm--wide \.sbm-card--controls \.sbm-label \{ color: rgba\(255,255,255,0\.84\); \}/) &&
  has(/\.sbm--wide \.sbm-card--controls \.sbm-xp-hint \{ color: rgba\(255,255,255,0\.74\); \}/));
check('...the soft tiles (Record, Tracks) laid on white, not see-through on navy',
  has(/\.sbm--wide \.sbm-card--controls \.sbm-tile--danger \{ background: linear-gradient\(var\(--sbm-danger-soft\), var\(--sbm-danger-soft\)\), #fff; \}/) &&
  has(/\.sbm--wide \.sbm-card--controls \.sbm-tile--teal \{ background: linear-gradient\(var\(--sbm-teal-soft\), var\(--sbm-teal-soft\)\), #fff; \}/));
check('...a pressed button (Liturgist Notes with notes) is gold, not navy on navy',
  has(/\.sbm--wide \.sbm-card--controls \.sbm-btn\.is-on \{ background: var\(--sbm-gold\);/));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (EXPECT_BROKEN) {
  if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
  console.log('--expect-broken: failures above are the expected ones');
  process.exit(0);
}
process.exit(fail ? 1 : 0);
