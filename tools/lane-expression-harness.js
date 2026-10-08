'use strict';
// Regression harness for the pitch lane's expression layer.
//
// WHY THIS EXISTS
// The lane drew a piano roll: every note the same pill at the same thickness,
// and the singer's own voice a 2.5px line. The cause was not the renderer. The
// song already carried dynamics, hairpins, slurs and fermatas on every note,
// and the draw loop only ever read midi, start, end and lyric -- so the music
// was in the database and never reached the screen.
//
// The fix moved the decisions a renderer cannot be tested on -- which notes a
// slur joins, which gaps are long enough to breathe in, how thick a velocity
// draws -- into src/lib/vocal-hero/laneExpression.ts, for the same reason
// laneGeometry.ts already sits outside the renderer: so a machine can check
// them without a canvas.
//
// WHAT THIS CHECKS
// Mostly the edges, because that is where this kind of code goes wrong: a slur
// whose end was deleted, a gap of exactly the breath threshold, notes that
// overlap because somebody wrote divisi, an octave-out singer, and a note
// nobody sang at all.
//
// It also checks that the RENDERER still reads the layer, and -- just as
// important -- that two hard-won behaviours survived the redesign: the green
// proof that shows which part of a note was held, and the input meter, whose
// absence is how a silent microphone once went unnoticed in the field.
//
// USAGE
//   node tools/lane-expression-harness.js
//   node tools/lane-expression-harness.js --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show HEAD~1:app/vocal-hero/CanvasLane.tsx > /tmp/old.tsx`), where the
// expression layer does not exist and the lane drew every note at one size.
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const ROOT = path.join(__dirname, '..');
const MODULE = path.join(ROOT, 'src', 'lib', 'vocal-hero', 'laneExpression.ts');
const LANE = args.find(a => !a.startsWith('--')) || path.join(ROOT, 'app', 'vocal-hero', 'CanvasLane.tsx');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

/**
 * Load a TypeScript module for real rather than regex-stripping it.
 *
 * Earlier harnesses in this directory slice a function out of Index.html with
 * a brace counter, because that file is one script and there is nothing to
 * import. This one is a module, so it is compiled by the same compiler the
 * app is built with: the thing under test is then the shipped code, not a
 * approximation of it that could pass while the real file fails.
 */
function loadModule(file) {
  if (!fs.existsSync(file)) return null;
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(file),
  });
  const exports = {};
  // `import type` is erased by the compiler, so nothing is actually required.
  new Function('exports', 'require', out.outputText)(exports, () => {
    throw new Error('laneExpression must stay pure: it required something at runtime');
  });
  return exports;
}

const L = loadModule(MODULE);
console.log('Expression layer: ' + (L ? path.relative(ROOT, MODULE) : 'ABSENT'));
console.log('Renderer:         ' + path.relative(ROOT, LANE) + '\n');

if (!L) {
  if (EXPECT_BROKEN) {
    console.log('(pre-change) there is no expression layer, so the lane drew every note alike');
    console.log('\n--expect-broken: 1 absence confirmed');
    process.exit(0);
  }
  console.error('laneExpression.ts is missing — the lane has nothing to read its dynamics from.');
  process.exit(1);
}

const note = (id, start, end, midi, marks, velocity) =>
  ({ id, part: 0, start, end, midi, lyric: id, velocity: velocity === undefined ? 85 : velocity, marks: marks || undefined });

// ---------------------------------------------------------------------------
console.log('slurSpans pairs the arcs and drops what it cannot pair');
{
  check('nothing to pair', L.slurSpans([]), []);
  check('one arc', L.slurSpans([
    note('a', 0, 1, 60, { slur: 'start' }), note('b', 1, 2, 62), note('c', 2, 3, 64, { slur: 'end' }),
  ]), [{ from: 0, to: 2 }]);
  check('two arcs', L.slurSpans([
    note('a', 0, 1, 60, { slur: 'start' }), note('b', 1, 2, 62, { slur: 'end' }),
    note('c', 2, 3, 64, { slur: 'start' }), note('d', 3, 4, 65, { slur: 'end' }),
  ]), [{ from: 0, to: 1 }, { from: 2, to: 3 }]);
  // Deleting the last note of a phrase leaves the opening mark behind. Drawing
  // it anyway would run one arc to the end of the song.
  check('an unclosed start draws nothing', L.slurSpans([
    note('a', 0, 1, 60, { slur: 'start' }), note('b', 1, 2, 62),
  ]), []);
  check('an end with nothing open draws nothing', L.slurSpans([
    note('a', 0, 1, 60), note('b', 1, 2, 62, { slur: 'end' }),
  ]), []);
  check('a second start replaces the first', L.slurSpans([
    note('a', 0, 1, 60, { slur: 'start' }), note('b', 1, 2, 62, { slur: 'start' }),
    note('c', 2, 3, 64, { slur: 'end' }),
  ]), [{ from: 1, to: 2 }]);
}

