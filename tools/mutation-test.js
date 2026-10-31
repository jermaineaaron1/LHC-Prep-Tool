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

  // Two-part songs. Every one of these leaves a page that still looks
  // like a song -- which is the whole reason the harness exists.
  //
  // The first is the one that matters most: without the rest cell, the
  // lane that is singing slides into the lane that is not, and the page
  // calmly tells the women to sing the men's line.
  ['voice-lines-harness.js', 'a resting part stops occupying its lane',
    s => s.replace('_rest: function(cls, tag, part, g) {', "_rest: function(cls, tag, part, g) { return '';")],
  ['voice-lines-harness.js', 'rows pair by bar number instead of sortOrder',
    s => s.replace('var k = String(ln.sortOrder == null ? 0 : ln.sortOrder);',
                   'var k = String(ln.barStart);')],
  ['voice-lines-harness.js', 'a unison passage is filed as the women alone',
    s => s.replace("if (p === 'both') b.both = ln;",
                   "if (p === 'both') b.women = ln;")],
  // The gap notice was suppressed at a verse boundary once, which is
  // exactly where this carol's two-bar rest falls, so it vanished.
  ['voice-lines-harness.js', 'a rest straddling a verse boundary is swallowed again',
    s => s.replace('out.push(\'<div class="vl-section">\' + V._esc(section) + \'</div>\');',
                   'out.push(\'<div class="vl-section">\' + V._esc(section) + \'</div>\'); prev = null;')],
  // The song's own words are offered from the women's line, which is both
  // the melody and, in this carol, the line without the engraving typos.
  // One line, not two: Index.html is CRLF, so a pattern spanning a newline
  // matches nothing and goes stale instead of going red.
  // The pick moved into leadLine, which toPlainLyrics and the chord row
  // now share -- a chord has to sit over the lyric its moment contributed,
  // so if the two ever chose differently every chord after the first
  // disagreement would print above the wrong words.
  ['voice-lines-harness.js', "the song's suggested words come from the men instead",
    s => s.replace('if (g.women && !g.women.sustained) return g.women;',
                   'if (g.men && !g.men.sustained) return g.men;')],
  ['voice-lines-harness.js', 'a held vowel is offered as if it were a lyric',
    s => s.replace('if (g.women && !g.women.sustained) return g.women;', 'if (g.women) return g.women;')],
  // The chord row reads and writes the song's own lyrics column. Too
  // loose and a chord lands over words it is not played against; too
  // eager and the write puts a chord line where a lyric should be.
  ['voice-lines-harness.js', 'chords are matched by spelling, so hyphenation misses',
    s => s.replace("var n = function(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); };",
                   "var n = function(s) { return String(s == null ? '' : s); };")],
  ['voice-lines-harness.js', 'a repeated line always takes the first chord line',
    s => s.replace('if (cursor) { cursor.at = i + 1; cursor.last = index[i]; cursor.lastPart = part; }', '')],
  // The two sides of one judgement: different parts on the same words are
  // one line and share a chord; the SAME part on the same words is a
  // refrain repeated and takes the next. Breaking it either way is
  // wrong, so break it both ways.
  ['voice-lines-harness.js', 'each part eats its own chord line, starving the verses',
    s => s.replace('if (cursor && cursor.last && cursor.lastPart && part !== cursor.lastPart &&',
                   'if (false &&')],
  ['voice-lines-harness.js', 'a repeated refrain is given the chords of the one before',
    s => s.replace('cursor.lastPart && part !== cursor.lastPart &&', '')],
  ['voice-lines-harness.js', 'clearing a chord leaves a blank line above the words',
    s => s.replace("if (!text.trim()) lines.splice(chordAt, 1);          // drop the row",
                   "if (!text.trim()) lines[chordAt] = '';")],
  ['voice-lines-harness.js', 'a new chord row overwrites the lyric instead of going above it',
    s => s.replace('lines.splice(lyricAt, 0, text);                      // a new row above',
                   'lines[lyricAt] = text;')],
  // The alignment contract, and the exact way it was broken: the chord row
  // and the lyric under it must be one size, because a chord is placed by
  // character offset. Shipped at 13.12px over 17.86px and nobody could see
  // it from a screenshot.
  ['voice-lines-harness.js', 'the chord row is sized on its own again',
    s => s.replace('font-size: var(--vl-text); font-weight: 800; color: #14532d; letter-spacing: 0; }',
                   'font-size: 0.82em; font-weight: 800; color: #14532d; letter-spacing: 0; }')],
  ['voice-lines-harness.js', 'the monospace rule shrinks the lyric again',
    s => s.replace("'Courier New',monospace; }\r\n  .vl-chords--empty",
                   "'Courier New',monospace; font-size: 0.94em; }\r\n  .vl-chords--empty")],
  // The exact bump is a taste decision and has already moved once. What
  // must not move is that the size is DERIVED from the lyric size rather
  // than written as a literal, because a literal is how the chord row and
  // the words drift apart again.
  ['voice-lines-harness.js', 'the chord size is hard-coded instead of derived',
    s => s.replace('--vl-text: calc(var(--sf-lyric-size, 19px) - 1px);',
                   '--vl-text: 18px;')],
  ['voice-lines-harness.js', 'the row rhythm stops being tokenised',
    s => s.replace('.vl-sys { padding: var(--vl-row) 0;', '.vl-sys { padding: 9px 0;')],
  ['voice-lines-harness.js', 'a section header is taken for a lyric a chord can sit over',
    s => s.replace("      if (/^\\s*\\[.+\\]\\s*$/.test(line)) continue;          // a section header\r\n", "")],
  ['voice-lines-harness.js', 'the bar-later echo is offered as a second line',
    s => s.replace("if (!t || t === last) return;", "if (!t) return;")],
  ['voice-lines-harness.js', 'lyrics stop being escaped on the way into the page',
    s => s.replace('_esc: function(s) {',
                   "_esc: function(s) { return String(s == null ? '' : s);")],

  // Starting an arrangement from a song that has none. The seed is the only
  // thing standing between a liturgist and retyping a whole carol.
  ['voice-lines-harness.js', 'a new arrangement seeds the women alone, not unison',
    s => s.replace("out.push({ part: 'both', text: line,", "out.push({ part: 'women', text: line,")],
  ['voice-lines-harness.js', 'chord lines are seeded as words somebody must sing',
    s => s.replace('      if (chord(raw)) return;', '      if (false) return;')],
  // One line, not two: Index.html is CRLF, so a pattern spanning a newline
  // goes stale instead of going red. The parseVoiceText line is nearly the
  // same but carries `cur = null`, so this anchor stays unique.
  ['voice-lines-harness.js', 'section headers are seeded as lyrics',
    s => s.replace('if (sec) { section = sec[1].trim(); return; }',
                   'if (sec) { section = sec[1].trim(); }')],
  ['voice-lines-harness.js', 'every seeded line lands in one group',
    s => s.replace('section: section, sortOrder: order++, sustained: false });',
                   'section: section, sortOrder: 0, sustained: false });')],

  // The stacked layout. A part joining mid-phrase has to sit under the words
  // it shares; back at the left margin the page says the men start the
  // phrase when they actually start four words into it.
  // These four guarded leadIn, the automatic indent. It is gone -- it was
  // what made the left edge ragged -- and what replaced it is the lane
  // model, so that is what is broken here instead.
  //
  // women is tested BEFORE men in partFamily, and this mutation is the
  // whole reason to say so: the word "women" CONTAINS "men", so the other
  // order paints every Women 2 lane in the men's colour. It is the kind of
  // wrong that looks like a theme decision rather than a bug.
  ['voice-lines-harness.js', 'men is tested before women, so Women 2 turns teal',
    s => s.replace("if (k.indexOf('women') > -1) return 'women';\r\n    if (k.indexOf('men') > -1) return 'men';",
                   "if (k.indexOf('men') > -1) return 'men';\r\n    if (k.indexOf('women') > -1) return 'women';")],
  // A song that names its own parts must not also sprout the bare lanes.
  ['voice-lines-harness.js', 'the canonical pair is forced on every song',
    s => s.replace('if (seen.women || seen.men) {', 'if (true) {')],
  ['voice-lines-harness.js', 'a two-part song loses the lane that is resting',
    s => s.replace('if (seen.women || seen.men) {', 'if (false) {')],
  // Lanes stack women above men. Sorted by first appearance alone, a verse
  // the men open puts them on top for the whole song.
  ['voice-lines-harness.js', 'the stack follows first appearance, not the staves',
    s => s.replace('return (a.r - b.r) || (a.i - b.i);', 'return (a.i - b.i);')],
  // A bracket WITH words after it names a part; a bracket alone is a
  // section. Drop the parse and "[Women 1] ..." becomes a unison line
  // whose words begin with somebody's part name.
  // A chorus written in named parts lost every chord because leadLine
  // knew only the three canonical names. Break the fallback either way:
  // remove it and the chords vanish again; drop its guard and held
  // vowels start counting as lyrics.
  ['voice-lines-harness.js', 'a moment of named parts has no lead line again',
    s => s.replace('      if (ln && !ln.sustained && String(ln.text || \'\').trim()) return ln;',
                   '      if (false) return ln;')],
  ['voice-lines-harness.js', 'the fallback stops skipping held vowels',
    s => s.replace('      if (ln && !ln.sustained && String(ln.text || \'\').trim()) return ln;',
                   '      if (ln) return ln;')],
  // The lane stack follows insertion order. Ordered by part instead, the
  // alphabet decides it and a chorus prints its tune below its harmonies.
  ['voice-lines-harness.js', 'the rows are read back in alphabetical part order',
    s => s.replace(".order('id', { ascending: true })\r\n        .range(from, from + 999)",
                   ".order('part', { ascending: true })\r\n        .range(from, from + 999)")],
  // One transposition convention. With two, the songbook's lyrics page
  // and the choir page beside it spelled the same key differently --
  // "Eb Ab" against "D# G#", both on screen at once.
  ['voice-lines-harness.js', 'going down spells with sharps again',
    s => s.replace('var OUT   = steps < 0 ? FLATS : NOTES;', 'var OUT   = NOTES;')],
  ['voice-lines-harness.js', 'going up spells with flats',
    s => s.replace('var OUT   = steps < 0 ? FLATS : NOTES;', 'var OUT   = steps < 0 ? NOTES : FLATS;')],
  // Transposing in place drags every chord after one that changed
  // length, which on a page placed by character offset means every
  // chord after the first Bb lands on the wrong syllable.
  ['voice-lines-harness.js', 'transposing rewrites in place and shifts the columns',
    s => s.replace("? V._transposeAligned(raw, steps, o.transposeFn) : raw;",
                   "? o.transposeFn(raw, steps) : raw;")],
  ['voice-lines-harness.js', 'a transposed chord stops returning to its column',
    s => s.replace("if (out.length < col) out += new Array(col - out.length + 1).join(' ');",
                   "if (out.length) out += ' ';")],
  // The musicians read the choir page, so it has to move with the key.
  ['voice-lines-harness.js', 'the choir page ignores the transpose buttons again',
    s => s.replace("return (steps && raw && typeof o.transposeFn === 'function')",
                   "return (false && raw && typeof o.transposeFn === 'function')")],
  // Transposing the display must never move what is stored, and editing
  // while transposed would write a chord back through a transposer that
  // respells every flat as a sharp.
  ['voice-lines-harness.js', 'a transposed row can be edited, respelling the song',
    s => s.replace('if (steps) editable = false;', '')],
  ['voice-lines-harness.js', 'the row forgets the chord it actually stores',
    s => s.replace('if (hit) attrs += \' data-chord-raw="\' + V._esc(raw) + \'"\';', '')],
  // Reordering a songbook by drag used to rename it and wipe its saved
  // per-song state, because save() writes the whole row. Third table to
  // be bitten by that, after songs and order_items.
  ['voice-lines-harness.js', 'the reorder goes back to the full-row write',
    s => s.replace('SBQ_SONGBOOKS.updateFields(_sbStandaloneId, {',
                   'SBQ_SONGBOOKS.save({ id: _sbStandaloneId, songIds: [] }); SBQ_SONGBOOKS.save({')],
  ['voice-lines-harness.js', 'the narrow write invents a name it was not given',
    s => s.replace('if (patch && patch.name != null) row.name = patch.name;',
                   "row.name = (patch && patch.name) || 'Untitled Songbook';")],
  // The printed songbook opens a standalone document. Drop the score's
  // rules from it and every chord slides to the left margin while the
  // part chips stack above their words -- on the page the carolers hold.
  ['voice-lines-harness.js', 'the print document loses the score stylesheet',
    s => s.replace("'<style>' + _sbChoirScoreCss() +", "'<style>' +")],
  ['voice-lines-harness.js', 'the lifted stylesheet stops being deduplicated',
    s => s.replace("if (txt.indexOf('.vl-') > -1 && !seen[txt]) { seen[txt] = 1; out.push(txt); }",
                   "if (txt.indexOf('.vl-') > -1) { out.push(txt); }")],
  // A moment whose words are not in the song has nowhere to put a chord.
  ['voice-lines-harness.js', 'an unmatched moment invites a chord it cannot take',
    s => s.replace('out.push(V._chordRow(hit, over, !!o.chordEdit && !!hit, !!o.chordEdit, o));',
                   'out.push(V._chordRow(hit, over, !!o.chordEdit, !!o.chordEdit, o));')],
  // Both found in real use, on a song somebody was actually writing.
  ['voice-lines-harness.js', 'the colon after a part name goes into the lyric again',
    s => s.replace('var br = /^\\[([^\\]]+)\\]\\s*:?\\s*/.exec(rest);',
                   'var br = /^\\[([^\\]]+)\\]\\s*/.exec(rest);')],
  ['voice-lines-harness.js', 'a part named in one section is drawn over the whole song',
    s => s.replace("(lanesBySection[g.section || ''] || []).forEach(function(p) {",
                   'V.lanes(lines).forEach(function(p) {')],
  ['voice-lines-harness.js', 'a named part is read as lyrics instead',
    s => s.replace('var br = /^\\[([^\\]]+)\\]\\s*:?\\s*/.exec(rest);', 'var br = null;')],

  // The editor, and the cue the carolers asked for. The first of these is
  // the placement rule itself: a line with no bars sings AT THE SAME MOMENT
  // as the line above it, and without that the two parts stop being
  // simultaneous and the whole arrangement becomes a list.
  ['voice-lines-harness.js', 'a line with no bars stops joining the one above',
    s => s.replace('if (hasBars || taken) {', 'if (true) {')],
  ['voice-lines-harness.js', 'a section header stops closing the group above it',
    s => s.replace("if (sec) { section = sec[1].trim(); cur = null; return; }",
                   "if (sec) { section = sec[1].trim(); return; }")],
  ['voice-lines-harness.js', 'held notes do not survive a trip through the editor',
    s => s.replace("r[0] + (r[1].sustained ? '~' : '') + (r[1].text || '')",
                   "r[0] + (r[1].text || '')")],
  // The two cue mutations that lived here went with the cue itself: the
  // banners were struck off the design, so there is no annotate() left to
  // break. What replaced them guards the label and the blank.
  ['voice-lines-harness.js', 'a unison line is labelled BOTH again',
    s => s.replace("V._line('both', 'All', g.both, o, inl)", "V._line('both', 'Both', g.both, o, inl)")],
  // Bars left the editor with the gutter, and the blank line took over the
  // job their absence used to do. It is now the whole of the grouping
  // syntax, so both ends of it are worth breaking.
  ['voice-lines-harness.js', 'groups stop being separated in the editor source',
    s => s.replace("return blocks.map(function(b) { return b.join('\\n'); }).join('\\n\\n');",
                   "return blocks.map(function(b) { return b.join('\\n'); }).join('\\n');")],
  ['voice-lines-harness.js', 'a blank line stops closing the group',
    s => s.replace('if (!line.trim()) { cur = null; return; }', 'if (!line.trim()) { return; }')],
  ['voice-lines-harness.js', 'a silent part goes back to a mark instead of a blank',
    // The class name appears twice -- the CSS rule first, then the markup.
    // String.replace takes only the first, so renaming "vl-blank" alone
    // restyles a stylesheet and leaves the element untouched: a mutation
    // that changes the file and nothing else. Anchor on the markup.
    s => s.replace('class="vl-blank" aria-hidden', 'class="vl-nothing" aria-hidden')],
  // rematch decides whether a practice take survives a save, and it can
  // fail in two opposite directions. Too strict and a save that changed
  // nothing empties the song of its recordings -- the bug this was written
  // for. Too loose and a take plays against words it is not a recording
  // of, which is quieter and worse. One mutation each way.
  ['voice-lines-harness.js', 'the words stop counting, so any line matches any line',
    s => s.replace("var strict = function(r) { return r.part + '|' + so(r) + '|' + norm(r.text); };",
                   "var strict = function(r) { return r.part + '|' + so(r); };")],
  ['voice-lines-harness.js', 'a line that moved loses its take again',
    s => s.replace("if (oldLoose[k].length !== 1) return;", "return;")],
  ['voice-lines-harness.js', 'repeated words are guessed at instead of left alone',
    s => s.replace("if (!cand || cand.length !== 1) return;", "if (!cand) return;")],
  // Two sections renamed in one save cannot be told apart; guessing moves
  // a verse's takes onto the chorus.
  ['voice-lines-harness.js', 'two sections renamed at once are guessed at',
    s => s.replace("    if (gone.length !== 1 || fresh.length !== 1) return null;",
                   "    if (gone.length < 1 || fresh.length < 1) return null;")],
  ['voice-lines-harness.js', 'a section deleted and another written is taken for a rename',
    s => s.replace("      if (kept * 2 < was.length) return null;",
                   "")],
  // A drawn remark lands on the words it was drawn round because its
  // anchor is the box its first point is in, or the nearest one above or
  // below; and the eraser asks the distance to a SEGMENT, clamped to it.
  ['songbook-marks-harness.js', 'a stroke in the gap is anchored sideways rather than to the nearer line',
    s => s.replace("      var d = dy * 4 + dx;", "      var d = dx;")],
  ['songbook-marks-harness.js', 'the eraser reaches past the end of a stroke',
    s => s.replace("      var t = L ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L)) : 0;",
                   "      var t = L ? ((x - ax) * vx + (y - ay) * vy) / L : 0;")],
  // On paper the box is stretched to the block; a pen that stretched with it
  // would be twice as thick across and hairline down, and a mark on the words
  // under a chord line would be drawn over the chords.
  ['songbook-marks-harness.js', 'the printed pen stretches with the box',
    s => s.replace(' vector-effect="non-scaling-stroke"', '')],
  ['songbook-marks-harness.js', 'a mark on the second line of a block is printed on the first',
    s => s.replace("return r4(f[0]) + ',' + r4((f[1] + line) / span);", "return r4(f[0]) + ',' + r4(f[1] / span);")],
  // A stroke kept in ems must scale both axes by the same font size, from
  // the word's centre; stretching one axis by the box is what scribbled
  // the handwriting on the phone.
  ['songbook-marks-harness.js', 'a stroke is kept from the word\'s corner, not its centre',
    s => s.replace("  function _sbmMarkOrigin(box) { return box.kind === 'token' ? [box.x + box.w / 2, box.y + box.h / 2] : [box.x, box.y]; }",
                   "  function _sbmMarkOrigin(box) { return [box.x, box.y]; }")],
  // Handwriting that runs off a phone's card must come back in, together
  // with the arrow beside it, and about the word -- not off into nothing.
  ['songbook-marks-harness.js', 'a stroke off the card is left to be cut off',
    s => s.replace("        if (q[0] > right && q[0] > ox && ox < right) k = Math.min(k, (right - ox) / (q[0] - ox));", "")],
  ['songbook-marks-harness.js', 'a shrunk stroke drifts from its word',
    s => s.replace("    return pts.map(function(q) { return [origin[0] + (q[0] - origin[0]) * k, origin[1] + (q[1] - origin[1]) * k]; });",
                   "    return pts.map(function(q) { return [q[0] * k, q[1] * k]; });")],
  ['songbook-marks-harness.js', 'a stroke no longer follows the width of its word',
    s => s.replace("    return tool === 'em' ? [w, em] : [w, w];", "    return tool === 'em' ? [w, em] : [em, em];")],
  // A drawing is scaled as a whole, or a ring comes out an egg; an arrow
  // between two words is turned to the line between them, or it points at
  // nothing; and its strokes are told apart by their shape.
  ['songbook-marks-harness.js', 'a ring is drawn as an egg again',
    s => s.replace("    return tool === 'em' ? [w, em] : [w, w];", "    return [w, em];")],
  ['songbook-marks-harness.js', 'an arrow between two words forgets the turn between them',
    s => s.replace("    if (box.kind === 'link') return [box.P[0] + (f[0] * box.cos - f[1] * box.sin) * box.L, box.P[1] + (f[0] * box.sin + f[1] * box.cos) * box.L];",
                   "    if (box.kind === 'link') return [box.P[0] + f[0] * box.L, box.P[1] + f[1] * box.L];")],
  ['songbook-marks-harness.js', 'an underline is taken for a ring',
    s => s.replace("    return Math.hypot(a[0] - z[0], a[1] - z[1]) <= 0.35 * Math.hypot(b[2] - b[0], b[3] - b[1]) + 4;", "    return true;")],
  ['songbook-marks-harness.js', 'an arrowhead no longer lies along its shaft',
    s => s.replace("      if (Math.hypot(P[0] + t * vx - q[0], P[1] + t * vy - q[1]) > tol) return false;", "      if (Math.hypot(P[0] + t * vx - q[0], P[1] + t * vy - q[1]) > 0) return false;")],
  ['songbook-marks-harness.js', 'a stroke drawn beside the last one starts a drawing of its own',
    s => s.replace("  function _sbmBoxesNear(a, b, pad) { return !(b[0] > a[2] + pad || b[2] < a[0] - pad || b[1] > a[3] + pad || b[3] < a[1] - pad); }",
                   "  function _sbmBoxesNear(a, b, pad) { return !(b[0] > a[2] || b[2] < a[0] || b[1] > a[3] || b[3] < a[1]); }")],
  // The phone view is a second copy of the app on production data: every
  // way it could write must stay shut, or opening a panel to LOOK at a
  // song could save over it, announce a phantom user, or post as one.
  ['songbook-phone-harness.js', 'the phone view can delete rows',
    s => s.replace("        ['insert', 'upsert', 'update', 'delete'].forEach(function(m) { if (b && b[m]) b[m] = _lhcDenied; });",
                   "        ['insert', 'upsert', 'update'].forEach(function(m) { if (b && b[m]) b[m] = _lhcDenied; });")],
  ['songbook-phone-harness.js', 'the phone view can call a database function',
    s => s.replace("      if (c.rpc) c.rpc = _lhcDenied;", "")],
  ['songbook-phone-harness.js', 'the phone view uploads through a fresh storage client',
    s => s.replace("      if (desc && desc.get) Object.defineProperty(c, 'storage', { configurable: true, get: function() { return fixStorage(desc.get.call(c)); } });",
                   "      if (desc && desc.get) fixStorage(desc.get.call(c));")],
  ['songbook-phone-harness.js', 'the phone view broadcasts to the songbook\'s channel',
    s => s.replace("          ch.send = function() { return Promise.resolve('ok'); };", "")],
  ['songbook-phone-harness.js', 'the phone view lets a PATCH onto the network',
    s => s.replace("        if (m === 'GET' || m === 'HEAD' || /\\/storage\\/v1\\/object\\/(list|sign)\\//.test(u)) return f.apply(this, arguments);",
                   "        if (m !== 'POST') return f.apply(this, arguments);")],
  ['songbook-phone-harness.js', 'the phone view saves its settings over the desk\'s',
    s => s.replace("      P.setItem = function(k, v) { bag(this)[String(k)] = String(v); };", "")],
  // What a stroke is attached to has to be shown long enough to see, and
  // named right; and the phone view must find the desk's song in a book
  // built from an order, whose item ids differ from load to load.
  // The phone re-measured every row and repainted the canvas ~11 times a
  // second because this took a class off and put it back on every pass.
  // A section's name is the song writer's: a '/' or '>' in it must not cut
  // the key apart and lose every mark on that section.
  ['songbook-marks-harness.js', 'a slash in a section\'s name cuts its marks\' keys apart',
    s => s.replace("      var b = /^(s:[\\s\\S]*?\\|\\d+|l:\\d+)(?:\\/([\\s\\S]*))?$/.exec(x);",
                   "      var b = /^([^\\/]*)(?:\\/([\\s\\S]*))?$/.exec(x);")],
  ['songbook-marks-harness.js', 'a > in a section\'s name is taken for a link',
    s => s.replace("    var ends = k.split(/>(?=[sl]:)/).map(function(x) {", "    var ends = k.split('>').map(function(x) {")],
  // Undo on one song deleted the last stroke of another, in the database,
  // with nothing on the screen to show for it.
  ['songbook-marks-harness.js', 'undo deletes the last stroke of any song',
    s => s.replace("    for (i = D.undo.length - 1; i >= 0; i--) if (D.undo[i].base === base) break;",
                   "    i = D.undo.length - 1;")],
  ['songbook-marks-harness.js', 'undo skips a stroke that is still saving',
    s => s.replace("    if (String(u.local.id).indexOf('tmp_') === 0) {", "    if (false) {")],
  // A chord line too long for a phone's row: set smaller with its words,
  // or the words wrap where the chords do not and the chords float.
  ['songbook-marks-harness.js', 'a chord line too long for the row is left to wrap apart from its words',
    s => s.replace("    var k = Math.min(1, (avail - 2) / (chars * charPx));", "    var k = 1;")],
  ['songbook-marks-harness.js', 'keeping rows alike churns the class and the canvas loops on it',
    s => s.replace("      if (stack !== had) sys.classList.toggle('vl-sys--stack', stack);",
                   "      if (had) sys.classList.remove('vl-sys--stack');\r\n      if (stack) sys.classList.add('vl-sys--stack');")],
  ['songbook-marks-harness.js', 'an arrow ending just under a chord is pinned to a word of that row',
    s => s.replace("    var pool = (at.rowHit && !anyRow) ? at.tokens.filter(function(t) { return t.row === at.rowHit; }) : at.tokens;",
                   "    var pool = at.rowHit ? at.tokens.filter(function(t) { return t.row === at.rowHit; }) : at.tokens;")],
  ['songbook-marks-harness.js', 'the glow is gone before it is seen',
    s => s.replace("    var hold = 1100, fade = 800;", "    var hold = 0, fade = 1;")],
  ['songbook-marks-harness.js', 'an arrow is captioned by its tail alone',
    s => s.replace("    if (ends.length > 1) return 'From ' + one(ends[0]) + ' to ' + one(ends[1]);", "")],
  ['songbook-marks-harness.js', 'the phone view loses the song in a book built from an order',
    s => s.replace("    return same[nth || 0] || same[0] || null;", "    return null;")],
  ['songbook-marks-harness.js', 'a printed stroke between two words loses its ends',
    s => s.replace(`class="sb-mark-svg sb-mark-link" data-a="' + a + '" data-b="' + b + '">`, `class="sb-mark-svg sb-mark-link">`)],
  ['voice-lines-harness.js', 'a chorus sung twice is one anchor',
    s => s.replace("        sectionKey = runs[section] > 1 ? section + '#' + runs[section] : section;",
                   "        sectionKey = section;")],
  ['songbook-marks-harness.js', 'a box with no height takes a stroke',
    s => s.replace("      var b = boxes[i]; if (!b || !(b.h > 0)) continue;", "      var b = boxes[i]; if (!b) continue;")],
  // A rewritten line must raise the banner; a part that could not be read
  // must not, or every hiccup of the network would nag.
  // The songbook poll read the whole order every 2 seconds on every open
  // device; it asks for the last-edited time first, and must not skip a
  // change, or one device's edit never reaches the others.
  ['songbook-live-harness.js', 'the poll reads the whole order every time again',
    s => s.replace("    if (!_sbPollFullRead[oid]) { _sbPollFullRead[oid] = true; return Promise.resolve(true); }",
                   "    return Promise.resolve(true);")],
  ['songbook-live-harness.js', 'the poll skips an order that has changed',
    s => s.replace("      return !(t > 0) || t > _sbLastPollTs;", "      return false;")],
  ['songbook-live-harness.js', 'rewritten lines no longer ask for a refresh',
    s => s.replace("structural: differs('lines') || differs('songs') || differs('book') };", "structural: differs('songs') || differs('book') };")],
  ['songbook-live-harness.js', 'a part that could not be read counts as a change',
    s => s.replace("    var differs = function(k) { return seen[k] !== cur[k] && cur[k] !== 'na' && seen[k] !== 'na'; };",
                   "    var differs = function(k) { return seen[k] !== cur[k]; };")],
  ['songbook-overview-harness.js', 'every extra part gets the same brown again',
    s => s.replace("      out[k] = _SB_PART_PALETTE[i % _SB_PART_PALETTE.length]; i++;",
                   "      out[k] = _SB_PART_PALETTE[0]; i++;")],
  ['voice-lines-harness.js', 'the margin counts on its own, not from lineNumbers',
    s => s.replace("      var at = numbered[gi] || { n: gi + 1, overall: gi + 1, sectionKey: section || '' };",
                   "      var at = { n: gi + 1, overall: gi + 1, sectionKey: section || '' };")],
  // A line's number is its place in its section; forgetting to restart
  // the count at a header numbers the second verse from where the first
  // left off.
  ['voice-lines-harness.js', 'line numbers run on across sections',
    s => s.replace("        section = g.section; n = 0;",
                   "        section = g.section;")],
  ['recordings-harness.js', 'the stamp loses its year',
    s => s.replace("return p(d.getHours()) + ':' + p(d.getMinutes()) + ', ' + d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear();",
                   "return p(d.getHours()) + ':' + p(d.getMinutes()) + ', ' + d.getDate() + ' ' + M[d.getMonth()];")],
  ['voice-lines-harness.js', 'a part change no longer detaches the take',
    s => s.replace("var loose = function(r) { return r.part + '|' + norm(r.text); };",
                   "var loose = function(r) { return norm(r.text); };")],

  // Two recorders write to one table. The songbook panel lists both and
  // must count only its own, or ten takes made in the choir view stop it
  // recording at all -- and it finds out after the singing, so the take is
  // thrown away with the refusal.
  ['recordings-harness.js', 'the limit counts takes the panel did not make',
    s => s.replace("return listEl ? listEl.querySelectorAll('.sb-rec-item:not([data-line-take])').length : 0;",
                   "return listEl ? listEl.querySelectorAll('.sb-rec-item').length : 0;")],
  ['recordings-harness.js', 'a line take is no longer marked as one',
    s => s.replace("var lineMark = (r.line_id != null || r.section) ? ' data-line-take=\"1\"' : '';",
                   "var lineMark = '';")],
  // A section take has no line_id either. Counted as the panel's, ten of
  // them would stop it recording; unmarked, the cap would count them.
  ['recordings-harness.js', 'a section take counts against the panel limit',
    s => s.replace("return r.line_id == null && !r.section; }).length;",
                   "return r.line_id == null; }).length;")],
  ['recordings-harness.js', 'a section take is no longer marked as the choir view',
    s => s.replace("(r.line_id != null || r.section) ? ' data-line-take=",
                   "(r.line_id != null) ? ' data-line-take=")],
  ['recordings-harness.js', 'the counter goes back to counting everything',
    s => s.replace("var ownCount = recs.filter(function(r) { return r.line_id == null && !r.section; }).length;",
                   "var ownCount = recs.length;")],
  // forget() is what stops a deleted take leaving a chip behind that plays
  // nothing. It has to sweep both stores, across every song.
  // One line, not a block: Index.html is CRLF throughout, and a multi-line
  // anchor written with \n matches nothing in it. This went in as a block
  // first and came back STALE.
  // The one that reached live data: a standalone songbook's item id is
  // sbsong_<songId>_<idx>, and chopping it at '--' leaves it whole, so
  // the take is filed against a song that does not exist.
  ['recordings-harness.js', 'the item id is chopped instead of asked',
    s => s.replace("    if (song.songId) return String(song.songId);\r\n", "")],
  ['recordings-harness.js', 'a deleted take is left in the drafts',
    s => s.replace('R._drafts[sid] = R._drafts[sid].filter(function(t) { return String(t.id) !== String(id); });',
                   'R._drafts[sid] = R._drafts[sid];')],

  // The phone songbook. Tapping either of the two choir songs in the
  // contents did nothing: a song showing its choir parts keeps its lyrics
  // page in the document with display:none, and a hidden element measures
  // as all zeros, so the scroll resolved to the top of the book. Three
  // songs out of five worked perfectly, which is why it read as "the
  // first two songs are broken".
  ['songbook-fold-harness.js', 'the contents goes back to the hidden lyrics page',
    s => s.replace('  function _sbVisiblePage(songId) {',
                   "  function _sbVisiblePage(songId) { return document.getElementById('sbPage-' + songId);")],
  // The two skips are not alternatives: one is for a page hidden by a
  // stylesheet rule, the other for a modal that has not been laid out at
  // all. The harness has a fixture for each.
  ['songbook-fold-harness.js', 'a page hidden by a rule is taken as visible',
    s => s.replace('        if (laidOut && el.getClientRects && !el.getClientRects().length) continue;\r\n', '')],
  ['songbook-fold-harness.js', 'display:none stops counting before layout',
    s => s.replace("        if (el.style && el.style.display === 'none') continue;\r\n", '')],
  // Landing under the title bar instead of on it reads as the wrong song.
  ['songbook-fold-harness.js', 'the contents lands on the sheet, not the song',
    s => s.replace("    var unit = (page.closest && page.closest('.sb-song-unit')) || page;",
                   '    var unit = page;')],
  ['songbook-fold-harness.js', 'tapping a folded song leaves it folded',
    s => s.replace('    sbExpandSong(songId);           // a folded song has nothing to scroll to\r\n', '')],
  ['songbook-fold-harness.js', 'the phone book opens with every song unfolded',
    s => s.replace('    if (!(sid in _sbFolded)) _sbFolded[sid] = true;',
                   '    if (!(sid in _sbFolded)) _sbFolded[sid] = false;')],
  ['songbook-fold-harness.js', 'a desktop folds its songs away too',
    s => s.replace("    return !!(window.matchMedia && window.matchMedia('(max-width: 820px)').matches);",
                   '    return true;')],
  // The zoom transform's bottom margin is computed from the wrap's height.
  // Left stale, the book keeps the scroll room of pages it is not showing.
  ['songbook-fold-harness.js', 'the book is not re-measured after folding',
    s => s.replace('    sbApplyZoom();\r\n    if (!folded) sbRedrawSong(sid);',
                   '    if (!folded) sbRedrawSong(sid);')],
  // Folding by display:none would empty every page-break marker's
  // offsetTop to 0 and pile them at the top of the song.
  ['songbook-fold-harness.js', 'folding takes the pages out of the layout',
    s => s.replace('      max-height:0 !important; overflow:hidden !important;',
                   '      display:none !important;')],
  ['songbook-fold-harness.js', 'the contents card goes back to a fluid width',
    s => s.replace('      width:794px; max-width:794px; min-height:0;',
                   '      width:100%; max-width:820px; min-height:0;')],
  // A contents of five songs padded out to A4 is most of a screenful of
  // blank paper to swipe past before the book starts.
  ['songbook-fold-harness.js', 'the contents card is padded out to a full sheet',
    s => s.replace('      width:794px; max-width:794px; min-height:0;',
                   '      width:794px; max-width:794px; min-height:1123px;')],
  // max-height cannot shrink a border-box below its own padding, and the
  // sheet carries 48px under the words.
  ['songbook-fold-harness.js', 'a sliver of blank paper is left under each folded song',
    s => s.replace('      padding:0 !important;\r\n', '')],
  // The chevron on a desktop is a control for folding away a sheet that
  // is already entirely on screen.
  ['songbook-fold-harness.js', 'the fold chevron turns up on the desktop too',
    s => s.replace('  .sb-unit-fold { display:none; }', '  .sb-unit-fold { display:inline-flex; }')],
  // The desktop contents card was never the problem; widening it there
  // would narrow it, since the desktop body is wider than a sheet.
  ['songbook-fold-harness.js', 'the desktop contents card is resized as well',
    s => s.replace('box-shadow:0 2px 16px rgba(0,0,0,0.1); width:100%; max-width:820px; overflow:hidden; }',
                   'box-shadow:0 2px 16px rgba(0,0,0,0.1); width:794px; max-width:794px; overflow:hidden; }')],

  // The control bar. Clipping it is what cut Liturgist Notes and Reset
  // Layout in half, and what made the media badge's dropdown -- absolutely
  // positioned inside that row -- open into the clip and show nothing.
  ['songbook-fold-harness.js', 'the control bar is clipped again',
    s => s.replace('      overflow:visible !important; flex-wrap:wrap !important; }',
                   '      overflow:hidden !important; flex-wrap:wrap !important; }')],
  ['songbook-fold-harness.js', 'the tool rows scroll out of sight instead of wrapping',
    s => s.replace('      flex:1 1 100% !important; flex-wrap:wrap !important; overflow:visible !important;',
                   '      flex:1 1 100% !important; flex-wrap:nowrap !important; overflow:hidden !important;')],
  ['songbook-fold-harness.js', 'the buttons shrink back to slivers',
    s => s.replace('      font-size:.78rem !important; padding:0 12px !important; min-height:36px !important;',
                   '      font-size:.6rem !important; padding:0 12px !important; min-height:28px !important;')],
  ['songbook-fold-harness.js', 'the red media badge leads the row again',
    s => s.replace('  .sb-page-header-btns > .sb-badge-rm-wrap { order: 2; }',
                   '  .sb-page-header-btns > .sb-badge-rm-wrap { order: 0; }')],
  ['songbook-fold-harness.js', 'there is no way back to the contents',
    s => s.replace('class="sb-attach-btn sb-to-index" onclick="WO.sbScrollToIndex()"',
                   'class="sb-attach-btn sb-to-index-x" onclick="WO.sbScrollToIndex()"')],
  // Eleven buttons at a size you can hit came to 305px of controls above
  // the song. Four stay out; the rest are one tap away -- and a desktop,
  // where the row fits on one line, discloses nothing.
  ['songbook-fold-harness.js', 'the occasional tools are back on the phone bar',
    s => s.replace('#songbookLiveModal .sb-page-controls-bar:not(.sb-ctrl-open) .sb-litlog-btn {\r\n      display:none !important; }',
                   '#songbookLiveModal .sb-page-controls-bar:not(.sb-ctrl-open) .sb-litlog-btn {\r\n      opacity:.5 !important; }')],
  ['songbook-fold-harness.js', 'a desktop grows a More button it does not need',
    s => s.replace('  .sb-ctrl-more { display: none !important; }',
                   '  .sb-ctrl-more { display: inline-flex !important; }')],
  ['songbook-fold-harness.js', 'Record is folded away with the occasional tools',
    s => s.replace('"sb-attach-btn sb-rec-cta" onclick="WO.sbOpenRecordings',
                   '"sb-attach-btn sb-rec-cta sb-ctrl-2nd" onclick="WO.sbOpenRecordings')],
  ['songbook-fold-harness.js', 'Attach stays out on the phone bar',
    s => s.replace('"sb-attach-btn sb-ctrl-2nd" onclick="WO.sbAttachFile(',
                   '"sb-attach-btn" onclick="WO.sbAttachFile(')],
  // A fixed element inside a transformed ancestor is positioned against
  // that transform. The songbook has two of them.
  ['songbook-fold-harness.js', 'the media menu goes back to fixed positioning',
    s => s.replace("      drop.style.display = 'flex';\r\n      if (caret) caret.style.transform = 'rotate(180deg)';",
                   "      drop.style.display = 'flex';\r\n      if (caret) caret.style.transform = 'rotate(180deg)';\r\n      var _p = drop.getBoundingClientRect(); drop.style.position = 'fixed';")],
  ['songbook-fold-harness.js', 'closing the others goes back to sweeping the page',
    s => s.replace("    var host = document.querySelector('.sb-page-controls-bar[data-song-id=\"' + songId + '\"]')\r\n            || $('sbPage-' + songId);",
                   "    var host = $('sbPage-' + songId);")],
  ['songbook-fold-harness.js', 'the menu hangs off the pill again',
    s => s.replace('    #songbookLiveModal .sb-badge-wrap { position:static !important; }',
                   '    #songbookLiveModal .sb-badge-wrap { position:relative !important; }')],

  // Getting to the songbooks, which live under seventy-two songs. The
  // branch that matters: on a phone the Songbooks TAB hides the
  // catalogue, so scrolling to a section it has hidden does nothing at
  // all, and does it silently.
  ['songbooks-ribbon-harness.js', 'the phone scrolls to a section its tab has hidden',
    s => s.replace("    if (tab && tab.offsetParent !== null) { switchMobileSongsTab('songbooks'); return; }\r\n", '')],
  ['songbooks-ribbon-harness.js', 'the breakpoint is guessed instead of asked',
    s => s.replace('if (tab && tab.offsetParent !== null) {', 'if (window.innerWidth <= 768) {')],
  ['songbooks-ribbon-harness.js', 'arriving at the foot of the page says nothing',
    s => s.replace("    card.classList.add('sf-sb-landed');\r\n", '')],
  ['songbooks-ribbon-harness.js', 'the two jumps both land on the songbooks',
    s => s.replace("(which === 'orders' ? 'orders-col' : 'songs-col')", "'songs-col'")],
  ['songbooks-ribbon-harness.js', 'the pill counts only the songbooks',
    s => s.replace("    set('sfSongbooksJumpCount', (books || 0) + (orders || 0));",
                   "    set('sfSongbooksJumpCount', (books || 0));")],
  ['songbooks-ribbon-harness.js', 'an empty list is written as a grey zero',
    s => s.replace("if (el) el.textContent = n > 0 ? String(n) : '';", 'if (el) el.textContent = String(n);')],
  ['songbooks-ribbon-harness.js', 'the pill lands after Add Song',
    s => s.replace('<button class="lhc-pill-button" id="sfSongbooksJump"',
                   '<button class="lhc-pill-button" id="sfSongbooksJumpMoved"')],
  // .lhc-card declares no padding on a desktop, so a guessed inset
  // overhung it by 17px each side. Measured before the fix.
  ['songbooks-ribbon-harness.js', 'the band guesses the card its padding again',
    s => s.replace('      margin: 0 0 14px; padding: 11px 16px;',
                   '      margin: -18px -18px 14px; padding: 11px 18px;')],

  // Two columns, asked of the LIST's width. A viewport rule would still
  // say "wide" when the catalogue has become a 400px rail beside an open
  // song, and split the rail down the middle.
  ['songbooks-ribbon-harness.js', 'the split asks the window instead of the list',
    s => s.replace('  @container sfcatalogue (min-width: 1120px) {', '  @media (min-width: 1520px) {')],
  ['songbooks-ribbon-harness.js', 'the card stops being a container to ask',
    s => s.replace('  #songFinderView #sfSongListCard { container-type:inline-size;container-name:sfcatalogue; }\r\n', '')],
  ['songbooks-ribbon-harness.js', 'the two columns stop being even',
    s => s.replace('display:grid;grid-template-columns:1fr 1fr;column-gap:8px;align-items:start;',
                   'display:grid;grid-template-columns:1.4fr 1fr;column-gap:8px;align-items:start;')],
  ['songbooks-ribbon-harness.js', 'an A-Z letter is trapped in one column',
    s => s.replace('    #songFinderView #songListContainer > .song-atlas-section-header { grid-column:1 / -1; }\r\n', '')],
  // 307px of every item is monogram, actions, gaps and padding whatever
  // the width, so below ~1120 the song's name is what gives.
  ['songbooks-ribbon-harness.js', 'the columns split before a title fits in one',
    s => s.replace('@container sfcatalogue (min-width: 1120px)', '@container sfcatalogue (min-width: 820px)')],

  // Opening a roster cell on a phone. A PIC signed in on an iPhone and
  // found that nothing he did to a Live Streaming cell had any effect:
  // the cells answered dblclick alone, which iOS does not dependably
  // send, and the touch shim that existed was wired to scripture cells
  // only. Silent and total -- no error, no toast, and the PIC concludes
  // the system has locked them out.
  ['roster-touch-edit-harness.js', 'the touch shim goes back to scripture cells only',
    s => s.replace('        self._bindDoubleTap(td, onDouble);',
                   "        if (td.hasAttribute('data-ref')) self._bindDoubleTap(td, onDouble);")],
  ['roster-touch-edit-harness.js', 'nothing binds the second tap at all',
    s => s.replace('        self._bindDoubleTap(td, onDouble);', '')],
  ['roster-touch-edit-harness.js', 'two taps are never close enough together',
    s => s.replace('(now - self._tapTime) < 400', '(now - self._tapTime) < 0')],
  // Without this the second tap is a zoom and the editor opens under a
  // page that has just jumped.
  ['roster-touch-edit-harness.js', 'the zoom is left to happen over the editor',
    s => s.replace('          e.preventDefault();\r\n          self._tapCell = null;',
                   '          self._tapCell = null;')],
  // A PIC login does not re-render this table, so an action that
  // captured the mode would keep acting on whichever was in force at the
  // last render -- signing in would appear to do nothing.
  ['roster-touch-edit-harness.js', 'the cell captures PIC mode at bind time',
    s => s.replace('          : function() { if (STATE.picMode) self.editCell(td); };',
                   '          : (function(pm) { return function() { if (pm) self.editCell(td); }; })(STATE.picMode);')],
  ['roster-touch-edit-harness.js', 'the options button swallows the cell edit',
    s => s.replace("        if (e.target && e.target.closest && e.target.closest('.roster-cell-dropdown-icon')) return;\r\n", '')],
  // The toggle buttons are the whole interaction surface on that row;
  // a text editor behind them is a second, conflicting answer.
  ['roster-touch-edit-harness.js', 'the service-type row gets a text editor behind its toggles',
    s => s.replace('        if (isServiceTypeCell) return;', '        if (false) return;')],
  // 7px at 35% opacity is a smudge, not a control -- and it is the route
  // a PIC finds when the gesture does not occur to them.
  ['roster-touch-edit-harness.js', 'the cell menu shrinks back to a smudge',
    s => s.replace('        opacity: 0.55 !important; font-size: 10px !important;\r\n        padding: 5px 6px !important;',
                   '        opacity: 0.35 !important; font-size: 7px !important;')],
  ['roster-touch-edit-harness.js', 'nobody tells a PIC on a phone what the gesture is',
    s => s.replace('<div class="rmp-edit-hint pic-only" id="rmpEditHint">',
                   '<div class="rmp-edit-hint-gone pic-only" id="rmpEditHint">')],
  // Floors, not sizes. The sizes are taste and have moved once already;
  // what must not move is that each of these is something a thumb has to
  // find on a phone.
  ['roster-touch-edit-harness.js', 'the appbar menu shrinks past a thumb',
    s => s.replace('        width: 28px; height: 28px; border-radius: 9px; color: #fff; font-size: 12px;',
                   '        width: 22px; height: 22px; border-radius: 9px; color: #fff; font-size: 12px;')],
  ['roster-touch-edit-harness.js', 'the month arrows shrink past a thumb',
    s => s.replace('        height: 34px; border-radius: 10px; color: #087b63; font-size: 15px;',
                   '        height: 26px; border-radius: 10px; color: #087b63; font-size: 15px;')],
  ['roster-touch-edit-harness.js', 'the view tabs shrink past a thumb',
    s => s.replace('        min-height: 30px; border-radius: 10px; font-size: 10px; font-weight: 800; color: #456158;',
                   '        min-height: 24px; border-radius: 10px; font-size: 10px; font-weight: 800; color: #456158;')],
  // 14px tall is below anything anyone can aim at, and it is the control
  // that sends a whole service to the team.
  ['roster-touch-edit-harness.js', 'the WhatsApp button goes back to 14px',
    s => s.replace('      .roster-share-btn { padding: 5px 9px !important; font-size: 8px !important; }',
                   '      .roster-share-btn { padding: 2px 6px !important; font-size: 8px !important; }')],

  // Showing one part at a time. Each of these leaves a page that still
  // looks like a score, which is the whole reason the checks exist.
  ['voice-lines-harness.js', 'a unison line is filtered away with the other parts',
    s => s.replace("        mine = (k === 'both' || k === 'all' || k === want);",
                   '        mine = (k === want);')],
  ['voice-lines-harness.js', "the chosen part's rests are dropped with everyone else's",
    s => s.replace("        if (p == null) p = ln.getAttribute('data-rest-part');\r\n", '')],
  ['voice-lines-harness.js', 'the filter never puts the other parts back',
    s => s.replace("      ln.classList.toggle('vl-ln--off', !mine);",
                   "      if (!mine) ln.classList.add('vl-ln--off');")],
  ['voice-lines-harness.js', 'the part name is matched raw, spaces and all',
    s => s.replace('    var want = V.partKey(part);\r\n    var all = !want',
                   "    var want = String(part == null ? '' : part);\r\n    var all = !want")],
  ['voice-lines-harness.js', 'a filtered-out line keeps its height',
    s => s.replace('  .vl-ln--off { display: none !important; }',
                   '  .vl-ln--off { visibility: hidden !important; }')],
  ['voice-lines-harness.js', 'the part label goes back to four pixels on a phone',
    s => s.replace('text-overflow: ellipsis; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; font-weight: 800; color: #64748b; background: #eef1f6;',
                   'text-overflow: ellipsis; font-size: 9.5px; letter-spacing: 0.5px; text-transform: uppercase; font-weight: 800; color: #64748b; background: #eef1f6;')],
  ['voice-lines-harness.js', 'the label box and the chord spacer disagree',
    s => s.replace('.vl-who { flex: 0 0 84px; width: 84px;', '.vl-who { flex: 0 0 84px; width: 74px;')],

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
                   '$1.wo-lyrics-NOPE$2')
          // the reading view's own grid, on every screen but the upright phone
          .replace(/(\.wo-lyrics-chord-line,\s*#sbmRoot #sbmLyrics:not\(\.sbm-lyrics--nochords\)\s+)\.wo-lyrics-lyric-line(\s*\{)/g,
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
                   "    return String(ref == null ? '' : ref).replace(/Psalms/, 'Psalm');")],
  // The phone's choir-parts editor. It saves by writing the desktop
  // editor's grammar out and handing it to the same parser, so every one
  // of these produces rows that save cleanly and a page that still looks
  // like a song: a line filed to the wrong part, two moments sung as one,
  // a held vowel printed as a lyric, a second line for a part quietly
  // overwritten by the first.
  ['songbook-editparts-harness.js', "a women's line is saved as everyone's",
    s => s.replace("? 'W: ' : (k === 'men') ? 'M: ' : '[' + l.part + '] '", "? '' : (k === 'men') ? 'M: ' : '[' + l.part + '] '")],
  ['songbook-editparts-harness.js', 'the blank line between moments is dropped, so they merge',
    s => s.replace("out.push(body.join('\\n\\n'));", "out.push(body.join('\\n'));")],
  ['songbook-editparts-harness.js', 'a held note loses its ~',
    s => s.replace("return pre + (l.sustained ? '~' : '') +", "return pre +")],
  ['songbook-editparts-harness.js', 'a second line for the same part is let into the moment',
    s => s.replace("return lk === k || lk === 'both' || k === 'both'; });", "return false; });")],
  ['songbook-editparts-harness.js', 'an empty arrangement is written anyway',
    s => s.replace("if (!parsed.length) { showToast('Nothing to save \\u2014 there are no lines', 'error'); return; }",
                   "if (!parsed.length) { showToast('Nothing to save \\u2014 there are no lines', 'error'); }")],
  ['songbook-editparts-harness.js', 'the rows are not re-read after the write, so the cache keeps invented ids',
    s => s.replace("return window.SBQ_VOICE_LINES.forSong(ed.base);", "return parsed;")],
  ['songbook-editparts-harness.js', 'a failed write closes the editor and loses the edits',
    s => s.replace(/(_sbVoiceLines\[ed\.base\] = fresh \|\| \[\];[\s\S]*?)showToast\('Could not save the choir parts', 'error'\);/,
                   "$1_sbmEdClose(); showToast('Could not save the choir parts', 'error');")],
  // The library's Choir parts tab hands the dialog its rows and takes the
  // text back; the dialog must write nothing of its own in that case.
  ['songbook-editparts-harness.js', "another screen's save is written from here anyway",
    s => s.replace("    if (ed.onSave) {", "    if (false && ed.onSave) {")],
  ['songbook-editparts-harness.js', '"Edit as text" hands over an empty page',
    s => s.replace("    var text = _sbmEdToText(ed), take = ed.onText;", "    var text = '', take = ed.onText;")],
  // What a take is called: after the chip on its line, never "Take take".
  ['recordings-harness.js', "a named part's take is called Take again",
    s => s.replace("var who = String(partName || '').trim() || (part === 'men'", "var who = (part === 'men'")],
  ['recordings-harness.js', 'an imported file loses its name',
    s => s.replace("    if (label) return String(label).replace(/", "    if (false) return String(label).replace(/")],

  // Overview Edit: the arrangement as a pad. Every one of these saves
  // cleanly -- a chord line sung by everyone, a section that took the next
  // section's chords, a section put back without the others, a colour
  // drawn for every song on the screen.
  ['songbook-overview-harness.js', 'a chord line is left in the parts text, sung by everyone',
    s => s.replace(/(chords\.push\(\{ words: _sbmPadWords\(lines\[j\]\), chord: l\.slice\(Math\.min\(pre, lead\)\)\.replace\(\/\\s\+\$\/, ''\) \}\);)\r?\n\s*continue;/, '$1')],
  ['songbook-overview-harness.js', "a section edited on its own takes the next section's chords",
    s => s.replace("      var hit = V.chordFor(index, g, cursor);\r\n      var name = String(g.section || ''), key = name.trim().toLowerCase();",
                   "      var name = String(g.section || ''), key = name.trim().toLowerCase();")
          .replace("      if (want !== null && (key !== want || runs[key] !== wantRun)) return;\r\n",
                   "      if (want !== null && (key !== want || runs[key] !== wantRun)) return;\r\n      var hit = V.chordFor(index, g, cursor);\r\n")],
  ['songbook-overview-harness.js', 'putting one section back drops the others',
    s => s.replace("      if (inTarget) continue;\r\n      out.push(lines[i]);", "      if (inTarget) continue;")],
  ['songbook-overview-harness.js', "a part's colour is drawn for every song on the screen",
    s => s.replace("    var scope = '[data-choir-song=\"' + String(base).replace(/[\"\\\\]/g, '') + '\"] ';", "    var scope = '';")],
  ['songbook-overview-harness.js', 'an unchanged colour map is written on every save',
    s => s.replace("    if (JSON.stringify(_sbPartColours(base)) === JSON.stringify(colours)) return Promise.resolve();", "")],
  // Chords riding on their words, on a phone.
  ['voice-lines-harness.js', "the phone's chords leave their words",
    s => s.replace("          inl = hit ? V._chordShown(hit, o) : '';", "          inl = '';")],
  ['voice-lines-harness.js', 'a chord in the gap before a word lands on the word that has ended',
    s => s.replace("      for (var i = 0; i < words.length; i++) { if (words[i].e > col) { hit = words[i]; break; } }",
                   "      for (var i = 0; i < words.length; i++) { if (words[i].e >= col) { hit = words[i]; break; } }")],
  // Cutting a run-through into line takes. A wav with the wrong byte rate
  // is a file some players refuse; a take numbered as the one before it
  // reads as the same take twice; a flat waveform hides the choir.
  ['songbook-cut-harness.js', 'the wav claims the wrong byte rate',
    s => s.replace("v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);", "v.setUint32(24, rate, true); v.setUint32(28, rate, true);")],
  ['songbook-cut-harness.js', 'a new take takes the number of the one before it',
    s => s.replace("    return label + ' take ' + (Math.max(n, (names || []).length) + 1);", "    return label + ' take ' + Math.max(n, (names || []).length, 1);")],
  ['songbook-cut-harness.js', 'a column of the waveform shows its last sample, not its loudest',
    s => s.replace("      for (var i = a; i < b; i++) { var v = Math.abs(samples[i]); if (v > m) m = v; }", "      for (var i = a; i < b; i++) { m = Math.abs(samples[i]); }")],
  ['songbook-cut-harness.js', 'the clamp flings a span of exactly a breath to the end',
    s => s.replace("function _sbmCutShort(start, end) { return end - start < 0.3 - 1e-9; }",
                   "function _sbmCutShort(start, end) { return end - start < 0.3; }")],
  ['songbook-cut-harness.js', 'the readout reads 0:60.0 at a minute',
    s => s.replace("    var tenths = Math.round(Math.max(0, Number(t) || 0) * 10);",
                   "    var tenths = Math.max(0, Number(t) || 0) * 10;")],
  // The line offered after a save: the next <option> is the other part of
  // the same words, and a melody cut lands the next seconds on it.
  ['songbook-cut-harness.js', 'the next target is the other part of the same moment',
    s => s.replace("    var j = i + 1; while (j < rows.length && same(rows[j], cur)) j++;",
                   "    var j = i + 1;")],
  ['songbook-cut-harness.js', 'the next target forgets which part was being cut',
    s => s.replace("      var mine = wanted ? moment.find(function(r) { return !unison(r) && _sbmRecSlug(key(r)) === wanted; }) : null;",
                   "      var mine = null;")],
  ['songbook-cut-harness.js', 'the next target hands the picker to whoever sings next',
    s => s.replace("      if (mine || all) return (mine || all).id;",
                   "      if (mine || all) return (mine || all).id;\r\n      return moment[0].id;")],
  // A section sung twice is two sections: editing one by name merged them
  // and the save dropped the second; a chord over a held note's moment was
  // never saved; a line opening with a number lost it to the bar column.
  ['songbook-overview-harness.js', 'editing a section sung twice replaces the wrong time through',
    s => s.replace("        inTarget = same && seenRuns === wantRun;", "        inTarget = same;")],
  ['songbook-overview-harness.js', 'the pad shows every time a section is sung as one',
    s => s.replace("      if (want !== null && (key !== want || runs[key] !== wantRun)) return;", "      if (want !== null && key !== want) return;")],
  ['songbook-overview-harness.js', 'a chord over a held note is put back over the held note',
    s => s.replace("        if (chord && ln === lead) { out.push(_sbmPadIndent(t) + chord); chord = ''; }", "        if (chord) { out.push(_sbmPadIndent(t) + chord); chord = ''; }")],
  ['songbook-overview-harness.js', 'a line opening with a number loses it to the bars',
    s => s.replace("  function _sbmAllPrefix(text) { return /^\\s*\\d+\\s*(?:[-\\u2013\\u2014]\\s*\\d+)?\\s+/.test(String(text || '')) ? '[All] ' : ''; }",
                   "  function _sbmAllPrefix(text) { return ''; }")],
  ['songbook-cut-harness.js', 'a take moved to General stays on its line',
    s => s.replace("    if (!hit && isLane) hit = moment.find(function(x) { return V.partFamily(x.part) === 'both'; });",
                   "    if (!hit) hit = moment.find(function(x) { return V.partFamily(x.part) === 'both'; });")],
  ['songbook-cut-harness.js', 'a take on a line everyone sings comes loose when it moves',
    s => s.replace("    if (!hit && isLane) hit = moment.find(function(x) { return V.partFamily(x.part) === 'both'; });", "")],
  ['songbook-cut-harness.js', 'cutting for everyone files the next span under one part',
    s => s.replace("      if (mine || all) return (mine || all).id;",
                   "      if (mine || all) return (mine || all).id;\r\n      if (!wanted) return moment[0].id;")],
  ['songbook-cut-harness.js', 'a move renames a take a person named',
    s => s.replace("    return !s || /^(?:.+ take \\d+|Run-through \\d+|Recording)$/i.test(s);",
                   "    return true;")],
  // A moved take is numbered after the takes it will sit among. Counting a
  // run-through among a section's takes, or a line take among a slot's,
  // gives it a number that reads as the same take twice.
  ['songbook-cut-harness.js', 'a moved section take is numbered across every section in the slot',
    s => s.replace("return x.line_id == null && _sbmRecTok(x.storage_path) === cat && _sbmSecNorm(x.section) === _sbmSecNorm(rec.section);",
                   "return x.line_id == null && _sbmRecTok(x.storage_path) === cat;")],
  ['songbook-cut-harness.js', 'a moved take counts line takes among the slot takes',
    s => s.replace("return x.line_id == null && _sbmRecTok(x.storage_path) === cat && _sbmSecNorm(x.section) === _sbmSecNorm(rec.section);",
                   "return _sbmRecTok(x.storage_path) === cat && _sbmSecNorm(x.section) === _sbmSecNorm(rec.section);")],

  // The order of worship as data. Each of these is a way an edit made in
  // the Liturgy Builder, or a reading put in anywhere, would stop reaching
  // the projection intact -- and every one of them leaves a screen that
  // looks fine until the next time the schedule is drawn.
  //
  // A restored reading planned again from its own joined text: the response
  // is appended once more on every load (one Gospel reached twenty-six).
  ['liturgy-builder-harness.js', 'a restored reading is planned again instead of drawn as saved',
    s => s.replace('      ? _woScriptureFromSaved(scriptureItem.savedSlides)',
                   '      ? _woScriptureSlides(subLabel, title, content, scriptureItem.singAlleluia)')],
  ['liturgy-builder-harness.js', 'a damaged reading keeps all twenty-six of its responses',
    s => s.replace('        if (seen[key]) return;', '        if (false) return;')],
  ['liturgy-builder-harness.js', 'a text box saved away from the schedule is written twice again',
    s => s.replace("              id: item.id || (_oidPfx + 'content_' + sectionId + '_' + sortOrder),",
                   "              id: _oidPfx + 'content_' + sectionId + '_' + sortOrder,")],
  ['liturgy-builder-harness.js', 'a song is placed by its section kind, not by its section',
    s => s.replace('      for (i = 0; i < list.length && !hit; i++) { if (list[i].id === ref) hit = list[i]; }', '')],
  ['liturgy-builder-harness.js', 'capturing the schedule drops the liturgist notes',
    s => s.replace('      _layout.push(Object.assign({}, _prevEntries[sec.id] || {}, {',
                   '      _layout.push(Object.assign({}, {}, {')],
  ['liturgy-builder-harness.js', 'an item listed twice is collected twice again',
    s => s.replace('    return _woUniqueItems(items);', '    return items;')],

  // The Songbook as step 2: medleys, the inbox, the shared song list. Each
  // of these leaves a page that looks right until the second medley, the
  // second copy of a shared link, or the first move past a medley.
  //
  // A song held by two medleys at once: which one it is sung in depends on
  // which the reader happens to look at.
  ['songbook-step-harness.js', 'a song is in two medleys at once',
    s => s.replace('if (byId[id] && !used[id] && ids.indexOf(id) === -1) ids.push(id);',
                   'if (byId[id] && ids.indexOf(id) === -1) ids.push(id);')],
  ['songbook-step-harness.js', "a medley's songs are listed apart",
    s => s.replace('      if (!m) { out.push(s); if (s.id) done[s.id] = true; return; }',
                   '      if (true) { out.push(s); if (s.id) done[s.id] = true; return; }')],
  ['songbook-step-harness.js', 'a song cannot change places inside its medley',
    s => s.replace('    if (u.md && u.items[ii + delta]) {', '    if (false) {')],
  ['songbook-step-harness.js', 'a dropped song splits the medley it lands in',
    s => s.replace('    var units = _woUnits(seq, medleys);\r\n    var loc = function(id) {',
                   '    var units = _woUnits(seq, []);\r\n    var loc = function(id) {')],
  // The localStorage copy of a share carries the address as it was typed;
  // untrimmed, the link a phone shared arrives in the inbox twice.
  ['songbook-step-harness.js', 'a shared link and its stored copy are two items',
    s => s.replace("    if (it.url) return 'u:' + String(it.url).trim();", "    if (it.url) return 'u:' + String(it.url);")],
  ['songbook-step-harness.js', "moving a link takes the song's own copy with it",
    s => s.replace('return !(d && d.url === url && d.inboxId === item.id);',
                   'return !(d && d.url === url && (!d.inboxId || d.inboxId === item.id));')],
  ['songbook-step-harness.js', 'the shared list loses its section headings',
    s => s.replace("        if (r.section) lines.push('*' + r.section + '*');", '')],
  // close() clears the pending share; set before it, the link never arrived.
  ['songbook-step-harness.js', "the share picker's Send drops the link it sends",
    s => s.replace(/(close\(\);\r?\n(?:\s*\/\/.*\r?\n)*)\s*window\._pendingShareItem = item;\r?\n/, '$1')],
  ['songbook-step-harness.js', 'the Songbook lists a medley apart',
    s => s.replace('    return _woRunWithMedleys(sorted, _woMedleys());', '    return sorted;')],
  ['songbook-step-harness.js', "the builder's undo forgets medleys",
    s => s.replace('      medleys: JSON.stringify((o.template && o.template.medleys) || []),\r\n', '')],
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
