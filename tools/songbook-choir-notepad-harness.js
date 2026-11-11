'use strict';
// Harness for a choir page as a notepad (CLAUDE.md gotcha 67).
//
// WHY THIS EXISTS
// From the operator (2026-11-06): make Book Mode's choir pages typeable
// too; recognise the part labels people type ("Vocals 1, 2, 3, Men, Women,
// Melody, etc."); give a way to highlight lines and mark them as parts that
// sing together; and let the chords be typed as well. Holding a choir page
// puts the whole arrangement on the page as text, each part named as a
// person writes it, the chords in the key sung. Each part is checked here:
//   - a label is read whichever way it is typed: [Melody], W:, Women:,
//     Melody:, Vocals 2:, a name only this song uses -- and words that only
//     look like a label ("Lord: have mercy") stay words;
//   - the notepad's text reads back to the very arrangement it was made
//     from, chords included, and a chord left as it was is stored as it
//     was, though it was shown in another key;
//   - what each line is shown as (who sings it, and which moments are sung
//     at once) is what the parser will save;
//   - Sing together joins the highlighted moments, Take turns parts them,
//     and each refuses what the parser could not save as asked;
//   - Enter saves through Overview Edit's own save, Esc and an untouched
//     page save nothing, and a failed save leaves what was typed to type on.
//
// USAGE
//   node tools/songbook-choir-notepad-harness.js                 # ../Index.html
//   node tools/songbook-choir-notepad-harness.js path/to/file.html
//   node tools/songbook-choir-notepad-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 86f18cf:Index.html > x`).
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

const SRC = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const fn = name => { const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };
const top = name => { const m = SRC.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\) \\{[^]*?\\n\\}')); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 600) : '')); }
}
const J = JSON.stringify;

// ---------------------------------------------------------------------------
// The sliced source: the voice-lines module, the chord detector and
// transposer, the pad and the choir notepad.
// ---------------------------------------------------------------------------
const vStart = SRC.indexOf('\nwindow.lhcVoiceLines = {');
const vEnd = vStart < 0 ? -1 : SRC.indexOf('\n};', vStart);
let V = null;
try { V = new Function('var window = {};\n' + SRC.slice(vStart, vEnd + 3) + '\nreturn window.lhcVoiceLines;')(); } catch (e) { V = null; }

if (!V || typeof V.labelOf !== 'function' || !fn('_sbChNpInfo')) {
  if (EXPECT_BROKEN) { console.log('--expect-broken: no typed part labels and no choir notepad, as expected.'); process.exit(0); }
  console.log('FAIL the voice-lines module has no labelOf, or there is no choir notepad');
  process.exit(1);
}
if (EXPECT_BROKEN) { console.log('\nBUT --expect-broken was given and the choir notepad is present.'); process.exit(1); }

const tokRe = (SRC.match(/\nvar CHORD_TOKEN_RE = [^\n]*/) || [''])[0];
const isChord = new Function(tokRe + '\n' + top('lhcChordAscii') + '\n' + top('isChordToken') + '\n' + top('isChordLineGlobal') + '\nreturn isChordLineGlobal;')();
const XP = new Function(top('transposeChordLinePrint') + '\nreturn transposeChordLinePrint;')();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PAD = ['_sbmAllPrefix', '_sbmPadLine', '_sbmPadText', '_sbmPadIndent', '_sbmPadWords', '_sbmPadSplit',
  '_sbChNpLine', '_sbChNpInfo', '_sbChNpSpan', '_sbChNpJoin', '_sbChNpSplit', '_sbChNpChords', '_sbChNpSame'];
const missing = PAD.filter(n => !fn(n));
check('every function this needs is in the source', !missing.length, missing.join(', '));
const P = new Function('window', 'escapeHtml', PAD.map(fn).join('\n') +
  '\nreturn { padText: _sbmPadText, split: _sbmPadSplit, line: _sbChNpLine, info: _sbChNpInfo, join: _sbChNpJoin,' +
  ' cut: _sbChNpSplit, chords: _sbChNpChords, same: _sbChNpSame, allPrefix: _sbmAllPrefix, words: _sbmPadWords };')({ lhcVoiceLines: V }, esc);

