'use strict';
// Regression harness: the reference a reading slot actually saves.
//
// WHY THIS EXISTS
// The Bible Browser has an editable title box, #bbPassageTitle, and three ways
// out of it: save to the Scripture library, insert into a service order, write
// to a reading slot on the Liturgy page. Two honoured the box. The third did
// not -- bbSaveToLectionarySlot read bbState.passage.reference, the canonical
// reference the Bible API hands back -- so a correction typed into the box was
// discarded with nothing said. In slot mode that box is the ONLY field, so it
// was not a cosmetic loss: it was the whole edit.
//
// What made it show on a Sunday is the plural. Ask the API for "Psalm 96" and
// it answers "Psalms 96"; the book dropdown in the same dialog is spelled
// "Psalms" for the same reason. Every psalm already in the roster is singular,
// because those came from the lectionary PDF import, which keeps the
// document's wording. So a psalm added by hand through the picker came out as
// the one odd spelling on the page, and carried through to projection and
// print.
//
// WHAT IS NOT TESTED HERE, DELIBERATELY
// There is no "Psalms" -> "Psalm" rewrite, and there must not be one. The
// psalm slot does not always hold a psalm. April-May 2026 runs a preaching
// series through Acts and Philippians with theme verses in that slot
// ("Matthew 6:24", "Luke 6: 18-19, 22-23") and a bare "-" on the weeks with
// no psalm at all; the church also picks its own festival psalms, "Psalm 2" on
// Christmas Day where the lectionary says 98. A normaliser assuming the slot
// holds "Psalm N" would quietly rewrite months of deliberate planning -- worse
// than the bug it fixed. The checks below pin the pass-through instead:
// whatever is typed is what is stored, verbatim.
//
// WHAT IT RUNS
// The real bbChosenTitle, bbSaveToLectionarySlot, bbSaveToLibrary,
// bbInsertIntoWO and bbNormaliseReference, sliced out of Index.html and run
// against tools/minidom.js with the title box present. The three save paths
// are run over the SAME box and their answers compared, so they cannot drift
// apart again without this going red.
//
// USAGE
//   node tools/reading-slot-title-harness.js
//   node tools/reading-slot-title-harness.js path/to/file.html
//   node tools/reading-slot-title-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');
const { El, makeDocument } = require('./minidom.js');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

function extractFunction(name) {
  const start = lines.findIndex(l => new RegExp('^\\s*function ' + name + '\\s*\\(').test(l));
  if (start < 0) return null;
  let depth = 0, started = false, out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces in ' + name);
}

const chosenSrc = extractFunction('bbChosenTitle');
const slotSrc = extractFunction('bbSaveToLectionarySlot');
const libSrc = extractFunction('bbSaveToLibrary');
const woSrc = extractFunction('bbInsertIntoWO');
const normSrc = extractFunction('bbNormaliseReference');
const suggestSrc = extractFunction('bbSuggestedTitle');

console.log('Reading ' + path.basename(INDEX));
console.log('  bbChosenTitle            ' + (chosenSrc ? 'found' : 'ABSENT'));
console.log('  bbSaveToLectionarySlot   ' + (slotSrc ? 'found' : 'ABSENT'));
console.log('  bbSaveToLibrary          ' + (libSrc ? 'found' : 'ABSENT'));
console.log('  bbInsertIntoWO           ' + (woSrc ? 'found' : 'ABSENT'));
console.log('  bbNormaliseReference     ' + (normSrc ? 'found' : 'ABSENT'));
console.log('  bbSuggestedTitle         ' + (suggestSrc ? 'found' : 'ABSENT') + '\n');

if (!slotSrc || !libSrc || !woSrc || !normSrc) {
  console.error('A Bible Browser save path is gone -- this harness can no longer see what it guards.');
  process.exit(1);
}

if (!chosenSrc) {
  if (EXPECT_BROKEN) {
    console.log('(pre-change) there was no shared bbChosenTitle. The library and the');
    console.log('service order read #bbPassageTitle; the reading slot read the API\'s own');
    console.log('reference instead, so the title box did nothing in slot mode and a psalm');
    console.log('added by hand was filed as "Psalms 96" among 59 singular ones.');
    console.log('\n--expect-broken: the pre-change shape is what passes');
    process.exit(0);
  }
  console.error('bbChosenTitle is gone -- the three save paths are free to disagree again,');
  console.error('and the reading slot is the one that silently ignores the title box.');
  process.exit(1);
}

