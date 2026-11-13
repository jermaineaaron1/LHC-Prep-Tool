'use strict';
// Harness for the choir pad (2026-11-12, CLAUDE.md gotcha 91). From the
// operator, on screenshots of Edit Parts (crossed out), Overview Edit and the
// choir view:
//   - "abolish this page for the editing of the choir parts. Rather it should
//     go straight to the editing pad (just like the lyrics, chords mode)";
//   - "change the outlook of the editing pad to look just like how the
//     songbook for choir view looks like";
//   - "Different parts can be added (e.g. Harmony 1, Men, Women, etc.) by
//     writing it in brackets";
//   - lines "just below each other and there's no gap in between" sing
//     together, "if there's a gap, then it's singing separately";
//   - in a medley, a double-tap on another song's lyrics or chord opens it
//     directly, though a different song of the medley is in front.
//
// Runs the pad's reader and writer (_sbCpRead / _sbCpText) on real
// arrangements through the real lhcVoiceLines parser, the toolbar's edits,
// the chords' way back into the copy's key, and the whole open-and-save path
// with the database stubbed; then checks the ways in by their source.
//
// USAGE
//   node tools/songbook-choir-pad-harness.js
//   node tools/songbook-choir-pad-harness.js <Index.html> --expect-broken

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const SRC = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
const fn = name => { const m = SRC.match(new RegExp('\\n  function ' + name + '\\([^)]*\\) \\{[^]*?\\n  \\}')); return m ? m[0] : ''; };
const top = name => { const m = SRC.match(new RegExp('\\nfunction ' + name + '\\([^)]*\\) \\{[^]*?\\n\\}')); return m ? m[0] : ''; };

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 700) : '')); }
}
const J = JSON.stringify;
process.on('unhandledRejection', e => check('no unexpected error', false, String(e && e.message || e)));

const vStart = SRC.indexOf('\nwindow.lhcVoiceLines = {');
const vEnd = vStart < 0 ? -1 : SRC.indexOf('\n};', vStart);
let V = null;
try { V = new Function('var window = {};\n' + SRC.slice(vStart, vEnd + 3) + '\nreturn window.lhcVoiceLines;')(); } catch (e) { V = null; }
const secVar = (SRC.match(/\n  var _SB_CP_SEC = [^\n]*/) || [''])[0];
if (!V || !fn('_sbCpRead') || !secVar) {
  if (EXPECT_BROKEN) { console.log('--expect-broken: no choir pad, as expected.'); process.exit(0); }
  console.log('FAIL there is no choir pad (_sbCpRead)'); process.exit(1);
}
if (EXPECT_BROKEN) { console.log('\nBUT --expect-broken was given and the choir pad is present.'); process.exit(1); }

const tokRe = (SRC.match(/\nvar CHORD_TOKEN_RE = [^\n]*/) || [''])[0];
const isChord = new Function(tokRe + '\n' + top('lhcChordAscii') + '\n' + top('isChordToken') + '\n' + top('isChordLineGlobal') + '\nreturn isChordLineGlobal;')();
const XP = new Function(top('transposeChordLinePrint') + '\nreturn transposeChordLinePrint;')();
const NAMES = ['_sbmPadIndent', '_sbmPadWords', '_sbChNpChords', '_sbCpPartName', '_sbCpSecLine', '_sbCpPrefix', '_sbCpRead', '_sbCpText',
  '_sbCpChordsToSave', '_sbCpBoxes', '_sbCpNormal', '_sbCpSetPart', '_sbCpHold', '_sbCpAddChords', '_sbCpAddSection', '_sbCpSectionAt', '_sbCpWordsAt'];
const missing = NAMES.filter(n => !fn(n));
check('every function this needs is in the source', !missing.length, missing.join(', '));
const C = new Function('window', secVar + '\n' + NAMES.map(fn).join('\n') +
  '\nreturn { partName: _sbCpPartName, secLine: _sbCpSecLine, read: _sbCpRead, text: _sbCpText, toSave: _sbCpChordsToSave, boxes: _sbCpBoxes,' +
  ' normal: _sbCpNormal, setPart: _sbCpSetPart, hold: _sbCpHold, addChords: _sbCpAddChords, addSection: _sbCpAddSection, sectionAt: _sbCpSectionAt, wordsAt: _sbCpWordsAt };')({ lhcVoiceLines: V });

// The arrangement as the parser groups it, for comparing: section, then each
// moment's lines by part, held marked.
const shape = rows => V.group(rows).map(g => (g.section || '') + ' :: ' +
  (g.both ? ['both=' + (g.both.sustained ? '~' : '') + g.both.text] : []).concat(Object.keys(g.byPart).sort().map(k => k + '=' + (g.byPart[k].sustained ? '~' : '') + g.byPart[k].text)).join(' | '));