// ---------------------------------------------------------------------------
console.log('\nA part label, typed any way a person types it');
const L = (t, parts) => { const r = V.labelOf(t, parts); return r ? r.part : null; };
check('Melody: is the Melody', L('Melody: It came upon') === 'Melody' && V.labelOf('Melody: x').len === 8);
check('Vocals 1:, Vocals 2:, Vocals 3: are three parts', J(['Vocals 1: a', 'Vocals 2: a', 'Vocals 3: a'].map(t => L(t))) === J(['Vocals 1', 'Vocals 2', 'Vocals 3']));
check('...typed in lower case, given capitals', L('vocals 2: a') === 'Vocals 2' && L('lead vocals: a') === 'Lead Vocals');
check('Women: and Men: are the two lanes, as W: and M: are', J(['Women: a', 'Men : a', 'W: a', 'M:a', 'women: a'].map(t => L(t))) === J(['women', 'men', 'women', 'men', 'women']));
check('All:, Everyone:, Unison: and B: are everybody', J(['All: a', 'Everyone: a', 'Unison: a', 'B: a', 'Both: a'].map(t => L(t))) === J(['both', 'both', 'both', 'both', 'both']));
check('the names a choir calls its parts', J(['Soprano: a', 'Alto 2: a', 'Tenors: a', 'Descant: a', 'Lead: a', 'Solo: a', '1st Part: a', 'Harmony: a', 'Women 2: a', 'Choir: a'].map(t => L(t))) ===
  J(['Soprano', 'Alto 2', 'Tenors', 'Descant', 'Lead', 'Solo', '1st Part', 'Harmony', 'Women 2', 'Choir']));
check('[Kids Choir] in brackets is that part, as it always was', L('[Kids Choir] a') === 'Kids Choir' && L('[All] a') === 'both' && L('[Women]: a') === 'women');
check('a name only this song uses is read with a colon when the song has it', L('Kids Choir: a') === null && L('Kids Choir: a', ['Kids Choir']) === 'Kids Choir');
check('...spelt as the song spells it', L('kids choir: a', ['Kids Choir']) === 'Kids Choir' && L('VOCALS 2: a', ['Vocals 2']) === 'Vocals 2');
check('words that only look like a label stay words', J(['Lord: have mercy', '10:30 at the door', 'Glory to God', 'Verse 1: x', 'Said he: go'].map(t => L(t))) === J([null, null, null, null, null]));

console.log('\nThe parser reads them');
const rows1 = V.parseVoiceText('[Verse]\nMelody: It came upon\nVocals 2: the midnight clear\n\nMen: That glorious song');
check('each line its part, the lines that touch one moment', J(rows1.map(r => [r.part, r.text, r.sortOrder, r.section])) ===
  J([['Melody', 'It came upon', 0, 'Verse'], ['Vocals 2', 'the midnight clear', 0, 'Verse'], ['men', 'That glorious song', 1, 'Verse']]));
check('"vocals 1:" after "Vocals 1:" is the same lane, not a new one', J(V.lanes(V.parseVoiceText('Vocals 1: a\n\nvocals 1: b'))) === J(['Vocals 1']));
check('the forms the editors write read as they always did', J(V.parseVoiceText('W: a\nM: ~b\n\n[Descant] c\n\n4  M: d').map(r => [r.part, r.text, !!r.sustained])) ===
  J([['women', 'a', false], ['men', 'b', true], ['Descant', 'c', false], ['men', 'd', false]]));