// ---------------------------------------------------------------------------
console.log('\nbreathPoints finds the rests a singer would actually use');
{
  check('no notes, no breaths', L.breathPoints([]), []);
  check('a long rest is a breath, in the middle of the gap', L.breathPoints([
    note('a', 0, 1, 60), note('b', 2, 3, 62),
  ]), [{ at: 1.5, length: 1 }]);
  // Below the threshold a gap is articulation -- the space around a staccato
  // note -- and marking it would litter the lane with breaths nobody takes.
  check('a short gap is articulation, not a breath', L.breathPoints([
    note('a', 0, 1, 60), note('b', 1.2, 2, 62),
  ]), []);
  // A rest the arranger wrote as exactly 0.45s arrives here as
  // 0.44999999999999996, so this is the case a naive `>=` drops.
  check('exactly the threshold counts', L.breathPoints([
    note('a', 0, 1, 60), note('b', 1.45, 2, 62),
  ]).map(b => ({ at: +b.at.toFixed(4), length: +b.length.toFixed(4) })), [{ at: 1.225, length: 0.45 }]);
  check('overlapping notes are not a breath', L.breathPoints([
    note('a', 0, 2, 60), note('b', 1, 3, 62),
  ]), []);
  check('two phrases, two breaths', L.breathPoints([
    note('a', 0, 1, 60), note('b', 2, 3, 62), note('c', 4, 5, 64),
  ]).length, 2);
}

// ---------------------------------------------------------------------------
console.log('\ndynamicMarkers prints a dynamic only where it changes');
{
  check('the first one is printed', [...L.dynamicMarkers([
    note('a', 0, 1, 60, { dynamic: 'p' }),
  ]).entries()], [['a', 'p']]);
  check('a repeat is not reprinted', [...L.dynamicMarkers([
    note('a', 0, 1, 60, { dynamic: 'p' }), note('b', 1, 2, 62, { dynamic: 'p' }),
  ]).entries()], [['a', 'p']]);
  check('a change is printed', [...L.dynamicMarkers([
    note('a', 0, 1, 60, { dynamic: 'p' }), note('b', 1, 2, 62, { dynamic: 'f' }),
  ]).entries()], [['a', 'p'], ['b', 'f']]);
  check('coming back is a change too', [...L.dynamicMarkers([
    note('a', 0, 1, 60, { dynamic: 'p' }), note('b', 1, 2, 62, { dynamic: 'f' }),
    note('c', 2, 3, 64, { dynamic: 'p' }),
  ]).entries()], [['a', 'p'], ['b', 'f'], ['c', 'p']]);
  check('notes without marks print nothing', [...L.dynamicMarkers([
    note('a', 0, 1, 60), note('b', 1, 2, 62),
  ]).entries()], []);
}

// ---------------------------------------------------------------------------
console.log('\nnoteThickness makes loud heavy without outgrowing the row');
{
  // The bug this guards: on a phone eighteen semitones share 117px -- a row
  // every 5.4px -- and a bar taller than its row turns the line into one
  // smear of colour. The old renderer's fixed 13px ceiling ignored the row
  // entirely, which is exactly how that happened.
  for (const rowPx of [4, 5.4, 8, 12, 20, 34]) {
    const quiet = L.noteThickness(40, rowPx);
    const loud = L.noteThickness(115, rowPx);
    check('rowPx ' + rowPx + ': loud is thicker than quiet', loud > quiet, true);
    check('rowPx ' + rowPx + ': never thicker than 18px', loud <= 18, true);
    if (rowPx >= 6) check('rowPx ' + rowPx + ': stays inside its row', loud <= rowPx, true);
  }
  check('a silent velocity still draws something', L.noteThickness(0, 20) >= 3, true);
  check('an over-range velocity does not run away', L.noteThickness(999, 20) <= 18, true);
}

