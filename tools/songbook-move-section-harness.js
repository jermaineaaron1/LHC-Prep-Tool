'use strict';
// Harness for the Songbook's "Move to section": a song moved to another part
// of the service (Song of Preparation, Dismissal...) without leaving the book.
//
// WHY THIS EXISTS
// From the music team (2026-11-05): the Songbook could only reorder a song
// within its own section, and pointed to the Liturgy Builder for the rest.
// Now the song's More menu has Move to section...:
//   - the song leaves the section it was in and joins the end of the one
//     chosen, the list in service order -- the Builder's own move;
//   - a song in a medley takes its medley with it, still a medley;
//   - a section that already sings the song is refused (a song sung twice
//     is two copies, one per section), and so is a move while LCD
//     Projection's schedule is on the page;
//   - Undo puts every song back where it was.
//
// USAGE
//   node tools/songbook-move-section-harness.js                 # ../Index.html
//   node tools/songbook-move-section-harness.js path/to/file.html
//   node tools/songbook-move-section-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 28a37d3:Index.html > x`).
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}

const SRC = fs.readFileSync(INDEX, 'utf8');
const has = re => re.test(SRC);
const fn = name => { const m = SRC.match(new RegExp('  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

console.log('Where it is');
check('the song\'s More menu has Move to section, in a service\'s book',
  has(/if \(song\) rows\.push\(\['fa-right-left', 'Move to section\\u2026 \(Song of Preparation, Dismissal\\u2026\)', 'WO\.sbmMoveToSection\(\)', '#[0-9a-f]{6}'\]\);/) &&
  has(/sbmMoveToSection: sbmMoveToSection, sbmMoveToSectionPick: sbmMoveToSectionPick,/));
check('...the sheet lists the sections, the one it is in ticked and not to be chosen',
  /var here = sec\.id === cur;/.test(fn('sbmMoveToSection')) && /\(here \? ' disabled' : ''\)/.test(fn('sbmMoveToSection')));

console.log('\nThe move, run on a service');
const pick = fn('sbmMoveToSectionPick');
const parts = ['_lbdPlaceSong', '_lbdUnplaceSong', '_lbdSortSongsByService', '_woSongCopyIn'].map(fn);
if (pick && parts.every(Boolean)) {
  const world = () => {
    const W = { lcd: false, toasts: [], cur: null };
    W.secs = [{ id: 'prep', title: 'Song of Preparation' }, { id: 'resp', title: 'Song of Response' }, { id: 'dism', title: 'Dismissal Song' }];
    const S = (id, title, sec, songId) => ({ id, title, songId: songId || id, serviceSections: [sec], sectionId: sec });
    W.songs = [S('a', 'Come, Now', 'prep'), S('b', 'We Praise You', 'prep'), S('c', 'Unto Thee', 'resp'), S('d', 'Give Me Oil', 'dism'), S('b2', 'We Praise You', 'dism', 'b')];
    W.medleys = [];
    const make = new Function('W', [
      'var songOrderSections = W.songs, _woSongsTakenOutOfSections = {};',
      'function _sbmSong() { return W.cur; }',
      'function _woLcdInPage() { return W.lcd; }',
      'function _woSectionList() { return W.secs; }',
      'function _woSongSectionIds(s) { return (s.serviceSections || []).slice(); }',
      'function _woMedleyOf(id) { for (var i = 0; i < W.medleys.length; i++) { var k = W.medleys[i].songs.indexOf(id); if (k > -1) return { medley: W.medleys[i], at: k, n: W.medleys[i].songs.length }; } return null; }',
      'function _lbdSecTitle(id) { return (W.secs.filter(function(x) { return x.id === id; })[0] || {}).title; }',
      'function _woSongsChange(f) { f(); return true; }',
      'function _sbmCloseSheet() {}', 'function renderSongbookLive() {}',
      'function showToast(m, t, o) { W.toasts.push({ m: m, o: o }); }'
    ].concat(parts, [pick, 'return sbmMoveToSectionPick;']).join('\n'));
    W.move = make(W);
    W.where = () => W.songs.map(s => s.title + '@' + s.serviceSections.join('|')).join(', ');
    W.undo = () => W.toasts[W.toasts.length - 1].o.onAction();
    return W;
  };
  let W = world(); const start = W.where();
  W.cur = W.songs[2]; W.move('dism');
  check('a song moves into the section chosen, at its end, the list in service order',
    W.where() === 'Come, Now@prep, We Praise You@prep, Give Me Oil@dism, We Praise You@dism, Unto Thee@dism', W.where());
  check('...and its Undo puts it back where it was', (W.undo(), W.where() === start), W.where());
  W = world(); W.medleys = [{ songs: ['a', 'b'] }]; W.cur = W.songs[0]; W.move('resp');
  check('a song in a medley takes its medley with it, in the medley\'s order',
    W.where() === 'Unto Thee@resp, Come, Now@resp, We Praise You@resp, Give Me Oil@dism, We Praise You@dism' && /The medley moved to Song of Response/.test(W.toasts[0].m), W.where());
  W = world(); W.cur = W.songs[1]; W.move('dism');
  check('a section that already sings the song is refused, and nothing moves',
    W.where() === start && /already sung in Dismissal Song/.test(W.toasts[0].m) && !W.toasts[0].o, W.toasts[0] && W.toasts[0].m);
  W = world(); W.lcd = true; W.cur = W.songs[2]; W.move('dism');
  check('...and so is a move while LCD Projection is open', W.where() === start && /Close LCD Projection first/.test(W.toasts[0].m));
} else check('the move and the Builder\'s place, unplace and sort are functions of their own', false);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
