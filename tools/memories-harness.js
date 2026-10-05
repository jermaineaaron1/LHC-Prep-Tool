'use strict';
// Regression harness for the Memories view's note recovery.
//
// WHY THIS EXISTS
// Nine planning notes about real services -- which preachers took which of the
// seven last words, the year CCLC worshipped with us, the Taize that opened
// Good Friday -- were invisible in the app for months.
//
// They are stored like this:
//
//   liturgy_occasion_data.data = {
//     notes: "",
//     specialElements: [...],
//     folders: {
//       "occ-fold-1773752086376": { planningNotes: [ {id,text,color,created} ] }
//     }
//   }
//
// Those folder objects have NO name field. Not an empty name -- no key at all.
// The occasion panel renders folders by name, so a folder without one rendered
// as nothing, and everything inside it was unreachable. Good Friday showed
// "No notes yet for this service" directly above six paragraphs about Good
// Friday. Nothing errored. Nothing looked wrong. The notes were simply gone.
//
// WHAT THIS CHECKS
// That _flattenMemories reads notes from BOTH places they can live -- the
// top-level planningNotes array and the per-folder ones -- and that an unnamed
// folder is no obstacle, because that is the exact shape of the live data.
//
// It also checks the quieter rules: an empty sticky note is not a memory and
// must not render as a blank card; notes come back newest first; and each one
// still carries the occasion and folder it came from, because that is the only
// way an edit can be written back to where it was rather than to a tidier
// place of the view's choosing.
//
// USAGE
//   node tools/memories-harness.js                 # ../Index.html
//   node tools/memories-harness.js path/to/file.html
//   node tools/memories-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before this view
// existed (`git show e3aea86:Index.html > x`).
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

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

function extractFunction(name) {
  const startIdx = lines.findIndex(l => new RegExp('^\\s*function ' + name + '\\s*\\(').test(l));
  if (startIdx < 0) return null;
  let depth = 0, started = false;
  const out = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    out.push(line);
    for (const ch of line) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return { text: out.join('\n'), line: startIdx + 1 };
  }
  throw new Error('unbalanced braces while extracting ' + name);
}

const flatten = extractFunction('_flattenMemories');
const home = extractFunction('_memNoteHome');

console.log('Extracted from ' + path.basename(INDEX) + ':');
console.log('  _flattenMemories @ ' + (flatten ? 'line ' + flatten.line : 'ABSENT'));
console.log('  _memNoteHome     @ ' + (home ? 'line ' + home.line : 'ABSENT') + '\n');

if (!flatten || !home) {
  if (EXPECT_BROKEN) {
    console.log('The Memories view is absent, as expected for pre-fix source.');
    console.log('The negative control holds: these checks cannot pass without it.');
    process.exit(0);
  }
  console.error('The Memories view is missing.');
  process.exit(1);
}

// OCCASIONS is the label lookup; a trimmed stand-in is enough.
const OCCASIONS = [
  { id: 'good-friday', label: 'Good Friday' },
  { id: 'pentecost', label: 'Pentecost Sunday' },
  { id: 'maundy-thursday', label: 'Maundy Thursday' }
];

const api = new Function('OCCASIONS',
  flatten.text + '\n' + home.text + '\nreturn { _flattenMemories: _flattenMemories, _memNoteHome: _memNoteHome };'
)(OCCASIONS);

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// The live shape, reproduced exactly: unnamed folders, notes inside them.
const LIVE = {
  'good-friday': {
    notes: '',
    specialElements: [{ id: 'veneration', checked: true }],
    folders: {
      'occ-fold-1773752086376': {
        planningNotes: [{ id: 'note-a', text: 'Expressive reading of John 18 and 19', color: '#fef9c3', created: 1773752270700 }],
        specialElements: []
      },
      'occ-fold-1773752263089': {
        planningNotes: [
          { id: 'note-b', text: 'Multiple preachers', color: '#fef9c3', created: 1773752490740 },
          { id: 'note-c', text: 'Combined Service with CCLC', color: '#dbeafe', created: 1773752566703, modified: 1773800000000 }
        ],
        specialElements: []
      }
    }
  },
  'pentecost': {
    notes: '',
    folders: {
      'occ-fold-1778847045099': {
        planningNotes: [{ id: 'note-d', text: 'Use the Athanasian creed', color: '#dbeafe', created: 1779110729478 }]
      }
    }
  },
  // The one occasion that keeps a note at the top level rather than in a folder.
  'maundy-thursday': {
    notes: '',
    planningNotes: [
      { id: 'note-e', text: 'Foot washing, twelve chairs', color: '#fef9c3', created: 1775352715319 },
      { id: 'note-empty', text: '', color: '#fef9c3', created: 1775352715319 }
    ],
    specialElements: []
  }
};

console.log('reading notes out of the shape the live data actually has');
const all = api._flattenMemories(LIVE);