// ---------------------------------------------------------------------------
console.log('\ninTune forgives an octave, the way the score engine does');
{
  check('dead on', L.inTune(60, 60), true);
  // 60.6 - 60 is 0.6000000000000014, so this is the case a naive `<=` drops.
  check('just inside tolerance', L.inTune(60.6, 60), true);
  check('just outside', L.inTune(60.7, 60), false);
  check('an octave below is the right note', L.inTune(48, 60), true);
  check('two octaves up is the right note', L.inTune(84, 60), true);
  check('a fifth away is not', L.inTune(67, 60), false);
  check('a semitone away is not', L.inTune(61, 60), false);
}

// ---------------------------------------------------------------------------
console.log('\nsungFraction reports how much of a note was actually held');
{
  const on = t => ({ t, midi: 60 });
  const off = t => ({ t, midi: 63 });
  check('a note nobody sang scores nothing', L.sungFraction([], 0, 1, 60), 0);
  check('held all the way', L.sungFraction([on(.1), on(.5), on(.9)], 0, 1, 60), 1);
  check('held half', L.sungFraction([on(.1), on(.4), off(.6), off(.9)], 0, 1, 60), 0.5);
  check('missed entirely', L.sungFraction([off(.2), off(.8)], 0, 1, 60), 0);
  // Samples from the notes either side must not count toward this one, or a
  // held previous note would score the entrance the singer actually fluffed.
  check('samples outside the note are ignored',
    L.sungFraction([on(-0.5), off(.5), on(2)], 0, 1, 60), 0);
}

// ---------------------------------------------------------------------------
console.log('\ncentsFromTarget folds octaves, so the ladder means something');
{
  check('dead on', L.centsFromTarget(60, 60), 0);
  check('a quarter tone sharp', L.centsFromTarget(60.5, 60), 50);
  check('thirty cents flat', L.centsFromTarget(59.7, 60), -30);
  // An alto practising a soprano line an octave down is in tune, not 1200
  // cents flat -- and the needle has to say so or it is useless to her.
  check('an octave down reads as in tune', L.centsFromTarget(48, 60), 0);
  check('an octave and a bit', L.centsFromTarget(72.2, 60), 20);
  check('a tritone is as far as it gets', Math.abs(L.centsFromTarget(66, 60)), 600);
}

// ---------------------------------------------------------------------------
console.log('\nthe renderer reads the layer, and kept what it already had');
{
  const src = fs.existsSync(LANE) ? fs.readFileSync(LANE, 'utf8') : '';
  if (!src) { check('the lane exists', false, true); }
  else if (EXPECT_BROKEN) {
    check('(pre-change) the lane sized every note the same', /Math\.min\(13,\s*rowPx\s*\*\s*0\.82\)/.test(src), true);
    check('(pre-change) the lane knew nothing of laneExpression', /laneExpression/.test(src), false);
  } else {
    check('it imports the expression layer', /from '@\/lib\/vocal-hero\/laneExpression'/.test(src), true);
    check('note height comes from the dynamic', /noteThickness\(/.test(src), true);
    check('the one-size-fits-all height is gone', /Math\.min\(13,\s*rowPx\s*\*\s*0\.82\)/.test(src), false);
    check('breaths are drawn', /p\.breaths/.test(src), true);
    check('slurs are drawn', /p\.slurs/.test(src), true);
    check('the ribbon width comes from the loudness recorded in the trail',
      /sample\.level/.test(src), true);
    // Two behaviours that predate this change and must outlive it.
    check('the green proof survived', /green proof/.test(src) && /inTune\(/.test(src), true);
    check('the input meter survived', /input meter/.test(src) && /level \* 45/.test(src), true);
  }
}

// ---------------------------------------------------------------------------
const failed = results.filter(ok => !ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed'
  + (EXPECT_BROKEN ? '  (--expect-broken: the pre-change shape is what passes)' : ''));
process.exit(failed ? 1 : 0);