const backToRows = (text, parts, sections) => { const R = C.read(text, isChord, parts, sections); return V.parseVoiceText(R.text, { parts: R.known }); };

// ---------------------------------------------------------------------------
console.log('\n1. A bracketed name alone on a line: a part, or a section');
const PN = (n, colon) => C.partName(n, ['Melody', 'Kids Choir'], ['Ad lib'], !!colon);
check('[Men] [Women] [All] and their shorthands are the lanes', J(['Men', 'women', 'All', 'W', 'M', 'Everyone', 'Unison'].map(n => PN(n))) === J(['men', 'women', 'both', 'women', 'men', 'both', 'both']));
check('[Harmony 1], [Soprano], [Lead] -- names parts are called by -- are parts', J(['Harmony 1', 'soprano', 'Lead', 'Vocals 2'].map(n => PN(n))) === J(['Harmony 1', 'Soprano', 'Lead', 'Vocals 2']));
check('a part the song already has, in the song\'s spelling', PN('melody') === 'Melody' && PN('KIDS CHOIR') === 'Kids Choir');
check('[Verse 2], [Chorus], [Pre-Chorus], [Tag], [Ending] are sections', J(['Verse 2', 'Chorus', 'Pre-Chorus', 'Tag', 'Ending', '2nd CHORUS', 'Bridge'].map(n => PN(n))) === J([null, null, null, null, null, null, null]));
check('one of the song\'s own sections stays a section', PN('Ad lib') === null && PN('ad LIB') === null);
check('any other name is a NEW part ("by writing it in brackets")', PN('Group A') === 'Group A' && PN('youth band') === 'Youth Band');
check('"[name]:" is a part whatever the name; "[Section: x]" a section', PN('Ad lib', true) === 'Ad lib' && PN('Verse 1', true) === 'Verse 1' && PN('Section: Men') === null);
check('a section whose name reads as a part is written [Section: ...]', C.secLine('Choir', [], []) === '[Section: Choir]' && C.secLine('Verse 1', [], []) === '[Verse 1]' && C.secLine('Men', [], []) === '[Section: Men]');

// ---------------------------------------------------------------------------
console.log('\n2. The pad, read as a singer writes it');
const TYPED = [
  '[Verse 1]',
  'Said the night wind to the little lamb',
  '[Men]',
  'G           C',
  'Do you see what I see',
  '',
  'Do you hear what I hear',
  '[Women]',
  '~oh....',
  '',
  'Women: A star, a star',
  'dancing in the night',
  '',
  '[Harmony 1]',
  'With a tail as big as a kite',
  '[Group A]:',
  'With a tail as big as a kite',
  '',
  '[Men]',
  'A song, a song',
  'High above the trees',
  '',
  '[Chorus]',
  'Pray for peace, people everywhere',
  'Melody:',
  'Listen to what I say'
].join('\n');
const R = C.read(TYPED, isChord, [], ['Verse 1']);
const kinds = R.info.map(f => f.kind[0]).join('');
check('each line is read as what it is (section, part, chord, words, blank)', kinds === 'swpcwbwpwbwwbpwpwbpwwbswpw', kinds);
const who = i => V.partKey(R.info[i].part);
check('no name yet: everyone', who(1) === 'both');
check('[Men] over a chord line names the words under it', who(4) === 'men' && R.info[3].kind === 'chord' && R.info[3].over === 4);
check('...and holds for the lines under it, across a gap', who(6) === 'men');
check('[Women] then a held note', who(8) === 'women' && R.info[8].held === true);
check('lines just below each other sing TOGETHER', R.info[6].m === R.info[8].m && R.info[6].tg && R.info[8].tg);
check('a gap between them: separately', R.info[4].m !== R.info[6].m && !R.info[4].tg);
check('"Women:" at the start of a line names that line only', who(10) === 'women' && R.info[10].inline && who(11) === 'women' && R.info[11].m !== R.info[10].m);
check('[Harmony 1] and a new part written "[Group A]:", touching, sing together', who(14) === 'harmony 1' && who(16) === 'group a' && R.info[14].tg && R.info[16].tg);
check('one part on two lines that touch: one after the other', who(19) === 'men' && who(20) === 'men' && R.info[19].m !== R.info[20].m && !R.info[19].tg);
check('a new section starts with everyone again', who(23) === 'both');
check('"Melody:" alone on a line is a part\'s name too', R.info[24].kind === 'part' && who(25) === 'melody');
check('every part named is known', J(R.known) === J(['Harmony 1', 'Group A', 'Melody']), J(R.known));
const rowsT = V.parseVoiceText(R.text, { parts: R.known });
check('the parser gets every line of words, once, with its part', rowsT.length === 12 && J(rowsT.slice(0, 4).map(r => [r.part, r.text, r.section])) ===
  J([['both', 'Said the night wind to the little lamb', 'Verse 1'], ['men', 'Do you see what I see', 'Verse 1'], ['men', 'Do you hear what I hear', 'Verse 1'], ['women', 'oh....', 'Verse 1']]), J(rowsT.map(r => [r.part, r.text])));
