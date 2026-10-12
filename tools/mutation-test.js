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
// WHAT THIS STILL CANNOT REACH
//
// It mutates Index.html and nothing else, so a harness reading a file under
// app/api is beyond it however many cases are listed below:
//
//   calendar-pending-harness   reads app/api/calendar/route.ts
//   scan-text-tests            reads app/api/parse-song-sheet/route.ts
//   multipage-scan-harness     its route section, for the same reason
//
// Those assertions are not worthless -- they bite on a real edit to the
// route, and the multipage ones were proved by hand -- but nothing here
// exercises them, so a green run below says nothing about them.
//
// One related problem was fixed rather than documented: scan-field-contract
// read Index.html from a hardcoded path and ignored the file it was handed,
// so every mutation aimed at it was a guaranteed false pass. It takes an
// argument now. Worth checking for in any new harness.
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
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
const TMP = path.join(os.tmpdir(), 'lhc-mutant-' + process.pid + '.html');

// [harness, what is being broken, the edit]
// The cleanup line, as it appears after each of those comments.
const CLEANUP = '\r\n    paths.forEach(function(p) { try { deleteFromSupabase(p); } catch (e) {} });';

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
  // Without the guard a triple tap uploaded every page three times and read
  // the sheet three times -- measured, not guessed.
  ['multipage-scan-harness.js', 'a double tap buys a second scan',
    s => s.replace('  if (_asScanning || !_asPages.length) return;', '  if (!_asPages.length) return;')],
  // Three functions now clean up after a failed upload, and the line is
  // identical in each. A bare replace hits whichever comes first in the file,
  // which is lpHandleDocFile -- not the one any of these tests exercise. That
  // is how the first version of this case reported MISS against correct code.
  ['multipage-scan-harness.js', 'a failed scan leaves its uploads in the bucket',
    s => s.replace('goes back for -- and a four page scan leaves four pieces of it.' + CLEANUP,
                   'goes back for -- and a four page scan leaves four pieces of it.')],
  ['multipage-scan-harness.js', 'a failed attach to an existing song leaves its uploads',
    s => s.replace('// Nothing will reference these -- the attach never happened.' + CLEANUP,
                   '// Nothing will reference these -- the attach never happened.')],
  ['multipage-scan-harness.js', 'full-size photographs are uploaded unshrunk',
    s => s.replace("    return _asDownscale(f).then(function(small) {\r\n      return uploadToSupabase(small, 'song-scans');\r\n    }).then(function(res) {",
                   "    return uploadToSupabase(f, 'song-scans').then(function(res) {")],
  // The route's own checks are not mutated here: this tool swaps Index.html
  // only, and multipage-scan-harness reads route.ts straight off disk. Those
  // assertions still bite on a real change to the route -- they were proved
  // by hand against a route with the storage check narrowed to page 1 -- but
  // they are not exercised automatically. Worth knowing before trusting a
  // green run to cover the route.

  ['multipage-scan-harness.js', 'pages attached to an existing song lose their order',
    s => s.replace('      infos[i] = info;          // by index, so the pages keep their order',
                   '      infos.push(info);')],
  ['multipage-scan-harness.js', 'page numbering restarts instead of carrying on',
    s => s.replace("', p' + (had + i + 1)", "', p' + (i + 1)")],
  // `_lpAttachDocs(infos, song);` appears identically in lpHandleDocFile and
  // in _asAttachPagesToSong, and lpHandleDocFile comes first in the file. A
  // bare replace therefore mutated the upload path while claiming to test the
  // camera path -- reported MISS against entirely correct code. Each is
  // anchored on the line above it, and both paths now have their own test.
  ['multipage-scan-harness.js', 'each attached page gets its own write',
    s => s.replace('    _asClearPages();\r\n    _lpAttachDocs(infos, song);',
                   '    _asClearPages();\r\n    infos.forEach(function(x) { _lpAttachDocs([x], song); });')],
  ['multipage-scan-harness.js', 'each uploaded document gets its own write',
    s => s.replace('  })).then(function() {\r\n    _lpAttachDocs(infos, song);',
                   '  })).then(function() {\r\n    infos.forEach(function(x) { _lpAttachDocs([x], song); });')],
  ['multipage-scan-harness.js', 'uploaded documents lose the order they were picked in',
    s => s.replace('      info.name = f.name;\r\n      infos[i] = info;', '      info.name = f.name;\r\n      infos.push(info);')],
  ['multipage-scan-harness.js', 'an abandoned scan deletes without checking the library',
    s => s.replace('      if (inUse.indexOf(name) !== -1 || inUse.indexOf(encodeURIComponent(name)) !== -1) return;', '')],

  // ---- the harnesses that had never been proved to fail -----------------
  //
  // Seventeen of the twenty-six in `npm run check` had no case here at all,
  // while this one harness had fifteen. A harness nobody has broken on
  // purpose is a harness nobody knows the strength of, and two of the ones
  // that WERE checked turned out to be reporting the wrong thing.
  //
  // Every anchor below was confirmed to appear exactly once before being
  // used -- the duplicated-line problem above cost two false MISS reports.

  ['emoji-font-harness.js', 'a page with no icons still asks for the emoji font',
    s => s.replace("if (!found || !found.length) return '';", 'if (false) return \'\';')],
  ['emoji-font-harness.js', 'the stylesheet stops naming the characters it needs',
    s => s.replace('encodeURIComponent(glyphs)', "''")],

  ['render-failure-message-harness.js', 'running out of credits reads as an unknown error',
    s => s.replace('/credit|quota|CREDITS_EXCEEDED/i.test(msg)', '/__never_matches__/i.test(msg)')],

  ['share-empty-card-harness.js', 'an empty service card counts as filled',
    s => s.replace('return isNaN(n) ? 1 : n;', 'return 1;')],

  ['duty-count-dedupe-harness.js', 'the dedupe key stops normalising the service date',
    s => s.replace("row.role_id + '|' + _normSvcDate(row.service_date)", "row.role_id + '|' + row.service_date")],

  ['year-pagination-harness.js', 'the read stops after the first thousand rows',
    s => s.replace('rows.length < 1000 ? SBQ_ROSTER._oneRowPerCell(out) : page(from + 1000)',
                   'SBQ_ROSTER._oneRowPerCell(out)')],

  ['subscribe-empty-warning-harness.js', 'an empty calendar stops warning anybody',
    s => s.replace('if ((body.match(/BEGIN:VEVENT/g) || []).length) return;', 'return;')],

  // sbIsChordLine is declared TWICE in Index.html, in two scopes, and the two
  // use different rules -- 0.55 of the words in one, 0.6 plus a prose-word
  // veto in the other. paste-fidelity deliberately extracts the LAST one,
  // which is the paste path. The first version of this case mutated the
  // other twin and reported MISS against a harness that was working
  // perfectly. Mutate the one the harness actually reads.
  ['paste-fidelity-harness.js', 'a lyric line with prose in it counts as chords',
    s => s.replace('return (chordCount / tokens.length >= 0.6) && !hasProseWord && tokens.length >= 1;',
                   'return (chordCount / tokens.length >= 0.6) && tokens.length >= 1;')],
  ['paste-fidelity-harness.js', 'the chord-density threshold is dropped altogether',
    s => s.replace('return (chordCount / tokens.length >= 0.6) && !hasProseWord && tokens.length >= 1;',
                   'return chordCount > 0 && !hasProseWord && tokens.length >= 1;')],

  ['order-save-contract.js', 'an explicit isNewOrder flag stops creating the row',
    s => s.replace('var _isNewOrder = !payload.id || payload.isNewOrder === true;',
                   'var _isNewOrder = !payload.id;')],

  ['group-duty-credit-harness.js', 'the app forgets that "all teachers" is a group',
    s => s.replace("var ROSTER_GROUP_LABELS = { 'all teachers': 'sundayschool' };",
                   'var ROSTER_GROUP_LABELS = {};')],

  ['bg-repin-harness.js', 'backgrounds are re-pinned to the slides that went away',
    s => s.replace('      var ni = boxes.indexOf(e.box);\r\n      if (ni >= 0) rebuilt[ni] = e.bg;',
                   '      var ni = boxes.indexOf(e.box);\r\n      rebuilt[ni] = e.bg;')],

  ['section-undo-harness.js', 'removing a section stops offering Undo',
    s => s.replace("    showToast('Section' + sectionTitle + ' removed', 'info', {",
                   "    showToast('Section' + sectionTitle + ' removed', 'info'); if (false) ({")],

  ['local-card-render-harness.js', 'the off-screen render stage is left in the document',
    s => s.replace('              stage.remove();', '              ;')],

  // Naming the pages buys nothing if the name is cut before the eye reaches
  // it. Truncating from the end removed the page number from every page of
  // every sheet -- three identical rows to choose between.
  ['multipage-scan-harness.js', 'document labels are cut from the end again',
    s => s.replace("  return str.slice(0, max - tail - 1) + '…' + str.slice(-tail);",
                   "  return str.slice(0, max) + '…';")],
  ['multipage-scan-harness.js', 'the document picker stops using the helper',
    s => s.replace('          label = window._docLabel(_stored);',
                   "          label = _stored.length > 30 ? _stored.substring(0, 30) + '...' : _stored;")],

  ['lyric-line-class-harness.js', 'page-break markers count as lyric lines again',
    s => s.replace("return !!c && (c.contains('sb-a4-marker') || c.contains('sb-a4-guide') ||",
                   'return false && (c.contains(\'sb-a4-marker\') || c.contains(\'sb-a4-guide\') ||')],

  // scan-field-contract could not be mutated at all until it was taught to
  // take a file argument: it read the real Index.html whatever it was handed,
  // so anything aimed at it was a guaranteed false pass.
  ['scan-field-contract.js', 'the edit form sets the key by assignment again',
    s => s.replace("_asmSetKeyField(song.key, 'editSongKey')", "$('editSongKey').value = song.key")],
  ['scan-field-contract.js', 'the save stops falling back to the key it opened with',
    s => s.replace("key: $('editSongKey').value || _asmEditingKey", "key: $('editSongKey').value")],

  ['order-delete-cleanup-harness.js', 'deleting an order leaves its projection settings',
    s => s.replace("from('projection_settings').delete().eq('owner_id', id)",
                   "from('projection_settings').select('owner_id').eq('owner_id', id)")],

  ['memories-harness.js', 'notes inside folders stop being read',
    s => s.replace('      Object.keys(d.folders || {}).forEach(function(fid) {', '      [].forEach(function(fid) {')]
];