check('every real note is found', all.length, 5);
check('  the empty sticky is not one of them', all.filter(n => !n.text.trim()).length, 0);
check('notes inside UNNAMED folders are found', all.filter(n => n.folderId).length, 4);
check('  and so is the one at the top level', all.filter(n => !n.folderId).map(n => n.id), ['note-e']);

console.log('\neach note remembers where it came from');
const b = all.filter(n => n.id === 'note-b')[0];
check('the occasion id', b.occasionId, 'good-friday');
check('  rendered as its label', b.occasionLabel, 'Good Friday');
check('  and the folder it lives in', b.folderId, 'occ-fold-1773752263089');
const e = all.filter(n => n.id === 'note-e')[0];
check('a top-level note carries an empty folder, not a made-up one', e.folderId, '');

console.log('\nnewest first, by modified then created');
//   note-d 1779110729478   note-e 1775352715319   note-c 1773800000000 (modified)
//   note-b 1773752490740   note-a 1773752270700
check('order', all.map(n => n.id), ['note-d', 'note-e', 'note-c', 'note-b', 'note-a']);
// note-c was CREATED before note-b but modified long after, so it sorts above
// it. Sorting on `created` alone would bury the note most recently worked on.
check('a modified note sorts by its modification, not its creation',
  all.indexOf(all.filter(n => n.id === 'note-c')[0]) < all.indexOf(all.filter(n => n.id === 'note-b')[0]), true);

console.log('\nthe colours the notes were written in are kept');
check('a yellow note', all.filter(n => n.id === 'note-a')[0].color, '#fef9c3');
check('a blue one', all.filter(n => n.id === 'note-d')[0].color, '#dbeafe');

console.log('\nodd shapes do not throw');
check('no occasions at all', api._flattenMemories({}), []);
check('null', api._flattenMemories(null), []);
check('an occasion with no data', api._flattenMemories({ 'x': {} }), []);
check('a folder with no notes', api._flattenMemories({ 'good-friday': { folders: { f: {} } } }), []);
check('a null note in the array', api._flattenMemories({ 'good-friday': { planningNotes: [null] } }), []);
check('a plain string note still reads',
  api._flattenMemories({ 'good-friday': { planningNotes: ['just text'] } }).map(n => n.text), ['just text']);
check('an unknown occasion falls back to its id',
  api._flattenMemories({ 'mystery': { planningNotes: [{ text: 'x' }] } })[0].occasionLabel, 'mystery');

// ---- Writing one back lands where it came from ----------------------------
console.log('\na note is written back to the folder it came from');
{
  const data = JSON.parse(JSON.stringify(LIVE['good-friday']));
  const arr = api._memNoteHome(data, 'occ-fold-1773752263089');
  check('the folder array is the one returned', arr.length, 2);
  arr.push({ id: 'new', text: 'added' });
  check('  pushing to it reaches the real folder',
    data.folders['occ-fold-1773752263089'].planningNotes.length, 3);
  check('  and does not touch the other folder',
    data.folders['occ-fold-1773752086376'].planningNotes.length, 1);
}
{
  const data = JSON.parse(JSON.stringify(LIVE['maundy-thursday']));
  const arr = api._memNoteHome(data, '');
  check('no folder means the top-level array', arr === data.planningNotes, true);
}
{
  // A new occasion has neither, and must end up with both rather than throwing.
  const data = {};
  api._memNoteHome(data, '').push({ id: 'n1', text: 'first' });
  check('a bare occasion gains a top-level array', data.planningNotes.length, 1);
  const data2 = {};
  api._memNoteHome(data2, 'brand-new-folder').push({ id: 'n2', text: 'first' });
  check('  and a missing folder is created, not lost',
    data2.folders['brand-new-folder'].planningNotes.length, 1);
}
{
  // The thing that must never happen: creating a folder array wipes its notes.
  const data = JSON.parse(JSON.stringify(LIVE['good-friday']));
  api._memNoteHome(data, 'occ-fold-1773752086376');
  check('asking for an existing folder preserves what is in it',
    data.folders['occ-fold-1773752086376'].planningNotes.map(n => n.id), ['note-a']);
  check('  and leaves its other keys alone',
    Object.keys(data.folders['occ-fold-1773752086376']).sort(), ['planningNotes', 'specialElements']);
}

console.log('\n' + '='.repeat(60));
const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN) {
  if (pass === results.length) {
    console.log('\nBUT --expect-broken was given and everything passed.');
    console.log('This harness cannot tell the fix from its absence. Do not trust it.');
    process.exit(1);
  }
  console.log('\nFailures above are expected for pre-fix source.');
  process.exit(0);
}
if (pass === results.length) console.log('Notes in unnamed folders are reachable, and go back where they came from.');
process.exit(pass === results.length ? 0 : 1);
