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

// Source fragments the cases below replace. Kept up here because each must
// match the RAW file, CRLF and comment alignment included, and a near-miss
// would silently mutate nothing and report the harness as asleep.
const SKIP_PSEUDO = "    if (/^standalone_/.test(it.order_id)) return;          // a songbook, not an order";
const SKIP_SEEN   = '    if (seen[pair]) return;                                // same order, counted once';
const ORDER_CMP   = '      return (b.orderCount - a.orderCount)\r\n          || (b.songbookCount - a.songbookCount)';
const SB_CLEANUP_HEAD = "      return SBQ.deleteOrder('standalone_' + id).catch(function(e) {";
const SB_CLEANUP_ALL  = SB_CLEANUP_HEAD +
  "\r\n        console.warn('Songbook ' + id + ': its stored work was not removed:', e && e.message);" +
  '\r\n      });';

const CRLF = SRC.includes('\r\n') ? '\r\n' : '\n';
const BSL = String.fromCharCode(92);

// Shared link -> song. Two of these are not hypothetical: they were real
// fixes, made by hand and never written down, and both were silently lost
// when the work was rebuilt on a newer master. Nothing went red.
const DESPACED   = "        if (x.replace(/ /g, '') === y.replace(/ /g, '')) return true;" + CRLF;
const SCRIBE_GUARD = '      if (!window.lhcLinkIsSongCandidate(url)) return false;' + CRLF;
const ANY_SCRIPT = "          .replace(/[^" + BSL + "p{L}" + BSL + "p{N}]+/gu, ' ')";
const TYPO_LATIN = "        var typoable = /^[a-z0-9 ]+$/;" + CRLF +
  '        if (typoable.test(x) && typoable.test(y) && Math.max(x.length, y.length) <= 24) {';
const CLEAN_NOISE = "        s = s.replace(noise, '');";

const SET_REF   = '        return SBQ_READINGS.setReference(dateStr, entry.idx, canonical);';
const SAVE_SLOT = '        SBQ_LECTIONARY.saveSlot(dateStr, entry.idx, { reference: canonical });';
// Two copies of this line exist, the sidebar's and the strip's; the mutation
// below takes the SECOND, which is the strip.
const STRIP_BTN = '<button class="lit-nav-occ-btn" data-libfilter="dashboard" onclick="LiturgyModule.selectOccasion(null)">';

// The loose-comparison line, as it appears in the source: \u2010 there is the
// literal escape, not the character, so these are written raw.
const NORM_LINE  = String.raw`    var norm = function(s) { return s.toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/[\s,.]+/g, ''); };`;
const LOOSE_LINE = String.raw`    var norm = function(s) { return s.toLowerCase().replace(/[0-9:,.\-\s]+/g, ''); };`;

const SORTED_RANGE = '        var dates = entries.map(function(e) { return e.date; }).sort();\r\n' +
                     '        var from = dates[0], to = dates[dates.length - 1];';
const POSITIONAL_RANGE = '        var from = entries[0].date, to = entries[entries.length - 1].date;';

// The one line that decides what a reset would change, and three ways of
// getting it wrong.
const PLAN_LINE = "      if (was && cur !== was) plan.push({ idx: i, label: slot.label, from: cur || '(empty)', to: was });";
const PLAN_CLEARS_BLANK = "      if (cur !== was) plan.push({ idx: i, label: slot.label, from: cur || '(empty)', to: was });";
const PLAN_REWRITES_ALL = "      if (was) plan.push({ idx: i, label: slot.label, from: cur || '(empty)', to: was });";
const PLAN_NEVER_FIRES  = '      if (false) plan.push({ idx: i, label: slot.label, from: cur, to: was });';
// customConfirm appears all over the file; this is the one in the reset.
const RESET_ASK =
  "      var ask = (typeof window.customConfirm === 'function')\r\n" +
  "        ? window.customConfirm('Reset to ' + found.src.fileName + '?', detail)\r\n" +
  '        : Promise.resolve(window.confirm(detail));';
const ORDER_FILL =
  "          if (serviceDate && typeof fillReadingsFromRoster === 'function') {\r\n" +
  '            fillReadingsFromRoster({ dateStr: serviceDate, quiet: true });\r\n' +
  '          }\r\n';

