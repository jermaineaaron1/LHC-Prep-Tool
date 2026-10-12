'use strict';
// Does the test suite actually have teeth?
//
// WHY THIS EXISTS
// A harness that cannot fail is worse than no harness: it reports green and
// nobody looks at that area again. Two were found in one morning.
//
//   chord-alignment-harness    an assertion was handed an array where it
//                              wanted a boolean, so it passed against source
//                              holding three conflicting colours
//
//   blank-slide-harness        it tested _prunedSlides thoroughly in
//                              isolation and never checked that anything
//                              CALLED it. Removing the guard from the write
//                              path left the harness entirely green -- it
//                              would have let a blank slide reach a Sunday
//                              service with the suite reporting success
//
// Neither was visible by reading the harness. Both were obvious the moment
// the guarded behaviour was actually broken.
//
// HOW IT WORKS
// Each case breaks one guarded behaviour in a COPY of Index.html, runs the
// harness against the copy, and requires a non-zero exit. The real file is
// never written to.
//
// A mutation that changes nothing is reported as a failure too, not skipped:
// an anchor that has moved proves nothing, and silently passing would be the
// same false comfort this tool exists to catch.
//
// IT RUNS AS PART OF `npm run check`, AND LAST
//
// It was kept out at first because it runs every harness again over a 5MB
// file, and while chord-alignment-harness alone took 127 seconds that came
// to roughly six minutes. `check` has to stay fast enough that people run it
// before committing, so the choice then was right.
//
// That harness is now 105 ms and the whole mutation pass is about 3 seconds
// on top of a 9 second suite, so there is no longer anything to trade off.
// It earned the place: it is what caught the @media-nested rule a rewrite
// had silently stopped guarding, and the line of JavaScript the chord
// harness was counting as a CSS rule.
//
// Last in the chain on purpose. A harness that is failing against real
// source should say so in its own words first; this tool would also go red,
// but "a mutation was caught" is a confusing way to hear it.
//
// USAGE
//   npm run check     # includes this, at the end
//   npm run mutate    # this on its own
//   node tools/mutation-test.js
//
// Exit code 0 = every mutation was caught, 1 = at least one went unnoticed.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const TMP = path.join(os.tmpdir(), 'lhc-mutant-' + process.pid + '.html');