check('the chord line goes to the save as the chords over its words', J(R.chords) === J([{ words: 'Do you see what I see', chord: 'G           C', lead: true, m: 1 }]), J(R.chords));
const bx = C.boxes(R.info);
check('each moment is one box, the ones sung at once marked', bx.length === new Set(R.info.filter(f => f.m > -1).map(f => f.m)).size && bx.filter(b => b.tg).length === 2, J(bx));

// ---------------------------------------------------------------------------
console.log('\n3. The pad as it opens: written from the arrangement, read back the same');
const ROWS = [
  { part: 'both', text: 'It came upon the midnight clear', section: 'Verse 1', sortOrder: 0, sustained: false },
  { part: 'women', text: 'That glorious song of old', section: 'Verse 1', sortOrder: 1, sustained: false },
  { part: 'men', text: 'oh', section: 'Verse 1', sortOrder: 1, sustained: true },
  { part: 'Melody', text: 'From angels bending near the earth', section: 'Verse 1', sortOrder: 2, sustained: false },
  { part: 'Melody', text: 'To touch their harps of gold', section: 'Verse 1', sortOrder: 3, sustained: false },
  { part: 'both', text: 'Lead: me on', section: 'Verse 1', sortOrder: 4, sustained: false },
  { part: 'both', text: '3 kings came', section: 'Verse 1', sortOrder: 5, sustained: false },
  { part: 'Kids Choir', text: 'Peace on the earth', section: 'Choir', sortOrder: 6, sustained: false },
  { part: 'both', text: 'la la la', section: 'Ad lib', sortOrder: 7, sustained: false }
];
const LYR = ['[Verse 1]', 'G        C', 'It came upon the midnight clear', 'D          G', 'That glorious song of old', 'Em            C', 'From angels bending near the earth'].join('\n');
const parts = V.lanes(ROWS), sections = ['Verse 1', 'Choir', 'Ad lib'], at = [];
const TEXT = C.text(ROWS, LYR, isChord, { parts, at });
const TL = TEXT.split('\n');
check('a section\'s name, then a part\'s name on its own line where it takes over', TL[0] === '[Verse 1]' && TL[1] === '[All]' && TL.indexOf('[Women]') > -1 && TL.indexOf('[Men]') > -1, TEXT);
check('the chords over the moment\'s lead line, under its part\'s name', TL[TL.indexOf('[Women]') + 1] === 'D          G' && TL[TL.indexOf('[Women]') + 2] === 'That glorious song of old', TEXT);
check('a part that carries on is not named again', TL.filter(l => l === '[Melody]').length === 1, TEXT);
check('a held note keeps its ~', TL.indexOf('~oh') > -1);
check('words that would read as a label keep their own', TL.indexOf('[All] Lead: me on') > -1 && TL.indexOf('3 kings came') > -1, TEXT);
check('a section named like a part is written so it stays a section', TL.indexOf('[Section: Choir]') > -1 && TL.indexOf('[Kids Choir]') > -1 && TL.indexOf('[Ad lib]') > -1, TEXT);
check('a blank line between moments', TL.filter(l => l === '').length >= 6);
check('at[] gives each moment\'s first line', at.length === 8 && TL[at[0]] === '[All]' && TL[at[2]] === '[Melody]' && TL[at[3]] === 'To touch their harps of gold', J(at));
check('READ BACK, it is the same arrangement, moment for moment', J(shape(backToRows(TEXT, parts, sections))) === J(shape(ROWS)), J(shape(backToRows(TEXT, parts, sections))) + '\n vs ' + J(shape(ROWS)));
const R0 = C.read(TEXT, isChord, parts, sections);
check('...and the chords it was written with are the chords it reads', J(R0.chords.map(c => [c.words, c.chord, c.lead])) ===
  J([['It came upon the midnight clear', 'G        C', true], ['That glorious song of old', 'D          G', true], ['From angels bending near the earth', 'Em            C', true]]), J(R0.chords));