const lead = [{ part: 'both', text: 'Lead: me on', section: '', sortOrder: 0, sustained: false }];
check('a line everyone sings that opens like a label is written [All] and read back as everyone\'s',
  /^\[All\] Lead: me on$/.test(V.toVoiceText(lead)) && J(V.parseVoiceText(V.toVoiceText(lead)).map(r => [r.part, r.text])) === J([['both', 'Lead: me on']]) &&
  P.allPrefix('Melody: la') === '[All] ' && P.allPrefix('3 kings came') === '[All] ' && P.allPrefix('Glory') === '');

// ---------------------------------------------------------------------------
console.log('\nThe arrangement on the page, as a person writes it');
const ROWS = [
  { id: 1, part: 'both', text: 'It came upon the midnight clear', section: 'Verse 1', sortOrder: 0, sustained: false },
  { id: 2, part: 'women', text: 'That glorious song of old', section: 'Verse 1', sortOrder: 1, sustained: false },
  { id: 3, part: 'men', text: 'oh', section: 'Verse 1', sortOrder: 1, sustained: true },
  { id: 4, part: 'Melody', text: 'From angels bending near', section: 'Verse 1', sortOrder: 2, sustained: false },
  { id: 5, part: 'Kids Choir', text: 'To touch their harps of gold', section: 'Verse 1', sortOrder: 3, sustained: false }
];
const LYR = '[Verse 1]\nC         G\nIt came upon the midnight clear\nF      C\nThat glorious song of old\nG\nFrom angels bending near\nC\nTo touch their harps of gold';
const parts = V.lanes(ROWS);
const lineOf = ln => P.line(ln, parts);
const at = [];
const shownText = P.padText(ROWS, LYR, null, isChord, null, { line: lineOf, parts, at, chord: c => V._transposeAligned(c, 2, XP) });
const storedText = P.padText(ROWS, LYR, null, isChord, null, { line: lineOf, parts });
const SL = shownText.split('\n');
check('each part named as a person types it', ['It came upon the midnight clear', 'Women: That glorious song of old', 'Men: ~oh', 'Melody: From angels bending near', 'Kids Choir: To touch their harps of gold'].every(l => SL.indexOf(l) > -1), shownText);
const wi = SL.indexOf('Women: That glorious song of old');
check('a chord line over its words, moved past the part\'s name, in the key sung', SL[wi - 1] === '       G      D' && SL[SL.indexOf('It came upon the midnight clear') - 1] === 'D         A', J(SL));
check('where each moment starts, for the cursor to go to the one held', J(at.map(i => SL[i])) === J(['D         A', '       G      D', '        A', '            D']), J(at.map(i => SL[i])));
const back = P.split(shownText, isChord, parts);
const shape = rs => rs.map(r => [V.partKey(r.part), r.text, r.section, r.sortOrder, !!r.sustained]);
check('and it reads back to the very arrangement it was made from', J(shape(V.parseVoiceText(back.text, { parts }))) === J(shape(ROWS)), J(shape(V.parseVoiceText(back.text, { parts }))));
check('...with every chord line over the words it was over', J(back.chords.map(c => c.words)) === J(['It came upon the midnight clear', 'That glorious song of old', 'From angels bending near', 'To touch their harps of gold']));
const shownCh = back.chords, storedCh = P.split(storedText, isChord, parts).chords;
check('a chord left as it was is stored as it was, though it was shown two steps up', J(P.chords(shownCh, shownCh, storedCh, 2, XP)) === J(storedCh));
const changed = shownCh.map(c => c.words === 'From angels bending near' ? { words: c.words, chord: 'B' } : c);
check('...and one typed is put back into the song\'s own key', P.chords(changed, shownCh, storedCh, 2, XP).find(c => c.words === 'From angels bending near').chord === 'A');
check('in the song\'s own key, the chords are kept as typed', P.chords(changed, shownCh, shownCh, 0, XP) === changed);