// [harness, what is being broken, the edit]
const CASES = [
  ['chord-alignment-harness.js', 'one lyric-line colour disagrees again',
    s => s.replace('#songbookLiveModal .wo-lyrics-lyric-line{color:#000000!important',
                   '#songbookLiveModal .wo-lyrics-lyric-line{color:#334155!important')],
  ['chord-alignment-harness.js', 'the lyric line gets a proportional font',
    s => s.replace(/(#songbookLiveModal \.sb-page-lyrics:has\(\.wo-lyrics-chord-line\) \.wo-lyrics-lyric-line \{\s*font-family: )[^;]+/,
                   '$1Arial, sans-serif')],
  // Both rules at once, because either one alone keeps the other standing.
  //
  // This case exists because the harness once answered it wrongly. It scanned
  // the whole file rather than the <style> blocks, so a line of JavaScript --
  // classList.contains('wo-lyrics-chord-line') && ...contains('wo-lyrics-
  // lyric-line') -- counted as a rule naming both classes. With both real
  // rules gone it still announced "1 found" and went red on a different
  // check. Caught, but pointing at the wrong thing.
  //
  // Two anchors worth keeping in mind here, both learned by getting them
  // wrong: the replacement must not CONTAIN the class name, since matching is
  // by substring ('.wo-lyrics-lyric-line-gone' still counts as a hit); and the
  // pattern must match the RAW source, which separates these two selectors
  // with ',\r\n    ', not the ', ' the harness prints after normalising.
  ['chord-alignment-harness.js', 'nothing binds the two lines to one font any more',
    s => s.replace(/(:has\(\.wo-lyrics-chord-line\)\s+)\.wo-lyrics-lyric-line(\s*\{)/g,
                   '$1.wo-lyrics-NOPE$2')
          .replace(/(\.wo-lyrics-chord-line,\s*#songbookLiveModal\s+)\.wo-lyrics-lyric-line(\s*\{)/g,
                   '$1.wo-lyrics-NOPE$2')],

  ['blank-slide-harness.js', 'the write boundary stops pruning',
    s => s.replace('slides:         _prunedSlides(item.slides),', 'slides:         item.slides || [],')],
  ['blank-slide-harness.js', 'a header-only slide is wrongly dropped',
    s => s.replace("           !String(header == null ? '' : header).trim() &&", '')],

  ['readings-roster-harness.js', 'the window filter is removed from getRange',
    s => s.replace('          if (!iso || iso < fromIso || iso > toIso) return;', '          if (!iso) return;')],
  ['readings-roster-harness.js', 'a reading write stops logging the change',
    s => s.replace("          return Promise.resolve(sb.from('roster_changes').insert({",
                   '          return Promise.resolve({}).then(function(){ return ({')],

  ['guest-status-harness.js', 'Guest drops out of the skip list',
    s => s.replace('inactive: 1, suspended: 1, guest: 1 }', 'inactive: 1, suspended: 1 }')],
  ['guest-status-harness.js', 'Auto-Suggest stops consulting the exclusion',
    s => s.replace('if (isAutoSuggestExcluded(name, STATE.rosterYear, STATE.rosterMonth)) return false;', '')],

  ['addressed-name-harness.js', 'Bro is applied to every role, not just preaching',
    s => s.replace("    if (roleId !== 'preacher') return value;", '')],
  ['addressed-name-harness.js', 'the share stops applying the form of address',
    s => s.replace("if (typeof window.LHC_addressedName === 'function') v = window.LHC_addressedName(roleId, v);", '')],

  ['song-save-local-harness.js', 'the merge rebuilds instead of carrying fields forward',
    s => s.replace('    Object.keys(prev).forEach(function(k) { merged[k] = prev[k]; });', '')],
  ['song-save-local-harness.js', 'the save stops applying the local merge',
    s => s.replace('if (_applySavedSongLocally(songData)) {', 'if (false) {')],
  ['song-save-local-harness.js', 'the reload goes back to wiping the catalogue',
    s => s.replace('renderSongs(_wasShowing);', 'renderSongs(false);')],

  // The reason the multi-page harness exists. Four pages upload in parallel;
  // collecting the URLs as they arrive rather than by index scrambles the
  // page order, and the model stitches them in whatever order it is handed.
  // The song reads almost right, which is why only a test finds it.
  ['multipage-scan-harness.js', 'page urls are collected as they arrive, not by page',
    s => s.replace('  var urls = new Array(pages.length);', '  var urls = [];')
          .replace('      urls[i] = res.url;', '      urls.push(res.url);')],
  ['multipage-scan-harness.js', 'the page cap stops being applied',
    s => s.replace('  var taken = picked.slice(0, Math.max(0, room));', '  var taken = picked;')],
  ['multipage-scan-harness.js', 'the sheet-music mode never reaches the request',
    s => s.replace('        mode: mode,', '')],
  ['multipage-scan-harness.js', 'only the first page is kept as a document',
    s => s.replace('    _scanUrls.forEach(function(u, i) {', '    [_scanUrls[0]].forEach(function(u, i) {')],
  ['multipage-scan-harness.js', 'sheet music is reported as a chord scan that found nothing',
    s => s.replace("  var _docMode = d.__scanMode === 'document';", '  var _docMode = false;')],
  // The route's own checks are not mutated here: this tool swaps Index.html
  // only, and multipage-scan-harness reads route.ts straight off disk. Those
  // assertions still bite on a real change to the route -- they were proved
  // by hand against a route with the storage check narrowed to page 1 -- but
  // they are not exercised automatically. Worth knowing before trusting a
  // green run to cover the route.

  ['memories-harness.js', 'notes inside folders stop being read',
    s => s.replace('      Object.keys(d.folders || {}).forEach(function(fid) {', '      [].forEach(function(fid) {')]
];

let caught = 0, missed = 0, stale = 0;
console.log('mutation test: break it, and see whether the harness notices\n');

for (const [harness, what, mutate] of CASES) {
  const mutated = mutate(SRC);
  if (mutated === SRC) {
    // The code moved and the mutation no longer applies, so this case is
    // testing nothing. Reported, not skipped.
    console.log('  STALE ' + harness.padEnd(34) + what);
    console.log('        the edit matched nothing -- update the anchor, it is proving nothing now');
    stale++;
    continue;
  }
  fs.writeFileSync(TMP, mutated);
  let exit = 0;
  try {
    execFileSync('node', [path.join(ROOT, 'tools', harness), TMP], { stdio: 'pipe' });
  } catch (e) { exit = e.status || 1; }
  if (exit !== 0) { caught++; console.log('  ok    ' + harness.padEnd(34) + what); }
  else {
    missed++;
    console.log('  MISS  ' + harness.padEnd(34) + what);
    console.log('        the harness stayed green with this broken. It is not guarding it.');
  }
}

try { fs.unlinkSync(TMP); } catch (e) {}

console.log('\n' + '='.repeat(66));
console.log(caught + ' caught, ' + missed + ' missed, ' + stale + ' stale');
if (!missed && !stale) console.log('Every guarded behaviour is actually guarded.');
process.exit(missed || stale ? 1 : 0);