// ---------------------------------------------------------------------------
console.log('\n4. The chords in the key sung, and back into the copy\'s key');
const up = c => V._transposeAligned(c, 2, XP);
const shown = C.read(C.text(ROWS, LYR, isChord, { parts, chord: up }), isChord, parts, sections).chords;
check('shown in the key sung', shown[0].chord.trim().split(/\s+/).join(' ') === 'A D', J(shown));
const back = C.toSave(shown, shown, R0.chords, 2, XP);
check('left as shown: stored exactly as it was', J(back.map(c => c.chord)) === J(R0.chords.map(c => c.chord)), J(back));
const typed = shown.map((c, i) => i === 1 ? Object.assign({}, c, { chord: c.chord.replace(/E/, 'F#m') }) : c);
const back2 = C.toSave(typed, shown, R0.chords, 2, XP);
check('one changed: moved back by the steps it was shown up', /^Em\b/.test(back2[1].chord.trim()) && back2[0].chord === R0.chords[0].chord, J(back2));
const offLead = C.read(['[Women]', 'That glorious song of old', '[Men]', 'D          G', '~oh'].join('\n'), isChord, parts, sections);
check('a chord line over a line that is not the moment\'s lead is marked so', offLead.chords.length === 1 && offLead.chords[0].lead === false, J(offLead.chords));
check('...left out of the save quietly when it is as it was shown', C.toSave(offLead.chords, [{ words: 'oh', chord: 'D          G' }], [], 0, XP).length === 0);
check('...and as a chord with nowhere to sit when it was typed', J(C.toSave(offLead.chords, [], [], 0, XP)) === J([{ words: '', chord: 'D          G' }]));
check('a chord line over nothing is one with nowhere to sit', J(C.read('G  C\n\nwords', isChord, [], []).chords) === J([{ words: '', chord: 'G  C', lead: false, m: -1 }]));

// ---------------------------------------------------------------------------
console.log('\n5. The toolbar');
const lineOf = (lines, re) => lines.findIndex(l => re.test(l));
let r = C.setPart(R0, lineOf(R0.lines, /^From angels/), lineOf(R0.lines, /^From angels/), 'men');
let R2 = C.read(r.lines.join('\n'), isChord, parts, sections);
const partOf = (RR, re) => V.partKey(RR.info[lineOf(RR.lines, re)].part);
check('Sung by Men: that line is the men\'s', partOf(R2, /^From angels/) === 'men' && r.lines[r.caret] === 'From angels bending near the earth', r.lines.join('\n'));
check('...no name of its own where the men already sing above it (~oh), and the next line keeps who it was',
  partOf(R2, /^To touch/) === 'melody' && r.lines[lineOf(r.lines, /^From angels/) - 2] === '' && r.lines[lineOf(r.lines, /^To touch/) - 1] === '[Melody]', r.lines.join('\n'));
r = C.setPart(R0, lineOf(R0.lines, /^It came upon/), lineOf(R0.lines, /^It came upon/), 'Harmony 1');
check('...and where another part sang before it, its name goes above its chords',
  r.lines[lineOf(r.lines, /^It came upon/) - 2] === '[Harmony 1]' && r.lines[lineOf(r.lines, /^It came upon/) - 1] === 'G        C', r.lines.join('\n'));
check('...and nothing else in the arrangement moved', J(shape(V.parseVoiceText(R2.text, { parts: R2.known })).filter((x, i) => i !== 2)) === J(shape(ROWS).filter((x, i) => i !== 2)));
r = C.setPart(R0, lineOf(R0.lines, /^\[Melody\]$/), lineOf(R0.lines, /^\[Melody\]$/), 'Harmony 1');
R2 = C.read(r.lines.join('\n'), isChord, parts.concat(['Harmony 1']), sections);
check('on a part\'s own name: every line under that name', partOf(R2, /^From angels/) === 'harmony 1' && partOf(R2, /^To touch/) === 'harmony 1' && r.lines.indexOf('[Melody]') < 0, r.lines.join('\n'));
const hr = C.hold(R0, lineOf(R0.lines, /^From angels/));
check('~ Hold puts the mark on, and the chords move with the words', hr.lines[lineOf(hr.lines, /From angels/)] === '~From angels bending near the earth' && hr.lines[lineOf(hr.lines, /From angels/) - 1] === ' Em            C', hr.lines.join('\n'));
const hr2 = C.hold(C.read(hr.lines.join('\n'), isChord, parts, sections), lineOf(hr.lines, /From angels/));
check('...and off again', J(hr2.lines) === J(R0.lines));
const ac = C.addChords(R0, lineOf(R0.lines, /^To touch/));
check('+ Chords: a line over words with none', ac.lines[ac.caret] === '' && ac.lines[ac.caret + 1] === 'To touch their harps of gold');
const ac2 = C.addChords(R0, lineOf(R0.lines, /^That glorious/));
check('...or into the chord line they have', J(ac2.lines) === J(R0.lines) && R0.lines[ac2.caret] === 'D          G');
const as = C.addSection(R0, 2, 'Verse');
check('+ Verse: the next verse, after the section the cursor is in', as.lines[as.caret - 1] === '[Verse 2]' && as.lines[as.caret] === '' && lineOf(as.lines, /^\[Verse 2\]$/) < lineOf(as.lines, /Section: Choir/), as.lines.join('\n'));
check('a section\'s pen opens at its line', C.sectionAt(R0, 'choir', 1) === lineOf(R0.lines, /Section: Choir/) && C.sectionAt(R0, 'Nope', 1) === null);
check('the cursor goes to the first words at or after a line', R0.lines[C.wordsAt(R0.info, 0)] === 'It came upon the midnight clear');
const N = C.normal(C.read('[Women]\nAlpha\n[Women]\nMen: Bravo\n\n[Women]\nCharlie', isChord, [], []));
check('written again: a name only where the part changes', J(N.lines) === J(['[Women]', 'Alpha', '[Men]', 'Bravo', '', '[Women]', 'Charlie']), J(N.lines));

