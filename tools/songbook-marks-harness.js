#!/usr/bin/env node
'use strict';
// songbook-marks-harness.js
//
// The geometry under the drawn remarks in the Worship Songbook's reading
// view. A stroke is kept against an ANCHOR -- a moment of the choir score
// or a line of the lyrics -- as fractions of that anchor's box, which is
// what lets a ring drawn round a word on a desk land round the same word
// on a phone, where the box is narrower and somewhere else. This slices
// the pure parts out of Index.html: the fractions and back, which anchor
// a stroke belongs to, the eraser's hit test, and the thinning of points.
//
//   node tools/songbook-marks-harness.js
//   node tools/songbook-marks-harness.js <file> --expect-broken
//
// --expect-broken is the negative control: against a source without the
// helpers it must report the absence and exit 0.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

const raw = fs.readFileSync(INDEX, 'utf8');
const lines = raw.split('\n');

// Brace-matched slice of one function, the way the other harnesses do it.
function extract(pattern, name) {
  const startIdx = lines.findIndex(l => pattern.test(l));
  if (startIdx < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('no close for ' + name);
}

const results = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log((ok ? '  ok    ' : '  FAIL  ') + label);
  if (!ok) {
    console.log('          got  ' + JSON.stringify(got));
    console.log('          want ' + JSON.stringify(want));
  }
}