let caught = 0, missed = 0, stale = 0;
console.log('mutation test: break it, and see whether the harness notices' + String.fromCharCode(10));

// Run the cases concurrently.
//
// Each one writes a 5MB file and spawns a node process that reads it, so
// one at a time took 48 seconds -- longer than the entire rest of the suite
// and enough to undo the work that got `npm run check` down from 136s. They
// do not depend on each other, so there is no reason to queue them.
//
// Each case gets its OWN temp file. Sharing one path across parallel runs
// would have every harness reading whichever mutation was written last.
const LIMIT = Math.max(2, Math.min(8, (os.cpus() || { length: 4 }).length));

function runCase(i) {
  const [harness, what, mutate] = CASES[i];
  const mutated = mutate(SRC);
  if (mutated === SRC) {
    // The code moved and the mutation no longer applies, so this case is
    // testing nothing. Reported, not skipped.
    return Promise.resolve({ i, harness, what, verdict: 'stale' });
  }
  const tmp = TMP.replace(/\.html$/, '-' + i + '.html');
  fs.writeFileSync(tmp, mutated);
  return new Promise(resolve => {
    execFile('node', [path.join(ROOT, 'tools', harness), tmp], (err) => {
      try { fs.unlinkSync(tmp); } catch (e) {}
      resolve({ i, harness, what, verdict: err ? 'caught' : 'missed' });
    });
  });
}

(async () => {
  const results = new Array(CASES.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(LIMIT, CASES.length) }, async () => {
    while (next < CASES.length) {
      const i = next++;
      results[i] = await runCase(i);
    }
  }));

  // Reported in the order they are written above, not the order they
  // finished, so the output is the same every run.
  for (const r of results) {
    if (r.verdict === 'stale') {
      console.log('  STALE ' + r.harness.padEnd(34) + r.what);
      console.log('        the edit matched nothing -- update the anchor, it is proving nothing now');
      stale++;
    } else if (r.verdict === 'caught') {
      caught++;
      console.log('  ok    ' + r.harness.padEnd(34) + r.what);
    } else {
      missed++;
      console.log('  MISS  ' + r.harness.padEnd(34) + r.what);
      console.log('        the harness stayed green with this broken. It is not guarding it.');
    }
  }

  console.log(String.fromCharCode(10) + '='.repeat(66));
  console.log(caught + ' caught, ' + missed + ' missed, ' + stale + ' stale');
  if (!missed && !stale) console.log('Every guarded behaviour is actually guarded.');
  process.exit(missed || stale ? 1 : 0);
})();