// ---------------------------------------------------------------------------
console.log('\n6. Opened and saved, end to end (the database stubbed)');
const OPEN = ['_sbOverviewOpenNow', '_sbmPadSaveSong', '_sbmEdMomentAt', '_sbmPadRoles', '_sbmPadSplit'];
const env = new Function('ctx', 'window', secVar + '\n' + NAMES.map(fn).join('\n') + '\n' + OPEN.map(fn).join('\n') + `
  var _sbVoiceLines = ctx.lines, _sbmPad = null;
  function _sbLinesSig(r) { return 'sig' + (r || []).length; }
  function _sbCopyById(id) { return ctx.copy; }
  function _sbChoirChordWords() { return ctx.lyrics; }
  function _sbmIsChord() { return ctx.isChord; }
  function _sbmStepsOf() { return ctx.steps; }
  var transposeChordLinePrint = ctx.XP;
  function _sbSungKey() { return 'A'; }
  function _sbmCloseSheet() {}
  function _sbmPadOpen(o) { ctx.opened = o; }
  function _sbPartColours() { return {}; }
  function showToast(m) { ctx.toasts.push(m); }
  function showLoader() {}
  function renderSongbookLive() {}
  function _sbVoiceWrite(base, sid, rows, o) { ctx.written = rows; ctx.writeOpts = o; return Promise.resolve(); }
  function _sbmPadSaveChords(base, rows, chords, sid) { ctx.chords = chords; return Promise.resolve({ written: false, orphans: chords.filter(function(c) { return !c.words; }).map(function(c) { return c.words; }) }); }
  function _sbPartColoursSave() { return Promise.resolve(); }
  return { open: _sbOverviewOpenNow };`);