// ---------------------------------------------------------------------------
console.log('\nWhat each line is shown as is what will be saved');
const info = P.info(SL, isChord, parts);
const at2 = l => info[SL.indexOf(l)];
check('the section, the chord lines, the blank lines', info[0].kind === 'sec' && info[1].kind === 'chord' && info[3].kind === 'blank');
check('who sings each line: All, Women, a held note, Melody, a part of the song\'s own', J(['It came upon the midnight clear', 'Women: That glorious song of old', 'Men: ~oh', 'Melody: From angels bending near', 'Kids Choir: To touch their harps of gold'].map(l => at2(l).who)) ===
  J(['All', 'Women', 'Men (held)', 'Melody', 'Kids Choir']));
check('the women and the held men sing at once: the bar runs from the chord line over them to the men', info[wi - 1].tg && info[wi - 1].tgFirst && at2('Women: That glorious song of old').tg && at2('Men: ~oh').tg && at2('Men: ~oh').tgLast);
check('...and the lines sung alone are not on it', !at2('It came upon the midnight clear').tg && !at2('Melody: From angels bending near').tg);
check('a label the parser would not take is shown as words for everyone', P.info(['Lord: have mercy'], isChord, []).map(f => f.who)[0] === 'All');
check('a part that rests (a dash) does not make a moment "together"', !P.info(['Women: Gloria', 'Men: -'], isChord, []).some(f => f.tg));

// ---------------------------------------------------------------------------
console.log('\nSing together, and Take turns');
const j1 = P.join(['[Verse]', 'Women: a', '', 'Men: b', '', 'All: c'], 1, 3, isChord, []);
check('Sing together: the highlighted moments become one, the blank line between them gone', J(j1.lines) === J(['[Verse]', 'Women: a', 'Men: b', '', 'All: c']) && j1.a === 1 && j1.b === 2 && P.info(j1.lines, isChord, []).slice(1, 3).every(f => f.tg));
const j2 = P.join(['G', 'Women: a', '', 'D', 'Men: b'], 1, 4, isChord, []);
check('...their chord lines going with them', J(j2.lines) === J(['G', 'Women: a', 'D', 'Men: b']) && P.info(j2.lines, isChord, []).every(f => f.tg));
check('refused: one part singing two lines at once', /Women would sing two lines at once/.test(P.join(['Women: a', '', 'Women: b'], 0, 2, isChord, []).error || ''));
check('refused: a line for everyone sharing a moment', /everyone/.test(P.join(['a', '', 'Men: b'], 0, 2, isChord, []).error || ''));
check('refused: across a section', /different sections/.test(P.join(['Women: a', '[Chorus]', 'Men: b'], 0, 2, isChord, []).error || ''));
check('refused: one line alone', /two parts or more/.test(P.join(['Women: a', '', 'Men: b'], 0, 0, isChord, []).error || ''));
const t1 = P.cut(['Women: a', 'Men: b', 'Melody: c'], 1, 1, isChord, []);
check('Take turns: each part in the moment gets its own, from the cursor alone', J(t1.lines) === J(['Women: a', '', 'Men: b', '', 'Melody: c']) && t1.a === 0 && t1.b === 4);
check('...a chord line staying over its words', J(P.cut(['G', 'Women: a', 'D', 'Men: b'], 0, 3, isChord, []).lines) === J(['G', 'Women: a', '', 'D', 'Men: b']));
check('...and nothing to do when each already sings alone', /already sings on its own/.test(P.cut(['Women: a', '', 'Men: b'], 0, 2, isChord, []).error || ''));
const flatSrc = fn('_sbChNpFlat');
if (flatSrc) {
  const Fl = new Function(flatSrc + '\nreturn _sbChNpFlat;')();
  const node = (tag, kids) => { const e = { nodeType: 1, tagName: tag, childNodes: kids }; kids.forEach((k, i) => { k.nextSibling = kids[i + 1] || null; }); e.firstChild = kids[0] || null; return e; };
  const t = d => ({ nodeType: 3, data: d });
  check('a page of one block a line, words only, is left as it is', Fl(node('DIV', [node('DIV', [t('Women: a')]), node('DIV', [node('BR', [])])])) === true);
  check('...but a line break typed into a line (Chrome types it as a newline here) is put into a line of its own',
    Fl(node('DIV', [node('DIV', [t('Melody: a\n b')])])) === false && Fl(node('DIV', [node('DIV', [t('a'), node('SPAN', [t('b')])])])) === false);
} else check('_sbChNpFlat exists', false);
check('the same text with trailing spaces is no change', P.same('a  \nb\n\n', 'a\nb') && !P.same('a\nb', 'a\nc'));

