'use strict';
// Regression harness for a change on one device reaching a projection
// already running on another.
//
// WHY THIS EXISTS
// The operator asked for it (2026-11-11) and, asked directly, chose that
// the words change in front of the congregation rather than wait to be
// advanced past. Everything here is about a screen a room is looking at,
// so the failures are public ones.
//
// THE DANGEROUS DIRECTION
// Not updating is bad. Updating the operator's SCHEDULE while the wall
// keeps the old words is worse, because the screen they read from then
// says it is done. And putting the app's own chrome -- a banner, a
// half-typed line -- in front of a congregation is worse than either.
//
// USAGE
//   node tools/live-projection-harness.js                 # ../Index.html
//   node tools/live-projection-harness.js path/to/file.html
//   node tools/live-projection-harness.js <file> --expect-broken

const fs = require('fs');
const path = require('path');
const { makeDocument, El } = require('./minidom.js');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');

if (!fs.existsSync(INDEX)) {
  console.error('No such file: ' + INDEX);
  process.exit(1);
}
const SRC = fs.readFileSync(INDEX, 'utf8');

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

const lines = SRC.split('\n');
function extractFn(name) {
  const i = lines.findIndex(l => new RegExp('^  function ' + name + '\\s*\\(').test(l));
  if (i < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let k = i; k < lines.length; k++) {
    out.push(lines[k].replace(/\r$/, ''));
    for (const ch of lines[k]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('no close for ' + name);
}

let slideTextSrc;
try {
  slideTextSrc = extractFn('_lcdSlideText');
} catch (e) {
  if (EXPECT_BROKEN) {
    console.log('--expect-broken: ' + e.message + ', as expected.');
    process.exit(0);
  }
  throw e;
}
if (EXPECT_BROKEN) {
  console.log('\nBUT --expect-broken was given and the live-projection code is present.');
  process.exit(1);
}

// ── 1. one answer to "what is on the wall" ─────────────────────────────
console.log('\nthe words of a slide have one definition');
// A second copy of this reading would be a second answer to what is
// being projected, and the two would drift.
// Both, because the reader calls the predicate -- which is the point of
// the predicate being its own function.
const _lcdSlideText = new Function(
  extractFn('_lcdIsSlideLine') + '\n' + slideTextSrc + '\nreturn _lcdSlideText;')();

function slide(kids) {
  const c = new El('div', 'wo-slide-content');
  kids.forEach(k => c.appendChild(k));
  return c;
}
function line(text, cls) {
  const el = new El('div', cls || 'wo-slide-line');
  el.textContent = text;
  return el;
}

check('the lines of a slide, joined',
  _lcdSlideText(slide([line('L: In the Name of the Father'), line('C: Amen.')])),
  'L: In the Name of the Father\nC: Amen.');
// This instruction once went up in front of a congregation.
check('the editor\'s own placeholder never reaches the wall, by class',
  _lcdSlideText(slide([line('Real words'), line('anything', 'wo-slide-line wo-slide-empty-hint')])),
  'Real words');
check('  and by its text, for slides that carry it without the class',
  _lcdSlideText(slide([line('Real words'), line('Double-click to add content')])),
  'Real words');
check('an empty slide is empty, not a placeholder', _lcdSlideText(slide([])), '');
check('nothing at all does not throw', _lcdSlideText(null), '');
// A slide being typed on HERE reads from the box being typed in, so the
// operator's own preview follows their keystrokes.
const ta = new El('textarea');
ta.value = 'half a line';
check('a slide being edited here reads from the editor',
  _lcdSlideText(slide([line('stale'), ta])), 'half a line');

console.log('\nand selectSlideBox uses it rather than its own copy');
check('selectSlideBox asks for the text', /var text = _lcdSlideText\(content\);/.test(SRC), true);
// The projector and the rail's preview are different readers; what
// they must never disagree about is which lines count.
check('  the test for what counts is written once',
  (SRC.match(/Double-click to add content'/g) || []).length, 1);
check('  and both readers call it',
  (SRC.match(/\.filter\(_lcdIsSlideLine\)/g) || []).length, 2);
check('  it also records what went up',
  /updateProjectionPreview\(text, true\);[^\n]*\r?\n\s*_lcdProjected = text;/.test(SRC), true);

// ── 2. projecting no longer blocks the apply ───────────────────────────
console.log('\nthe state the operator cares about is no longer excluded');
const busy = extractFn('_orderSyncScreenBusy');
check('projecting does not stand the sync down', /_orderSyncProjecting\(\)/.test(busy), false);
// These stay: they are about not destroying words somebody here is
// typing, which is a different thing from not interrupting a service.
check('a slide being edited here still does', /editingSlideBox/.test(busy), true);
check('  and held, unsaved words', /_lcdEditDirty/.test(busy), true);
check('  and an open slide editor', /\.wo-slide-editor/.test(busy), true);
check('  and the Liturgy Builder, which takes the schedule down', /_lbdIsActive\(\)/.test(busy), true);
// The app's own chrome must still never appear on a projected screen.
check('a banner still refuses to show over a projection',
  /function _orderSyncShowBanner[\s\S]{0,300}?if \(_orderSyncProjecting\(\)\) return;/.test(SRC), true);

// ── 3. the wall follows the schedule ───────────────────────────────────
console.log('\nthe wall follows the schedule, not the other way round');
// Updating the operator's list while the wall kept the old words would
// be the worse failure: the screen they read from would say it was done.
check('the slide is re-sent after a change is applied',
  /applied\.applied\.length\) \{[\s\S]{0,600}?try \{ _lcdReproject\(\); \}/.test(SRC), true);
const repro = extractFn('_lcdReproject');
check('it does nothing when nothing is being projected', /if \(!_lcdOnAir\(\)\) return false;/.test(repro), true);
check('  nor when the operator is typing that very slide here',
  /if \(content\.querySelector\('textarea'\)\) return false;/.test(repro), true);
check('  nor when the words have not actually changed',
  /if \(text === _lcdProjected\) return false;/.test(repro), true);
check('it sends the SELECTED slide, which is the one on the wall',
  /\.wo-slide-box\.selected/.test(repro), true);

console.log('\nwhat counts as being on air');
const onAir = extractFn('_lcdOnAir');
// The operator projects through the Project button's own WINDOW, which
// leaves this page out of fullscreen entirely -- so asking about
// fullscreen alone, as the old sync guard did, answers "no" during most
// real services.
check('the projector WINDOW counts', /projectionWindow && !projectionWindow\.closed/.test(onAir), true);
check('  and a closed cross-origin window does not throw', /catch \(e\)/.test(onAir), true);
check('fullscreen counts', /document\.fullscreenElement/.test(onAir), true);
// #sbFsOverlay is the SONGBOOK's book mode -- somebody reading a song,
// not a congregation reading a wall. Calling it "the presenter overlay"
// here is what let the real one, #woFullscreenOverlay, go unchecked.
check('the LCD presenter overlay counts', /woFullscreenOverlay/.test(onAir), true);

// ── 4. pushed, not waited for ──────────────────────────────────────────
console.log('\npushed, rather than waited for');
// The realtime channel used to be started only by the songbook's open
// paths, so a device sitting in LCD Projection was never subscribed.
check('an open order subscribes, not only an open songbook',
  /function _orderSyncStart\(\)[\s\S]{0,900}?sbStartRealtimeSync\(\)/.test(SRC), true);
check('  and does not start a second channel over a live one',
  /typeof sbRealtimeChannel !== 'undefined' && !sbRealtimeChannel/.test(SRC), true);
check('every save says so, from the one place they all go through',
  /\.then\(function\(res\) \{[\s\S]{0,400}?window\._orderTouchSend\(id\)/.test(SRC), true);
check('  and that place is SBQ.saveOrder, which every path uses',
  /saveOrder: function\(payload(, opts)?\)[\s\S]*?window\._orderTouchSend\(id\)/.test(SRC), true);
check('  and the other devices listen for it',
  /\.on\('broadcast', \{ event: 'order_touch' \}/.test(SRC), true);
check('  for this order only',
  /p\.orderId !== \(currentOrderData && currentOrderData\.id\)\) return;/.test(SRC), true);
// A tick must see a difference twice before it trusts it (a save is
// upsert-then-prune), so one nudge alone would only ever arm it.
check('a nudge asks twice, because one pass only arms the check',
  /_orderSyncTick\(\);[\s\S]{0,120}?setTimeout\(function\(\) \{ _orderSyncTick\(\); \}, 700\);/.test(SRC), true);
check('the 4-second poll is still there as the fallback',
  /ORDER_SYNC_MS = 4000;/.test(SRC), true);

console.log('\nand the tick can actually run during a projection');
// Reported by the operator, who tried it: nothing reached the laptop and
// the banner was waiting on the way out of Full Screen. Three things
// blocked the path and the previous change had removed only the last.
const tick = extractFn('_orderSyncTick');
// #worshipOrderView is `position: fixed !important` in Full Screen, and
// offsetParent is NULL for a fixed element -- so the test meant to ask
// "is the editor on screen" answered "no" for every projected service,
// three lines in. Measured on the live page: offsetParent null in Full
// Screen, an element otherwise; getClientRects().length is 1 in both.
check('the editor is found by what is laid out, not by offsetParent',
  /!view \|\| !view\.getClientRects\(\)\.length/.test(tick), true);
// The word still appears in the comment saying why it is not used; what
// must be gone is the TEST.
check('  and offsetParent is no longer what it asks',
  /view\.offsetParent/.test(tick), false);
// Right when nobody is looking; wrong when a congregation is.
check('a hidden tab still syncs while something is on the wall',
  /visibilityState !== 'visible' &&[\s\S]{0,120}?_lcdOnAir\(\)\)\) return;/.test(tick), true);
check('  and that call cannot throw if the blocks are ever split',
  /typeof _lcdOnAir === 'function' && _lcdOnAir\(\)/.test(tick), true);
check('the 4-second poll and the Songbook hand-off are untouched',
  /ORDER_SYNC_MS/.test(SRC) && /songbookLiveModal/.test(tick), true);

console.log('\nthe slide on the wall is the one that may change');
const delta = extractFn('_orderSyncApplyDelta');
// The selected item IS the projected item, so deferring it made the
// operator's exact case the one case that could never apply.
const redrawBranch = delta.slice(delta.indexOf('redrawIds.forEach'), delta.indexOf('// Removals this pass'));
check('an edit to the projecting slide is no longer deferred',
  /selKey/.test(redrawBranch), false);
// A removal is different: yanking the projecting slide out leaves
// nothing on the wall, and it applies the moment they move off it.
const removeBranch = delta.slice(delta.indexOf('// Removals this pass'), delta.indexOf('// Which sections need'));
check('  but removing it still waits until they move off it',
  /selKey && loc\.domKey === selKey/.test(removeBranch), true);

console.log('\nand the projection survives the redraw');
// A redraw replaces the item's nodes, and the selected slide is one of
// them -- so what is on the wall would be lost with the markup.
check('the projecting slide is remembered before the redraw',
  /var liveSel = _orderSyncRememberLive\(\);/.test(delta), true);
check('  and put back after everything is on the page again',
  /_orderSyncRestoreLive\(liveSel\);/.test(delta), true);
check('  in that order', delta.indexOf('_orderSyncRememberLive()') < delta.indexOf('_orderSyncRestoreLive('), true);
const restore = extractFn('_orderSyncRestoreLive');
// Selecting a slide is what projects it, so going through selectSlideBox
// is what puts the new words on the wall -- one path, not a second one.
check('putting it back goes through the same path a click takes',
  /selectSlideBox\(box\)/.test(restore), true);
check('  and does nothing when it is already the selected one',
  /box\.classList\.contains\('selected'\)/.test(restore), true);
const remember = extractFn('_orderSyncRememberLive');
// A reading's slides carry no data-slide-idx (gotcha 60), so the place
// is counted rather than read off an attribute that may not be there.
check('the slide is remembered by its place, not by an element',
  /indexOf\(sel\)/.test(remember) && /data-slide-idx/.test(remember), false);
check('  by the key its item carries',
  /data-song-id.*data-liturgy-id/.test(remember), true);
// The rail is rebuilt from the DOM below, and clamps to the top (gotcha 73).
check('the rail is told to hold its place first',
  /_lcdRailHoldScroll/.test(delta), true);

console.log('\npresenting counts as being on air');
// Measured, not reasoned about: with the presenter overlay open and the
// browser refusing fullscreen, overlayShown was true, fullscreenElement
// false and _lcdOnAir() FALSE -- so the one state that most needs a
// last-minute change was not counted as projecting at all. goFullscreen
// falls back to this overlay whenever the projection window cannot be
// opened (gotcha 75), which is every single-screen laptop.
check('on-air asks whether that overlay is shown, not what the browser thinks',
  /classList\.contains\('show'\)/.test(onAir), true);
check('  and the projection window still answers first',
  onAir.indexOf('projectionWindow') < onAir.indexOf('woFullscreenOverlay'), true);
// #sbFsOverlay is the SONGBOOK's book mode -- somebody reading a song,
// not a congregation reading a wall. It was the wrong overlay entirely.
check('the Songbook\'s book mode is not mistaken for a projection',
  /getElementById\('sbFsOverlay'\)/.test(onAir), false);
// The banner is the one piece of app chrome that must never cross a
// projected slide, so it asks about the overlay too.
const projecting = extractFn('_orderSyncProjecting');
check('the notice also stands down for a windowed presenter overlay',
  /woFullscreenOverlay/.test(projecting) && /classList\.contains\('show'\)/.test(projecting), true);

console.log('\nthe presenter overlay is repainted, not left on stale nodes');
// _wofsSlides is a list of DOM NODES captured when Project was pressed.
// Applying a change takes the item's nodes off the page and builds new
// ones, so the overlay was left reading detached markup with the old
// words on it -- reproduced in the browser: the schedule read "WALL TEST
// ONE" within one tick while #woFullscreenContent never changed at all.
const reproject = extractFn('_lcdReproject');
check('reproject repaints the overlay', /_wofsRefresh\(\)/.test(reproject), true);
// selectSlideBox sets _lcdProjected, and the restore has already run it,
// so the text comparison at the end returns early. The refresh has to
// come before it or it is never reached.
check('  before the already-projected shortcut can return early',
  reproject.indexOf('if (_wofsRefresh())') < reproject.indexOf('text === _lcdProjected'), true);
const refresh = extractFn('_wofsRefresh');
check('the overlay\'s slide list is rebuilt from the page',
  /_buildWofsSlides\(\)/.test(refresh), true);
check('  and that rebuilt list becomes the one the overlay uses',
  /_wofsSlides = rebuilt;/.test(refresh), true);
check('  and the overlay is drawn again', /_wofsRender\(\)/.test(refresh), true);
check('  but nothing happens while it is closed',
  /classList\.contains\('show'\)/.test(refresh), true);
// Landing on the same INDEX would be wrong: a change from another device
// may add or remove slides above the one being shown.
check('it lands on the same slide, not the same index',
  /_wofsKeys\(/.test(refresh) && /indexOf\(wasKey\)/.test(refresh), true);

console.log('\nand a slide is found again by what it is');
const _wofsKeys = new Function(extractFn('_wofsKeys') + '\nreturn _wofsKeys;')();
function box(attrs) {
  const el = new El('div', 'wo-slide-box');
  Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
  return el;
}
const song = { 'data-song-id': 'song_1' };
const lit  = { 'data-liturgy-id': 'lit_9' };
check('each slide of an item is told from the next',
  _wofsKeys([box(song), box(song), box(lit)]),
  ['box:song_1:1', 'box:song_1:2', 'box:lit_9:1']);
// A song sung in two sections is two copies with two ids (gotcha 55), so
// the count restarts per item rather than running across the service.
check('  and the count restarts for each item',
  _wofsKeys([box(song), box(lit), box(song)]),
  ['box:song_1:1', 'box:lit_9:1', 'box:song_1:2']);
check('a sermon slide is its deck and its page',
  _wofsKeys([{ type: 'ppt', sectionId: 'wo-section-3', slideIndex: 4 }]),
  ['ppt:wo-section-3:4']);
check('nothing in the list does not throw', _wofsKeys([null, undefined]), ['', '']);
check('neither does no list at all', _wofsKeys(null), []);
// The whole point: the key of the slide being shown survives a rebuild
// in which slides above it came and went.
const before = [box(lit), box(lit), box(song)];
const after  = [box(lit), box({ 'data-liturgy-id': 'lit_new' }), box(lit), box(song)];
const shown = _wofsKeys(before)[1];
check('a slide keeps its identity when another is inserted above it',
  _wofsKeys(after).indexOf(shown), 2);

console.log('\na half-written line waits for the green tick');
// The operator, pointing at the Done tick on the phone's key bar: changes
// made in the Liturgy Builder should take effect when they confirm them.
// Once the sync began applying to a running projection, every keystroke
// was a last-minute change -- the builder writes as it types (gotcha 41)
// and autosaves two seconds later, so half a line went up in front of a
// congregation. What is held is the SHARING. The words still save, always,
// so a phone that locks mid-sentence loses nothing.
const ttlM = SRC.match(/var LBD_TYPING_HOLD = (\d+);/);
check('the hold has a stated length', !!ttlM, true);
const TTL = ttlM ? Number(ttlM[1]) : 0;
// Long enough to stop and think mid-sentence; short enough that a
// liturgist called away from an open field cannot freeze the order.
check('  minutes, not seconds, and not forever', TTL >= 60000 && TTL <= 600000, true);

const _lbdTypingHeld = new Function(
  'var LBD_TYPING_HOLD = ' + TTL + ';\n' + extractFn('_lbdTypingHeld') +
  '\nreturn _lbdTypingHeld;')();
const NOW = 1762000000000;
check('somebody is typing: the words wait',
  _lbdTypingHeld({ at: NOW - 1000, by: 'phone_b' }, 'me', NOW), true);
check('  our own typing never holds us',
  _lbdTypingHeld({ at: NOW - 1000, by: 'me' }, 'me', NOW), false);
// A mark nobody came back to must not freeze the order for everybody.
check('  a mark older than the hold is let go',
  _lbdTypingHeld({ at: NOW - TTL - 1, by: 'phone_b' }, 'me', NOW), false);
check('  and one exactly at the edge is let go too',
  _lbdTypingHeld({ at: NOW - TTL, by: 'phone_b' }, 'me', NOW), false);
check('no mark at all holds nothing', _lbdTypingHeld(null, 'me', NOW), false);
check('  nor a mark with no time on it',
  _lbdTypingHeld({ by: 'phone_b' }, 'me', NOW), false);

console.log('\nand the mark says what it means');
// A section title, a search box or a note is not the congregation's words.
const typingNow = extractFn('_lbdTypingNow');
check('only the words count as typing',
  /f === 'slide' \|\| f === 'content-text'/.test(typingNow), true);
check('  and only a field being typed in', /isContentEditable/.test(typingNow), true);
check('  inside the builder, not anywhere on the page',
  /host\.contains\(ae\)/.test(typingNow), true);
// Written at save time rather than kept as state: every save while the
// typing goes on stamps it afresh, so it needs no timer to stay alive and
// cannot be left behind by a path that forgot to clear it.
check('every save stamps the mark', /_lbdMarkTyping\(\);/.test(extractFn('saveCurrentOrder')), true);
const mark = extractFn('_lbdMarkTyping');
check('  set while the words are focused', /t\.lbdTyping = \{ at: Date\.now\(\)/.test(mark), true);
check('  and taken off when they are not', /delete t\.lbdTyping;/.test(mark), true);

console.log('\nDone is what sends them');
// Leaving the words IS the confirmation: the tick blurs the field on a
// phone, clicking away does the same on a desk.
const syncTyping = extractFn('_lbdSyncTyping');
check('leaving the words confirms them',
  /_lbdWasTyping && !typingNow.*_lbdConfirmTyping\(\)/.test(syncTyping), true);
// One definition of "typing the words", not two: f here is any editable
// field, and a section title never set the mark in the first place.
check('  and asks the same question that sets the mark',
  /var typingNow = _lbdTypingNow\(\);/.test(syncTyping), true);
const confirm = extractFn('_lbdConfirmTyping');
// Without this the finished words would wait out the 2s autosave while
// every other screen was still holding.
check('  and saves at once instead of waiting for the autosave',
  /clearTimeout\(_autoSaveTimer\)/.test(confirm) && /saveCurrentOrder\(true\)/.test(confirm), true);
check('  a songbook\'s pseudo-order is left alone', /_sbStandaloneId/.test(confirm), true);

console.log('\nthe receiver asks before it does anything at all');
const tick2 = extractFn('_orderSyncTick');
check('the tick asks whether somebody is typing',
  /_lbdTypingHeld\(res\.template && res\.template\.lbdTyping/.test(tick2), true);
// Before the diff: so there is no banner either, and the baseline stays
// put -- the tick after Done then sees the whole change at once.
check('  before it works out what changed',
  tick2.indexOf('_lbdTypingHeld(') < tick2.indexOf('_orderSyncFingerprint(res.items)'), true);
console.log('\nwords edited in the Songbook reach the wall');
// Measured before anything was changed, on a real order of 64 song
// slides: the edit pad's save returned success, the words were stored,
// and both the schedule's slide boxes and the saved slides[0].content
// still read the old text. The LCD projects `slides`, a separate array
// from the lyric fields, and nothing rebuilt it.
const setWords = extractFn('_sbSetCopyWords');
// Through _sbSlidesFollow since 2026-11-12 (gotcha 93): the same rebuild,
// only when the projected words changed.
const follow = extractFn('_sbSlidesFollow');
check('saving the words rebuilds the slides',
  /_sbSlidesFollow\(song, before\);/.test(setWords) && /refreshSongSlidesInOrder\(song\.id, now, \{ keepLyrics: true \}\);/.test(follow) &&
  /var now = _sbProjectionWords\(song\.lyrics \|\| ''\);/.test(follow), true);
// A save serialises the schedule's DOM whenever it is on the page
// (gotcha 35), and the rebuild is what brings that DOM into line.
check('  before the saves, not after',
  setWords.indexOf('_sbSlidesFollow(') > -1 && setWords.indexOf('_sbSlidesFollow(') < setWords.indexOf('sbAutoSave();'), true);
// Projecting on this device: the schedule just changed underneath it.
check('  and the slide on the wall is sent again',
  /_lcdReproject\(\)/.test(follow), true);
// song.lyrics here is the Songbook's own words, chords and all.
check('the rebuild does not take the Songbook\'s words away',
  /\{ keepLyrics: true \}/.test(follow), true);
const slideRebuild = extractFn('refreshSongSlidesInOrder');
check('  and that is what keepLyrics means',
  /if \(!\(opts && opts\.keepLyrics\)\) song\.lyrics = newLyrics;/.test(slideRebuild), true);
// A heading the operator typed on a slide (gotcha 73) used to be thrown
// away by every re-split; the song's own [Verse 1] marker still wins.
check('a heading typed on a slide survives a re-split',
  /slide\.header \|\| was\.header \|\| ''/.test(slideRebuild), true);
check('  and the background still does too',
  /background: was\.background \|\| ''/.test(slideRebuild), true);

console.log('\nand the chords stay off it');
// The pad is the Lyrics AND CHORDS editor. A chord line on the wall is
// sheet music in front of a congregation.
function topFn(name) {
  const i = lines.findIndex(l => new RegExp('^function ' + name + '\\s*\\(').test(l));
  if (i < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false, out = [];
  for (let k = i; k < lines.length; k++) {
    out.push(lines[k].replace(/\r$/, ''));
    for (const ch of lines[k]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  throw new Error('no close for ' + name);
}
const chordRe = SRC.split('\n').find(l => /^var CHORD_TOKEN_RE = /.test(l));
check('the shared chord pattern is there', !!chordRe, true);
// The real chain, run: the filter, the line test and the token test.
const _sbProjectionWords = new Function(
  chordRe.replace(/\r$/, '') + '\n' + topFn('lhcChordAscii') + '\n' + topFn('isChordToken') + '\n' +
  topFn('isChordLineGlobal') + '\n' + extractFn('_sbProjectionWords') +
  '\nreturn _sbProjectionWords;')();
check('a chord line is dropped',
  _sbProjectionWords('G    D\nAmazing grace\nEm   C\nhow sweet'),
  'Amazing grace\nhow sweet');
// The blank lines are the stanza breaks parseLyricsIntoSlides works from.
check('  blank lines are kept, so the slides still break where they did',
  _sbProjectionWords('one\n\ntwo'), 'one\n\ntwo');
check('  and so are the section markers',
  _sbProjectionWords('[Verse 1]\nG\nwords'), '[Verse 1]\nwords');
// The trap the shared detector exists for: "Am" is also the word "am",
// and both of these are real worship lyrics.
check('"the Great I Am" is a lyric, not a chord',
  _sbProjectionWords('You are the Great I Am'), 'You are the Great I Am');
check('  and so is "Am I not still the same"',
  _sbProjectionWords('Am I not still the same'), 'Am I not still the same');
check('nothing at all does not throw', _sbProjectionWords(null), '');
check('  nor an empty string', _sbProjectionWords(''), '');
// Without the detector it must hand back the words rather than nothing:
// a projection with no words is worse than one with a chord line.
check('with no detector it keeps every line',
  /typeof isChordLineGlobal !== 'function'/.test(extractFn('_sbProjectionWords')), true);

const passed = results.filter(Boolean).length;
console.log('\n' + '='.repeat(58));
console.log(passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