if (!suggestSrc) {
  if (EXPECT_BROKEN) {
    console.log('(pre-change) there was no bbSuggestedTitle. The box was pre-filled with');
    console.log('the API\'s own reference, so adding a psalm through the picker suggested');
    console.log('"Psalms 96" and stored it for anyone who did not retype the box by hand.');
    console.log('\n--expect-broken: the pre-change shape is what passes');
    process.exit(0);
  }
  console.error('bbSuggestedTitle is gone -- the box is pre-filled with the API spelling');
  console.error('again, so the DEFAULT path files psalms as "Psalms N" once more. Making');
  console.error('the box editable only helps the person who notices.');
  process.exit(1);
}

const results = [];
const bbSuggestedTitle = new Function('return (' + suggestSrc + ')')();
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// A document holding the title box. Passing null leaves the box out
// altogether, which is what a caller opening the dialog without it looks like.
function makeDoc(titleValue) {
  const document = makeDocument();
  if (titleValue !== null) {
    const input = new El('input', '', { id: 'bbPassageTitle' });
    input.value = titleValue;
    document.root.appendChild(input);
  }
  return document;
}

// Every runner below carries the REAL bbChosenTitle, not a stub of it. A stub
// would keep passing with the helper broken, which is the exact kind of
// toothless harness the mutation test exists to catch.
const PRELUDE = chosenSrc + '\n';
const normalise = new Function(normSrc + '\nreturn bbNormaliseReference;')();

function slotSave(titleValue, passage, slotIdx) {
  const document = makeDoc(titleValue);
  const calls = [];
  const cache = {};
  const bbState = { passage: passage };
  const SBQ_READINGS = {
    setReference: function (date, idx, ref) {
      calls.push({ date: date, idx: idx, ref: ref });
      return Promise.resolve(ref);
    }
  };
  const fn = new Function('document', 'bbState', '_lectionaryPickerSlotIndex',
    '_lectionaryPickerDate', '_currentReadingDate', '_passageTextCache',
    'SBQ_READINGS', 'reloadReadings', 'closeBibleBrowser', 'showToast',
    PRELUDE + normSrc + '\n' + slotSrc + '\nreturn bbSaveToLectionarySlot;')(
    document, bbState, slotIdx == null ? 1 : slotIdx, '2026-12-24', '2026-12-24',
    cache, SBQ_READINGS, function () {}, function () {}, function () {});
  fn();
  return { calls: calls, cache: cache };
}

function librarySave(titleValue, passage) {
  const document = makeDoc(titleValue);
  const items = [];
  const bbState = { passage: passage };
  const fn = new Function('document', 'bbState', 'addItem', 'closeBibleBrowser',
    'showToast', 'filterByCategory',
    PRELUDE + libSrc + '\nreturn bbSaveToLibrary;')(
    document, bbState, function (it) { items.push(it); }, function () {},
    function () {}, function () {});
  fn();
  return { items: items };
}

function woInsert(titleValue, passage) {
  const document = makeDoc(titleValue);
  const inserted = [];
  const bbState = { passage: passage };
  const WO = {
    addScriptureToSection: function (sid, item) { inserted.push(item); },
    insertScriptureIntoBox: function (box, item) { inserted.push(item); }
  };
  const fn = new Function('document', 'bbState', 'biblePickerTargetBox',
    'biblePickerTargetSectionId', 'WO', 'closeBibleBrowser', 'showToast',
    PRELUDE + woSrc + '\nreturn bbInsertIntoWO;')(
    document, bbState, null, 'sec-scripture', WO, function () {}, function () {});
  fn();
  return { inserted: inserted };
}

const PASSAGE = { reference: 'Psalms 96', translation: 'ESV',
                  text: '[1] Oh sing to the LORD a new song', note: '' };

// What each of the three paths makes of the same dialog state.
function titles(typed, passage) {
  const p = passage || PASSAGE;
  const slot = slotSave(typed, p).calls;
  const lib = librarySave(typed, p).items;
  const wo = woInsert(typed, p).inserted;
  return {
    slot: slot.length ? slot[0].ref : null,
    library: lib.length ? lib[0].title : null,
    order: wo.length ? wo[0].title : null
  };
}

// ---------------------------------------------------------------------------
console.log('the psalm that started this');
{
  // The dialog pre-fills the box with the API's reference, so "Psalm 96"
  // here is somebody correcting "Psalms 96" before saving.
  const t = titles('Psalm 96');
  check('the reading slot saves what was typed', t.slot, 'Psalm 96');
  check('and not the plural the API returned', t.slot === 'Psalms 96', false);
  check('the library agrees', t.library, 'Psalm 96');
  check('the service order agrees', t.order, 'Psalm 96');
}