// ---------------------------------------------------------------------------
console.log('\nEnter saves, Esc and an untouched page do not');
const endSrc = fn('_sbChNpEnd');
async function E(o) {
  const log = { saved: null, released: 0, rebuilt: 0, toast: [], editable: null, listen: [], bar: 0 };
  const el = { isConnected: true, removeAttribute(a) { if (a === 'contenteditable') log.editable = false; }, setAttribute(a) { if (a === 'contenteditable') log.editable = true; },
    classList: { add() {}, remove() {} }, focus() {} };
  const N = { kind: 'choir', el, base: 'song_a', sid: 'copy_a', text: 'Women: a\nMen: b', openSig: 'SIG', parts: ['Melody'], shownChords: [], storedChords: [], steps: 0, fn: null, saving: false, lyrics: '' };
  const env = { _sbNp: N };
  const save = (base, sid, text, colours, sig, opts) => { log.saved = { base, sid, text, sig, opts }; return o.fail ? Promise.reject(o.fail) : Promise.resolve({ orphans: [] }); };
  const run = new Function('env', 'window', 'STATE', '_sbChNpListen', '_sbNpBarOff', '_sbNpLines', '_sbChNpSame', '_sbEditRelease', '_sbBkRebuild', '_sbEditMayWrite',
    '_sbmPadSaveSong', '_sbChNpChords', '_sbLinesSig', '_sbVoiceLines', 'showToast', '_sbBkOpen', '_sbNpBar', '_sbChNpUndo', '_sbChoirChordWords',
    'var _sbNp = env._sbNp;\n' + endSrc + '\nenv.end = function(N, s) { _sbChNpEnd(N, s); }; env.cur = function() { return _sbNp; };');
  const ST = { songs: [] };
  run(env, { STATE: ST }, ST, (e, on) => log.listen.push(on), () => {}, () => o.typed.split('\n'), P.same,
    () => { log.released++; }, () => { log.rebuilt++; }, () => o.may !== false, save, (c) => c, () => 'SIG2', {}, (m, k, x) => log.toast.push([m, x]),
    () => true, () => { log.bar++; }, () => {}, () => '');
  env.end(N, o.save !== false);
  if (o.again) env.end(N, true);
  await new Promise(r => setTimeout(r, 0));
  log.after = env.cur();
  return log;
}
(async () => {
  if (!endSrc) { check('_sbChNpEnd exists', false); return; }
  const same = await E({ typed: 'Women: a\nMen: b  ' });
  check('nothing typed: nothing saved, the song let go, the book drawn again', same.saved === null && same.released === 1 && same.rebuilt === 1 && same.after === null);
  const esc = await E({ typed: 'WIPED', save: false });
  check('Esc: nothing saved, the page put back as it was', esc.saved === null && esc.released === 1 && esc.rebuilt === 1);
  const typed = await E({ typed: 'Women: a\n\nMelody: b' });
  check('Enter: saved through Overview Edit\'s own save, against the parts as they were when it opened',
    typed.saved && typed.saved.text === 'Women: a\n\nMelody: b' && typed.saved.sig === 'SIG' && typed.saved.opts.quiet === true && J(typed.saved.opts.parts) === J(['Melody']) && typeof typed.saved.opts.mapChords === 'function');
  check('...then the song let go, the book drawn again, and an Undo offered', typed.released === 1 && typed.rebuilt === 1 && typed.after === null && typed.toast.some(t => /Choir parts saved/.test(t[0]) && t[1] && t[1].action === 'Undo'));
  const locked = await E({ typed: 'Women: x', may: false });
  check('another device has the song: nothing saved, what was typed left on the page', locked.saved === null && locked.rebuilt === 0 && locked.after === null);
  const failedSave = await E({ typed: 'Women: x', fail: new Error('offline') });
  check('a save that fails leaves it typeable again, nothing lost', failedSave.editable === true && failedSave.bar === 1 && failedSave.listen.slice(-1)[0] === true && failedSave.after && failedSave.after.kind === 'choir' && failedSave.released === 0);
  const ch = Object.assign(new Error('changed'), { code: 'changed' });
  const changedSave = await E({ typed: 'Women: x', fail: ch });
  check('...but not when the parts were changed elsewhere: the song let go', changedSave.editable === false && changedSave.released === 1 && changedSave.after === null);
  const twice = await E({ typed: 'Women: x', again: true });
  check('a second Enter while it saves does not save twice', twice.saved && twice.toast.filter(t => /Choir parts saved/.test(t[0])).length === 1);

  // -------------------------------------------------------------------------
  console.log('\nWhere it is wired in');
  const down = fn('_sbBkDown');
  let held = null;
  const choirScore = { id: 'score' };
  new Function('_sbBk', '_sbBkCancelHold', '_sbBkHold', 'setTimeout', '_sbmDraw', '_sbNp', down + '\nreturn _sbBkDown;')(
    { tap: null, down: null, hold: null }, () => {}, (l) => { held = l; }, (f) => { f(); return 1; }, null, null)(
    { isPrimary: true, button: 0, clientX: 1, clientY: 2, target: { closest: sel => (/sbm-bk-card--choir \.vl-score/.test(sel) ? choirScore : null) } });
  check('holding a choir page\'s score starts the hold, as holding the words does', held === choirScore);
  check('...and the hold on a choir page opens the choir notepad at the moment held',
    /if \(card\.classList\.contains\('sbm-bk-card--choir'\)\) \{ _sbChNpStart\(card, song, _sbChNpSysAt\(card, y\)\); return; \}/.test(fn('_sbBkHold')));
  check('the words notepad\'s end hands a choir notepad to its own', /var N = _sbNp; if \(!N\) return;\n    if \(N\.kind === 'choir'\) \{ _sbChNpEnd\(N, save\); return; \}/.test(fn('_sbNpEnd')));
  const open = fn('_sbChNpOpen');
  check('it is the notepad\'s own state, in the book, so a redraw waits for it', /kind: 'choir'/.test(open) && /where: 'book'/.test(open) && /_sbNp = N;/.test(open));
  check('the score is hidden under it and the drawings with it, until the page is drawn again',
    /score\.style\.display = 'none';/.test(open) && /card\.classList\.add\('sbm-chnp-card'\)/.test(open) && /\.sbm-chnp-card \.sbm-marks \{ display: none; \}/.test(SRC));
  check('the chords shown in the key sung, and the song held before it opens', /_sbmStepsOf\(song\)/.test(open) && /_sbEditClaim\(song\)/.test(fn('_sbChNpStart')) && /_sbLinesReady\(base\)/.test(fn('_sbChNpStart')));
  check('the bar has Sing together and Take turns, for the choir only', /choir \? '<button[^']*'[^]*WO\.sbChNpTogether\(\)[^]*WO\.sbChNpTurns\(\)/.test(fn('_sbNpBar')) && /sbChNpTogether: sbChNpTogether, sbChNpTurns: sbChNpTurns,/.test(SRC));
  check('Overview Edit reads the song\'s own part names too', /return _sbmPadSaveSong\(base, sid, whole, colours, openSig, \{ parts: V\.lanes\(rows\) \}\);/.test(SRC));
  check('...and its save hands them to the parser', /var split = _sbmPadSplit\(fullText, _sbmIsChord\(\), o\.parts\);\n    var parsed = V\.parseVoiceText\(split\.text, \{ parts: o\.parts \}\);/.test(fn('_sbmPadSaveSong')));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