// getRange's window filter, as it reads now: three lines, comparing the
// date part of a service key rather than the key itself.
const WINDOW_FILTER =
  '          if (!iso) return;' + CRLF +
  '          var day = SBQ_READINGS.keyDate(iso);' + CRLF +
  '          if (day < SBQ_READINGS.keyDate(fromIso) || day > SBQ_READINGS.keyDate(toIso)) return;';
const WHOLE_KEY_FILTER = '          if (!iso || iso < fromIso || iso > toIso) return;';

// The Bible Browser's editable title box, and the one function all three of
// its save paths now ask for it. In reading-slot mode that box IS the
// reference that reaches the roster, there being no second field.
const CHOSEN_TYPED =
  "    var typed = titleInput ? String(titleInput.value == null ? '' : titleInput.value).trim() : '';";
const CHOSEN_RETURN =
  '    return typed || (bbState.passage && bbState.passage.reference) || fallback;';
const SLOT_REF = "    var reference = bbChosenTitle('');";
const SLOT_CACHE_KEY = '    _passageTextCache[bbNormaliseReference(reference)] = {';
// Two copies of this line exist, the library's and the service order's;
// replace() below takes the FIRST, which is the library.
const LIB_TITLE = "    var title = bbChosenTitle('Scripture');";
// The pre-fill: what the title box is filled WITH when a passage arrives.
// Tidying the suggestion is what fixes the default path, since most people
// save the reference the dialog already put in front of them.
const PREFILL =
  '        if (titleInput) titleInput.value = bbSuggestedTitle(result.reference || reference);';
const SUGGEST_BODY =
  "    return String(ref == null ? '' : ref).replace(/^(\\s*)Psalms(\\s+\\d)/, '$1Psalm$2');";