// ---------------------------------------------------------------------------
console.log('\nwhat the box is pre-filled with, for the person who types nothing');
{
  // The fix above made the box count. This makes its SUGGESTION right, which
  // is what the default path stores -- most people will not retype a
  // reference the dialog already filled in for them.
  check('the suggestion is singular', bbSuggestedTitle('Psalms 96'), 'Psalm 96');
  check('verses come along', bbSuggestedTitle('Psalms 96:1-13'), 'Psalm 96:1-13');
  check('a singular one is left alone', bbSuggestedTitle('Psalm 96'), 'Psalm 96');
  check('other books are untouched', bbSuggestedTitle('Isaiah 9:2-7'), 'Isaiah 9:2-7');

  // Only a LEADING book name followed by a number. The word elsewhere in a
  // title is somebody's own wording and none of this function's business.
  check('the word mid-title is not a book name',
    bbSuggestedTitle('Readings from Psalms'), 'Readings from Psalms');
  check('nor is it without a number', bbSuggestedTitle('Psalms'), 'Psalms');
  check('nothing is nothing', [bbSuggestedTitle(''), bbSuggestedTitle(null)], ['', '']);

  // End to end: the API answers plural, the box is filled from it, nobody
  // edits, and the roster still gets the house spelling.
  const t = titles(bbSuggestedTitle('Psalms 96'));
  check('an untouched box now files the psalm singular',
    [t.slot, t.library, t.order], ['Psalm 96', 'Psalm 96', 'Psalm 96']);

  // And the slot still stores verbatim whatever a person puts there: the
  // suggestion is tidied, the decision is not.
  [['-', 'a week with no psalm'],
   ['Matthew 6:24', 'a theme verse in the psalm slot'],
   ['Psalms 96', 'the plural, if somebody really wants it']].forEach(function (row) {
    check(row[1] + ' is stored as typed', titles(row[0]).slot, row[0]);
  });
}

// ---------------------------------------------------------------------------
console.log('\nall three save paths answer the same');
{
  // The point of the shared helper. Each row is one state of the dialog.
  const STATES = [
    ['Psalm 96', 'Psalm 96', 'a corrected reference'],
    ['Psalms 96', 'Psalms 96', 'the reference left as the API gave it'],
    ['', 'Psalms 96', 'an empty box falls back to the passage'],
    ['   ', 'Psalms 96', 'a box holding only spaces falls back too'],
    [null, 'Psalms 96', 'no box at all falls back'],
    ['  Psalm 96  ', 'Psalm 96', 'surrounding space is dropped']
  ];
  STATES.forEach(function (row) {
    const t = titles(row[0]);
    check(row[2], [t.slot, t.library, t.order], [row[1], row[1], row[1]]);
  });
}

// ---------------------------------------------------------------------------
console.log('\nthe one difference that is meant to be there');
{
  // With no reference to fall back on the two want different things:
  // "Scripture" is a reasonable name for a library item and a useless
  // reading reference, and setReference treats '' as clearing the slot.
  const empty = { reference: '', translation: '', text: 'x' };
  check('the library names an untitled passage', titles('', empty).library, 'Scripture');
  check('the service order does the same', titles('', empty).order, 'Scripture');
  check('the reading slot does not invent a reference', titles('', empty).slot, '');
}

// ---------------------------------------------------------------------------
console.log('\nwhatever is typed is stored verbatim');
{
  // Live 2026 roster values. The psalm slot is repurposed for a preaching
  // series through Acts and Philippians, and "-" means there is no psalm
  // that week. Any coercion toward "Psalm N" would rewrite real planning.
  const VERBATIM = [
    ['-', 'the sentinel for a week with no psalm'],
    ['Matthew 6:24', 'a theme verse in the psalm slot'],
    ['Luke 6: 18-19, 22-23', 'another, spaced the way the office types it'],
    ['Acts 2 (Special Reading)', 'a reading carrying its own note'],
    ['Psalm 2', 'the house psalm for Christmas Day, not the lectionary 98'],
    ['Psalm 72:1-7', 'a range, kept exactly'],
    ['Philippians 3:4b-14', 'a part-verse letter, which the slot keeps'],
    ['Psalm 34:1-10, 22', 'a split range with its space']
  ];
  VERBATIM.forEach(function (row) {
    check('"' + row[0] + '" is stored as typed (' + row[1] + ')',
      slotSave(row[0], PASSAGE).calls[0].ref, row[0]);
  });

  // The normaliser is for looking a passage UP, and tidies punctuation only.
  // It must not touch book names, or it would reintroduce the coercion by the
  // back door wherever a caller normalises before writing.
  check('normalising does not singularise a book name', normalise('Psalms 96'), 'Psalms 96');
  check('nor pluralise one', normalise('Psalm 96'), 'Psalm 96');
  check('and leaves the no-psalm sentinel alone', normalise('-'), '-');

  // Source, not behaviour: a rewrite added to either function would have to
  // name the book to do its work.
  const code = s => s.replace(/^\s*\/\/.*$/gm, '');
  check('neither the helper nor the slot save mentions the book at all',
    /Psalms/.test(code(chosenSrc) + code(slotSrc)), false);
}