const WANTED = [
  [/^  function _sbmMarkFrac\(/, '_sbmMarkFrac'],
  [/^  function _sbmMarkPoint\(/, '_sbmMarkPoint'],
  [/^  function _sbmMarkNearest\(/, '_sbmMarkNearest'],
  [/^  function _sbmMarkHit\(/, '_sbmMarkHit'],
  [/^  function _sbmMarkThin\(/, '_sbmMarkThin'],
  [/^  function _sbMarkSvg\(/, '_sbMarkSvg'],
  [/^  function _sbmMarkOrigin\(/, '_sbmMarkOrigin'],
  [/^  function _sbmMarkToLocal\(/, '_sbmMarkToLocal'],
  [/^  function _sbmMarkFromLocal\(/, '_sbmMarkFromLocal'],
  [/^  function _sbmMarkUnits\(/, '_sbmMarkUnits'],
  [/^  function _sbmMarkFit\(/, '_sbmMarkFit'],
  [/^  function _sbmMarkScale\(/, '_sbmMarkScale'],
  [/^  function _sbmLinkFrame\(/, '_sbmLinkFrame'],
  [/^  function _sbmMarkBBox\(/, '_sbmMarkBBox'],
  [/^  function _sbmMarkClosed\(/, '_sbmMarkClosed'],
  [/^  function _sbmMarkAlong\(/, '_sbmMarkAlong'],
  [/^  function _sbmBoxesNear\(/, '_sbmBoxesNear'],
  [/^  function _sbmBoxUnion\(/, '_sbmBoxUnion'],
  [/^  function _sbMarkLinkSvg\(/, '_sbMarkLinkSvg'],
  [/^  function _sbmGlowAlpha\(/, '_sbmGlowAlpha'],
  [/^  function _sbmMarkCaption\(/, '_sbmMarkCaption'],
  [/^  function _sbmPhoneFind\(/, '_sbmPhoneFind'],
  [/^  function _sbmMarkGap\(/, '_sbmMarkGap'],
  [/^  function _sbmMarkTokenNear\(/, '_sbmMarkTokenNear'],
  [/^  function _sbmKeyParts\(/, '_sbmKeyParts'],
  [/^  function _sbmFitFactor\(/, '_sbmFitFactor']
];

let S;
try {
  const src = WANTED.map(([re, name]) => extract(re, name)).join('\n');
  S = new Function(src + '\nreturn { frac: _sbmMarkFrac, point: _sbmMarkPoint, nearest: _sbmMarkNearest, hit: _sbmMarkHit, thin: _sbmMarkThin, svg: _sbMarkSvg, origin: _sbmMarkOrigin, toLocal: _sbmMarkToLocal, fromLocal: _sbmMarkFromLocal, fit: _sbmMarkFit, scale: _sbmMarkScale, link: _sbmLinkFrame, bbox: _sbmMarkBBox, closed: _sbmMarkClosed, along: _sbmMarkAlong, near: _sbmBoxesNear, union: _sbmBoxUnion, linkSvg: _sbMarkLinkSvg, glow: _sbmGlowAlpha, caption: _sbmMarkCaption, phoneFind: _sbmPhoneFind, tokenNear: _sbmMarkTokenNear, keyParts: _sbmKeyParts, fit2: _sbmFitFactor };')();
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the helpers are present.');
  process.exit(1);
}

const r4 = v => Math.round(v * 10000) / 10000;

// ---------------------------------------------------------------------------
console.log('\na stroke is kept as fractions of its anchor, and comes back');
const desk = { x: 10, y: 20, w: 200, h: 50 };
check('the middle of the box is a half, a half', S.frac(desk, 110, 45).map(r4), [0.5, 0.5]);
check('  and comes back to the same place', S.point(desk, [0.5, 0.5]), [110, 45]);
check('  a point past the box keeps going: fractions outside 0..1, not clipped',
  S.frac(desk, -10, 80).map(r4), [-0.1, 1.2]);
check('  and comes back there too', S.point(desk, [-0.1, 1.2]).map(r4), [-10, 80]);
// The same fraction on a phone's box -- narrower, taller, elsewhere.
const phone = { x: 0, y: 300, w: 100, h: 80 };
check('the same fraction lands on the same place of a narrower box', S.point(phone, [0.5, 0.5]), [50, 340]);
check('a box with no size gives no NaN', S.frac({ x: 0, y: 0, w: 0, h: 0 }, 5, 5), [0, 0]);

console.log('\nwhich anchor a stroke belongs to');
const A = { key: 'A', x: 0, y: 0, w: 100, h: 20 }, B = { key: 'B', x: 0, y: 40, w: 100, h: 20 };
check('the box the first point is in', S.nearest([A, B], 50, 10).key, 'A');
check('  in the gap, the nearer one above or below', [S.nearest([A, B], 50, 25).key, S.nearest([A, B], 50, 36).key], ['A', 'B']);
check('  off to the side, still the nearest', S.nearest([A, B], 500, 10).key, 'A');
check('  a box with no height is not an anchor', S.nearest([{ key: 'Z', x: 0, y: 0, w: 100, h: 0 }, B], 50, 2).key, 'B');
check('  nothing to anchor to is null', S.nearest([], 1, 1), null);

console.log('\nthe eraser');
const line = [[0, 0], [100, 0]];
check('a touch beside the stroke hits', S.hit(line, 50, 5, 6), true);
check('  a touch further off does not', S.hit(line, 50, 10, 6), false);
check('  nor one past its end', S.hit(line, 120, 0, 6), false);
check('  a single dot can be erased', S.hit([[10, 10]], 12, 12, 6), true);
check('  an empty stroke never hits', S.hit([], 0, 0, 6), false);

console.log('\nthinning');
check('points on top of each other are dropped, the ends kept',
  S.thin([[0, 0], [0.5, 0.5], [1, 1], [10, 10], [10.5, 10.5], [20, 20]]), [[0, 0], [10, 10], [20, 20]]);
check('  one point stays one point', S.thin([[3, 3]]), [[3, 3]]);

console.log('\na stroke is kept in widths of its word, both ways, so its shape is exact');
const word = { x: 100, y: 200, w: 60, h: 20, em: 16, kind: 'token' };       // a word on a desk
const wordPhone = { x: 10, y: 500, w: 45, h: 15, em: 12, kind: 'token' };   // the same word on a phone
const ring = [[130, 194], [146, 210], [130, 226], [114, 210]];              // a ring round it: 32 wide, 32 tall
const local = ring.map(q => S.toLocal(word, q, 'w').map(r4));
check('offsets from the word\'s centre, in widths of the word both ways', local, [[0, -0.2667], [0.2667, 0], [0, 0.2667], [-0.2667, 0]]);
const r1 = v => Math.round(v * 10) / 10;
check('  back on the desk, the same points', local.map(f => S.fromLocal(word, f, 'w').map(r1)), ring);
const onPhone = local.map(f => S.fromLocal(wordPhone, f, 'w'));
check('  on the phone, round the same word\'s centre', onPhone[0].map(r1), [32.5, 495.5]);
check('  scaled as a whole by the word (45 wide now, 60 before): still a ring, 24 by 24', [r1(onPhone[1][0] - onPhone[3][0]), r1(onPhone[2][1] - onPhone[0][1])], [24, 24]);
// The desk sets the words in a monospace face: an underline the length of
// three words there is longer than the same three words on a phone.
const wide = { x: 0, y: 0, w: 90, h: 20, em: 18, kind: 'token' }, narrow = { x: 0, y: 0, w: 60, h: 20, em: 18, kind: 'token' };
check('  an underline drawn the length of a wide word is the length of the narrow one', r4(S.fromLocal(narrow, S.toLocal(wide, [90, 25], 'w'), 'w')[0]), 60);
check('a row anchor counts from its top left', S.origin({ x: 5, y: 7, w: 100, h: 40, em: 16, kind: 'box' }), [5, 7]);
check('  and is ems both ways, having no width to speak of', S.fromLocal({ x: 5, y: 7, w: 100, h: 40, em: 16, kind: 'box' }, [1, 2], 'w'), [21, 39]);
check('a stroke from the round before (tool em) is still read as widths across and ems down', S.fromLocal(wordPhone, [0.5, 1], 'em').map(r1), [55, 519.5]);
check('a stroke from the first round (tool pen) is still read as fractions of the box', S.fromLocal(word, [0.5, 0.5], 'pen'), [130, 210]);

console.log('\na stroke from one word to another is kept between them');
// On a desk: the word "story" in the 2nd Part's row, the chord F up and to
// the left of it in the chord row. An arrow drawn from the word to the chord.
const story = { x: 300, y: 120, w: 50, h: 20, em: 16, kind: 'token' }, F = { x: 200, y: 20, w: 12, h: 20, em: 16, kind: 'token' };
const fr = S.link(story, F, 'k');
check('the frame runs from the one\'s centre to the other\'s', [fr.P, fr.Q, r4(fr.L)], [[325, 130], [206, 30], r4(Math.hypot(119, 100))]);
const shaft = [[325, 125], [265, 75], [212, 36]];
const loc = shaft.map(q => S.toLocal(fr, q).map(r4));
check('  the tail is at the start of the line, the head near its end, the middle on it', [loc[0][0] < 0.1, loc[2][0] > 0.9, Math.abs(loc[1][1]) < 0.1], [true, true, true]);
check('  and it comes back to the same points on the desk', loc.map(f => S.fromLocal(fr, f, 'w').map(r1)), shaft);
// On a phone the two sit elsewhere: the word lower and to the left, the
// chord straight above it and twice as far away.
const storyP = { x: 100, y: 400, w: 40, h: 16, em: 14, kind: 'token' }, FP = { x: 112, y: 100, w: 9, h: 16, em: 14, kind: 'token' };
const frP = S.link(storyP, FP, 'k'), onP = loc.map(f => S.fromLocal(frP, f, 'w'));
check('  the arrow still runs from the word to the chord there', [Math.hypot(onP[0][0] - 120, onP[0][1] - 408) < 12, Math.hypot(onP[2][0] - 116.5, onP[2][1] - 108) < 20, Math.abs(onP[1][0] - 118) < 12], [true, true, true]);
check('  turned to the line between them, so it points at the chord', onP[2][1] < onP[1][1] && onP[1][1] < onP[0][1], true);
check('  its shape kept: read back in the phone\'s frame it is the same stroke', onP.map(q => S.toLocal(frP, q).map(r4)), loc);
check('two ends on top of each other make no frame', S.link(story, story, 'k'), null);

console.log('\nthe shape of a stroke');
check('a ring ends about where it began', S.closed([[130, 194], [146, 210], [130, 226], [114, 210], [128, 196]]), true);
check('  an underline does not', S.closed([[100, 220], [120, 221], [140, 220], [160, 221]]), false);
check('  nor a V', S.closed([[100, 100], [110, 120], [120, 100], [121, 99]]), false);
check('  three points are never a ring', S.closed([[0, 0], [10, 0], [0, 0]]), false);
check('an arrowhead lies along its shaft', S.along([[200, 40], [212, 36], [206, 48]], [325, 130], [206, 30], 32), true);
check('  a word written beside the shaft does not', S.along([[300, 60], [320, 40], [330, 70]], [325, 130], [206, 30], 32), false);
check('the box round a stroke', S.bbox([[3, 9], [1, 2], [8, 5]]), [1, 2, 8, 9]);
check('  of nothing is nothing', S.bbox([]), [0, 0, 0, 0]);

console.log('\nwhat a stroke is attached to is shown as it lands');
check('the glow is full for a second', [S.glow(0), S.glow(500), S.glow(1100)], [1, 1, 1]);
check('  then fades', r4(S.glow(1500)), 0.5);
check('  and is gone', [S.glow(1900), S.glow(5000)], [0, 0]);
check('  a time before it began, or none, shows nothing', [S.glow(-5), S.glow(NaN)], [0, 0]);
check('a chord is named', S.caption([{ kind: 'chord', text: 'F' }]), 'On the chord F');
check('  a word, with whose row it is in', S.caption([{ kind: 'word', text: 'story', part: '2nd Part' }]), 'On \u201cstory\u201d \u00b7 2nd Part');
check('  an arrow, from its tail to its head', S.caption([{ kind: 'word', text: 'story', part: '2nd Part' }, { kind: 'chord', text: 'F' }]), 'From \u201cstory\u201d \u00b7 2nd Part to the chord F');
check('  a row, and the moment it is in', S.caption([{ kind: 'row', part: 'Melody', section: 'VERSE 1', n: 3 }]), 'On the Melody row, VERSE 1 line 3');
check('  a moment by its section and number', S.caption([{ kind: 'moment', section: '1st CHORUS', n: 4 }]), 'On 1st CHORUS, line 4');
check('  a lyric line by its number', S.caption([{ kind: 'line', n: 13 }]), 'On lyric line 13');
check('  nothing, no caption', S.caption([]), '');

console.log('\nan arrow\'s tip is about the nearest chord or word, whatever row it stops in');
// The chord F sits above the melody's row; an arrow's tip stops 5px under
// it, just inside the top of that row, where the row's own nearest word
// is "story", 66px away.
const rowM = { id: 'melody row' };
const at = { X: 486, Y: 1193, rowHit: rowM, tokens: [
  { key: 'c:2', kind: 'c', row: null, rect: { left: 483, right: 494, top: 1167, bottom: 1188, width: 11 } },
  { key: 'w:melody:5', kind: 'w', row: rowM, rect: { left: 367, right: 420, top: 1195, bottom: 1216, width: 53 } }
] };
check('handwriting in a row is kept beside that row\'s words', S.tokenNear(at, null).key, 'w:melody:5');
check('  an arrow\'s tip there is about the chord just above', S.tokenNear(at, 27, true).key, 'c:2');
check('  and a tip further than reach from anything is about nothing', S.tokenNear(Object.assign({}, at, { X: 700 }), 27, true), null);

console.log('\na mark\'s key is read by its shape, whatever the section is called');
const kp = k => { const r = S.keyParts(k); return [r.ends.map(x => [x.base, x.sub]), r.tag]; };
check('a word of a part, in a drawing', kp('s:Verse 1|3/w:men:4@gab12'), [[['s:Verse 1|3', 'w:men:4']], 'gab12']);
check('  a moment on its own, from before drawings had names', kp('s:Verse 1|3'), [[['s:Verse 1|3', '']], '']);
check('  a link between a word and a chord', kp('s:CHORUS|4/w:2nd part:5>s:CHORUS|4/c:2@gx9'), [[['s:CHORUS|4', 'w:2nd part:5'], ['s:CHORUS|4', 'c:2']], 'gx9']);
check('  a section with a slash in its name', kp('s:Chorus / Tag|2/c:0'), [[['s:Chorus / Tag|2', 'c:0']], '']);
check('  with a > in its name', kp('s:Echo (Women > Men)|1/w:women:0@gq'), [[['s:Echo (Women > Men)|1', 'w:women:0']], 'gq']);
check('  with an @ in its name', kp('s:Tag @ end|1/r:all'), [[['s:Tag @ end|1', 'r:all']], '']);
check('  a part with a slash in its name', kp('s:V|1/w:Soprano/Alto:3'), [[['s:V|1', 'w:Soprano/Alto:3']], '']);
check('  a line of the lyrics, and a word of it', [kp('l:12'), kp('l:12/w:4@gz')], [[[['l:12', '']], ''], [[['l:12', 'w:4']], 'gz']]);
check('  a sung-twice section keeps its #2', kp('s:2nd CHORUS#2|3/c:1'), [[['s:2nd CHORUS#2|3', 'c:1']], '']);

console.log('\nundo takes back the last stroke on the song in front of you');
// The session's strokes, each with its song; a sandbox with the helpers
// undo calls, recording what it deletes from the database.
const undoSrc = extract(/^  function sbmDrawUndo\(/, 'sbmDrawUndo');
function undoBox(current) {
  const env = { deleted: [], _sbmDraw: { undo: [] }, _sbmMarks: {}, cur: current };
  const f = new Function('env', 'var _sbmDraw = env._sbmDraw, _sbmMarks = env._sbmMarks;' +
    'function _sbmSong() { return { songId: env.cur }; } function _sbBaseSongId(s) { return s.songId; }' +
    'function _sbmShownBases() { return [env.cur].concat(env.under || []); }' +
    'function _sbmMarkDelete(id, base) { env.deleted.push(id + "@" + base); }' +
    'function _sbmGroupStillDrawn() {} function _sbmMarksPaintAll() {} function _sbmPhoneMarks() {}\n' +
    undoSrc + '\nreturn sbmDrawUndo;');
  env.undo = f(env);
  env.add = (id, base) => { const local = { id: id }; (env._sbmMarks[base] = env._sbmMarks[base] || []).push(local); env._sbmDraw.undo.push({ local: local, base: base }); return local; };
  return env;
}
let U = undoBox('B');
U.add('a1', 'A'); U.add('a2', 'A');
U.undo();
check('on song B, a stroke drawn on song A is never what goes', U.deleted, []);
U.add('b1', 'B'); U.cur = 'A'; U.undo();
check('  back on song A, its own last stroke goes, not B\'s newer one', U.deleted, ['a2@A']);
U = undoBox('A');
const saving = U.add('tmp_1', 'A'); U.add('a0', 'A');
U._sbmDraw.undo.reverse();   // the stroke still saving is the newest
U.undo();
check('a stroke still being saved is taken back, not the one before it', [U.deleted, saving.undone, U._sbmMarks.A.map(m => m.id)], [[], true, ['a0']]);
U = undoBox('A');
U.under = ['C'];   // a medley's next song, drawn under this one
U.add('a1', 'A'); U.add('c1', 'C'); U.add('x1', 'X');
U.undo();
check('  a stroke on the medley song under this one is on the page, and goes first', U.deleted, ['c1@C']);

console.log('\na chord line and its words share one row');
// 40 characters of a 9.6px-wide monospace, on a phone card 339px wide.
check('a pair that fits is left at full size', S.fit2(30, 9.6, 339, 16, 11), 1);
check('  one too long is set smaller until the longer line fits', r4(S.fit2(40, 9.6, 339, 16, 11)), r4(337 / 384));
check('  never below the floor: past that it wraps as before', S.fit2(200, 9.6, 339, 16, 11), 11 / 16);
check('  nothing to measure, nothing changed', [S.fit2(0, 9.6, 339, 16, 11), S.fit2(40, 0, 339, 16, 11), S.fit2(40, 9.6, 0, 16, 11)], [1, 1, 1]);

console.log('\nkeeping a moment\'s rows alike changes nothing the second time');
// A class taken off and put back is two changes, and the canvas over the
// card repaints on every change and runs this again: a loop, ~11 a second.
const evenSrc = extract(/^  function _sbmEvenRows\(/, '_sbmEvenRows');
let classOps = 0;
function fakeSys(stacked) {
  const cls = new Set(stacked ? ['vl-sys', 'vl-sys--stack'] : ['vl-sys']);
  const rect = r => ({ getBoundingClientRect: () => r });
  const row = { offsetParent: {}, querySelector: q => q === '.vl-who' ? rect({ top: 0, bottom: 18, height: 18 }) : rect({ top: 24, bottom: 60, height: 36 }) };
  return { cls: cls, querySelectorAll: () => [row], classList: {
    contains: c => cls.has(c),
    add: c => { classOps++; cls.add(c); },
    remove: c => { classOps++; cls.delete(c); },
    toggle: (c, on) => { classOps++; if (on) cls.add(c); else cls.delete(c); }
  } };
}
const systems = [fakeSys(false), fakeSys(true)];
const evenRows = new Function('document', '_sbFoldPhone', evenSrc + '\nreturn _sbmEvenRows;')({ getElementById: () => ({ querySelectorAll: () => systems }) }, () => true);
evenRows();
check('a moment whose words sit under its chips is marked stacked', systems.map(x => x.cls.has('vl-sys--stack')), [true, true]);
classOps = 0; evenRows();
check('  and a second pass touches no class at all', classOps, 0);

console.log('\nthe phone view finds the desk\'s song in its own copy of the book');
const book = [{ id: 'sbsong_a_0', songId: 'a' }, { id: 'sbsong_b_1', songId: 'b' }, { id: 'sbsong_a_2', songId: 'a' }];
check('by its id', S.phoneFind(book, 'sbsong_b_1', 'b', 0).id, 'sbsong_b_1');
// An order's item ids are its own; the same song is the same song.
const order = [{ id: 'a--x1' }, { id: 'b--x2' }, { id: 'a--x3' }];
check('  failing that, the same copy of the same song', [S.phoneFind(order, 'a--zz', 'a', 0).id, S.phoneFind(order, 'a--yy', 'a', 1).id], ['a--x1', 'a--x3']);
check('  a copy it has fewer of is the first', S.phoneFind(order, 'b--q', 'b', 4).id, 'b--x2');
check('  a song it does not have is nothing, and the view opens again', S.phoneFind(book, 'sbsong_z_9', 'z', 0), null);

console.log('\nstrokes drawn together are one drawing');
check('a stroke beside the last one joins its drawing', S.near([100, 100, 200, 140], [230, 120, 300, 160], 40), true);
check('  one further off does not', S.near([100, 100, 200, 140], [260, 120, 300, 160], 40), false);
check('  nor one above', S.near([100, 100, 200, 140], [120, 20, 180, 50], 40), false);
check('  touching counts', S.near([100, 100, 200, 140], [200, 140, 250, 170], 0), true);
check('the drawing\'s box grows round each stroke', S.union([100, 100, 200, 140], [230, 120, 300, 160]), [100, 100, 300, 160]);

console.log('\nstrokes that would run off the card are shrunk about their word until they fit');
// A word at x=100; an arrow out to 300 and a word written out to 400, on a card 250 wide.
const arrow = [[110, 50], [300, 50]], soft = [[320, 40], [400, 60]];
check('what fits is left alone', S.fit([arrow], [100, 50], 6, 1000, 0.3), 1);
check('  what runs off the right is scaled to the edge, about the word', r4(S.fit([arrow], [100, 50], 6, 244, 0.3)), r4(144 / 200));
check('  an arrow and the word it points at shrink together, by the furthest of them', r4(S.fit([arrow, soft], [100, 50], 6, 244, 0.3)), r4(144 / 300));
check('  the points are moved towards the word, shape kept', S.scale(arrow, [100, 50], 0.5), [[105, 50], [200, 50]]);
check('  and no further than minK: past that it is clipped, not dotted', S.fit([[[100, 0], [5000, 0]]], [100, 0], 6, 244, 0.3), 0.3);
check('  a stroke off the LEFT is brought in the same way', r4(S.fit([[[-50, 0], [90, 0]]], [100, 0], 6, 244, 0.3)), r4(94 / 150));
check('  a scale of one changes nothing', S.scale(arrow, [100, 50], 1), arrow);

console.log('\non a printed page, the same strokes as SVG stretched over the block');
const mark = { colour: '#dc2626', width: 7, points: [[0.1, 0.5], [0.9, 0.5]] };
const svg1 = S.svg([mark]);
check('a 1x1 viewBox stretched to the element', /viewBox="0 0 1 1" preserveAspectRatio="none"/.test(svg1), true);
check('  the points are the fractions', /points="0.1,0.5 0.9,0.5"/.test(svg1), true);
check('  the pen keeps its width in pixels however the box is stretched', /stroke-width="7"[^>]*vector-effect="non-scaling-stroke"/.test(svg1), true);
check('  in its colour', /stroke="#dc2626"/.test(svg1), true);
// A printed block holding two lines (a chord line and its words): a mark
// on the second line sits in the lower half.
check('a mark on the second line of a two-line block sits in its lower half',
  /points="0.1,0.75 0.9,0.75"/.test(S.svg([mark], () => [1, 2])), true);
check('  and on the first line, the upper half', /points="0.1,0.25 0.9,0.25"/.test(S.svg([mark], () => [0, 2])), true);
check('a colour that is not a colour is not written into the page', /stroke="#111827"/.test(S.svg([{ colour: '"><script>', width: 4, points: [[0, 0], [1, 1]] }])), true);
check('no strokes, no svg', S.svg([]), '');
const emMark = { tool: 'em', colour: '#2563eb', width: 4, points: [[-1, 0], [1, 0]] };
const emSvg = S.svg([emMark], null, 'token');
check('an em stroke on a word is a 1em square on the word\'s centre, one unit one em', /sb-mark-svg--em sb-mark-svg--centre/.test(emSvg) && /points="-0.5,0.5 1.5,0.5"/.test(emSvg), true);
check('  on a row, from its top left', /points="-1,0 1,0"/.test(S.svg([emMark], null, 'box')), true);
check('  and the pen still keeps its width', /vector-effect="non-scaling-stroke"/.test(emSvg), true);
const wMark = { tool: 'w', colour: '#2563eb', width: 4, points: [[-1, 0], [1, 0]] };
const wSvg = S.svg([wMark], null, 'token'), wRow = S.svg([wMark], null, 'box');
check('a stroke kept in widths is a square the width of the word, on its centre', /sb-mark-svg--sq/.test(wSvg) && /points="-0.5,0.5 1.5,0.5"/.test(wSvg), true);
check('  on a row, a 1em square from its top left', /sb-mark-svg--em/.test(wRow) && !/--sq/.test(wRow) && /points="-1,0 1,0"/.test(wRow), true);
const lk = S.linkSvg({ colour: '#dc2626', width: 7, points: [[0.02, 0.03], [0.5, 0.01], [0.95, 0]] }, 'mk1', 'mk2');
check('a stroke between two words names both ends for the page\'s script', /data-a="mk1" data-b="mk2"/.test(lk), true);
check('  and carries its points in the frame of the line between them', /data-pts="0.02,0.03 0.5,0.01 0.95,0"/.test(lk), true);
check('  in its colour and width', /stroke="#dc2626" stroke-width="7"/.test(lk), true);

const failed = results.filter(r => !r).length;
console.log('\n' + (failed ? failed + ' of ' + results.length + ' checks FAILED' : 'All ' + results.length + ' checks passed.'));
process.exit(failed ? 1 : 0);
