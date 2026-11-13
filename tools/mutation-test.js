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
//   route-url-guard-harness    reads route files too
//   scan-text-tests            reads app/api/parse-song-sheet/route.ts
//   multipage-scan-harness     its route section, for the same reason
//
// Three more have no case here and are not in `npm run check` either, so
// nothing runs them at all, let alone mutates them: autosuggest-skip,
// duty-pairing and duty-settings-audit. That is a different gap from this
// one and is not fixed by adding cases.
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

// Four harnesses that ran on every commit with nothing proving they could
// fail. Each anchor below is the one line carrying the behaviour its harness
// is there to defend, so breaking it breaks a check rather than a signature.
const BRAND_GREEN = '--brand: #188e44;';
const WATCHNIGHT_KEY = "dateStr:'Dec 31 PM'";
const SHUFFLE_SALT = 'var _shuffleSalt = Math.random()';
const SHUFFLE_HASH = 'var h = 2166136261 ^ Math.floor(_shuffleSalt * 4294967295);';
const PAIRING_ANSWERED = '      if (answered) return;';

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
    s => s.replace('chordRow = V._chordRow(hit, over, !!o.chordEdit && !!hit, !!o.chordEdit, o);',
                   'chordRow = V._chordRow(hit, over, !!o.chordEdit, !!o.chordEdit, o);')],
  // Both found in real use, on a song somebody was actually writing.
  ['voice-lines-harness.js', 'the colon after a part name goes into the lyric again',
    s => s.replace('var br = /^\\[([^\\]]+)\\]\\s*:?\\s*/.exec(s);',
                   'var br = /^\\[([^\\]]+)\\]\\s*/.exec(s);')],
  ['voice-lines-harness.js', 'a part named in one section is drawn over the whole song',
    s => s.replace("var laneList = lanesBySection[g.section || ''] || [];",
                   'var laneList = V.lanes(lines);')],
  ['voice-lines-harness.js', 'a named part is read as lyrics instead',
    s => s.replace('var br = /^\\[([^\\]]+)\\]\\s*:?\\s*/.exec(s);', 'var br = null;')],

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
    s => s.replace("    for (i = D.undo.length - 1; i >= 0; i--) if (shown.indexOf(D.undo[i].base) !== -1) break;",
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
    s => s.replace("      return v !== 'same';", "      return false;")],
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

  // What Browse online searches for: the song, its artist, and the word
  // that turns a song into a chord sheet.
  ['songbook-live-harness.js', 'the search forgets the word chords',
    s => s.replace("            String((song && song.artist) || '').trim(), 'chords']",
                   "            String((song && song.artist) || '').trim()]")],
  ['songbook-live-harness.js', 'the search forgets the artist',
    s => s.replace("    return [String((song && song.title) || '').trim(),\r\n            String((song && song.artist) || '').trim(), 'chords']",
                   "    return [String((song && song.title) || '').trim(), 'chords']")],
  ['songbook-live-harness.js', 'an absent artist leaves a gap in the search',
    s => s.replace('      .filter(Boolean).join(\' \');', "      .join(' ');")],
  // ── The Sunday bulletin ──────────────────────────────────────────
  // It is printed, handed out, and never checked against the roster
  // again, so every one of these is a wrong name on a real page.
  // The page is a fixed A4 box, so anything that does not fit is simply
  // gone -- and only on paper, where nobody looks before Sunday.
  // Placeholders belong to the editor. Unscoped, an un-typed theme verse
  // printed the words "The theme verse" across the masthead.
  // ── A change reaching a projection already running ───────────────
  // Every one of these is a screen a congregation is looking at.
  // Every keystroke in the builder reaching a running projection is what
  // the operator asked to stop: half a line in front of a congregation.
  ['live-projection-harness.js', 'a half-written line reaches the wall again',
    s => s.replace('      if (_lbdTypingHeld(res.template && res.template.lbdTyping, _edClientId, Date.now())) return;\r\n', '')],
  ['live-projection-harness.js', 'the hold is asked only after the diff is worked out',
    s => s.replace('      if (_lbdTypingHeld(res.template && res.template.lbdTyping, _edClientId, Date.now())) return;\r\n', '')
          .replace('      var seen = _orderSyncSeen[oid];',
                   '      if (_lbdTypingHeld(res.template && res.template.lbdTyping, _edClientId, Date.now())) return;\r\n      var seen = _orderSyncSeen[oid];')],
  // A mark nobody comes back to would freeze the order for everybody.
  ['live-projection-harness.js', 'a mark left behind holds the order for ever',
    s => s.replace('    return (now - mark.at) < LBD_TYPING_HOLD;', '    return true;')],
  ['live-projection-harness.js', 'the hold is cut to a couple of seconds',
    s => s.replace('  var LBD_TYPING_HOLD = 180000;', '  var LBD_TYPING_HOLD = 2000;')],
  ['live-projection-harness.js', 'our own typing holds our own screen',
    s => s.replace('    if (mark.by && me && mark.by === me) return false;   // our own typing', '')],
  // The mark has to be written by the save, or it goes stale while the
  // typing is still going on and the words escape mid-sentence.
  ['live-projection-harness.js', 'the mark is never stamped by a save',
    s => s.replace('    _lbdMarkTyping();\r\n', '')],
  ['live-projection-harness.js', 'the mark is never taken off again',
    s => s.replace('    if (t.lbdTyping) delete t.lbdTyping;', '')],
  // A section title is not the congregation's words.
  ['live-projection-harness.js', 'a title or a search box counts as typing',
    s => s.replace("    return f === 'slide' || f === 'content-text';", '    return !!f;')],
  ['live-projection-harness.js', 'anything focused anywhere on the page counts',
    s => s.replace('    if (!host || !ae || !host.contains(ae) || !ae.isContentEditable) return false;',
                   '    if (!host || !ae) return false;')],
  // Done has to save at once: until the save lands, every other screen is
  // still holding the words back.
  ['live-projection-harness.js', 'Done does not confirm anything',
    s => s.replace('    if (_lbdWasTyping && !typingNow) { _lbdWasTyping = false; _lbdConfirmTyping(); }', '')],
  ['live-projection-harness.js', 'leaving the words is decided by a different question',
    s => s.replace('    var typingNow = _lbdTypingNow();', "    var typingNow = !!f;")],
  ['live-projection-harness.js', 'the confirmed words wait out the autosave',
    s => s.replace('    clearTimeout(_autoSaveTimer);\r\n    _autoSaveTimer = null;\r\n    saveCurrentOrder(true);',
                   '    autoSaveOrder();')],
  ['live-projection-harness.js', 'a songbook pseudo-order is saved as a service',
    s => s.replace('    if (!currentOrderData || _sbStandaloneId) return;\r\n    if (!currentOrderData.template || !currentOrderData.template.lbdTyping) return;',
                   '    if (!currentOrderData) return;\r\n    if (!currentOrderData.template || !currentOrderData.template.lbdTyping) return;')],
  // The bug itself: the words changed everywhere except the one place a
  // congregation reads them.
  // Through _sbSlidesFollow since 2026-11-12 (gotcha 93).
  ['live-projection-harness.js', 'saving the words leaves the slides as they were',
    s => s.replace('    // running projection, so the slide is sent again (gotcha 82).\r\n    _sbSlidesFollow(song, before);\r\n', '    // running projection, so the slide is sent again (gotcha 82).\r\n')],
  ['live-projection-harness.js', 'the rebuild runs after the save that reads the DOM',
    s => s.replace('    // running projection, so the slide is sent again (gotcha 82).\r\n    _sbSlidesFollow(song, before);\r\n', '    // running projection, so the slide is sent again (gotcha 82).\r\n')
          .replace('    renderSongbookLive();\r\n  }\r\n  // The editor closed',
                   '    renderSongbookLive();\r\n    _sbSlidesFollow(song, before);\r\n  }\r\n  // The editor closed')],
  ['live-projection-harness.js', 'the wall is not sent the slide again',
    s => s.replace("    if (typeof _lcdReproject === 'function') { try { _lcdReproject(); } catch (e) {} }", '')],
  // song.lyrics here is the Songbook's own words, chords and all.
  ['live-projection-harness.js', 'the rebuild takes the Songbook chords away',
    s => s.replace('    refreshSongSlidesInOrder(song.id, now, { keepLyrics: true });',
                   '    refreshSongSlidesInOrder(song.id, now);')],
  ['live-projection-harness.js', 'keepLyrics is accepted and ignored',
    s => s.replace('    if (!(opts && opts.keepLyrics)) song.lyrics = newLyrics;', '    song.lyrics = newLyrics;')],
  // A heading the operator typed is not the parser's to throw away.
  ['live-projection-harness.js', 'a typed heading is lost on every re-split',
    s => s.replace("               header: slide.header || was.header || '', background: was.background || '' };",
                   "               header: slide.header || '', background: was.background || '' };")],
  ['live-projection-harness.js', 'the slide background is lost with it',
    s => s.replace("               header: slide.header || was.header || '', background: was.background || '' };",
                   "               header: slide.header || was.header || '', background: '' };")],
  // A chord line on the wall is sheet music in front of a congregation.
  ['live-projection-harness.js', 'the chords go up with the words',
    s => s.replace('      return !line.trim() || !isChordLineGlobal(line);', '      return true;')],
  ['live-projection-harness.js', 'the blank lines go, and the slides break elsewhere',
    s => s.replace('      return !line.trim() || !isChordLineGlobal(line);', '      return !!line.trim() && !isChordLineGlobal(line);')],
  // "Am" is also the word "am", and both of these are real lyrics.
  ['live-projection-harness.js', 'a looser test eats "Am I not still the same"',
    s => s.replace('      return !line.trim() || !isChordLineGlobal(line);', '      return !line.trim() || !/^[A-G]/.test(line.trim());')],
  ['live-projection-harness.js', 'with no detector the words are dropped instead of kept',
    s => s.replace("    if (typeof isChordLineGlobal !== 'function') return lines.join('\\n');", '')],
  // The operator's own report: a chord written with the MUSIC SHARP SIGN
  // was not recognised at all.
  ['lyrics-editor-harness.js', 'the sharp sign is not read as a sharp',
    s => s.replace("  return String(text == null ? '' : text).replace(/\\u266f/g, '#').replace(/\\u266d/g, 'b');", "  return String(text == null ? '' : text);")],
  ['lyrics-editor-harness.js', 'the flat sign is left alone',
    s => s.replace(".replace(/\\u266d/g, 'b');", ';')],
  // Worse than not recognising it: recognising it and moving it wrongly.
  ['lyrics-editor-harness.js', 'a sharp-sign chord transposes a semitone out',
    s => s.replace('  chord = lhcChordAscii(chord);\r\n  var match = chord.match', '  var match = chord.match')],
  ['lyrics-editor-harness.js', 'the token test reads the raw token',
    s => s.replace("  var t = lhcChordAscii(tok).replace(/[()|\\-:.]/g, '');", "  var t = (tok || '').replace(/[()|\\-:.]/g, '');")],
  // The pad: --sb was doing the look AND the hiding, so the song form
  // could not have one without the other.
  ['lyrics-editor-harness.js', 'the song form goes back to the plain dark pad',
    s => s.replace("    modal.classList.add('lyrics-editor-modal--sheet');\r\n  }", '  }')],
  ['lyrics-editor-harness.js', 'the Songbook loses the look it had',
    s => s.replace("    modal.classList.add('lyrics-editor-modal--sb');\r\n    modal.classList.add('lyrics-editor-modal--sheet');",
                   "    modal.classList.add('lyrics-editor-modal--sb');")],
  ['lyrics-editor-harness.js', 'the look goes back onto --sb, hiding the preview with it',
    s => s.replace('.lyrics-editor-modal--sheet .lyrics-rich-editor', '.lyrics-editor-modal--sb .lyrics-rich-editor')],
  // The preview: a second opinion about where a slide ends.
  ['lyrics-editor-harness.js', 'the preview cuts its own slides again',
    s => s.replace('  var fromLcd = _lyrSlidesFromLcd(text, getSectionType);', '  var fromLcd = null;')],
  ['lyrics-editor-harness.js', 'the splitter is not lent out',
    s => s.replace('\r\n    parseLyricsIntoSlides: parseLyricsIntoSlides,', '')],
  ['lyrics-editor-harness.js', 'the renderer is not lent out',
    s => s.replace('\r\n    projectionHtml: _projectionHtml,', '')],
  ['lyrics-editor-harness.js', 'the words are drawn by a copy of the rules',
    s => s.replace('    ? WO.projectionHtml(words)\r\n    : esc(words);', '    ? esc(words)\r\n    : esc(words);')],
  // A heading is never projected (gotcha 73).
  ['lyrics-editor-harness.js', 'the heading is drawn inside the slide',
    s => s.replace("'<div class=\"wo-preview-inner\">' + body + '</div>' +",
                   "'<div class=\"wo-preview-inner\"><span class=\"slide-header\"></span>' + body + '</div>' +")],
  // A long word with no space ran off the wall before gotcha 75.
  ['lyrics-editor-harness.js', 'a long word can run off the preview screen',
    s => s.replace('  .lyr-preview-screen .wo-preview-inner { max-width: 100%; overflow-wrap: break-word; text-align: center; }',
                   '  .lyr-preview-screen .wo-preview-inner { text-align: center; }')],
  // Presenting from the overlay was not counted as being on air at all --
  // measured: overlayShown true, fullscreenElement false, _lcdOnAir() false.
  ['live-projection-harness.js', 'presenting from the overlay is not on air',
    s => s.replace("    if (ovl && ovl.classList.contains('show')) return true;", '    if (false) return true;')],
  ['live-projection-harness.js', 'the notice may cross a windowed presenter overlay',
    s => s.replace("    if (povl && povl.classList.contains('show')) return true;", '    if (false) return true;')],
  // The overlay reads DOM nodes captured when Project was pressed; the
  // redraw replaces them, so without a repaint it shows the old words.
  ['live-projection-harness.js', 'the overlay is left on the nodes it captured',
    s => s.replace('    if (_wofsRefresh()) return true;\r\n', '')],
  ['live-projection-harness.js', 'the repaint comes after the already-projected shortcut',
    s => s.replace('    if (_wofsRefresh()) return true;\r\n', '')
          .replace('    _lcdProjected = text;\r\n    updateProjectionPreview',
                   '    _lcdProjected = text;\r\n    if (_wofsRefresh()) return true;\r\n    updateProjectionPreview')],
  ['live-projection-harness.js', 'the overlay is repainted even while it is closed',
    s => s.replace("    if (!overlay || !overlay.classList.contains('show')) return false;", '    if (!overlay) return false;')],
  ['live-projection-harness.js', 'the rebuilt list is never put back',
    s => s.replace('    _wofsSlides = rebuilt;\r\n', '')],
  // Landing on the same index jumps the congregation when a slide above
  // the one being shown was added or removed.
  ['live-projection-harness.js', 'the overlay lands on the same index, not the same slide',
    s => s.replace('    var at = wasKey ? _wofsKeys(rebuilt).indexOf(wasKey) : -1;', '    var at = -1;')],
  ['live-projection-harness.js', 'the slide list is not rebuilt from the page at all',
    s => s.replace('    var rebuilt = _buildWofsSlides();', '    var rebuilt = _wofsSlides;')],
  // A key that cannot tell one slide of a song from the next finds the
  // wrong one; a count that runs across the service never finds it again.
  ['live-projection-harness.js', 'every slide of one item gets the same key',
    s => s.replace("      return 'box:' + k + ':' + n;", "      return 'box:' + k;")],
  ['live-projection-harness.js', 'the slide count runs across the whole service',
    s => s.replace('      var n = seen[k] = (seen[k] || 0) + 1;', '      var n = seen.__all = (seen.__all || 0) + 1;')],
  ['live-projection-harness.js', 'a sermon slide forgets which page it is',
    s => s.replace("      if (e.type === 'ppt') return 'ppt:' + (e.sectionId || '') + ':' + e.slideIndex;",
                   "      if (e.type === 'ppt') return 'ppt:' + (e.sectionId || '');")],
  // The tick never ran at all: #worshipOrderView is position:fixed in Full
  // Screen, and offsetParent is null for a fixed element.
  ['live-projection-harness.js', 'the sync never runs during a projection at all',
    s => s.replace('    if (!view || !view.getClientRects().length) return;', '    if (!view || view.offsetParent === null) return;')],
  ['live-projection-harness.js', 'a hidden tab stops syncing while the wall is lit',
    s => s.replace("        !(typeof _lcdOnAir === 'function' && _lcdOnAir())) return;", '        true) return;')],
  ['live-projection-harness.js', 'the on-air call throws if the blocks are split',
    s => s.replace("!(typeof _lcdOnAir === 'function' && _lcdOnAir())", '!_lcdOnAir()')],
  // The selected item IS the projected one, so deferring it made the
  // operator's exact case the one case that could never apply.
  ['live-projection-harness.js', 'an edit to the projecting slide is deferred again',
    s => s.replace('          (loc && (!_ORDER_SYNC_REMOVABLE[loc.kind] || loc.unaddressable))) {',
                   '          (loc && (!_ORDER_SYNC_REMOVABLE[loc.kind] || loc.unaddressable)) ||\r\n          (selKey && loc && loc.domKey === selKey)) {')],
  // Removing the slide on the wall is different: it would leave nothing.
  ['live-projection-harness.js', 'the projecting slide can be yanked out from under the wall',
    s => s.replace('          (selKey && loc.domKey === selKey)) {', '          false) {')],
  // A redraw replaces the nodes, and the selection goes with them.
  ['live-projection-harness.js', 'the projection is lost when its slide is redrawn',
    s => s.replace('    _orderSyncRestoreLive(liveSel);', '')],
  ['live-projection-harness.js', 'nothing is remembered to put back',
    s => s.replace('    var liveSel = _orderSyncRememberLive();', '    var liveSel = null;')],
  ['live-projection-harness.js', 'the slide is put back without being projected',
    s => s.replace('    try { selectSlideBox(box); } catch (e) { return false; }', "    try { box.classList.add('selected'); } catch (e) { return false; }")],
  ['live-projection-harness.js', 'the same slide is re-selected over and over',
    s => s.replace("    if (!box || box.classList.contains('selected')) return false;", '    if (!box) return false;')],
  ['live-projection-harness.js', 'the rail jumps to the top on every change',
    s => s.replace("    if (typeof _lcdRailHoldScroll === 'function') _lcdRailHoldScroll();", '')],
  ['live-projection-harness.js', 'projecting stands the sync down again, as it did',
    s => s.replace('    if (_lbdIsActive()) return true;', '    if (_orderSyncProjecting()) return true;\r\n    if (_lbdIsActive()) return true;')],
  // The worse of the two failures: the operator's list says it is done
  // while the wall keeps the old words.
  ['live-projection-harness.js', 'the schedule updates but the wall does not',
    s => s.replace('        try { _lcdReproject(); } catch (e) { console.warn(\'[OrderSync] reproject:\', e); }', '')],
  ['live-projection-harness.js', 'a half-typed line goes up in front of the church',
    s => s.replace("    if (content.querySelector('textarea')) return false;", '')],
  ['live-projection-harness.js', 'the wall is re-sent words it is already showing',
    s => s.replace('    if (text === _lcdProjected) return false;', '')],
  // The operator projects through the Project button's own window, which
  // leaves this page out of fullscreen entirely.
  ['live-projection-harness.js', 'only fullscreen counts as being on air',
    s => s.replace('      if (typeof projectionWindow !== \'undefined\' && projectionWindow && !projectionWindow.closed) return true;', '')],
  ['live-projection-harness.js', 'a device in LCD Projection never subscribes',
    s => s.replace('      try { sbStartRealtimeSync(); } catch (e) { /* the poll still covers it */ }', '')],
  ['live-projection-harness.js', 'a second channel is opened over a live one',
    s => s.replace("        typeof sbRealtimeChannel !== 'undefined' && !sbRealtimeChannel) {", '        true) {')],
  ['live-projection-harness.js', 'a save no longer tells the other devices',
    s => s.replace('        try { if (window._orderTouchSend) window._orderTouchSend(id); } catch (e) {}', '')],
  ['live-projection-harness.js', 'the nudge is not listened for',
    s => s.replace("      .on('broadcast', { event: 'order_touch' }, function(msg) {", "      .on('broadcast', { event: 'zz_never' }, function(msg) {")],
  // A tick must see a difference twice before it trusts it, so one nudge
  // alone would only ever arm the check.
  ['live-projection-harness.js', 'a nudge only arms the check and never fires it',
    s => s.replace('          setTimeout(function() { _orderSyncTick(); }, 700);', '')],
  ['live-projection-harness.js', 'the poll fallback is taken away',
    s => s.replace('var ORDER_SYNC_MS = 4000;', 'var ORDER_SYNC_MS = 400000;')],
  // The editor's own placeholder once went up in front of a church.
  ['live-projection-harness.js', 'the editor placeholder can reach the wall again',
    s => s.replace("           el.textContent.trim() !== 'Double-click to add content';", '           true;')],
  ['live-projection-harness.js', 'the rail preview and the wall disagree about what counts',
    s => s.replace('      .filter(_lcdIsSlideLine)\r\n      .map(function(l) { return l.textContent.trim(); })', '      .map(function(l) { return l.textContent.trim(); })')],
  // The app's own chrome must never appear on a projected screen.
  ['live-projection-harness.js', 'a banner shows over a live projection',
    s => s.replace('    if (_orderSyncProjecting()) return;', '')],

  // An auto LEFT margin against a fixed RIGHT one pushes a box right, so
  // the bulletin sat off-centre at every zoom.
  ['bulletin-harness.js', 'the page is pushed off centre again',
    s => s.replace("      box.style.width = Math.round(A4_W * scale) + 'px';",
                   "      stage.style.marginRight = (A4_W * scale - A4_W) + 'px';")],
  // The sanitiser is the only thing between a stored row and the page.
  ['bulletin-harness.js', 'an image is allowed back into a typed field',
    s => s.replace('var RICH_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, SPAN: 1 };',
                   'var RICH_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, SPAN: 1, IMG: 1 };')],
  ['bulletin-harness.js', 'typed text is written back as markup, not words',
    s => s.replace('if (c.nodeType === 3) { out += _esc(c.nodeValue); continue; }',
                   'if (c.nodeType === 3) { out += c.nodeValue; continue; }')],
  ['bulletin-harness.js', 'any style at all survives a save',
    s => s.replace("  var RICH_STYLES = ['color', 'fontFamily', 'fontWeight', 'fontStyle', 'textDecoration'];",
                   "  var RICH_STYLES = ['color', 'fontFamily', 'fontWeight', 'fontStyle', 'textDecoration', 'background', 'fontSize'];")],
  ['bulletin-harness.js', 'a pasted block becomes a block on the bulletin',
    s => s.replace("      if (tag === 'DIV' || tag === 'P') {", "      if (false) {")],
  // Undo: a run of typing has to be one step, and what comes back off
  // the stack has to go through the same reader as a stored row.
  ['bulletin-harness.js', 'undoing one Bold takes two presses',
    s => s.replace('if (_applying) return;', 'if (false) return;')],
  ['bulletin-harness.js', 'the applying flag is never put down',
    s => s.replace('} catch (e) { return; } finally { _applying = false; }', '} catch (e) { return; }')],
  ['bulletin-harness.js', 'undo walks back one character at a time',
    s => s.replace('if (_typeSnap == null || now - _typeAt > 1400) {', 'if (true) {')],
  ['bulletin-harness.js', 'the undo snapshot is taken after the keystroke',
    s => s.replace("      _noteTyping();\r\n      _setPath(_cur.data, el.dataset.p,",
                   "      _setPath(_cur.data, el.dataset.p,")],
  ['bulletin-harness.js', 'an undone bulletin skips the reader a load uses',
    s => s.replace('_cur.data = _sane(JSON.parse(_undo.pop()));', '_cur.data = JSON.parse(_undo.pop());')],
  ['bulletin-harness.js', 'the undo history grows without bound',
    s => s.replace('var UNDO_MAX = 60;', 'var UNDO_MAX = Infinity;')],
  ['bulletin-harness.js', 'another bulletin inherits the last one\'s history',
    s => s.replace('      _undo.length = 0; _redo.length = 0; _typeSnap = null;', '')],
  // A QR travels inside the bulletin row, so what goes in must be an
  // image and nothing else.
  // The slot opened a picker all along; nobody could tell it was a button.
  // Three fixed columns with no colgroup split evenly, so short duty
  // labels had as much room as cells holding three names.
  ['bulletin-harness.js', 'the duty labels take back the names\' width',
    s => s.replace('<colgroup><col style="width:28%"><col style="width:36%"><col style="width:36%"></colgroup>', '')],
  ['bulletin-harness.js', 'the duty column becomes the widest of the three',
    s => s.replace('<col style="width:28%"><col style="width:36%"><col style="width:36%">',
                   '<col style="width:50%"><col style="width:25%"><col style="width:25%">')],
  // The dialogue is the whole point: the sheet is 10px type.
  // Two ways to write one field is two code paths for it, and the
  // in-place one was 10px type nobody could aim at on a phone.
  ['bulletin-harness.js', 'the sheet becomes editable again',
    s => s.replace('    return \'<span class="blt-view \' + (cls || \'\') + \'" \' +',
                   '    return \'<span class="blt-view \' + (cls || \'\') + \'" contenteditable="true" \' +')],
  ['bulletin-harness.js', 'the form\'s own fields stop being editable',
    s => s.replace('contenteditable="\' + (f.rich ? \'true\' : \'plaintext-only\') + \'"',
                   'data-was-editable="\' + (f.rich ? \'true\' : \'plaintext-only\') + \'"')],
  // dblclick never fires on a phone: a double tap is a zoom and the
  // browser keeps it. Desktop-only here leaves the form unreachable on
  // the phones this is mostly read on.
  ['bulletin-harness.js', 'the form is unreachable on a phone',
    s => s.replace("      el.addEventListener('touchend', function(e) {", '      if (1) return; el.addEventListener(\'touchend\', function(e) {')],
  ['bulletin-harness.js', 'the second tap zooms the page instead of opening the form',
    s => s.replace('          e.preventDefault();          // or the second tap is a zoom', '')],
  ['bulletin-harness.js', 'the tap listener is passive and cannot stop the zoom',
    s => s.replace('      }, { passive: false });', '      });')],
  ['bulletin-harness.js', 'two taps a second apart count as a double tap',
    s => s.replace('(now - _tapAt) < 400', '(now - _tapAt) < 4000')],
  ['bulletin-harness.js', 'a block stops saying which form it opens',
    s => s.replace("_secAttr('giving')", "''")],
  ['bulletin-harness.js', 'a redraw leaves every block dead',
    s => s.replace('    _bindOpeners();', '')],
  ['bulletin-harness.js', 'tapping the QR slot opens the form over it',
    s => s.replace("        if (e.target && e.target.closest && e.target.closest('.blt-qr, .blt-x, .blt-add, .blt-pen')) return;\r\n        var now = Date.now();",
                   '        var now = Date.now();')],
  ['bulletin-harness.js', 'the pencil never appears on a touch screen',
    s => s.replace('@media (hover: none) { .blt-pen { opacity: .9; } }', '')],
  // Asked for explicitly: the middle of the screen, not the bottom.
  ['bulletin-harness.js', 'the form slides up from the bottom again',
    s => s.replace('  display: flex; align-items: center; justify-content: center; padding: 14px;',
                   '  display: flex; align-items: flex-end; justify-content: center;')],
  ['bulletin-harness.js', 'the form keeps its bottom-sheet corners',
    s => s.replace('  border-radius: 16px; display: flex; flex-direction: column;',
                   '  border-radius: 16px 16px 0 0; display: flex; flex-direction: column;')],
  ['bulletin-harness.js', 'a section can no longer be opened to edit it',
    s => s.replace('    verse: { title: ', '    zz_verse: { title: ')],
  ['bulletin-harness.js', 'the dialogue adds items its own way',
    s => s.replace('function dlgAdd(what) { addItem(what); _dlgRefresh(); }',
                   'function dlgAdd(what) { _cur.data.notices.push({}); _dlgRefresh(); }')],
  ['bulletin-harness.js', 'the dialogue removes items its own way',
    s => s.replace('function dlgRemove(what, i) { removeItem(what, i); _dlgRefresh(); }',
                   'function dlgRemove(what, i) { _cur.data.notices.splice(i, 1); _dlgRefresh(); }')],
  ['bulletin-harness.js', 'a list no longer says what kind of item it holds',
    s => s.replace("addKey: 'notice', ", '')],
  ['bulletin-harness.js', 'the page behind the dialogue stops moving as you type',
    s => s.replace('      _dlgPaint = setTimeout(function() { render(); }, 220);', '')],
  ['bulletin-harness.js', 'the formatting bar leaves the dialogue',
    s => s.replace("'<div class=\"blt-dlg__bar\">' +", "'' +")],
  ['bulletin-harness.js', 'the dialogue cannot be dismissed',
    s => s.replace("      if (e.key === 'Escape') { e.preventDefault(); closeSection(); return; }", '')],
  ['bulletin-harness.js', 'the edit pencils print on the bulletin',
    s => s.replace('.blt-capturing .blt-pen { display: none !important; }', '')],
  // A phone fitting A4 to its width lands near 45%.
  ['bulletin-harness.js', 'a phone opens at a size nobody can read',
    s => s.replace('var PHONE_ZOOM = 0.87;', 'var PHONE_ZOOM = 0.45;')],
  ['bulletin-harness.js', 'the phone zoom is forced on every visit',
    s => s.replace('if (_zoom == null && _isPhone()) _zoom = PHONE_ZOOM;', 'if (_isPhone()) _zoom = PHONE_ZOOM;')],
  ['bulletin-harness.js', 'a tablet with a coarse pointer is not treated as one',
    s => s.replace("      (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);", '      false;')],
  ['bulletin-harness.js', 'a phone opens in the middle of the duty table',
    s => s.replace('      sc.scrollLeft = 0; sc._bltScrolled = true;', '')],
  ['bulletin-harness.js', 'the QR slot reads as a placeholder again',
    s => s.replace('<span>Add QR</span>', '<span>QR code</span>')],
  ['bulletin-harness.js', 'the slot stops saying what it does on hover',
    s => s.replace('title="Choose a QR picture, or drop or paste one here"', '')],
  // A QR copied out of a banking app is on the clipboard, not in a file.
  ['bulletin-harness.js', 'a QR can no longer be dropped on the slot',
    s => s.replace('ondrop="BLT.dropQr(event,', 'data-nodrop="(')],
  ['bulletin-harness.js', 'a dropped picture navigates the page away instead',
    s => s.replace('  function dropQr(ev, i) {', '  function dropQr(ev, i) { if (1) return;')],
  ['bulletin-harness.js', 'a QR can no longer be pasted',
    s => s.replace("document.addEventListener('paste', _qrPaste);", '')],
  ['bulletin-harness.js', 'a paste no longer knows which slot it is for',
    s => s.replace("var slot = a && a.closest ? a.closest('.blt-qr') : null;", 'var slot = null;')],
  // A photograph of a QR is a megapixel file, and refusing it was the
  // old behaviour -- it is the commonest thing somebody would try.
  ['bulletin-harness.js', 'a photographed QR is refused instead of scaled',
    s => s.replace('var QR_SIDE = 512;         // a QR needs no more than this to scan', 'var QR_SIDE = 99999;')],
  ['bulletin-harness.js', 'a QR photographed on a patterned table is refused',
    s => s.replace("if (out.length > QR_MAX) out = c.toDataURL('image/jpeg', 0.85);", '')],
  ['bulletin-harness.js', 'the last resort for a noisy photo is gone',
    s => s.replace("if (out.length > QR_MAX) out = c.toDataURL('image/jpeg', 0.6);", '')],
  // A transparent PNG over the gold block loses the quiet zone a
  // scanner needs, and JPEG has no alpha at all.
  ['bulletin-harness.js', 'the QR is laid on nothing, so it will not scan',
    s => s.replace("          g.fillStyle = '#ffffff';", '')],
  ['bulletin-harness.js', 'any file at all is taken as a QR',
    s => s.replace("    if (!/^image\\//.test(file.type || '')) { _toast('That is not a picture', 'error'); return; }", '')],
  ['bulletin-harness.js', 'anything at all can be stored as the QR code',
    s => s.replace("qr: (g && typeof g.qr === 'string' && /^data:image\\//.test(g.qr)) ? g.qr : ''",
                   "qr: (g && g.qr) || ''")],
  ['bulletin-harness.js', 'a picture of any size is accepted',
    s => s.replace('var QR_MAX = 350 * 1024;', 'var QR_MAX = Infinity;')],
  ['bulletin-harness.js', 'the empty QR slot prints on the bulletin',
    s => s.replace('.blt-capturing .blt-qr--empty, .blt-capturing .blt-qr__x { display: none !important; }', '')],
  // The account, as the chapel writes it.
  ['bulletin-harness.js', 'the account name stops being bold',
    s => s.replace(".blt-give__name { font-family: 'Poppins', sans-serif; font-weight: 700;",
                   ".blt-give__name { font-family: 'Poppins', sans-serif; font-weight: 400;")],
  ['bulletin-harness.js', 'the account number loses its label',
    s => s.replace("'<div class=\"blt-give__acct\"><span class=\"blt-give__lbl\">A/C No :</span> ' +",
                   "'<div class=\"blt-give__acct\">' +")],
  ['bulletin-harness.js', 'a new bulletin forgets the chapel\'s account',
    s => s.replace("name: 'Luther House Chapel', bank: 'RHB Bank',", "name: '', bank: '',")],
  ['bulletin-harness.js', 'the announcement title goes back beside its words',
    s => s.replace("      h += '<li><div class=\"blt-notices__t\">' +", "      h += '<li><span class=\"blt-notices__t\"><b>' +")],
  ['bulletin-harness.js', 'empty fields print their placeholder text',
    s => s.replace('.blt-sheet:not(.blt-capturing) .blt-view:empty::before { content: attr(data-ph)',
                   '.blt-view:empty::before { content: attr(data-ph)')],
  // Centred overflow runs off both sides: the left of a zoomed page
  // could then never be scrolled to.
  ['bulletin-harness.js', 'a zoomed page cannot be scrolled back to its left edge',
    s => s.replace('.blt-stage { padding: 18px 8px 0; overflow-x: auto; }',
                   '.blt-stage { display: flex; justify-content: center; padding: 18px 8px 0; overflow: hidden; }')],
  ['bulletin-harness.js', 'the zoom buttons have nothing to reset to',
    s => s.replace('onclick="BLT.zoomFit()"', 'onclick="void 0"')],
  ['bulletin-harness.js', 'the bulletin opens at a fixed size instead of fitting',
    s => s.replace('var _zoom = null;', 'var _zoom = 0.7;')],
  // The PDF is always the whole A4 page, whatever the screen is showing.
  ['bulletin-harness.js', 'the PDF is captured at whatever zoom was on screen',
    s => s.replace("          pixelRatio: 2, backgroundColor: '#ffffff', width: A4_W, height: A4_H,",
                   "          pixelRatio: 2, backgroundColor: '#ffffff', width: A4_W * (_zoom || 1), height: A4_H,")],
  // Something in the app's own CSS strips list markers, so the <ol>
  // numbered nothing and the announcements ran together.
  ['bulletin-harness.js', 'the announcements lose their numbering again',
    s => s.replace('list-style: none; counter-reset: blt-n;', 'counter-reset: blt-n;')],
  ['bulletin-harness.js', 'the number is not drawn at all',
    s => s.replace('.blt-notices li::before { content: counter(blt-n) ".";', '.blt-notices li::before { content: "";')],
  ['bulletin-harness.js', 'the words are not kept clear of the number',
    s => s.replace('.blt-notices__t { flex: 1 1 auto; min-width: 0; }', '')],
  // Giving was two loose lines in the first week; a bulletin written
  // then must still open with its account details in it.
  ['bulletin-harness.js', 'the first week\'s giving details are dropped on open',
    s => s.replace('      } else if (Array.isArray(d.giving.lines)) {', '      } else if (false) {')],
  ['bulletin-harness.js', 'a new giving purpose arrives pre-filled',
    s => s.replace("d.giving.entries.push({ purpose: '', name: '', bank: '', number: '', qr: '' });",
                   "d.giving.entries.push(d.giving.entries[0]);")],
  ['bulletin-harness.js', 'an over-long bulletin loses its bottom in silence',
    s => s.replace('    _warnIfLong();', '')],
  ['bulletin-harness.js', 'the overflow check measures the page, which never grows',
    s => s.replace('var over = body ? body.scrollHeight - body.clientHeight : 0;',
                   'var over = sheet.scrollHeight - A4_H;')],
  ['bulletin-harness.js', 'the footer is shoved off the page instead of clipping',
    s => s.replace('width: 794px; height: 1123px; box-sizing: border-box; overflow: hidden;',
                   'width: 794px; height: 1123px; box-sizing: border-box;')],
  ['bulletin-harness.js', 'an offering amount wraps onto the row beneath it',
    s => s.replace('.blt-money__v { flex: 0 0 auto; white-space: nowrap; font-family',
                   '.blt-money__v { font-family')],
  ['bulletin-harness.js', 'the page ends in a white band above the footer',
    s => s.replace('.blt-main .blt-table { flex: 1 1 auto; }', '')],
  ['bulletin-harness.js', 'the first reading prints the passage as the reader',
    s => s.replace("{ key: 'read1',     label: 'First Reading',         roles: ['reader1'], ref: 'reading1' }",
                   "{ key: 'read1',     label: 'First Reading',         roles: ['reading1'], ref: 'reading1' }")],
  // The roster keeps the liturgical cell as a JSON STRING, so unwrapping
  // only objects printed the braces across the masthead.
  ['bulletin-harness.js', 'the liturgical day prints as raw JSON',
    s => s.replace("if (s.charAt(0) === '{') {", "if (false) {")],
  ['bulletin-harness.js', 'a hand-typed liturgical day disappears',
    s => s.replace("} catch (e) { /* not JSON after all: keep the text */ }", "} catch (e) { return ''; }")],
  ['bulletin-harness.js', 'a duty points at a roster role that does not exist',
    s => s.replace("roles: ['flowerarrangement']", "roles: ['flowers']")],
  ['bulletin-harness.js', 'the band loses half its players',
    s => s.replace("roles: ['pianist', 'guitarist', 'bassist', 'drummer', 'singer1', 'singer2', 'singer3', 'singer4']",
                   "roles: ['pianist', 'guitarist']")],
  // '-' in a scripture slot is the roster saying there is no psalm today.
  ['bulletin-harness.js', 'the no-psalm sentinel is tidied away',
    s => s.replace("if (v === '-' && !isScripture) return '';", "if (v === '-') return '';")],
  ['bulletin-harness.js', 'the same person rostered twice is printed twice',
    s => s.replace('if (v && names.indexOf(v) === -1) names.push(v);', 'if (v) names.push(v);')],
  // The sheet is scaled to fit the screen; scaling the SHEET rather than
  // its wrapper bakes that fraction into the printed PDF.
  ['bulletin-harness.js', 'the PDF is printed at whatever size the phone showed',
    s => s.replace("stage.style.transform = 'scale(' + scale + ')';",
                   "sheet.style.transform = 'scale(' + scale + ')';")],
  ['bulletin-harness.js', 'the editing controls print on the bulletin',
    s => s.replace('.blt-capturing .blt-x, .blt-capturing .blt-add { display: none !important; }', '')],
  // Without onConflict the upsert inserts another row on every keystroke
  // batch, and reopening the bulletin returns whichever one came back first.
  ['bulletin-harness.js', 'every save makes a second bulletin for the same Sunday',
    s => s.replace("{ onConflict: 'service_date,year' }", '{}')],
  ['bulletin-harness.js', 'a bulletin saved by an older page throws on open',
    s => s.replace('if (Array.isArray(d.notices)) b.notices = d.notices.map(function(n) {',
                   'if (d.notices) b.notices = d.notices.map(function(n) {')],
  // Opened on the last Sunday of a month, one month ahead leaves the
  // right-hand column with no service to name.
  ['bulletin-harness.js', 'the next-Sunday column runs out at a month end',
    s => s.replace('for (var k = 0; k < 3; k++) {', 'for (var k = 0; k < 1; k++) {')],

  ['songbook-live-harness.js', 'the box goes back to holding only the title',
    s => s.replace("value=\"' + escapeHtml(_sbmFindQuery(song)) +",
                   "value=\"' + escapeHtml(String(song.title || '').trim()) +")],
  // A box on a line of its own with only `.sbm-input` is 209px wide
  // under a 347px button, so the query is cut off mid-word.
  ['songbook-live-harness.js', 'the query box is laid out as a flex child again',
    s => s.replace('<input id="sbmFindQ" class="sbm-input sbm-input--block"',
                   '<input id="sbmFindQ" class="sbm-input"')],
  ['songbook-live-harness.js', 'the block class stops meaning full width',
    s => s.replace('.sbm-input--block { width: 100%; }',
                   '.sbm-input--block { width: auto; }')],

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
  // A share is somebody's only copy of what they went looking for, and
  // the url-only gate meant sharing selected chords did nothing at all.
  ['share-target-harness.js', 'a share of selected text is ignored again',
    s => s.replace("    if ((window.__SHARE_INBOX_URL && window.__SHARE_INBOX_URL.trim()) ||\r\n        (window.__SHARE_INBOX_TEXT && window.__SHARE_INBOX_TEXT.trim())) {",
                   '    if (window.__SHARE_INBOX_URL && window.__SHARE_INBOX_URL.trim()) {')],
  // The manifest checks are not mutated: this tool rewrites Index.html
  // and nothing else, so a case aimed at public/manifest.json would be a
  // guaranteed false pass -- the same trap the header of this file
  // records for the app/api harnesses.
  // Nothing is written until Save Lyrics; seeding must not become
  // overwriting.
  ['share-target-harness.js', 'shared words overwrite the song instead of opening in the editor',
    s => s.replace("    var stored = given ? String(seed) : (s.customLyrics || s.lyrics || '');",
                   "    var stored = s.customLyrics || s.lyrics || '';")],
  ['share-target-harness.js', 'the reader stops noting which song it shows',
    s => s.replace('    _sbmNoteLastSong(sid);\r\n', '')],
  // The book loads asynchronously; a fixed delay attaches to nothing on
  // a slow connection and says it worked.
  ['share-target-harness.js', 'attaching guesses a delay instead of waiting',
    s => s.replace('    var waited = 0;\r\n    var tick = setInterval(function() {',
                   '    var waited = 0;\r\n    var tick = setTimeout(function() {')],
  ['share-target-harness.js', 'a shared link stops going through the one save path',
    s => s.replace('          _sbAddLinkToSong(ref.sid, url);',
                   '          (song.sbLinks = song.sbLinks || []).push({ url: url });')],
  // Both of these were found by running the flow, not by reading it.
  ['share-target-harness.js', "the book key is passed whole to an opener that wants it bare",
    s => s.replace("      openSongbookStandalone(String(ref.book).replace(/^sb-/, ''));",
                   '      openSongbookStandalone(ref.book);')],
  ['share-target-harness.js', 'the wait is shorter than a cold open takes',
    s => s.replace('if (waited < 25000) return;', 'if (waited < 8000) return;')],
  ['share-target-harness.js', 'shared words are diverted to the choir parts editor',
    s => s.replace("    if (!(seed && String(seed).trim()) &&\r\n        (typeof _sbChoirView === 'function') && _sbChoirView(s) === 'choir') {",
                   "    if ((typeof _sbChoirView === 'function') && _sbChoirView(s) === 'choir') {")],

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
  // 104 of the 124 "..." icons on the live roster had nothing behind
  // them, because the guard asked whether the cell had an icon rather
  // than whether the icon was wired -- and the table's own markup gives
  // every role cell one already.
  ['roster-touch-edit-harness.js', 'the guard goes back to skipping an icon that exists',
    s => s.replace('        if (!iconBtn._ddBound) {', '        if (!iconBtn._ddBound && false) {')],
  ['roster-touch-edit-harness.js', 'only cells with no icon get a working one',
    s => s.replace("        var iconBtn = td.querySelector('.roster-cell-dropdown-icon');\r\n        if (!iconBtn) {",
                   "        var iconBtn = null;\r\n        if (!td.querySelector('.roster-cell-dropdown-icon')) {")],
  ['roster-touch-edit-harness.js', 'a span icon is left without a button\'s semantics',
    s => s.replace("            iconBtn.setAttribute('role', 'button');\r\n            iconBtn.setAttribute('tabindex', '0');\r\n", '')],
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
          .replace(/(\.wo-lyrics-chord-line,\s*#sbmRoot :is\(#sbmLyrics, \.sbm-card--follow > \.sbm-lyrics\):not\(\.sbm-lyrics--nochords\)\s+)\.wo-lyrics-lyric-line(\s*\{)/g,
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
    s => s.replace('      if (ni >= 0) rebuilt[ni] = e.bg;',
                   '      rebuilt[ni] = e.bg;')],

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

  // Four harnesses that nothing here reached. These are their first cases.
  //
  // The altar colours and the jubilee green are the whole visual identity of
  // the app, and reverting --brand to the pre-rebrand blue is the regression a
  // careless sweep would actually make.
  ['theme-colour-harness.js', 'the jubilee green reverts to the old blue',
    s => s.replace(BRAND_GREEN, '--brand: #4a6da7;')],

  // Two services fall on 31 December. Give the Watchnight the morning's key
  // and they collide: one row overwrites the other, and whoever is rostered
  // for the evening quietly disappears.
  ['watchnight-service-harness.js', 'the Watchnight shares the morning service key',
    s => s.replace(WATCHNIGHT_KEY, "dateStr:'Dec 31'")],

  // Auto-Suggest exists so that a second press gives a different answer.
  // Two ways to lose that, caught in two different places: the salt drawn
  // once per run is a textual check, while a salt that never reaches the
  // hash only shows in the spread over 200 runs. The second is why one
  // case here would not have been enough.
  ['autosuggest-shuffle-harness.js', 'the shuffle salt stops being random',
    s => s.replace(SHUFFLE_SALT, 'var _shuffleSalt = 0.5')],
  ['autosuggest-shuffle-harness.js', 'the salt stops reaching the hash',
    s => s.replace(SHUFFLE_HASH, 'var h = 2166136261;')],

  // The one the source comment warns about in so many words: a group rule is
  // satisfied ONCE. Without that, a strict rule demands the same person in
  // every singer row -- she fills Singer 2, and Singer 3 is still required.
  ['duty-group-pairing-harness.js', 'a group rule is never satisfied, so it keeps firing',
    s => s.replace(PAIRING_ANSWERED, '      if (false) return;')],
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
    s => s.replace(/(return window\.SBQ_VOICE_LINES\.replaceAll\(base, rows\);\r?\n\s*\}\)\.then\(function\(\) \{\r?\n\s*)return window\.SBQ_VOICE_LINES\.forSong\(base\);/, '$1return rows;')],
  ['songbook-editparts-harness.js', 'a failed write closes the editor and loses the edits',
    s => s.replace(/(_sbVoiceWrite\(ed\.base, ed\.sid, parsed, \{ openSig: ed\.openSig \}\)[\s\S]*?\}\)\.catch\(function\(err\) \{\r?\n\s*)console\.error\(err\);/,
                   '$1_sbmEdClose(); console.error(err);')],
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
    s => s.replace(/(chords\.push\(\{ words: _sbmPadWords\(lines\[j\], parts\), chord: l\.slice\(Math\.min\(pre, lead\)\)\.replace\(\/\\s\+\$\/, ''\) \}\);)\r?\n\s*continue;/, '$1')],
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
    s => s.replace("        if (chord && ln === lead) { out.push(_sbmPadIndent(t, o.parts) + chord); chord = ''; }", "        if (chord) { out.push(_sbmPadIndent(t, o.parts) + chord); chord = ''; }")],
  ['songbook-overview-harness.js', 'a line opening with a number loses it to the bars',
    s => s.replace("  function _sbmAllPrefix(text) { return window.lhcVoiceLines._needsAll(text) ? '[All] ' : ''; }",
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

  // Versions of a song. Each of these puts one service's drawings on
  // another's song, or loses which version a service sings, on a page that
  // looks right until the next service opens the song.
  ['songbook-versions-harness.js', 'the card paints every version\'s remarks',
    s => s.replace('    var marks = _sbmMarksOf(base, song && song.versionId), memo = {}, laid = [], byAnchor = {};',
                   '    var marks = _sbmMarks[base] || [], memo = {}, laid = [], byAnchor = {};')],
  ['songbook-versions-harness.js', 'a remark is drawn on Standard whatever the service sings',
    s => s.replace('    if (_sbVerOk === true) mark.version_id = song.versionId || null;\r\n', '')],
  ['songbook-versions-harness.js', 'a version shows remarks that are not its own',
    s => s.replace("return (marks || []).filter(function(m) { return m && (m.version_id || '') === v; });",
                   'return (marks || []).filter(function(m) { return !!m; });')],
  ['songbook-versions-harness.js', 're-drawn words are not a change from the version',
    s => s.replace('      return { key: false, words: _sbVerNorm(w.lyrics) !== _sbVerNorm(v.lyrics) || _sbVerNorm(w.rich) !== _sbVerNorm(v.rich_lyrics) };',
                   '      return { key: false, words: _sbVerNorm(w.lyrics) !== _sbVerNorm(v.lyrics) };')],
  // A version written again from its song's new key has other steps and the
  // same sound; without the sung comparison every service on it is told it
  // has changed key and words, and offered an Update that would undo the move.
  // Somebody's own drawing is theirs until they share it; without the
  // check every private stroke on a chord sheet is drawn for everyone.
  ['songbook-layers-harness.js', 'other people\'s private drawings are shown',
    s => s.replace('    if (owner && m.shared === false) return !!(privOn && privOn[owner]);\r\n', '')],
  ['songbook-layers-harness.js', 'the rubber takes somebody else\'s drawing',
    s => s.replace("if (l.owner && !l.mine) { theirs = theirs || l.ownerName || 'somebody else'; return; }", '')],
  // Earlier versions (2026-11-08): every take says which service it was
  // made for, another service's marked; the read-only view paints the
  // drawings of the version it shows, never the copy in front.
  ['songbook-earlier-versions-harness.js', 'a take recorded in the songbook notes no service',
    s => s.replace('      if (forOrder) ins.order_id = forOrder;\r\n      return sb.from(\'song_recordings\').insert(ins).select();', '      return sb.from(\'song_recordings\').insert(ins).select();')],
  ['songbook-earlier-versions-harness.js', 'a cut forgets the service its recording was made for',
    s => s.replace('var forOrder = (C.rec && C.rec.order_id) ? String(C.rec.order_id) : _sbRecOrderNow();', 'var forOrder = _sbRecOrderNow();')],
  ['songbook-earlier-versions-harness.js', 'another service\'s take passes for this one\'s',
    s => s.replace('if (hereId && o === String(hereId)) return', 'if (hereId) return')],
  ['songbook-earlier-versions-harness.js', 'the read-only view paints the drawings of the copy in front',
    s => s.replace('    if (card && card.__sbmSong) return card.__sbmSong;\r\n', '')],
  ['songbook-earlier-versions-harness.js', 'the preview leaves the choir score\'s drawings off',
    s => s.replace('          : \'<p class="sbm-empty">This song has no choir parts yet.</p>\';\r\n        _sbEvMountOne(cc, temp);\r\n', '          : \'<p class="sbm-empty">This song has no choir parts yet.</p>\';\r\n')],
  ['songbook-earlier-versions-harness.js', 'an earlier service\'s medleys are lost',
    s => s.replace('m.songs.length > 1 && m.songs.indexOf(x.id) !== -1', 'false')],
  // One Versions sheet (2026-11-08): past versions newest first, a song new
  // to a service that was sung before pulses its badge and is pointed out,
  // and a medley kept keeps each song's version.
  // Save / Load Versions (2026-11-09): a tile of its own, and a name saved
  // twice replaces the first, asked first.
  ['songbook-earlier-versions-harness.js', 'Save / Load Versions is back inside More only',
    s => s.replace("      vTile +\r\n      '<button class=\"sbm-tile sbm-tile--more\"", "      '<button class=\"sbm-tile sbm-tile--more\"")],
  ['songbook-earlier-versions-harness.js', 'a name saved again is saved twice',
    s => s.replace('      if (!x) return _sbVerSaveAs(song, name);\r\n', '      return _sbVerSaveAs(song, name);\r\n')],
  ['songbook-earlier-versions-harness.js', 'a version is replaced without asking',
    s => s.replace("}).then(function(ok) { return ok ? _sbVerReplace(song, x) : null; });", "}).then(function() { return _sbVerReplace(song, x); });")],
  ['songbook-earlier-versions-harness.js', 'names differing only in case are taken for two',
    s => s.replace("function _sbVerNameKey(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim().toLowerCase(); }", "function _sbVerNameKey(s) { return String(s == null ? '' : s); }")],
  ['songbook-earlier-versions-harness.js', 'a replace takes the old drawings off before the new ones are in',
    s => s.replace("        return oldIds.length ? sup.from('song_marks').delete().in('id', oldIds) : { error: null };\r\n", "        return { error: null };\r\n")],
  ['songbook-earlier-versions-harness.js', 'the preview is the width of any sheet again',
    s => s.replace('#sbmSheet[data-sheet="earlier-open"] .sbm-sheet { width: min(470px, 92vw); }', '#sbmSheet[data-sheet="earlier-open"] .sbm-sheet { width: min(460px, 92vw); }')],
  ['songbook-earlier-versions-harness.js', 'past versions are listed oldest first',
    s => s.replace('return tb.localeCompare(ta) || (a.k - b.k);', 'return ta.localeCompare(tb) || (a.k - b.k);')],
  ['songbook-earlier-versions-harness.js', 'the badge of a song sung before no longer pulses',
    s => s.replace("el.classList.toggle('is-pulsing', !!n && el.getAttribute('data-ev-fresh') === '1');", "el.classList.toggle('is-pulsing', false);")],
  ['songbook-earlier-versions-harness.js', 'a copy with the main song\'s words is taken for one with words of its own',
    s => s.replace('return !own || own === t(song.masterLyrics);', 'return !own;')],
  ['songbook-earlier-versions-harness.js', 'a song sung before is never pointed out',
    s => s.replace('if (n && s1 && _sbBaseSongId(s1) === base && _sbEvFresh(s1)) _sbmCoachRecallSoon(s1);', '')],
  ['songbook-earlier-versions-harness.js', 'Use on the main song does nothing',
    s => s.replace("    if (r.kind === 'main') { _sbmCloseSheet(); sbVerUse(''); return; }\r\n", '')],
  ['songbook-earlier-versions-harness.js', 'a saved medley forgets the version each song was sung on',
    s => s.replace("transposeSteps: parseInt(stepsOf ? stepsOf(e) : e.transposeSteps, 10) || 0, versionId: e.versionId || '' };", "transposeSteps: parseInt(stepsOf ? stepsOf(e) : e.transposeSteps, 10) || 0 };")],
  ['songbook-earlier-versions-harness.js', 'a medley used again comes back on Standard',
    s => s.replace('    if (ed.vers && ed.useKeys) _mdsApplyVersions(ed.vers);\r\n', '')],
  ['songbook-coach-harness.js', 'Show the tips again leaves out the past-versions hint',
    s => s.replace('if (_sbmCoachDrawAt()) { _sbmCoachDraw(true); _sbmReplayRecall(); return; }', 'if (_sbmCoachDrawAt()) { _sbmCoachDraw(true); return; }')],
  // Slide parts in the LCD rail (2026-11-08): a song marks a part once and
  // the rail carries it down the slides that finish it; a heading the
  // operator adds is a SIBLING of .wo-slide-content, which is the only
  // reason it never reaches the congregation's screen.
  ['lcd-rail-parts-harness.js', 'every slide starts a part of its own, so nothing is carried down',
    s => s.replace('if (own || !cur) { cur = { label: own, start: i, size: 0 }; runs.push(cur); }',
                   '{ cur = { label: own, start: i, size: 0 }; runs.push(cur); }')],
  ['lcd-rail-parts-harness.js', 'the heading goes INSIDE the slide content, and onto the wall',
    s => s.replace('if (content && content.parentNode) content.parentNode.insertBefore(el, content);',
                   'if (content) content.appendChild(el);')],
  ['lcd-rail-parts-harness.js', 'an empty heading leaves an empty element behind',
    s => s.replace('if (!t) { if (el) el.remove(); return; }', 'if (!t) return;')],
  ['lcd-rail-parts-harness.js', 'a song goes back to one flat run of rows with no heading row',
    s => s.replace('            rowsHtml += _lcdBuildItemGroupRow(\'song\', groupTitle, _songBoxes.length);\r\n', '')],
  ['lcd-rail-parts-harness.js', 'the rows show the item title again instead of the words',
    s => s.replace('var _words = lines.slice(0, 2).join(\'   /   \');', 'var _words = \'\';')],
  ['lcd-rail-parts-harness.js', 'a liturgy heading is dropped on the next load',
    s => s.replace('                if (slide.header) _lcdWriteSlideHeader(slideBox, slide.header);\r\n', '')],
  ['lcd-rail-parts-harness.js', 'Cancel on the heading prompt clears the heading instead',
    s => s.replace('      if (v === null || v === undefined) return;   // Cancel, which is not \"clear\"', '')],
  ['lcd-rail-parts-harness.js', 'pre-chorus is swallowed by chorus again',
    s => s.replace('if (h.indexOf(\'pre-chorus\') >= 0 || h.indexOf(\'prechorus\') >= 0 || h.indexOf(\'pre chorus\') >= 0) return \'prechorus\';',
                   'if (h.indexOf(\'zzz\') >= 0) return \'prechorus\';')],
  ['lcd-rail-parts-harness.js', 'labelling a slide snaps the rail back to the projecting slide',
    s => s.replace('      _lcdRailHoldScroll();\r\n      _lcdWriteSlideHeader(box, t);', '      _lcdWriteSlideHeader(box, t);')],
  ['lcd-rail-parts-harness.js', 'the held position is put back once, so a later rebuild still moves it',
    s => s.replace('[0, 60, 150, 320, 700, 1100].forEach', '[0].forEach')],
  ['lcd-rail-parts-harness.js', 'the watcher is held off for one reveal instead of a window',
    s => s.replace('        if (Date.now() < _lcdSkipRevealUntil) return;\r\n', '')],
  ['lcd-rail-parts-harness.js', 'the bridge loses the colour edge that ties its slides to its heading',
    s => s.replace('  .lcd-rail-slide-row[data-part=\"bridge\"]::before    { background: #9573d6; }\r\n', '')],
  // The rail's title rows in black, and All Slides on the console itself
  // (2026-11-09). The part badges stay coloured -- the operator was asked
  // and chose that -- and All Slides stays OUT of the controls row, which
  // has 27px of its 517 left and would spend 44px of the projection.
  ['lcd-rail-parts-harness.js', 'the section band goes back to cream',
    s => s.replace('    background: #13161b;\r\n', '')],
  ['lcd-rail-parts-harness.js', 'the song and liturgy name rows go back to cream',
    s => s.replace('    background: #1b1f26;\r\n', '')],
  ['lcd-rail-parts-harness.js', 'the VERSE badge is dragged into the black with them',
    s => s.replace('.lcd-rail-part[data-part=\"verse\"]     { background: #e0ecfd;',
                   '.lcd-rail-part[data-part=\"verse\"]     { background: #13161b;')],
  ['lcd-rail-parts-harness.js', 'All Slides is taken off the console again',
    s => s.replace('<button class=\"lcd-slide-nav-btn lcd-allslides-btn\" id=\"lcdAllSlidesToolBtn\"', '<button class=\"lcd-slide-nav-btn\" id=\"lcdGone\"')],
  ['lcd-rail-parts-harness.js', 'All Slides takes Project\'s blue, so the live button has a twin',
    s => s.replace('background: #1d4ed8; border-color: #1d4ed8; color: #fff;',
                   'background: #0066ff; border-color: #0066ff; color: #fff;')],
  // Projected words wrap instead of shrinking (2026-11-10). The height test
  // stays -- a wall has nothing to scroll -- and max-width is what lets
  // overflow-wrap act at all on a flex item in a centred flex container.
  ['projection-text-wrap-harness.js', 'a long line shrinks the whole slide again',
    s => s.replace("'  while (textEl.scrollHeight > maxH && fs > 1.2) {' +",
                   "'  var maxW = content ? content.offsetWidth - 4 : window.innerWidth - 80;' +\r\n      '  while ((textEl.scrollHeight > maxH || textEl.scrollWidth > maxW) && fs > 1.2) {' +")],
  ['projection-text-wrap-harness.js', 'a slide taller than the screen keeps its size and loses its last lines',
    s => s.replace("'  while (textEl.scrollHeight > maxH && fs > 1.2) {' +",
                   "'  while (false && fs > 1.2) {' +")],
  ['projection-text-wrap-harness.js', 'the projected text loses its width cap, so a long word runs off both edges',
    s => s.replace("font-size: 6.5vw; line-height: 1.6; max-width: 100%;", "font-size: 6.5vw; line-height: 1.6;")],
  ['projection-text-wrap-harness.js', 'a word with no space in it stops breaking',
    s => s.replace("max-width: 100%; white-space: pre-wrap; overflow-wrap: break-word;", "max-width: 100%; white-space: pre-wrap;")],
  ['projection-text-wrap-harness.js', 'the presenter view stops wrapping at the safe zone',
    s => s.replace("    textEl.style.maxWidth = Math.round(maxW) + 'px';\r\n", '')],
  // 125px on the projector, and nothing of the app's own on a screen the
  // room can see (2026-11-10). 6.5vw is 124.8px at 1920 and one stop of the
  // existing slider; the fullscreen rule needs !important to beat
  // .wofs-filmstrip's own display:flex.
  ['projection-text-wrap-harness.js', 'the projected words drop back to 5vw, two thirds of what was asked',
    s => s.replace("'.projection-text { font-size: 6.5vw;", "'.projection-text { font-size: 5vw;")],
  ['projection-text-wrap-harness.js', 'the projection window falls back to the old size when nothing is stored',
    s => s.replace("'  var fs = s.fontSize || 6.5;' +", "'  var fs = s.fontSize || 5;' +")],
  ['projection-text-wrap-harness.js', 'the Text settings dialog still starts at 5vw',
    s => s.replace('    fontSize: 6.5,', '    fontSize: 5,')],
  ['projection-text-wrap-harness.js', 'the arrows stay on the wall when the view goes full screen',
    s => s.replace('  .wo-fullscreen-overlay:fullscreen .wofs-nav-btn,\r\n', '')],
  ['projection-text-wrap-harness.js', 'the filmstrip is hidden without !important, so its display:flex wins',
    s => s.replace('    display: none !important;\r\n  }\r\n  /* ...and the pointer',
                   '    display: none;\r\n  }\r\n  /* ...and the pointer')],
  ['projection-text-wrap-harness.js', 'the mouse pointer is left sitting on the wall',
    s => s.replace('  .wo-fullscreen-overlay:-webkit-full-screen { cursor: none; }', '')],
  // The parts a reader plays or sings follow their name (drawer_prefs). A
  // phone that changed hands must not carry one person's parts into the
  // next person's row, which would then follow THEM to every device; a tick
  // that is not kept with the name is the bug this replaced; and a name's
  // read that comes back after another name was given must change nothing.
  ['songbook-layers-harness.js', 'a handed-on phone carries one person\'s parts into another\'s name',
    s => s.replace("var mode = (of && of !== key) ? 'theirs' : !of ? 'join' :", "var mode = !of ? 'join' :")],
  ['songbook-layers-harness.js', 'a part ticked under Layers stays on the device only',
    s => s.replace('    _sbmPrefsTicked(p, i === -1);\r\n', '')],
  ['songbook-layers-harness.js', 'a name read after another name was given still lands',
    s => s.replace('      if (!opts.keep && gen !== _sbmPrefsGen) return null;\r\n', '')],
  // A change on one phone reaches the others: the name's parts win unless
  // the device holds a change not saved yet. Joined instead, a part unticked
  // on one phone comes back from the other; without the marker, a change
  // whose save failed is lost to the name's older parts; without the tick
  // count, a read that left before a tick undoes it.
  ['songbook-layers-harness.js', 'a part unticked on one phone comes back from the other',
    s => s.replace("(dirty || saved == null) ? 'mine' : 'saved';", "'join';")],
  ['songbook-layers-harness.js', 'a change not saved yet is overwritten by the name\'s older parts',
    s => s.replace('var dirty = _sbmPartsDirty(me.key) || ticks !== _sbmPrefsTicks;', 'var dirty = false;')],
  ['songbook-layers-harness.js', 'a read that left before a tick undoes it',
    s => s.replace('var dirty = _sbmPartsDirty(me.key) || ticks !== _sbmPrefsTicks;', 'var dirty = _sbmPartsDirty(me.key);')],
  ['songbook-versions-harness.js', 'a version moved with its song reads as changed',
    s => s.replace('    if (_sbVerHasChords(w.lyrics) && _sbVerSung(w.lyrics, s) === _sbVerSung(v.lyrics, sv)) return { key: false, words: false };\r\n', '')],
  // Going back to Standard writes versionId '' over the stored one; a sync
  // that only ever writes a version keeps the old one, and the reload undoes
  // the choice.
  ['songbook-versions-harness.js', 'going back to Standard is never synced',
    s => s.replace("(snap.versionId || (base.customizations && base.customizations.versionId)) ? { versionId: snap.versionId || '' } : {}",
                   'snap.versionId ? { versionId: snap.versionId } : {}')],
  ['songbook-versions-harness.js', 'a link to one song opens the book at its index',
    s => s.replace("        try { localStorage.setItem('lhc_sbm_song_' + _deepSb.replace(/^(order|sb)-/, ''), _deepSbSong); } catch (e) {}\r\n", '')],
  // The reading view as asked for on 2026-11-07. A key moved on another
  // device reached this one and was never drawn; a 0 arriving for a copy
  // never moved must not be announced as a new key; other people's private
  // drawings show only when switched on; the floater must go once arrived.
  ['songbook-reading-view-harness.js', 'a key moved elsewhere is not drawn until something else redraws',
    s => s.replace('    _sbmRemoteRedraw(patches);\r\n', '')],
  ['songbook-reading-view-harness.js', 'every copy never moved is announced as a key change',
    s => s.replace('if (inc.transposeSteps !== (parseInt(song.transposeSteps, 10) || 0)) p.key = true;', 'p.key = true;')],
  ['songbook-layers-harness.js', 'everybody\'s private drawings show to everyone',
    s => s.replace('if (owner && m.shared === false) return !!(privOn && privOn[owner]);', 'if (owner && m.shared === false) return true;')],
  ['songbook-reading-view-harness.js', 'the floater stays after the words are reached',
    s => s.replace('    if (top < h * 0.4) return false;             // arrived: they fill the screen, or are past\r\n', '')],
  ['songbook-reading-view-harness.js', 'the Drawings tile keeps the count from before the drawings were read',
    s => s.replace('        _sbmPhoneMarks(null);\r\n        _sbmDrawingsTileCount();\r\n', '        _sbmPhoneMarks(null);\r\n')],
  // The second pass the same day: a double-tap on the words draws, the song
  // view's score no longer edits a line in place, and a take plays from
  // wherever its timeline was set, never past its end.
  ['songbook-reading-view-harness.js', 'a double-tap on the words does nothing',
    s => s.replace('    if (!modal || !root) return;\r\n    _sbmDblBind(root);\r\n', '    if (!modal || !root) return;\r\n')],
  // Hold to draw, double-tap to edit, the editor dressed as the songbook
  // (2026-11-11, gotcha 86).
  ['songbook-hold-edit-harness.js', 'a double-click draws again instead of editing',
    s => s.replace("var c = _sbmDblCard(e.target); if (c) _sbmDblEdit(e, c); });", "var c = _sbmDblCard(e.target); if (c) _sbmHoldDraw(); });")],
  ['songbook-hold-edit-harness.js', 'the pen comes out after half a second, not two',
    s => s.replace('var _SBM_HOLD_DRAW_MS = 2000, _SBM_HOLD_RING_MS = 450;', 'var _SBM_HOLD_DRAW_MS = 500, _SBM_HOLD_RING_MS = 450;')],
  ['songbook-hold-edit-harness.js', 'a finger let go before the pen picks no line',
    s => s.replace('if (up && H.ringOn && H.pick) return _sbmXpPick(H.card, H.target);', 'if (false) return _sbmXpPick(H.card, H.target);')],
  ['songbook-hold-edit-harness.js', 'a save stores the chords in the key they were shown in',
    s => s.replace("if (O && O.steps) lyrics = _sbNpMap(O.shown, O.stored, String(lyrics == null ? '' : lyrics).split('\\n'), O.steps).join('\\n');", '')],
  ['songbook-hold-edit-harness.js', 'the Songbook\'s editor looks like the song form\'s',
    s => s.replace("    modal.classList.add('lyrics-editor-modal--sb');\r\n", '')],
  ['songbook-hold-edit-harness.js', 'a double-tap opens the editor at its top, not the line tapped',
    s => s.replace('      if (at && at.line != null) _sbLyrGoTo(richEditor, _sbLyrLineFor(given ? null : _sbmLinesOf(s), storedLines, at.line), at.col || 0);\r\n', '')],
  // The phone's choir label above its line (2026-11-11, gotcha 87).
  ['choir-chord-sheet-harness.js', 'a phone\'s label floats beside the words again',
    s => s.replace('  display: block; float: none; position: static; flex: none; box-sizing: border-box;\r\n', '  float: left; position: static; flex: none; box-sizing: border-box;\r\n')],
  ['choir-chord-sheet-harness.js', 'the words under a label keep room for the recorder',
    s => s.replace('#sbmRoot:not(.sbm--wide) .sbm-score .vl-score .vl-ln:not(.vl-ln--same) > .vl-body::before { content: none; }\r\n', '')],
  // Set up choir parts for the medley and for everyone; one set of chords
  // (2026-11-11, gotcha 89).
  ['songbook-choir-setup-harness.js', 'Set up leaves the rest of the medley without parts',
    s => s.replace('    (md ? md.songs : []).forEach(function(id) {', '    ([]).forEach(function(id) {')],
  ['songbook-choir-setup-harness.js', 'the other devices are never told the parts are there',
    s => s.replace('      _sbmLiveSend();\r\n      _sbmChoirAnnounce(bases);\r\n', '      _sbmLiveSend();\r\n')],
  ['songbook-choir-setup-harness.js', 'the choir score reads the library song\'s chords again',
    s => s.replace('      _sbChoirChordWords(song),\r\n', "      (song.lyrics || ''),\r\n")],
  ['songbook-choir-setup-harness.js', 'a chord from the choir side goes to the library while the copy has its own words',
    s => s.replace("    if (song && String(song.customLyrics || '').trim() && songOrderSections.indexOf(song) !== -1) {", '    if (false) {')],
  // The choir pad: Edit goes straight to it, parts in brackets on their own
  // lines, touching lines sing together (2026-11-12, gotcha 91).
  ['songbook-choir-pad-harness.js', 'a part\'s name no longer holds for the lines under it',
    s => s.replace("      if (fw.kind === 'part') { cur = fw.part; continue; }", "      if (fw.kind === 'part') { continue; }")],
  ['songbook-choir-pad-harness.js', 'a new section keeps the part from the section before',
    s => s.replace("      if (fw.kind === 'sec') { out.push(fw.name ? '[' + fw.name + ']' : ''); cur = 'both'; continue; }", "      if (fw.kind === 'sec') { out.push(fw.name ? '[' + fw.name + ']' : ''); continue; }")],
  ['songbook-choir-pad-harness.js', 'a new name in brackets is taken for a section',
    s => s.replace('      if (_SB_CP_SEC.test(name)) return null;', '      if (true) return null;')],
  ['songbook-choir-pad-harness.js', 'Edit in Choir opens the Edit Parts page again',
    s => s.replace("    _sbOverviewOpen(_sbBaseSongId(song), song.id, song.title || '', null, null, typeof anchor === 'string' ? anchor : '');", '    _sbmEdOpen({ base: _sbBaseSongId(song) });')],
  ['songbook-choir-pad-harness.js', 'a medley\'s next song in Choir opens the song in front',
    s => s.replace("      if (card.querySelector('.sbm-score')) { _sbmStopPlayer(); _sbOverviewOpen(_sbBaseSongId(song), song.id, song.title || '', null, null, anchor); }", "      if (card.querySelector('.sbm-score')) { sbmEditParts(anchor); }")],
  ['songbook-choir-pad-harness.js', 'an untouched chord off the lead line is reported as having nowhere to sit',
    s => s.replace('    return out.concat(typed.filter(function(c) { return !isLead(c) && !asShown(c); })', '    return out.concat(typed.filter(function(c) { return !isLead(c); })')],
  ['songbook-choir-pad-harness.js', 'Keep editing on the unsaved-changes toast throws the changes away',
    s => s.replace("      if (v === 'discard') _sbmPadClose();\r\n      else if (v === 'save') sbmPadSave();", "      if (v !== 'save') _sbmPadClose();\r\n      else if (v === 'save') sbmPadSave();")],
  ['songbook-choir-pad-harness.js', 'Esc on the unsaved-changes toast discards',
    s => s.replace("e.stopImmediatePropagation(); e.preventDefault(); done('keep'); } };", "e.stopImmediatePropagation(); e.preventDefault(); done('discard'); } };")],
  // The choir pad's review fixes (2026-11-12).
  ['songbook-choir-pad-harness.js', 'the pad\'s chords are matched by their words again',
    s => s.replace("    var byM = chords.some(function(c) { return typeof c.m === 'number' && c.m > -1; });", '    var byM = false;')],
  ['songbook-choir-pad-harness.js', 'a chord line taken away on the pad stays in the words',
    s => s.replace('    if (pair) sL.forEach(function(x, i) { if (!used[i] && x.words) out.push(', '    if (false) sL.forEach(function(x, i) { if (!used[i] && x.words) out.push(')],
  ['songbook-choir-pad-harness.js', 'chords left as shown under edited words are moved back through the key',
    s => s.replace('      var chord = (p && p.pass < 2) ? tL[p.i].chord : back(c.chord);', '      var chord = (p && p.pass < 1) ? tL[p.i].chord : back(c.chord);')],
  ['songbook-choir-pad-harness.js', '+ Chords puts a gap inside a moment sung together',
    s => s.replace("    for (var u = 0; u < w; u++) if (info[u].kind === 'words' && info[u].m === info[w].m) {", "    for (var u = 0; u < 0; u++) if (info[u].kind === 'words' && info[u].m === info[w].m) {")],
  ['songbook-choir-pad-harness.js', 'a part\'s line ending in a bracket is taken for a section',
    s => s.replace('      var sec = /^\\s*\\[([^\\[\\]]+)\\]\\s*$/.exec(line);', '      var sec = /^\\s*\\[(.+)\\]\\s*$/.exec(line);')],
  // Songbook <-> LCD / Builder (review, 2026-11-12, gotcha 93).
  ['songbook-lcd-builder-harness.js', 'a chord-only change re-splits the slides again',
    s => s.replace('    if (before != null && _sbProjectionWords(before) === now) return false;\r\n', '')],
  ['songbook-lcd-builder-harness.js', 'a song drawn in from elsewhere takes the wall again',
    s => s.replace('    if (firstSlideBox && !noSelect) {\r\n      selectSlideBox(firstSlideBox);', '    if (firstSlideBox) {\r\n      selectSlideBox(firstSlideBox);')],
  ['songbook-lcd-builder-harness.js', 'another device\'s words are only drawn, not taken',
    s => s.replace("        if (typeof inc.customLyrics === 'string' && inc.customLyrics !== (song.customLyrics || '')) {", '        if (false) {')],
  ['songbook-lcd-builder-harness.js', 'a version\'s words never reach the slides',
    s => s.replace('    _sbSlidesFollow(song, before);\r\n  }\r\n  function _sbVerSetKey(song, want) {', '  }\r\n  function _sbVerSetKey(song, want) {')],
  ['songbook-lcd-builder-harness.js', 'a song inserted after a medley\'s song goes into it',
    s => s.replace('      if (md && md.medley.songs.length) afterSong = _lbdSong(', '      if (false) afterSong = _lbdSong(')],
  // The songs-library and songbook data-loss fixes (review, 2026-11-12, gotcha 92).
  ['songs-data-loss-harness.js', 'the Edit Song form writes the whole row again',
    s => s.replace('    SBQ_SONGS.updateForm(songData, { openedLyrics: _asmOpenedLyrics }).then(function(result) {', '    SBQ_SONGS.update(songData).then(function(result) {')],
  ['songs-data-loss-harness.js', 'the form writes the choir parts flag it never knew',
    s => s.replace("    SBQ_SONGS.FORM_COLUMNS.forEach(function(k) { patch[k] = row[k]; });", "    Object.keys(row).forEach(function(k) { if (k !== 'id') patch[k] = row[k]; });")],
  ['songs-data-loss-harness.js', 'the appearance controls replace the whole style',
    s => s.replace("  currentDisplayStyle = Object.assign({}, (currentDisplayStyle && typeof currentDisplayStyle === 'object') ? currentDisplayStyle : {},\r\n    { lyricFont: lf,", "  currentDisplayStyle = Object.assign({}, {},\r\n    { lyricFont: lf,")],
  ['songs-data-loss-harness.js', 'a standalone book forgets its Choir / Lyrics view on save',
    s => s.replace("          choirView:               s.choirView || ''\r\n", "          noView:                  ''\r\n")],
  ['songs-data-loss-harness.js', 'the shared-link Songbook keeps the last order\'s liturgy',
    s => s.replace("        window.serviceSectionItems = _scr.serviceSectionItems;\r\n", '')],
  ['songs-data-loss-harness.js', 'Add choir parts seeds over parts already there',
    s => s.replace('    if (rows && rows.length) {\r\n      _lpVoiceLineCache[song.id] = rows;', '    if (false) {\r\n      _lpVoiceLineCache[song.id] = rows;')],
  // The review's four larger follow-ups (2026-11-12, gotcha 94).
  ['songbook-followups-harness.js', 'a template key this device never changed is written back over the stored one',
    s => s.replace('      else if (J(L[k]) !== J(base[k])) v = L[k];', '      else if (true) v = L[k];')],
  ['songbook-followups-harness.js', 'the save reads what is stored and writes its own anyway',
    s => s.replace('      row.template = m.template;\r\n', '')],
  ['songbook-followups-harness.js', 'a redrawn song loses its slides\' backgrounds again',
    s => s.replace("      if (ni < 0 && e.item) { var j = byItem[e.item + '#' + e.nth]; if (j != null) ni = j; }\r\n", '')],
  ['songbook-followups-harness.js', 'another device\'s change leaves the backgrounds where the redraw put them',
    s => s.replace('    if (_bgSnap) _lcdRestoreAllBgs(_bgSnap);\r\n', '')],
  ['songbook-followups-harness.js', 'a song taken out in the Songbook is not a step the builder\'s Undo knows',
    s => s.replace('      _woSongsChange(function() {\r\n        songOrderSections = songOrderSections.filter(function(s) { return s.id !== baseSongId; });\r\n        _woUserClearedTypes.song = true;\r\n      });',
                   '      songOrderSections = songOrderSections.filter(function(s) { return s.id !== baseSongId; });\r\n      _woUserClearedTypes.song = true;')],
  ['songbook-followups-harness.js', 'a song deleted from the library drops out of a standalone songbook again',
    s => s.replace('          if (!libLoaded) return null;\r\n          song = {', '          return null;\r\n          song = {')],
  // The smaller leftovers of the review (2026-11-13, gotcha 95).
  ['songbook-live-harness.js', 'the poll compares the order\'s time with this device\'s clock again',
    s => s.replace("    if (t === seen) return 'same';", "    if (t <= seen) return 'same';")],
  ['songbook-live-harness.js', 'this device\'s own save is taken for another device\'s',
    s => s.replace("    return own ? 'own' : 'new';", "    return 'new';")],
  ['songbook-small-fixes-harness.js', '"set up on another device" is said twice again',
    s => s.replace('    bases = (bases || []).filter(function(b) { return b && !(_sbmChoirGotAt[b] && now - _sbmChoirGotAt[b] < 60000); });', '    bases = (bases || []).filter(Boolean);')],
  ['songbook-small-fixes-harness.js', 'a read that failed keeps the next check from trying again',
    s => s.replace('      bases.forEach(function(b) { delete _sbmChoirGotAt[b]; });   // the next check may try again\r\n', '')],
  ['songbook-small-fixes-harness.js', 'the era chosen in the form is dropped again',
    s => s.replace('    if (era) out.era = era; else delete out.era;', '    delete out.era;')],
  ['songbook-small-fixes-harness.js', 'words left as the form opened them are written over the stored ones',
    s => s.replace('    if (untouched) delete patch.lyrics;\r\n', '')],
  ['songbook-small-fixes-harness.js', 'words changed in the form and elsewhere: one change is lost',
    s => s.replace("      if (cols.indexOf('lyrics') !== -1 && !SBQ_SONGS.sameWords(d.lyrics, opened) && !SBQ_SONGS.sameWords(d.lyrics, row.lyrics)) {", '      if (false) {')],
  ['songbook-small-fixes-harness.js', 'the library\'s lyrics save writes without looking at what is stored',
    s => s.replace('      if (r && !r.error && r.data && !SBQ_SONGS.sameWords(r.data.lyrics, openedOn) && !SBQ_SONGS.sameWords(r.data.lyrics, lyrics)) {', '      if (false) {')],
  ['songbook-small-fixes-harness.js', 'the library\'s parts save no longer checks what the editor opened on',
    s => s.replace('{ openSig: STATE._lpEditSig }', '{}')],
  ['songbook-small-fixes-harness.js', 'the library\'s editor opens on a song somebody else holds',
    s => s.replace("  if (enter && W && typeof W.sbLibHold === 'function' && !W.sbLibHold(song)) { _lpAbandonPendingChoir(); return; }", "  if (enter && W && typeof W.sbLibHold === 'function') W.sbLibHold(song);")],
  ['songbook-small-fixes-harness.js', 'a Songbook editor closing lets the library\'s hold of the song go',
    s => s.replace(' || _sbLyricsEditBase === base || _sbLibEditBase === base) return;', ' || _sbLyricsEditBase === base) return;')],
  ['songbook-choir-pad-harness.js', 'the pad is saved with the old reader',
    s => s.replace('    var split = o.read ? o.read(fullText, _sbmIsChord(), o.parts) : _sbmPadSplit(fullText, _sbmIsChord(), o.parts);', '    var split = _sbmPadSplit(fullText, _sbmIsChord(), o.parts);')],
  ['songbook-reading-view-harness.js', 'the song view still edits a choir line on a double-click',
    s => s.replace("if (window.lhcVoiceEdit && !page.closest('#sbmRoot')) {", 'if (window.lhcVoiceEdit) {')],
  ['songbook-reading-view-harness.js', 'a time set while paused is forgotten when the take plays',
    s => s.replace('if (done || (!a.paused && a.readyState >= 2)) { try { a.currentTime = t; } catch (e) {} }', 'if (!a.paused && a.readyState >= 2) { try { a.currentTime = t; } catch (e) {} }')],
  ['songbook-reading-view-harness.js', 'ten seconds on runs past the end of the take',
    s => s.replace('    return (dur > 0 && t > dur) ? dur : t;\r\n', '    return t;\r\n')],
  // The third pass: a swipe turns like a book, a zoom carries on to the
  // pages after it, and the first-time flash shows once per device.
  ['songbook-book-mode-harness.js', 'a swipe from right to left goes back a page again',
    s => s.replace('            if (dx < 0) sbFsNext();\r\n', '            if (dx > 0) sbFsNext();\r\n')],
  ['songbook-book-mode-harness.js', 'a zoom stays on the page it was set on',
    s => s.replace('    for (var i = idx; i >= 0; i--) {\r\n      var z = map ? map[i] : undefined;', '    for (var i = idx; i >= idx; i--) {\r\n      var z = map ? map[i] : undefined;')],
  ['songbook-reading-view-harness.js', 'the first-time flash shows every time',
    s => s.replace("    _sbmIntroDone = true;\r\n    _sbmSeenMark('lhc_sbm_intro_seen_v2');\r\n    var el = document.createElement('div');", "    var el = document.createElement('div');")],
  // 2026-11-08: the flash once on the device, not once each time the app
  // is opened -- phones reopen the app all day, and singers met it again
  // and again.
  ['songbook-reading-view-harness.js', 'the first-time flash comes back each time the app is opened',
    s => s.replace("    _sbmSeenMark('lhc_sbm_intro_seen_v2');\r\n", '')],
  // The coach marks (the same day): the recordings sheet's, and the two
  // minutes before the drawing one, counted only while the book is in front.
  ['songbook-coach-harness.js', 'the recordings sheet opens with no coach mark',
    s => s.replace('    setTimeout(_sbmCoachRecord, 80);\r\n', '')],
  ['songbook-coach-harness.js', 'time in another tab counts toward the ten seconds',
    s => s.replace('    if (document.hidden || !_sbmBookOpen() || !_sbmActive()) return;\r\n    _sbmCoachClock.ms', '    _sbmCoachClock.ms')],
  ['songbook-coach-harness.js', 'a coach mark shows twice while the app stays open',
    s => s.replace('    _sbmCoachSeen[key] = true;\r\n', '')],
  // The drawing hint (2026-11-08): ten seconds in, once on the device, and
  // only with the song's words in sight to point at.
  // The floater (2026-11-08): armed by a song being opened, not by the
  // flash, which is once on a device -- or on a desk it never comes.
  ['songbook-coach-harness.js', 'on a desk the floater waits for a flash that no longer comes',
    s => s.replace('      if (_sbmGuideFresh && r.height > 0 && _sbmIntroWant(wt, wb, r.height)) { want = true; _sbmGuideFresh = 0; }\r\n', '')],
  ['songbook-coach-harness.js', 'opening another song does not arm the floater',
    s => s.replace('if (song && song.id !== _sbmGuideSong) { _sbmGuideSong = song.id; _sbmGuideFresh = Date.now(); }', '')],
  // The tips again (2026-11-08): replayed from More, the hint after the card.
  ['songbook-coach-harness.js', 'Show the tips again plays the card and stops',
    s => s.replace('if (_sbmCoachDrawAt()) { _sbmCoachDraw(true); _sbmReplayRecall(); return; }', 'if (_sbmCoachDrawAt()) { return; }')],
  ['songbook-coach-harness.js', 'the drawing hint shows again every time the app is opened',
    s => s.replace("var _SBM_COACH_ONCE = { draw: 'lhc_sbm_draw_hint_seen_v2', recall: 'lhc_sbm_recall_hint_v1', recallPick: 'lhc_sbm_recall_pick_v1' };", "var _SBM_COACH_ONCE = { recall: 'lhc_sbm_recall_hint_v1', recallPick: 'lhc_sbm_recall_pick_v1' };")],
  ['songbook-coach-harness.js', 'the drawing hint waits two minutes again',
    s => s.replace('var _SBM_DRAW_HINT_AFTER = 10000;', 'var _SBM_DRAW_HINT_AFTER = 120000;')],
  ['songbook-coach-harness.js', 'the drawing hint shows with the words out of sight',
    s => s.replace(" || _sbmMarksOk !== true || !_sbmCoachDrawAt()) return;", ' || _sbmMarksOk !== true) return;')],
  // Loading a whole liturgy from a past service (2026-11-08): never a
  // songbook's pseudo-order, never that day's sermon slides, and only into
  // an order of the kind it was made for.
  ['builder-load-liturgy-harness.js', 'a songbook is listed as a past service',
    s => s.replace("return o && o.id && !/^standalone_/.test(o.id) && !(currentOrderData && o.id === currentOrderData.id);", "return o && o.id && !(currentOrderData && o.id === currentOrderData.id);")],
  ['builder-load-liturgy-harness.js', 'a past service brings its sermon slides along',
    s => s.replace("return it && /^(liturgy|content|scripture)$/.test(it.itemType || '');", "return it && /^(liturgy|content|scripture|slides)$/.test(it.itemType || '');")],
  // Readings that skip verses (2026-11-11): a cut-short one is seen, only a
  // whole passage replaces it, and a past order is never touched.
  ['reading-pieces-harness.js', 'a missing piece goes unseen',
    s => s.replace("var miss = pieces.filter(function(p) { return !nums[String(p.verse)]; });", "var miss = [];")],
  ['reading-pieces-harness.js', 'a fetch numbered some other way replaces the reading',
    s => s.replace("if (p && !p.error && p.text && _woReadingWhole(ref, p.text)) got.push(", "if (p && !p.error && p.text && !_woReadingGaps(ref, p.text).length) got.push(")],
  ['reading-pieces-harness.js', 'a past order\'s readings are fetched again',
    s => s.replace("if (_woMendDone[order.id] || !_woOrderIsUpcoming(order)) return Promise.resolve(0);", "if (_woMendDone[order.id]) return Promise.resolve(0);")],
  // Dragging a section (2026-11-11): the numbers follow the drag, a finger
  // that moves first scrolls, the phone shows its grip, the songs follow.
  ['builder-section-drag-harness.js', 'the numbers stay put while a section is dragged',
    s => s.replace('nextSibling);\r\n    _lbdDragNumber(d);\r\n  }', 'nextSibling);\r\n  }')],
  ['builder-section-drag-harness.js', 'a finger scrolling the page picks up the heading',
    s => s.replace('    if (d.hold && !d.armed) {\r\n', '    if (false) {\r\n')],
  ['builder-section-drag-harness.js', 'the phone hides the heading\'s grip again',
    s => s.replace('.lbw--sm .lbw-tb[data-act="sec-up"], .lbw--sm .lbw-tb[data-act="sec-down"],', '.lbw--sm .lbw-h .lbw-grip,\r\n.lbw--sm .lbw-tb[data-act="sec-up"], .lbw--sm .lbw-tb[data-act="sec-down"],')],
  ['builder-section-drag-harness.js', 'a dropped section leaves the songs in the old order',
    s => s.replace('      lay.splice(after ? to + 1 : to, 0, moved);\r\n      _lbdSortSongsByService();\r\n', '      lay.splice(after ? to + 1 : to, 0, moved);\r\n')],
  // The phone's bar, the songbook's font, the master copy (2026-11-09).
  ['phone-bar-font-master-harness.js', 'the phone\'s bar loses its Save',
    s => s.replace("      '<button type=\"button\" class=\"lbw-mb lbw-mb-act\" data-act=\"save-liturgy\" aria-label=\"Save This Liturgy\" title=\"Save This Liturgy\"><i class=\"fa-solid fa-floppy-disk\" aria-hidden=\"true\"></i></button>' +\r\n", '')],
  ['phone-bar-font-master-harness.js', 'a font for words moves the chords off their words',
    s => s.replace("return f.mono ? f.fam : _SBM_GRID_STACK;", "return f.fam || _SBM_GRID_STACK;")],
  ['phone-bar-font-master-harness.js', 'the master copy is overwritten whatever the answer',
    s => s.replace("        'Every new service starts from the master. Services already planned keep their own copies, and the master as it is now is kept under Past versions, where it can be put back.' }).then(function(ok) {\r\n      if (!ok) return;\r\n", "        'Every new service starts from the master. Services already planned keep their own copies, and the master as it is now is kept under Past versions, where it can be put back.' }).then(function(ok) {\r\n")],
  // Save and Load as two buttons, Templates gone (2026-11-09): Load offers
  // past services too, and Add Item's New section keeps the template tools.
  ['builder-load-liturgy-harness.js', 'Load forgets the past services',
    s => s.replace("      { label: 'Load Liturgy from Past Services…', icon: 'fa-solid fa-clock-rotate-left', run: function() { lbdServiceLiturgies('*', 'order'); } }\r\n    ]);", "    ]);")],
  ['builder-load-liturgy-harness.js', 'Add Item\'s New section loses the template sections',
    s => s.replace("full ? { label: 'New section', icon: 'fa-solid fa-heading', sub: _lbdNewSectionItems(secId) }", "full ? { label: 'New section below', icon: 'fa-solid fa-heading', run: function() { lbdAddSection(_lbdSecIndex(secId) + 1); } }")],
  ['builder-load-liturgy-harness.js', 'a contemporary liturgy loads into a traditional order',
    s => s.replace("    if (x.type !== _svlOrderType()) { showToast('That liturgy was made for another kind of service', 'info'); return; }\r\n", '')],
  // A saved liturgy's year folder in the Liturgy Library (2026-11-08): never
  // a second folder for a year that has one, a folder removed is deleted and
  // nothing else is, and a year folder lists only its year's liturgies.
  ['svl-year-folder-harness.js', 'a year that has its folder is given a twin',
    s => s.replace("var rows = r.data || [], hit = rows.filter(same)[0];", "var rows = r.data || [], hit = null;")],
  ['svl-year-folder-harness.js', 'a folder removed here is never deleted',
    s => s.replace("    _occFoldersGone[folderId] = true;\r\n", '')],
  ['svl-year-folder-harness.js', 'removing one folder deletes every folder',
    s => s.replace(".delete().in('id', gone)", ".delete().neq('id', 'x')")],
  // Reading a part's words in the load window (2026-11-08): one part open
  // at a time, a reading's verse numbers raised, the words escaped.
  ['svl-item-text-harness.js', 'a second part opens beside the first instead of in its place',
    s => s.replace("    ol.querySelectorAll('.svl-tx').forEach(function(b) { b.hidden = true; b.innerHTML = ''; });\r\n", '')],
  ['svl-item-text-harness.js', 'a reading\'s verse numbers are left as [10]',
    s => s.replace("texts = _svlItemTexts(it); verses = it.itemType === 'scripture';", "texts = _svlItemTexts(it); verses = false;")],
  ['svl-item-text-harness.js', 'a part\'s words go into the page unescaped',
    s => s.replace(".join('') : _lbdEsc(ln.text);", ".join('') : ln.text;")],
  ['svl-year-folder-harness.js', 'a year folder lists every year\'s liturgies',
    s => s.replace("return f ? _occSvlSorted(_occSvlInYear(occId, f.name)) : [];", "return _occSvlSorted(_occSvlRows[occId]);")],
  ['songbook-versions-harness.js', 'a shared link gains a second question mark',
    s => s.replace("    return url + (url.indexOf('?') === -1 ? '?' : '&') + key + '=' + encodeURIComponent(val);",
                   "    return url + '?' + key + '=' + encodeURIComponent(val);")],
  // The Enablers directory (enablers-calendar-harness). A duty card's dates
  // sorted as text ran "Nov 15" before "Nov 8".
  ['enablers-calendar-harness.js', 'a person\'s duties come in the order the rows happened to be in',
    s => s.replace('        .sort(function(a, b) { return a.at.t - b.at.t; })', '')],
  ['enablers-calendar-harness.js', 'the Watchnight ties with that morning\'s service',
    s => s.replace("t: Date.UTC(y, m, d) + (pm ? 1 : 0) };", "t: Date.UTC(y, m, d) };")],
  ['enablers-calendar-harness.js', 'a duty rostered to "All Teachers" is nobody\'s',
    s => s.replace(" || (w.labels || []).indexOf(lv) !== -1;", ';')],
  // wa.me's redirect turned an emoji outside the BMP into U+FFFD.
  ['enablers-calendar-harness.js', 'the WhatsApp link goes by wa.me again',
    s => s.replace("return 'https://api.whatsapp.com/send?' + (p ? 'phone=' + p + '&' : '') + 'text='", "return 'https://wa.me/' + p + '?text='")],
  ['enablers-calendar-harness.js', 'the duty card signs off with an emoji WhatsApp breaks',
    s => s.replace("      lines.push('_God bless you!_');", "      lines.push('_Blessings \\uD83D\\uDE4F_');")],
  // A phone saved must not blank the email beside it.
  ['enablers-calendar-harness.js', 'saving a phone writes the email too, blank',
    s => s.replace("        if (patch && Object.prototype.hasOwnProperty.call(patch, f)) { row[f] = String(patch[f] == null ? '' : patch[f]); fields.push(f); }",
                   "        row[f] = String(patch && patch[f] != null ? patch[f] : ''); fields.push(f);")],
  ['enablers-calendar-harness.js', 'a refused save is reported as saved',
    s => s.replace("        var stuck = got && fields.every(function(f) { return String(got[f] == null ? '' : got[f]) === row[f]; });\r\n        if (!stuck) throw new Error('The save did not go through. Please try again.');\r\n", '')
          .replace("        if (r && r.error) throw new Error(r.error.message || 'The save did not go through.');\r\n", '')],
  ['enablers-calendar-harness.js', 'a contact is written under the picker\'s spelling, making a second row',
    s => s.replace('      return hit || clean;', '      return clean;')],
  ['enablers-calendar-harness.js', 'only a PIC can add a phone or an email again',
    s => s.replace("          html += '<div class=\"en-ct-group\">' + self._enCtHtml(name, 'phone', phone) + self._enCtHtml(name, 'email', email) + '</div>';",
                   "          html += '<span>' + (phone || 'No phone saved') + '</span>';")],
  // The Songs page's search and the home cards (home-songs-search-harness).
  ['home-songs-search-harness.js', 'the list finds the letters anywhere in the title again',
    s => s.replace("      result = result.filter(function(s) { return _sfTitleStarts(s, f.q); });",
                   "      result = result.filter(function(s) { return String(s.title || '').toLowerCase().indexOf(f.q.toLowerCase()) >= 0; });")],
  ['home-songs-search-harness.js', 'a title matches wherever the letters fall in it',
    s => s.replace("    if (q) return _sfTitleKey(song && song.title).indexOf(q) === 0;", "    if (q) return _sfTitleKey(song && song.title).indexOf(q) >= 0;")],
  ['home-songs-search-harness.js', 'the hint stays three times as long',
    s => s.replace("    timer = setTimeout(end, 5000);", "    timer = setTimeout(end, 15000);")],
  ['home-songs-search-harness.js', 'the hint paints under the filters',
    s => s.replace("    #songFinderView #sfCommandHeader > .sf-search-field.sf-search-flash { position: relative; z-index: 60; }", "")],
  ['home-songs-search-harness.js', 'a chip opens the whole page as well as its book',
    s => s.replace("        e.stopPropagation();\r\n        var id = chip.getAttribute('data-id');", "        var id = chip.getAttribute('data-id');")],
  ['home-songs-search-harness.js', 'every order chip reads "Service - ..."',
    s => s.replace("    if ((!title || dated) && o && o.serviceDate) return String(o.serviceDate);\r\n", "")],
  ['home-songs-search-harness.js', 'the Roster card says 0 services again',
    s => s.replace("        HOME_STATE.rosterNext = results[1] || [];\r\n        _homeRosterStat();\r\n", "        HOME_STATE.rosterNext = results[1] || [];\r\n")],
  // The Songs card: the songbooks opened last, of either kind.
  ['home-songs-search-harness.js', 'opening a songbook is not remembered',
    s => s.replace("    try { _sbRememberOpened(); } catch (e) {}\r\n", '')],
  ['home-songs-search-harness.js', 'a deleted songbook stays on the card',
    s => s.replace("        if (b === null) return;\r\n", '')],
  ['home-songs-search-harness.js', 'a book opened since the last read is dropped as if deleted',
    s => s.replace("        if (b === null) return;\r\n", "        if (known && !b) return;\r\n")],
  ['home-songs-search-harness.js', 'a service\'s chip opens the order editor instead of its Songbook',
    s => s.replace("          if (typeof openSongbookFromOrder === 'function') openSongbookFromOrder(id);",
                   "          if (window.WO && window.WO.loadOrder) window.WO.loadOrder(id);")],
  ['home-songs-search-harness.js', 'opening one of My Songbooks is not remembered',
    s => s.replace("    // My Songbooks open here rather than through openSongbook().\r\n    try { _sbRememberOpened(); } catch (e) {}\r\n", '')],
  // Every WhatsApp share, not only the duty card: wa.me's redirect broke an
  // emoji outside the BMP into U+FFFD.
  ['enablers-calendar-harness.js', 'the shared WhatsApp helper goes by wa.me again',
    s => s.replace("  return 'https://api.whatsapp.com/send?text=' + encodeURIComponent(text == null ? '' : String(text));",
                   "  return 'https://wa.me/?text=' + encodeURIComponent(text == null ? '' : String(text));")],
  ['enablers-calendar-harness.js', 'one share builds its own wa.me link again',
    s => s.replace("window.open(window.lhcWhatsAppUrl(_sbSongShareText(song)), '_blank');",
                   "window.open('https://wa.me/?text=' + encodeURIComponent(_sbSongShareText(song)), '_blank');")],
  ['enablers-calendar-harness.js', 'the playlist share opens with an emoji WhatsApp breaks',
    s => s.replace("    var msg = '\\u266B *' + orderTitle + serviceDate", "    var msg = '\\uD83C\\uDFB5 *' + orderTitle + serviceDate")],
  // From the review of #397 (2026-11-07).
  ['enablers-calendar-harness.js', 'an older year\'s rows, landing late, are kept as the new year\'s',
    s => s.replace("        ]).then(function(results) {\r\n          if (loadTok !== self._enLoadTok) return;\r\n", "        ]).then(function(results) {\r\n")],
  ['enablers-calendar-harness.js', 'an old value on a PIC\'s card stops the other field being saved',
    s => s.replace("        return String(v == null ? '' : v).trim() === was.trim() ? { ok: true, value: was } : self._enCleanContact(f, v);",
                   "        return self._enCleanContact(f, v);")],
  ['enablers-calendar-harness.js', 'Send All opens its windows after a wait on the network, where they are blocked',
    s => s.replace("      if (!self._enRowsNow(STATE.rosterYear)) {", "      if (false) {")],
  ['enablers-calendar-harness.js', 'a liturgical cell that is not JSON shows its raw text, "__BLANK__" and all',
    s => s.replace("        if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }",
                   "        if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = { day: r.value }; } }")],
  ['enablers-calendar-harness.js', 'a liturgical cell is matched by its stored text, missing an ISO-dated one',
    s => s.replace("        var sv = (at && saved[at.key]) || {};", "        var sv = saved[day.dateStr] || {};")],
  // The Songbooks list's rows (home-look-harness).
  ['home-look-harness.js', 'a songbook row puts its buttons under its name again on a phone',
    s => s.replace("      .sb-list-item { flex-wrap: nowrap; gap: 10px; align-items: center; padding: 5px 10px; }",
                   "      .sb-list-item { flex-wrap: wrap; gap: 6px 12px; align-items: flex-start; padding: 10px 12px; }")],
  ['home-look-harness.js', 'a row of six buttons is not marked, and squeezes its name to nothing',
    s => s.replace("(isOrder ? '' : ' sb-list-item--many')", "''")],
  ['home-look-harness.js', 'a long name in a row of six drops under its icon',
    s => s.replace("      .sb-list-item.sb-list-item--many .sb-list-body { flex: 1 1 0; min-width: 0; }\r\n", '')],
  // A title in Chinese or Tamil is letters, not something to skip.
  ['home-songs-search-harness.js', 'a title in another script is stripped away and matches everything',
    s => s.replace("    return t.toLowerCase().replace(/\\s+/g, ' ').replace(_SF_LEAD, '');", "    return t.toLowerCase().replace(/\\s+/g, ' ').replace(/^[^a-z0-9]+/, '');")],
  // From the review of #401 (2026-11-07).
  ['home-songs-search-harness.js', 'a box of only punctuation or an emoji lists every song',
    s => s.replace("    return !raw || String((song && song.title) || '').trim().toLowerCase().indexOf(raw) === 0;", "    return true;")],
  ['home-songs-search-harness.js', 'the home cards are not drawn again once the orders are read',
    s => s.replace("      if (_hv && _hv.style.display !== 'none') renderHomeNavStats();\r\n", '')],
  ['home-songs-search-harness.js', 'a second hint leaves the first one\'s timer running',
    s => s.replace("    if (_sfHintEnd) _sfHintEnd(true);\r\n", '')],
  ['home-songs-search-harness.js', '"Service of Lessons and Carols" is shown as a date',
    s => s.replace("    if ((!title || dated) && o && o.serviceDate) return String(o.serviceDate);", "    if ((!title || /^service\\b/i.test(title)) && o && o.serviceDate) return String(o.serviceDate);")],
  ['home-songs-search-harness.js', 'two services on one date read alike',
    s => s.replace("      if (count[it.name] < 2 || !it.type) return it;", "      return it;")],
  ['home-songs-search-harness.js', 'the phone rules size the chips\' icons again',
    s => s.replace("    .home-nav-card .home-recent-chip i { font-size: .62rem;", "    .home-recent-chip i { font-size: .62rem;")],
  // After #433: a songbook name in its row's handlers, and a narrow column.
  ['home-look-harness.js', 'a songbook name goes into its handlers escaped for HTML only, and an apostrophe ends the string',
    s => s.replace("          return escapeHtml(String(v == null ? '' : v).replace(", "          return escapeHtml(String(v == null ? '' : v)); void (String(v).replace(")],
  ['home-look-harness.js', 'on a desk a row of six squeezes its name to 60px again',
    s => s.replace("    .sb-two-col > div { container-type: inline-size; container-name: sbcol; }\r\n", '')],
  // A member's name in the Enablers directory's handlers (enablers-calendar-harness).
  ['enablers-calendar-harness.js', 'a member named O\'Neil gets buttons that do nothing again',
    s => s.replace("      return this.escapeHtml(String(v == null ? '' : v).replace(", "      return this.escapeHtml(String(v == null ? '' : v)); void (String(v).replace(")],
  ['enablers-calendar-harness.js', 'one profile button takes the name escaped for HTML only',
    s => s.replace("RosterEngine._printEnablerProfile(\\''+self._jsArg(selectedName)+'\\')", "RosterEngine._printEnablerProfile(\\''+self.escapeHtml(selectedName)+'\\')")],

  // ---------------------------------------------------------------------
  // Offline for a live service (offline-service-harness).
  //
  // This runner mutates Index.html and nothing else, so the checks that read
  // public/sw.js -- the routing table, the strategies -- have no case here.
  // They are run for real by the harness, which lifts _swRoute out of that
  // file and executes it; what is missing is a proof that those checks BITE,
  // and nothing below supplies it.
  // ---------------------------------------------------------------------
  ['offline-service-harness.js', 'createClient is bare again, so an offline boot loses every deep link',
    s => s.replace("      if (window.supabase && window.supabase.createClient) {\r\n        _db = window.supabase.createClient(SUPA_URL, SUPA_ANON);\r\n      } else {",
                   "      _db = window.supabase.createClient(SUPA_URL, SUPA_ANON);\r\n      if (false) {")],
  ['offline-service-harness.js', 'the banner is driven by navigator.onLine again',
    s => s.replace("      var off = window.LHC_Net ? LHC_Net.offline() : !navigator.onLine;",
                   "      var off = !navigator.onLine;")],
  ['offline-service-harness.js', '...and claims it is showing data it has not got',
    s => s.replace("    function _offDraw(mode) {",
                   "    function _offDraw(mode) {\r\n      offDiv.innerHTML = '<i class=\"fa-solid fa-wifi-slash\"></i> You' + String.fromCharCode(39) + 're offline';")],
  ['offline-service-harness.js', 'a dead uplink is only noticed once the device says it has no network',
    s => s.replace("      offline: function () { return reachable === false || navigator.onLine === false; },",
                   "      offline: function () { return navigator.onLine === false; },")],
  ['offline-service-harness.js', 'a refused write is counted as the internet being down',
    s => s.replace("      var watch = String(method).toUpperCase() === 'GET' &&",
                   "      var watch = true || String(method).toUpperCase() === 'GET' &&")],
  ['offline-service-harness.js', 'a failed silent autosave blanks the indicator again, so it reads as saved',
    s => s.replace("        _soSetSaveStatus('failed');\r\n        /* It does NOT tell LHC_Net",
                   "        _soSetSaveStatus('');\r\n        /* It does NOT tell LHC_Net")],
  ['offline-service-harness.js', 'the lock rebuild gives away the song it is still holding',
    s => s.replace("    _edLockChannel = null; _edLockReady = false; _edLockOrderId = null;\r\n    _edSongChannel = null; _edSongReady = false;",
                   "    _edTeardownLocks();\r\n    _edSongChannel = null; _edSongReady = false;")],
  ['offline-service-harness.js', 'a closed order leaves a relock timer rebuilding nothing for ever',
    s => s.replace("    if (!(currentOrderData && currentOrderData.id)) return;\r\n    _edRelockTimer = setTimeout", "    _edRelockTimer = setTimeout")],
  ['offline-service-harness.js', 'a deliberate teardown triggers a pointless rebuild that drops the locks',
    s => s.replace("      if (_edLockReady && _edSongReady) { _edRelockDelay = 5000; return; }\r\n", '')],
  ['offline-service-harness.js', 'a background that will not load leaves a broken image on the wall',
    s => s.replace("        el.style.background = '#000';\r\n        _lcdBgBlackOnFail(el);\r\n      }", "        el.style.background = '#000';\r\n      }")],
  ['offline-service-harness.js', '...and the guess from the network flag is back, blanking a cached one',
    s => s.replace("    m.addEventListener('error', function() {", "    if (window.LHC_Net && LHC_Net.offline()) return;\r\n    m.addEventListener('error', function() {")
          .replace("  function _lcdBgUnresolvable(background) {\r\n    if (!background) return false;", "  function _lcdBgUnresolvable(background) {\r\n    if (window.LHC_Net && LHC_Net.offline()) return true;\r\n    if (!background) return false;")],
  ['offline-service-harness.js', 'the projector stops probing its background-image, which fires no error',
    s => s.replace("      '      bgEl.setAttribute(\"data-bg\", bg.value);' +\r\n", '')],
  ['offline-service-harness.js', 'urlsIn stops walking, so a nested slide background is never downloaded',
    s => s.replace("      if (v == null || depth > 14) return;", "      if (v == null || depth > 0) return;")],
  ['offline-service-harness.js', '...or it takes the YouTube links too, filling the cache with other people\'s video',
    s => s.replace("    var need = want || '/storage/v1/object/public/';", "    var need = want || '';")],
  ['offline-service-harness.js', 'the Phone view installs the worker, racing the desk that owns it',
    s => s.replace("    if (window.__SBM_PREVIEW) return Promise.resolve(null);\r\n    if (!('serviceWorker' in navigator))", "    if (!('serviceWorker' in navigator))")],
  ['offline-service-harness.js', 'the download builds its own REST url instead of replaying the app\'s read',
    s => s.replace("    return SBQ.loadOrder(orderId).then(function (res) {", "    return Promise.resolve({ order: {}, items: [] }).then(function (res) {")],
  ['offline-service-harness.js', 'the marks query is shaped differently, so the cached answer is never read',
    s => s.replace("        jobs.push(sup.from('song_marks').select('*').eq('song_id', sid)", "        jobs.push(sup.from('song_marks').select('id,anchor').eq('song_id', sid)")],
  ['offline-service-harness.js', 'the song id is looked for where it is not, so no song is downloaded at all',
    s => s.replace("        var sid = it.sourceId || it.songId || String(it.id || '').split('--')[0];",
                   "        var sid = it.songId || (it.content && it.content.songId);")],
  ['offline-service-harness.js', 'a liturgy id is queried as though it were a song',
    s => s.replace("        if (it.itemType !== 'song') return;\r\n", '')],
  // The banner that never showed (2026-11-13), and the warm that keeps the
  // next service on the device.
  ['offline-service-harness.js', 'any resolved answer counts as reaching the database, so a 401 reads as online',
    s => s.replace("      return p.then(function (res) { judge(res); return res; },",
                   "      return p.then(function (res) { mark(true); return res; },")],
  ['offline-service-harness.js', 'a cache-served read counts as reaching the database, so the banner never shows',
    s => s.replace("      if (cached) { mark(false); return; }   // the worker had to cover for us\r\n", '')],
  ['offline-service-harness.js', 'a cached Storage picture is taken for proof the database is up',
    s => s.replace("                  String(url).indexOf('/rest/v1/') !== -1;", "                  true;")],
  ['offline-service-harness.js', 'a 5xx is taken for a healthy database',
    s => s.replace("      if (res.status >= 500 || res.status === 0) mark(false);\r\n", '')],
  ['offline-service-harness.js', 'the warm nags the operator it was never asked to serve',
    s => s.replace("      console.warn('[LHC] could not keep the next service offline:', e && e.message);",
                   "      showToast('Could not keep the next service offline', 'error');")],
  ['offline-service-harness.js', 'the warm spends a phone\'s data allowance on Data Saver',
    s => s.replace("      if (c && c.saveData) return 'Data Saver is on';\r\n", '')],
  ['offline-service-harness.js', 'the warm re-downloads the service on every visit',
    s => s.replace("    if (rec && rec.at && (Date.now() - rec.at) < WARM_EVERY) return 'already downloaded today';\r\n", '')],
  ['offline-service-harness.js', 'the warm cuts across a download the operator started',
    s => s.replace("    if (_busy)      return 'a download is already running';\r\n", '')],
  ['offline-service-harness.js', 'it keeps the most recently EDITED order, not this Sunday\'s service',
    s => s.replace("        if (when < bestWhen) { bestWhen = when; next = o; }", "        if (!next) { bestWhen = when; next = o; }")],
  ['offline-service-harness.js', 'a songbook pseudo-order is downloaded as though it were a service',
    s => s.replace("          if (!o || !o.id || String(o.id).indexOf('standalone_') === 0) return;", "          if (!o || !o.id) return;")],
  ['offline-service-harness.js', 'the warm fires during boot, competing with the app painting',
    s => s.replace("      }, tries ? 15000 : 20000);", "      }, 0);")],
  ['offline-service-harness.js', 'a first-ever visit gives up while the worker is still installing',
    s => s.replace("        if (!LHC_Offline.ready() && ++tries < 5) { go(); return; }\r\n", '')],
  // The bar that could not be shut, and the refresh that would have thrown
  // the outage's work away (2026-11-13).
  ['offline-service-harness.js', 'the offline bar cannot be shut and sits over the header all service',
    s => s.replace('class="lhc-off-x" aria-label="Close"', 'class="lhc-off-x" hidden aria-label="Close"')],
  ['offline-service-harness.js', 'closing it hides every future outage too',
    s => s.replace('      if (!mode || _offSeenAt === _offSince()) { offDiv.classList.remove(\'show\'); return; }',
                   '      if (!mode || _offSeenAt !== -1) { offDiv.classList.remove(\'show\'); return; }')],
  ['offline-service-harness.js', 'it announces "back online" to somebody who was never offline',
    s => s.replace("      var mode = off ? 'off' : (_offWasOff ? 'back' : null);", "      var mode = off ? 'off' : 'back';")],
  ['offline-service-harness.js', 'the refresh reloads first and throws away what the outage held',
    s => s.replace('      if (!unsaved()) { location.reload(); return; }\r\n', '      location.reload(); return;\r\n')],
  ['offline-service-harness.js', '...or reloads anyway when the save will not land',
    s => s.replace('        if (++tries > 25) {           // five seconds', '        if (false) {')],
  ['offline-service-harness.js', 'a save still waiting on its debounce does not count as unsaved',
    s => s.replace("    _soUnsaved = (state === 'pending' || state === 'failed');", "    _soUnsaved = (state === 'failed');")],
  ['offline-service-harness.js', 'the internet coming back no longer saves what the outage held',
    s => s.replace('    console.info(\'[LHC] back online — saving what the outage held\');\r\n    saveImmediately();',
                   '    console.info(\'[LHC] back online\');')],
  ['offline-service-harness.js', 'the retry fires on every read that comes back, not once per reconnect',
    s => s.replace('    if (Date.now() - _soRetryAt < 15000) return;\r\n', '')],
  ['offline-service-harness.js', 'a failed save claims the network is down again, and the two make a loop',
    s => s.replace("    _soSetSaveStatus('failed');\r\n        /* It does NOT tell LHC_Net",
                   "    _soSetSaveStatus('failed');\r\n        if (window.LHC_Net) LHC_Net.mark(false);\r\n        /* It does NOT tell LHC_Net")],
  // The crash journal (crash-journal-harness). The replay is the single most
  // dangerous write in the app: a prune on a page that has read nothing.
  ['crash-journal-harness.js', 'the replay decides by two client clocks again, so a fast phone wipes another device\'s edit',
    s => s.replace("    if (typeof pending.baseEdited === 'string') {", "    if (false) {")],
  ['crash-journal-harness.js', 'the two ISO spellings of one instant stop matching, so recovery is silently off',
    s => s.replace("      var ca = new Date(cloud).getTime(), cb = new Date(pending.baseEdited).getTime();\r\n" + "      return (ca > 0 && ca === cb) ? 'replay' : 'drop';",
                   "      return cloud === pending.baseEdited ? 'replay' : 'drop';")],
  ['crash-journal-harness.js', 'a nonsense stored timestamp counts as a match',
    s => s.replace("      return (ca > 0 && ca === cb) ? 'replay' : 'drop';", "      return (ca === cb) ? 'replay' : 'drop';")],
  ['crash-journal-harness.js', 'a stored value that is merely different counts as a match',
    s => s.replace("      return (ca > 0 && ca === cb) ? 'replay' : 'drop';", "      return 'replay';")],
  ['crash-journal-harness.js', 'the journal stops recording what was believed stored',
    s => s.replace("          baseEdited: (currentOrderData && currentOrderData.lastEdited) || '',\r\n", '')],
  ['crash-journal-harness.js', 'the replay prunes again: _knownItems left undefined reads as permission',
    s => s.replace('      SBQ._knownItems[payload.id] = SBQ._knownItems[payload.id] || {};\r\n', '')],
  ['crash-journal-harness.js', 'it throws away what a load in this session had already recorded',
    s => s.replace('SBQ._knownItems[payload.id] = SBQ._knownItems[payload.id] || {};', 'SBQ._knownItems[payload.id] = {};')],
  ['crash-journal-harness.js', 'the replay inherits permission to empty the order',
    s => s.replace('      delete payload.allowEmptyItems;\r\n      delete payload.allowClearTypes;\r\n', '')],
  ['crash-journal-harness.js', 'an order deleted since the crash is re-created',
    s => s.replace("    if (!row) return 'drop';                       // the order was deleted", "    if (!row) return 'replay';")],
  ['crash-journal-harness.js', 'a seven-day-old journal is pushed anyway',
    s => s.replace("    if (!savedAt || (nowMs - savedAt) > 7 * 86400000) return 'drop';", "    if (!savedAt) return 'drop';")],
  ['crash-journal-harness.js', 'a journal with no items is replayed, which prunes the lot',
    s => s.replace("    if (!payload || !payload.id || !Array.isArray(payload.items) || !payload.items.length) return 'drop';",
                   "    if (!payload || !payload.id) return 'drop';")],
  ['offline-service-harness.js', 'a write is queued to be replayed later, which is how slides get deleted',
    s => s.replace("  var STORE = 'lhc_offline_ready';", "  var STORE = 'lhc_offline_ready', QUEUE = 'lhc_offline_queue';")],
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