// ---------------------------------------------------------------------------
console.log('\nthe slot and date it was asked about');
{
  // A reading filed under the wrong role would put the psalm in the Gospel.
  check('the slot index is passed through', slotSave('Psalm 96', PASSAGE, 1).calls[0].idx, 1);
  check('and so is the gospel slot', slotSave('John 1:1-14', PASSAGE, 3).calls[0].idx, 3);
  check('the date comes from the picker', slotSave('Psalm 96', PASSAGE).calls[0].date, '2026-12-24');
  check('it writes exactly once', slotSave('Psalm 96', PASSAGE).calls.length, 1);
}

// ---------------------------------------------------------------------------
console.log('\nthe fetched text is cached where the reader will look for it');
{
  // The reader loads a reading by the roster's reference:
  //   var key = bbNormaliseReference(reference); _passageTextCache[key]
  // So the cache has to be keyed on what was SAVED. Keyed on the API's
  // canonical reference instead, every corrected reference misses and goes
  // back to the API for text already in hand.
  const run = slotSave('Psalm 96', PASSAGE);
  const saved = run.calls[0].ref;
  const readerKey = normalise(saved);
  check('the reader\'s lookup finds it', !!run.cache[readerKey], true);
  check('and it is not filed under the API\'s spelling',
    Object.keys(run.cache), [readerKey]);
  check('the cached label matches the roster', run.cache[readerKey].reference, saved);
  check('the text is the one that was fetched', run.cache[readerKey].text, PASSAGE.text);
  check('with its translation', run.cache[readerKey].translation, 'ESV');

  // A reference typed with the office's spacing still has to resolve.
  const spaced = slotSave('Psalm 80: 7 -19', PASSAGE);
  check('a loosely spaced reference is still reachable',
    !!spaced.cache[normalise(spaced.calls[0].ref)], true);
  check('while the roster keeps the spacing as typed',
    spaced.calls[0].ref, 'Psalm 80: 7 -19');
}

// ---------------------------------------------------------------------------
console.log('\none place decides the title');
{
  // The three paths can only agree by asking the same function.
  check('the reading slot asks it', /bbChosenTitle\(/.test(slotSrc), true);
  check('the library asks it', /bbChosenTitle\(/.test(libSrc), true);
  check('the service order asks it', /bbChosenTitle\(/.test(woSrc), true);

  // And none of them may read the box or the passage for a title directly,
  // which is how the slot path came to ignore it in the first place.
  [['the reading slot', slotSrc], ['the library', libSrc], ['the service order', woSrc]]
    .forEach(function (row) {
      check(row[0] + ' does not read the box itself',
        /getElementById\('bbPassageTitle'\)/.test(row[1]), false);
    });
  check('the reading slot no longer takes the reference straight off the passage',
    /var reference = bbState\.passage\.reference/.test(slotSrc), false);

  // Only the helper and the pre-fill in bbDoFetch touch the box.
  check('exactly two places touch the title box',
    (raw.match(/getElementById\('bbPassageTitle'\)/g) || []).length, 2);
  check('and the helper is one of them',
    /getElementById\('bbPassageTitle'\)/.test(chosenSrc), true);
  check('the other is the pre-fill, which is what makes the box editable',
    /titleInput\.value = bbSuggestedTitle\(result\.reference \|\| reference\);/.test(raw), true);
  // The suggestion is tidied on the way IN. Nothing tidies it on the way out.
  check('the pre-fill goes through the suggestion',
    /titleInput\.value = bbSuggestedTitle\(/.test(raw), true);
  check('and the saved value still does not',
    /bbSuggestedTitle/.test(chosenSrc) || /bbSuggestedTitle/.test(slotSrc), false);
}

// ---------------------------------------------------------------------------
const failed = results.filter(ok => !ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
