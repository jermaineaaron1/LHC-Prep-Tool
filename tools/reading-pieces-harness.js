'use strict';
// Harness for readings that skip verses (2026-11-11). From the operator:
// "Isaiah 61:1-4, 8-11" was put into the service as verses 1-4 only.
//
// The ESV answers a reference in pieces with one passage PER PIECE, and the
// route kept only the first. Four upcoming readings were saved cut short:
// Zephaniah 1:7, 12-18 (as 7), Ezekiel 34:11-16, 20-24 (as 11-16),
// Isaiah 61:1-4, 8-11 (as 1-4) and John 1:6-8, 19-28 (as 6-8).
//
//   1. The route reads every passage the ESV sends, in order.
//   2. A reading's words are checked against its reference (_woReadingGaps).
//   3. An upcoming order opened in the builder fetches a cut-short reading
//      whole and puts it in, one step with Undo (_woMendReadings).
//
// USAGE
//   node tools/reading-pieces-harness.js
//   node tools/reading-pieces-harness.js <Index.html> --expect-broken [route.ts]

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const files = args.filter(a => !a.startsWith('--'));
const INDEX = files[0] || path.join(__dirname, '..', 'Index.html');
const ROUTE = files[1] || path.join(__dirname, '..', 'app', 'api', 'bible-passage', 'route.ts');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8');
const RSRC = fs.existsSync(ROUTE) ? fs.readFileSync(ROUTE, 'utf8') : '';
const lines = SRC.split('\n');