const ctx = { lines: { song_1: ROWS }, copy: { id: 'c1', songId: 'song_1' }, lyrics: LYR, isChord, steps: 2, XP, toasts: [] };
const E = env(ctx, { lhcVoiceLines: V });
E.open('song_1', 'c1', 'It Came Upon', null, null, 's:Verse 1|3');
const O = ctx.opened || {};
check('Edit opens the PAD -- the sheet -- not the Edit Parts page', O.sheet === true && typeof O.onSave === 'function');
check('...in the key sung, and says so', /chords in A/.test(O.title || '') && /^\s*A\s+D\s*$/.test((O.text || '').split('\n')[2] || ''), O.title + '\n' + O.text);
check('...at the moment double-tapped', O.focus === at[2], J([O.focus, at]));
E.open('song_1', 'c1', 'It Came Upon', 'Choir', 1, '');
check('...or at the section whose pen was pressed', ctx.opened.text.split('\n')[ctx.opened.focus] === '[Section: Choir]');
(async () => {
  E.open('song_1', 'c1', 'It Came Upon', null, null, '');
  const T = ctx.opened.text.split('\n');
  const i = T.indexOf('To touch their harps of gold');
  T.splice(i, 0, '[Harmony 1]');                         // a new part, in brackets
  T.splice(T.indexOf('[Melody]') + 3, 1);                 // and the gap under the Melody line taken out
  await ctx.opened.onSave(T.join('\n'), {});
  const W = ctx.written || [];
  const g = V.group(W);
  check('saved: [Harmony 1] typed in brackets is a part of the arrangement', W.some(x => x.part === 'Harmony 1' && x.text === 'To touch their harps of gold'), J(W));
  check('saved: the two lines with no gap between them are one moment, sung together', g.some(x => x.byPart.melody && x.byPart['harmony 1']), J(shape(W)));
  check('saved: refused if what is stored changed since it opened', ctx.writeOpts && ctx.writeOpts.openSig === 'sig9');
  check('saved: the chords untouched go back exactly as they were stored', J((ctx.chords || []).map(c => c.chord)) === J(R0.chords.map(c => c.chord)), J(ctx.chords));
  check('saved: a toast, and no chord reported with nowhere to sit', ctx.toasts.slice(-1)[0] === 'Arrangement saved', J(ctx.toasts));

  // -------------------------------------------------------------------------
  console.log('\n7. The ways in');
  const has = (name, re) => re.test(fn(name));
  check('the Edit tile and chip in Choir: the pad (sbmEditParts -> _sbOverviewOpen, never _sbmEdOpen)',
    has('sbmEditParts', /_sbOverviewOpen\(_sbBaseSongId\(song\), song\.id, song\.title \|\| '', null, null, typeof anchor === 'string' \? anchor : ''\)/) && !has('sbmEditParts', /_sbmEdOpen/));
  check('the tile says Edit, and the score\'s card has the Edit chip, not Overview edit',
    !/'Edit Parts' : 'Edit'/.test(SRC) && /_sbmDrawChip\(\) \+ _sbmEditChip\(\) \+ _sbmLayersChip\(\) \+ '<\/div>' \+\n\s*'<div class="sbm-score sb-song-page--choir"/.test(SRC) && !/>Overview edit<\/button>/.test(SRC));
  check('the printed page\'s Edit parts and the lyrics editor\'s choir redirect: the pad',
    /sbOverviewFor\(baseSongId, null\)/.test(fn('sbEditChoirParts')) && /_sbOverviewOpen\(_baseId, sid, s\.title \|\| '', null, null, ''\)/.test(fn('sbOpenLyricsEditor')) && !/sbEditChoirParts\(/.test(fn('sbOpenLyricsEditor')));
  check('a medley\'s following song, in Choir: ITS pad at the moment tapped',
    has('_sbmDblEdit', /card\.classList\.contains\('sbm-card--follow'\)\) \{\n\s*if \(card\.querySelector\('\.sbm-score'\)\) \{ _sbmStopPlayer\(\); _sbOverviewOpen\(_sbBaseSongId\(song\), song\.id, song\.title \|\| '', null, null, anchor\); \}/));
  check('...in lyrics: its words\' editor at the line tapped, anchors stamped first',
    has('_sbmDblEdit', /else sbOpenLyricsEditor\(song\.id, null, _sbmTapLine\(card, e\)\);/) && has('_sbmTapLine', /_sbmStampAnchors\(card\);/));
  check('the pad is the sheet, its save reads with the pad\'s reader',
    has('_sbmPadOpen', /if \(sheet\) \{ _sbCpMount\(o\); return; \}/) && has('_sbmPadSaveSong', /var split = o\.read \? o\.read\(fullText, _sbmIsChord\(\), o\.parts\) : _sbmPadSplit/) &&
    has('_sbmPadSaveSong', /parseVoiceText\(split\.text, \{ parts: split\.known \|\| o\.parts \}\)/));
  check('the boxes are a layer behind the words, never inside the editable text',
    /<div class="sbm-cp__boxes" aria-hidden="true"><\/div>' \+\n\s*'<div class="sbm-cp" contenteditable="true"/.test(SRC) && has('_sbCpPaint', /layer\.innerHTML = _sbCpBoxes/));
  check('+ New part is offered and exported; a question over the pad keeps its own keys',
    /WO\.sbmPadNewPart\(\)/.test(SRC) && /sbmPadNewPart: sbmPadNewPart/.test(SRC) && has('_sbmPadKey', /!_sbmPad\.host\.contains\(ev\.target\)\) return;/));
  check('Book Mode\'s choir notepad is left as it was (its own format, its own save)',
    /_sbmPadSaveSong\(N\.base, N\.sid, text, null, N\.openSig, \{ parts: N\.parts, quiet: true,/.test(fn('_sbChNpEnd')) && !/read:/.test(fn('_sbChNpEnd')));

  // -------------------------------------------------------------------------
  console.log('\n8. Closing with changes not saved: a toast, not the browser\'s box (2026-11-12)');
  const ask = fn('_sbmAskUnsaved');
  check('the pad and the parts editor no longer ask through confirm()', !/confirm\('Discard your changes/.test(SRC) && !/confirm\('Discard your changes to the parts\?'\)/.test(SRC));
  check('Cancel with changes asks; Discard closes, Save saves, anything else keeps editing',
    /if \(!P\.dirty\) \{ _sbmPadClose\(\); return; \}\n\s*_sbmAskUnsaved\(/.test(fn('sbmPadCancel')) &&
    /if \(v === 'discard'\) _sbmPadClose\(\);\n\s*else if \(v === 'save'\) sbmPadSave\(\);\n\s*else \{/.test(fn('sbmPadCancel')) &&
    /if \(v === 'discard'\) _sbmEdClose\(\);\n\s*else if \(v === 'save'\) sbmEdSave\(\);/.test(fn('sbmEdCancel')));
  check('the toast offers Keep editing (focused), Discard and Save',
    /data-unsaved="keep">Keep editing</.test(ask) && /data-unsaved="discard"/.test(ask) && /data-unsaved="save"/.test(ask) && /querySelector\('\[data-unsaved="keep"\]'\); if \(k\) k\.focus\(\);/.test(ask));
  check('Esc, and a tap anywhere else, keep editing', /if \(e\.key === 'Escape'\) \{[^}]*done\('keep'\); \}/.test(ask) && /var away = function\(e\) \{ if \(!el\.contains\(e\.target\)\) done\('keep'\); \};/.test(ask));
  check('asked again while it is up: a nudge, never a second toast', /if \(was && was\.__ask && !was\.__gone\) \{[^\n]*is-nudge[^\n]*return was\.__ask; \}/.test(ask));
  check('while it is up the editors leave the keys to it, and closing an editor takes it down',
    /if \(!_sbmPad \|\| document\.getElementById\('sbmUnsaved'\)\) return;/.test(fn('_sbmPadKey')) && /_sbmUnsavedDrop\(\);/.test(fn('_sbmPadClose')) &&
    /if \(!_sbmEd \|\| _sbmPad \|\| document\.getElementById\('sbmUnsaved'\)\) return;/.test(fn('_sbmEdKey')));
  check('it sits over the pad and the editors (z-index above 3650), from the foot of the screen', /\.sbm-unsaved \{\n\s*position: fixed; left: 50%; bottom: calc\(18px[^\n]*z-index: 10004;/.test(SRC));

  // -------------------------------------------------------------------------
  console.log('\n9. The review of 2026-11-12');
  check('[B] is everyone, as B: is', C.partName('B', [], [], false) === 'both');
  const Rm = C.read(['[Women]', 'D          G', 'That glorious song of old', '[Men]', '~oh'].join('\n'), isChord, [], []);
  check('a chord line knows its moment and whether it is over the lead line', Rm.chords[0].m === 0 && Rm.chords[0].lead === true && Rm.info[2].lead === true);
  // chords in the key sung: words edited, chords as shown -> the stored line exactly
  const sh = [{ words: 'Is there room', chord: 'G#m  D#m', lead: true, m: 0 }];
  const st = [{ words: 'Is there room', chord: 'F#m  C#m', lead: true, m: 0 }];
  const keep = C.toSave([{ words: 'Is there room, Lord', chord: 'G#m  D#m', lead: true, m: 0 }], sh, st, 2, XP);
  check('words edited under chords left as shown: the stored chords exactly (no F#m turned Gbm)', keep[0].chord === 'F#m  C#m', J(keep));
  const moved = C.toSave([{ words: 'Is there room', chord: 'A    E', lead: true, m: 0 }], sh, st, 2, XP);
  check('chords edited: moved back by the steps', /^G\s+D$/.test(moved[0].chord), J(moved));
  const goneOne = C.toSave([], sh, st, 0, XP);
  check('a chord line shown and taken away: asked to come out of the words', J(goneOne) === J([{ words: 'Is there room', chord: '', drop: 'F#m  C#m' }]), J(goneOne));
  // the save, by moment: a refrain sung three times, its first chord line deleted
  const SC = (lyrics) => {
    const out = { lyrics: null };
    const E = new Function('window', 'out', `
      var STATE = window.STATE;
      function _sbCopyById() { return null; }
      function _sbmIsChord() { return window.isChord; }
      function _sbChoirChordWords() { return window.STATE.songs[0].lyrics; }
      function _sbChoirChordSave(copy, base, l) { out.lyrics = l; return Promise.resolve(); }
      ${fn('_sbmPadSaveChords')}
      return _sbmPadSaveChords;`)({ lhcVoiceLines: V, STATE: { songs: [{ id: 'song_1', lyrics }] }, isChord }, out);
    return { E, out };
  };
  const REF = [0, 1, 2].map(i => ({ part: 'both', text: 'Glory to God', section: '', sortOrder: i, sustained: false }));
  const RLYR = 'C\nGlory to God\n\nF\nGlory to God\n\nG\nGlory to God';
  const shownR = C.read(C.text(REF, RLYR, isChord, { parts: [] }), isChord, [], []).chords;
  const padT = C.text(REF, RLYR, isChord, { parts: [] }).split('\n');
  padT.splice(padT.indexOf('C'), 1);                     // the first chord line taken out
  const typedR = C.read(padT.join('\n'), isChord, [], []).chords;
  const toSaveR = C.toSave(typedR, shownR, shownR, 0, XP);
  const sc = SC(RLYR);
  const res = await sc.E('song_1', REF, toSaveR, 'c1');
  check('a refrain sung three times, its first chord line deleted: only the first loses its chords',
    sc.out.lyrics === 'Glory to God\n\nF\nGlory to God\n\nG\nGlory to God' && res.orphans.length === 0, J([sc.out.lyrics, res]));
  const sc2 = SC(RLYR);
  await sc2.E('song_1', REF, C.toSave(C.read(C.text(REF, RLYR, isChord, { parts: [] }), isChord, [], []).chords, shownR, shownR, 0, XP), 'c1');
  check('...nothing changed: nothing written', sc2.out.lyrics === null);
  const one = C.text(REF.slice(1, 2).map(r => Object.assign({}, r, { sortOrder: 0 })), 'D  G\nGlory to God', isChord, { parts: [] }).split('\n');
  const sh1 = C.read(one.join('\n'), isChord, [], []).chords;
  one.splice(one.indexOf('D  G'), 1);
  const sc3 = SC('D  G\nGlory to God');
  await sc3.E('song_1', [Object.assign({}, REF[0])], C.toSave(C.read(one.join('\n'), isChord, [], []).chords, sh1, sh1, 0, XP), 'c1');
  check('a single chord line deleted: the chords come out of the words (it used to say "saved" and keep them)', sc3.out.lyrics === 'Glory to God', J(sc3.out));
  // + Chords on the men's line of a moment sung together
  const RT = C.read(['[Women]', 'Do you see', '[Men]', 'A star'].join('\n'), isChord, [], []);
  const ac3 = C.addChords(RT, 3);
  check('+ Chords on the second line of a moment sung together goes to its lead line, the first: a line over it, no gap inside',
    ac3.lines[1] === '' && ac3.lines[2] === 'Do you see' && ac3.lines[3] === '[Men]' && ac3.lines[4] === 'A star' && !ac3.toast, J(ac3));
  const ac4 = C.addChords(RT, 1);
  check('...on its first line: a line for chords over it, as before', ac4.lines[1] === '' && ac4.lines[2] === 'Do you see' && !ac4.toast);
  // the lead not the first line (the women hold, the men lead): no line can go in without parting them
  const RH = C.read(['[Women]', '~oh', '[Men]', 'A star'].join('\n'), isChord, [], []);
  const ac5 = C.addChords(RH, 1);
  check('...a lead that is not the moment\'s first line: nothing put in (it would part them), and it says why',
    J(ac5.lines) === J(RH.lines) && /sing together/.test(ac5.toast || ''), J(ac5));
  // a part's line that ends in a bracket
  const pv = V.parseVoiceText('[Verse]\n[Melody] [ad lib]\nnext line');
  check('"[Melody] [ad lib]" is the Melody singing "[ad lib]", not a section that takes the lines after it',
    J(pv.map(r => [r.part, r.text, r.section])) === J([['Melody', '[ad lib]', 'Verse'], ['both', 'next line', 'Verse']]), J(pv));
  check('...a bracket alone is still a section', V.parseVoiceText('[Chorus (x2)]\nla').map(r => r.section).join() === 'Chorus (x2)');
  // source: the rest
  check('the save reads with the parts named in the pad (+ New part)', /read: function\(x, ic\) \{ return _sbCpRead\(x, ic, \(_sbmPad && _sbmPad\.parts\) \|\| parts, sections\); \}/.test(fn('_sbOverviewOpenNow')));
  check('a save that half failed can be tried again (the signature moves on once the parts are kept)',
    /onLines: function\(rows\) \{ openSig = _sbLinesSig\(rows\); \}/.test(fn('_sbOverviewOpenNow')) && /if \(typeof o\.onLines === 'function'\) o\.onLines\(_sbVoiceLines\[base\] \|\| \[\]\);/.test(fn('_sbmPadSaveSong')));
  check('the toolbar keeps the cursor in the pad, and acts only where the cursor is',
    /\['pointerdown', 'mousedown'\]\.forEach/.test(fn('_sbCpMount')) && /if \(!sel\) \{ showToast\('Put the cursor on a line of the pad first'/.test(fn('_sbCpTool')) && !/\|\| \{ a: 0, b: 0, collapsed: true \}/.test(fn('_sbCpTool')));
  check('opening the pad lets the song go whatever goes wrong', /_sbOverviewOpenNow\(base, sid, title, sectionName, run, anchor\); \}\)\n\s*\.catch\(function\(e\) \{\n\s*_sbEditRelease\(base\);/.test(fn('_sbOverviewOpen')));
  check('Esc while a word is being composed is the keyboard\'s', /if \(ev\.isComposing\) return;/.test(fn('_sbmPadKey')));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