const CASES = [
  ['share-link-song-harness.js', 'titles differing only by a comma in a number stop matching',
    s => s.replace(DESPACED, '')],
  ['share-link-song-harness.js', 'Transcribe offers itself on links Add as Song refuses',
    s => s.replace(SCRIBE_GUARD, '')],
  ['share-link-song-harness.js', 'only English letters survive normalising a title',
    s => s.replace(ANY_SCRIPT, "          .replace(/[^a-z0-9]+/g, ' ')")],
  ['share-link-song-harness.js', 'two-letter typo tolerance reaches Mandarin again',
    s => s.replace(TYPO_LATIN, '        if (Math.max(x.length, y.length) <= 24) {')],
  ['share-link-song-harness.js', 'video decoration is left on the song title',
    s => s.replace(CLEAN_NOISE, '')],
  ['share-link-song-harness.js', 'a Facebook reel stops being recognised',
    s => s.replace(/[^\n]*type:'facebook-video',[^\n]*label:'Facebook Reel'[^\n]*\r?\n/, '')],

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
    s => s.replace(WINDOW_FILTER, '          if (!iso) return;')],
  // The window filter now compares the DATE part, because an evening key
  // carries a suffix. Comparing the whole key again drops the Watchnight
  // from any window that ends on the 31st.
  // The readings layer reads a year at a time, and PostgREST stops at 1000
  // rows without saying so. Stopping after the first page is exactly the
  // bug: 2026 is 1299 rows, so the tail of the year silently vanishes.
  ['readings-roster-harness.js', 'a year is read only as far as the first page',
    s => s.replace('            return rows.length < 1000 ? out : page(from + 1000);',
                   '            return out;')],
  // Paging without an order: two pages of an unordered result can repeat a
  // row and miss another, which reads as data that is merely odd.
  ['readings-roster-harness.js', 'paged reads stop being ordered',
    s => s.replace("build().order('id').range(from, from + 999)",
                   'build().range(from, from + 999)')],
  ['readings-roster-harness.js', 'the window filter compares the whole key again',
    s => s.replace(WINDOW_FILTER, WHOLE_KEY_FILTER)],
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

  // Both reported from a phone. Neither was in code written for the scan --
  // they were in an older preview modal the new flow leads into.
  ['multipage-scan-harness.js', 'the attachment preview opens behind the form again',
    s => s.replace('<div id="previewModal" class="modal-overlay" style="z-index:10050;">',
                   '<div id="previewModal" class="modal-overlay">')],
  ['multipage-scan-harness.js', 'a photographed page goes back into the iframe',
    s => s.replace('  var isImage = /\\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)(\\?|#|$)/i.test(url);',
                   '  var isImage = false;')],

  ['multipage-scan-harness.js', 'a page removed before saving is left in the bucket',
    s => s.replace('    if (held.indexOf(name) !== -1 || held.indexOf(encodeURIComponent(name)) !== -1) return;',
                   '    return;')],
  ['multipage-scan-harness.js', 'saving deletes the pages the song actually kept',
    s => s.replace('    if (held.indexOf(name) !== -1 || held.indexOf(encodeURIComponent(name)) !== -1) return;',
                   '    if (false) return;')],

  // The transposer is handed every line, chord row or not. Without the
  // chord-line test it rewrites the words: "A mighty fortress is our God"
  // becomes "G mighty fortress is our God", saved, in the song's own lyrics.
  ['suggested-chord-key-harness.js', 'the words get transposed along with the chords',
    s => s.replace("    if (!(typeof isChordLineGlobal === 'function' && isChordLineGlobal(line))) return line;", '')],
  // Replacing chord text in place moves every chord after one that changed
  // width: C becomes Bb and the rest of the row slides a column right,
  // while the words underneath stay exactly where they were.
  ['suggested-chord-key-harness.js', 'chords drift off their column when one gets wider',
    s => s.replace('    if (out.length > 0 && col <= out.length) col = out.length + 1;'+String.fromCharCode(13,10)+"    out += new Array(col - out.length + 1).join(' ') + moved;",
                   "    out += (out.length ? ' ' : '') + moved;")],
  ['suggested-chord-key-harness.js', 'the long way round between keys',
    s => s.replace('  return d > 6 ? d - 12 : d;', '  return d;')],
  ['suggested-chord-key-harness.js', 'a flat key is spelled with sharps again',
    s => s.replace('  if (!m || !FLAT_KEY_ROOTS[m[1]]) return line;', '  return line;')],
  ['suggested-chord-key-harness.js', 'chords read off a sheet are offered for moving too',
    s => s.replace('_asmSuggestedFromKey = d.chordsSuggested ? (d.key || null) : null;',
                   '_asmSuggestedFromKey = d.key || null;')],

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
    s => s.replace('      Object.keys(d.folders || {}).forEach(function(fid) {', '      [].forEach(function(fid) {')],

  // Song usage. The sidebar counted songbook membership as worship usage AND
  // counted it twice, so four songs nobody had ever sung led the Trending
  // list. Each case below is one half of that bug put back.
  ['song-usage-stats-harness.js', 'songbook membership is added back into the order count',
    s => s.replace('    e.orderCount = e.orders.length;',
                   '    e.orderCount = e.orders.length + e.songbooks.length;')],
  ['song-usage-stats-harness.js', 'a songbook pseudo-order counts as a worship service',
    s => s.replace(SKIP_PSEUDO, '    if (false) return;')],
  ['song-usage-stats-harness.js', 'one order counts twice if the song is in it twice',
    s => s.replace(SKIP_SEEN, '    if (false) return;')],
  // The subtle one. Every song with no order is filtered out before the sort,
  // so adding the two counts together leaves most orderings untouched -- it
  // takes a song that IS in an order and in enough songbooks to overtake one
  // with more orders. The harness needed a fixture built for exactly that.
  ['song-usage-stats-harness.js', 'songbooks are allowed to outrank services',
    s => s.replace(ORDER_CMP,
                   '      return ((b.orderCount + b.songbookCount) - (a.orderCount + a.songbookCount))')],

  // Deleting a songbook must take its standalone_<id> pseudo-order with it,
  // and must delete the songbook FIRST -- the other order would leave a
  // songbook whose annotations had already been thrown away.
  ['songbook-delete-cleanup-harness.js', 'deleting a songbook leaves its stored work behind',
    s => s.replace(SB_CLEANUP_HEAD, '      return Promise.resolve().then(function(e) {')],
  ['songbook-delete-cleanup-harness.js', 'a failed cleanup is reported as a failed delete',
    s => s.replace(SB_CLEANUP_ALL, "      return SBQ.deleteOrder('standalone_' + id);")],

  // The Liturgy page. Auto-Fill saved into lectionary_readings, a text cache
  // nothing reads back, so the references vanished on the next load; and two
  // of the five sections never lit up at all.
  ['liturgy-nav-readings-harness.js', 'Auto-Fill saves to the cache nothing reads',
    s => s.replace(SET_REF, SAVE_SLOT)],
  // The sharper one: the roster write is still THERE, so a textual check is
  // satisfied, but the dead store is written beside it again.
  ['liturgy-nav-readings-harness.js', 'the dead store is written alongside the roster',
    s => s.replace(SET_REF, SAVE_SLOT + '\r\n' + SET_REF)],
  ['liturgy-nav-readings-harness.js', 'a reading is filed under the wrong slot',
    s => s.replace(SET_REF,
                   '        return SBQ_READINGS.setReference(dateStr, 3 - entry.idx, canonical);')],
  ['liturgy-nav-readings-harness.js', 'the section nav goes dark again',
    s => s.replace(
      "      btn.classList.toggle('active', !!key && btn.getAttribute('data-libfilter') === key);",
      "      btn.classList.remove('active');")],
  // The strip and the sidebar are lit by ONE selector. Drop the shared class
  // from the strip and only the sidebar highlights -- invisible on desktop,
  // where the strip is hidden, and the only place it shows is a phone.
  ['liturgy-nav-readings-harness.js', 'the mobile strip stops sharing the sidebar class',
    s => { const i = s.indexOf(STRIP_BTN); const j = s.indexOf(STRIP_BTN, i + 1);
           return j < 0 ? s : s.slice(0, j) + STRIP_BTN.replace('lit-nav-occ-btn', 'lit-strip-btn') + s.slice(j + STRIP_BTN.length); }],

  // Importing a lectionary writes many roster rows from one upload, so what
  // it does on a disagreement is the whole safety story. The comparison has
  // to thread between two quiet failures, and both are mutated here.
  ['lectionary-import-harness.js', 'a clash is treated as an empty slot and overwrites',
    s => s.replace("    return { kind: 'clash', current: cur, incoming: next };",
                   "    return { kind: 'empty', current: '', incoming: next };")],
  // Too fussy: an en dash or a missing space reads as a conflict, so a real
  // year of readings arrives as fifty false alarms and people click through.
  ['lectionary-import-harness.js', 'punctuation counts as a different reading',
    s => s.replace(NORM_LINE, '    var norm = function(s) { return s; };')],
  // Too loose: only the book name is compared, so a different chapter passes
  // as already-saved and the genuine disagreement is never shown at all.
  ['lectionary-import-harness.js', 'a different chapter passes as the same reading',
    s => s.replace(NORM_LINE, LOOSE_LINE)],
  ['lectionary-import-harness.js', 'the review stops showing what it would replace',
    s => s.replace("    return { kind: 'clash', current: cur, incoming: next };",
                   "    return { kind: 'clash', current: '', incoming: next };")],
  ['lectionary-import-harness.js', 'every slot is compared against the first reading',
    s => s.replace('[SBQ_READINGS.SLOTS[slotIdx].role]', '[SBQ_READINGS.SLOTS[0].role]')],
  ['lectionary-import-harness.js', 'the source is recorded even when nothing saved',
    s => s.replace('    if (saved > 0) SBQ_LECT_SOURCES.save(rec)', '    SBQ_LECT_SOURCES.save(rec)')],
  // Local time moves the day west of Greenwich, so 1 Nov prints as 31 Oct.
  // The range the import checks for clashes over. Built from the array's
  // first and last entry instead of its smallest and largest date, it
  // matches nothing the moment the entries arrive unsorted -- every slot
  // then reads as empty and the conflict check is off with no sign of it.
  ['lectionary-import-harness.js', 'the clash lookup trusts the array order',
    s => s.replace(SORTED_RANGE, POSITIONAL_RANGE)],
  ['lectionary-import-harness.js', 'review dates are built in local time',
    s => s.replace('new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]))', 'new Date(+p[0], +p[1] - 1, +p[2])')],

  // Resetting a service back to what the lectionary said. The destructive
  // one is first: a slot the document left blank is not the document saying
  // there is no reading, so it must never clear one added by hand.
  ['lectionary-import-harness.js', 'a reset clears readings the document never mentioned',
    s => s.replace(PLAN_LINE, PLAN_CLEARS_BLANK)],
  ['lectionary-import-harness.js', 'a reset rewrites slots that already match',
    s => s.replace(PLAN_LINE, PLAN_REWRITES_ALL)],
  ['lectionary-import-harness.js', 'the reset never finds anything to do',
    s => s.replace(PLAN_LINE, PLAN_NEVER_FIRES)],
  // The button and the reset agree only by reading the same function.
  ['lectionary-import-harness.js', 'the reset button stops asking the shared plan',
    s => s.replace('      if (!_lectResetPlan(iso, found.slots).length) return;',
                   '      if (!found.slots) return;')],
  ['lectionary-import-harness.js', 'the reset stops asking before it overwrites',
    s => s.replace(RESET_ASK, '      var ask = Promise.resolve(true);')],
  // Building the snapshot is not the same as handing it over: drop this one
  // line and every future reset has nothing to go back to.
  ['lectionary-import-harness.js', 'the import stops recording what the document said',
    s => s.replace('      readings: readings,\r\n', '')],
  ['lectionary-import-harness.js', 'a new order stops getting its readings',
    s => s.replace(ORDER_FILL, '')],
  // The Bible Browser's title box. Two save paths honoured it and the third
  // did not, so a correction typed in reading-slot mode was discarded with
  // nothing said -- and since the API answers "Psalms 96" when asked for
  // "Psalm 96", that is how a hand-added psalm became the one odd spelling
  // on a page of 59 singular ones.
  ['reading-slot-title-harness.js', 'the reading slot ignores the title box again',
    s => s.replace(SLOT_REF, "    var reference = bbState.passage.reference || '';")],
  ['reading-slot-title-harness.js', 'the shared helper stops reading the box',
    s => s.replace(CHOSEN_TYPED, "    var typed = '';")],
  ['reading-slot-title-harness.js', 'a box holding only spaces becomes the reference',
    s => s.replace(CHOSEN_TYPED,
                   "    var typed = titleInput ? String(titleInput.value == null ? '' : titleInput.value) : '';")],
  // Keyed on the API's spelling, the reader never finds the text just
  // fetched and goes back to the API for every corrected reference.
  ['reading-slot-title-harness.js', 'the passage cache is keyed on the API reference',
    s => s.replace(SLOT_CACHE_KEY,
                   '    _passageTextCache[bbNormaliseReference(bbState.passage.reference || reference)] = {')],
  // The thing that must NOT be fixed by coercion. Six live 2026 services
  // deliberately hold non-psalm values in the psalm slot -- theme verses for
  // a preaching series, and a bare "-" for the weeks with no psalm -- so a
  // rewrite that assumes "Psalm N" would destroy real planning.
  ['reading-slot-title-harness.js', 'a Psalms -> Psalm rewrite creeps into the helper',
    s => s.replace(CHOSEN_RETURN, String.raw`    return (typed || (bbState.passage && bbState.passage.reference) || fallback).replace(/\bPsalms\b/, 'Psalm');`)],
  // Drift the other way: the library stops asking the shared helper, which
  // is how the three came to disagree in the first place.
  // Liturgies and Library were folded into Memories and taken off the
  // strip. Putting one back gives the page two entries leading to the
  // same ribbons, which is what was just removed.
  ['liturgy-nav-readings-harness.js', 'a Library entry creeps back into the strip',
    // Inside the STRIP, not the sidebar: the sidebar copy appears first
    // in the file, and a plain replace would change the one the strip
    // checks never look at -- which is how this mutation first passed.
    s => {
      const at = s.indexOf('<nav id="litTopNav"');
      if (at < 0) return s;
      return s.slice(0, at) +
        s.slice(at).replace('data-libfilter="memories"', 'data-libfilter="library"');
    }],
  ['reading-slot-title-harness.js', 'the library stops asking the shared helper',
    s => s.replace(LIB_TITLE, "    var title = bbState.passage.reference || 'Scripture';")],
  // Making the box editable only helps the person who notices the plural.
  // If the suggestion goes back to the API's spelling, the DEFAULT path
  // files psalms as "Psalms N" again and almost nobody will retype it.
  ['reading-slot-title-harness.js', 'the pre-fill suggests the API spelling again',
    s => s.replace(PREFILL,
                   '        if (titleInput) titleInput.value = result.reference || reference;')],
  // The suggestion must rename a LEADING book followed by a number and
  // nothing else. Unanchored, it rewrites any title with the word in it.
  ['reading-slot-title-harness.js', 'the suggestion loses its anchor',
    s => s.replace(SUGGEST_BODY,
                   "    return String(ref == null ? '' : ref).replace(/Psalms/, 'Psalm');")]
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