function extractFrom(text, startRe) {
  const ls = text.split('\n');
  const startIdx = ls.findIndex(l => startRe.test(l));
  if (startIdx < 0) throw new Error('not found: ' + startRe);
  let depth = 0, started = false, out = [];
  for (let i = startIdx; i < ls.length; i++) {
    out.push(ls[i]);
    for (const ch of ls[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('unbalanced braces: ' + startRe);
}
const extractFn = name => extractFrom(SRC, new RegExp('^  function ' + name + '\\s*\\('));
const fn = n => { try { return extractFn(n); } catch (e) { return ''; } };
const varLine = name => lines.find(l => new RegExp('^  var ' + name + '\\b').test(l)) || '';

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

(async () => {
  // ------------------------------------------------------------ 1. the route
  console.log('\n1. The route reads every piece the ESV sends');
  let esv = null, routeDetail = '';
  try {
    const body = extractFrom(RSRC, /^function esvVerseLines\(/)
      .replace(/\(passages: string\[\]\): \{ lines: string\[\]; verseCount: number \}/, '(passages)')
      .replace(/const lines: string\[\] = \[\];/, 'const lines = [];');
    esv = new Function(body + '\nreturn esvVerseLines;')();
  } catch (e) { routeDetail = e.message; }
  if (esv) {
    const r = esv(['[1] The Spirit of the Lord GOD is upon me,  because\n the LORD [2] to proclaim [3] to grant [4] They shall build',
                   '[8] For I the LORD love justice; [9] Their offspring [10] I will greatly rejoice [11] For as the earth']);
    check('two pieces come back as eight verses, in order, a line a verse',
      r.verseCount === 8 && r.lines.map(l => (l.match(/^\[(\d+)\]/) || [])[1]).join(',') === '1,2,3,4,8,9,10,11' &&
      r.lines[0] === '[1] The Spirit of the Lord GOD is upon me, because the LORD', JSON.stringify(r));
    const one = esv(['[10] I will greatly rejoice [11] For as the earth [1] For Zion’s sake [2] The nations [3] You shall be']);
    check('a reading that runs into the next chapter is one piece, as before', one.verseCount === 5);
  } else check('the route has a verse reader for every piece', false, routeDetail);
  check('...and the route hands it every passage, never only the first',
    /const raws: string\[\] = data\.passages\.map\(/.test(RSRC) && /const read = esvVerseLines\(raws\);/.test(RSRC) && !/data\.passages\[0\]/.test(RSRC));

  // ------------------------------------------------------------ 2. the check
  console.log('\n2. A reading\'s words against its reference');
  let P = null;
  try {
    P = new Function(['_woRefPieces', '_woReadingGaps', '_woReadingWhole', '_woReadingRef', '_woReadingText'].map(extractFn).join('\n') +
      '\nreturn { pieces: _woRefPieces, gaps: _woReadingGaps, whole: _woReadingWhole, ref: _woReadingRef, text: _woReadingText };')();
  } catch (e) { console.log('  (could not build: ' + e.message + ')'); }
  if (P) {
    const nums = a => a.map(n => '[' + n + '] v').join('\n');
    const pc = P.pieces('Isaiah 61:1-4, 8-11');
    check('"Isaiah 61:1-4, 8-11" is two pieces of chapter 61, from verses 1 and 8',
      pc.length === 2 && pc[0].chapter === 61 && pc[0].verse === 1 && pc[1].chapter === 61 && pc[1].verse === 8, JSON.stringify(pc));
    check('the four readings saved cut short are seen to be, and say which piece is missing',
      P.gaps('Isaiah 61:1-4, 8-11', nums([1, 2, 3, 4])).join() === '8-11' &&
      P.gaps('John 1:6-8, 19-28', nums([6, 7, 8])).join() === '19-28' &&
      P.gaps('Ezekiel 34:11-16, 20-24', nums([11, 12, 13, 14, 15, 16])).join() === '20-24' &&
      P.gaps('Zephaniah 1:7, 12-18', nums([7])).join() === '12-18');
    check('...and whole once every piece is there',
      P.gaps('Isaiah 61:1-4, 8-11', nums([1, 2, 3, 4, 8, 9, 10, 11])).length === 0 &&
      P.gaps('Zephaniah 1:7, 12-18', nums([7, 12, 13, 14, 15, 16, 17, 18])).length === 0);
    check('written as people write them: an en dash, spaces, "4b", a semicolon, a book with a number',
      P.gaps('Isaiah 61 : 1 – 4b ,  8–11', nums([1, 2, 3, 4])).join() === '8-11' &&
      P.gaps('1 Thessalonians 5:16-18; 23-24', nums([16, 17, 18])).join() === '23-24' &&
      P.gaps('John 1:6-8; 2:1-5', nums([6, 7, 8])).join() === '2:1-5');
    check('cannot tell, so leaves alone: one piece, a psalm with no verse numbers, a whole chapter, nothing found',
      P.gaps('Isaiah 61:10-62:3', nums([10, 11, 1, 2, 3])).length === 0 &&
      P.gaps('Psalm 34:1-10, 22', 'L: I will bless the LORD\nC: My soul makes its boast').length === 0 &&
      P.gaps('Psalm 23', nums([1, 2])).length === 0 && P.gaps('Isaiah 55', '').length === 0 &&
      P.gaps('Isaiah 61:1-4, 8-11', nums([30, 31])).length === 0 && P.gaps('', 'x').length === 0);
    check('a passage is whole only with every piece there, never by default', P.whole('Isaiah 61:1-4, 8-11', nums([1, 2, 3, 4, 8, 9])) &&
      !P.whole('Isaiah 61:1-4, 8-11', nums([1, 2, 3, 4])) && !P.whole('John 1:6-8, 19-28', nums([1, 2, 3, 4])) && !P.whole('Psalm 23', nums([1])));
    check('a reading\'s reference and words are read from the item', P.ref({ title: 'T', content: { reference: 'R 1:1' } }) === 'R 1:1' &&
      P.ref({ title: 'T 1:2' }) === 'T 1:2' && P.text({ slides: [{ content: 'a' }, { content: 'b' }] }) === 'a\nb' && P.text({}) === '');
  }

  // ------------------------------------------------------------ 3. the mend
  console.log('\n3. An upcoming order fetches a cut-short reading whole');
  function mendScope(st) {
    const body = ['_woRefPieces', '_woReadingGaps', '_woReadingWhole', '_woReadingRef', '_woReadingText', '_woScriptureSlides', '_woScriptureSlideKind', '_woMendReadings'].map(extractFn).join('\n');
    return new Function('S', 'setTimeout', varLine('_SCR_ALLELUIA') + '\n' + varLine('_SCR_GOSPEL_RESPONSE') + '\n' + varLine('_SCR_READING_RESPONSE') + '\n' +
      'var currentOrderData = S.order, _sbStandaloneId = null, LiturgyModule = { fetchPassage: function(r, t) { S.asked.push(r + "|" + t); return Promise.resolve(S.answer(r)); } };' +
      'function _woOrderIsUpcoming() { return S.upcoming; } function _woLcdInPage() { return S.lcd; }' +
      'function _lbdChange(f) { S.changes++; return f() !== false; } function showToast(m, k, o) { S.toasts.push(m); S.undo = o; } function _woUndoOpts() { return { action: "Undo" }; }\n' +
      body + '\nvar _woMendDone = {};\nreturn { mend: _woMendReadings, done: function() { return _woMendDone; } };')(st, f => { f(); return 1; });
  }
  const isaiahOld = [{ index: 0, content: '[1] The Spirit\n[2] to proclaim', background: 'bg-a' }, { index: 1, content: '[3] to grant\n[4] They shall', background: '' },
    { index: 2, content: 'P: The Word of the Lord\nC: Thanks be to God', background: 'bg-c' }];
  const johnOld = [{ index: 0, content: 'Alleluia Lord to whom shall we go\nYou have the words of Eternal Life\nAlleluia' },
    { index: 1, content: 'P: The Gospel is according to John 1:6-8, 19-28\nC: Glory to You, O Lord' }, { index: 2, content: '[6] There was a man\n[7] He came' },
    { index: 3, content: '[8] He was not the light' }, { index: 4, content: 'P: This is the Gospel of our Lord\nC: Praise to You, O Christ' }];
  const whole = { 'Isaiah 61:1-4, 8-11': '[1] a\n[2] b\n[3] c\n[4] d\n[8] e\n[9] f\n[10] g\n[11] h', 'John 1:6-8, 19-28': '[6] a\n[7] b\n[8] c\n[19] d\n[20] e' };
  const mk = extra => Object.assign({
    order: { id: 'order_1', allItems: [
      { id: 'r1', itemType: 'scripture', title: 'Isaiah 61:1-4, 8-11', content: { reference: 'Isaiah 61:1-4, 8-11', subLabel: 'First Reading' }, slides: JSON.parse(JSON.stringify(isaiahOld)) },
      { id: 'r2', itemType: 'scripture', title: 'John 1:6-8, 19-28', content: { reference: 'John 1:6-8, 19-28', subLabel: 'Gospel' }, slides: JSON.parse(JSON.stringify(johnOld)) },
      { id: 'r3', itemType: 'scripture', title: 'Luke 1:26-38', content: { reference: 'Luke 1:26-38', subLabel: 'Second Reading' }, slides: [{ content: '[26] x' }] },
      { id: 'l1', itemType: 'liturgy', title: 'Invocation', slides: [{ content: 'L: In the Name' }] }] },
    upcoming: true, lcd: false, changes: 0, toasts: [], asked: [], answer: r => ({ text: whole[r], reference: r })
  }, extra || {});
  const run = async st2 => { try { const m = mendScope(st2); await m.mend(); return m; } catch (e) { st2.err = e.message; return { mend: async () => {}, done: () => ({}) }; } };
  let st = mk(), detail = '';
  let M = await run(st); detail = st.err || '';
  const it1 = st.order.allItems[0], it2 = st.order.allItems[1];
  const words = it => it.slides.map(s => s.content).join('\n');
  check('only the readings cut short are fetched again, from the ESV', st.asked.join() === 'Isaiah 61:1-4, 8-11|esv,John 1:6-8, 19-28|esv', st.asked.join() + ' ' + detail);
  check('...and put in whole, in one step', st.changes === 1 && /\[8\] e/.test(words(it1)) && /\[11\] h/.test(words(it1)) && /\[19\] d/.test(words(it2)));
  check('a reading keeps its response, a Gospel its Alleluia and its own response',
    /P: The Word of the Lord/.test(it1.slides[it1.slides.length - 1].content) && /^Alleluia/.test(it2.slides[0].content) &&
    /The Gospel is according to John 1:6-8, 19-28/.test(it2.slides[1].content) && /Praise to You, O Christ/.test(it2.slides[it2.slides.length - 1].content));
  check('each slide keeps the background it had in its place', it1.slides[0].background === 'bg-a' && it1.slides[2].background === 'bg-c' && it1.slides[1].background === '');
  check('nothing else is touched', st.order.allItems[2].slides.length === 1 && st.order.allItems[3].slides[0].content === 'L: In the Name');
  check('the toast names them, with Undo', /Put in the verses missing from Isaiah 61:1-4, 8-11 and John 1:6-8, 19-28/.test(st.toasts[0] || '') && st.undo && st.undo.action === 'Undo', st.toasts.join(' | '));
  const again = st.changes; await M.mend();
  check('once an order a session', st.changes === again && st.asked.length === 2);

  st = mk({ upcoming: false }); M = await run(st);
  check('a past order is a record of what was read: never fetched again', st.asked.length === 0 && st.changes === 0);
  st = mk({ lcd: true }); M = await run(st);
  check('LCD Projection drawn meanwhile: nothing written, and left for the next opening (gotcha 35)', st.asked.length === 2 && st.changes === 0 && !M.done().order_1);
  st = mk({ answer: r => ({ text: '[1] a\n[2] b\n[3] c\n[4] d', reference: r }) }); M = await run(st);
  check('a fetch that is still short, or numbered some other way, replaces nothing', !st.err && st.changes === 0 &&
    /\[4\] They shall/.test(words(st.order.allItems[0])) && /\[8\] He was not the light/.test(words(st.order.allItems[1])), st.err);

  const ar = fn('_woAutoReadings');
  check('it runs after the roster\'s readings are filled in, when the builder opens an upcoming order',
    /var filled = fillReadingsFromRoster\(\{ quiet: true, auto: true \}\);\r?\n\s*\/\/[^\n]*\r?\n\s*if \(step === 'liturgy'\) Promise\.resolve\(filled\)\.then\(_woMendReadings, _woMendReadings\);/.test(ar));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (EXPECT_BROKEN) {
    if (fail === 0) { console.log('--expect-broken: nothing failed, so this source already has it (or the harness has no teeth)'); process.exit(1); }
    console.log('--expect-broken: failures above are the expected ones');
    process.exit(0);
  }
  process.exit(fail ? 1 : 0);
})();
