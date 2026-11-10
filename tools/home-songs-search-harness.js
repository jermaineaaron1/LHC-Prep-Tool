'use strict';
// Harness for the home page's Songs / Songbooks and Worship Orders cards and
// the Songs page's search, as changed on 2026-11-07.
//
// WHY THIS EXISTS
// Asked for with three annotated screenshots:
//   - search by the FIRST letters of a song's title, and only that. It
//     matched the letters anywhere in the title, artist, theme, scripture,
//     style or season, so "he" listed "10,000 Reasons (Bless the Lord)" and
//     "All The Earth is Hopeful".
//   - a five-second hint at the search box, as the page opens.
//   - "Song Finder" renamed "Songs / Songbooks"; the three newest songbooks on
//     that card and the three orders edited last on Worship Orders; the
//     jubilee strip ten pixels shorter; more room before Upcoming Services.
// And one found on the way: the Roster card always said "0 services this
// month", because its count came only from the retired Apps Script.
//
// 2026-11-10: the second line under every name went, and the name itself
// grew 6px and went to weight 800. The trap is that weight. Cinzel was
// loaded at 500;700, and a browser asked for 800 from a family that stops
// at 700 renders 700 and says nothing -- the rule reads correctly in the
// file, the page is no bolder, and no test that only greps the rule can
// tell. The weight is therefore checked where it is REQUESTED.
//
// WHAT IS EASY TO GET WRONG
//   - The list and the suggestions must use ONE rule, or they disagree.
//   - A card that holds buttons cannot itself be a <button>: the two cards
//     are a <div> under a full-size transparent button, and a chip's click
//     must not reach the card, or it opens the page as well as the book.
//   - The hint must paint above the filters (their header gives every child
//     z-index 1, and they come later in the page).
//
// USAGE
//   node tools/home-songs-search-harness.js                 # ../Index.html
//   node tools/home-songs-search-harness.js path/to/file.html
//   node tools/home-songs-search-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 378359a:Index.html > x`).

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n').map(l => l.replace(/\r$/, ''));

let passed = 0, failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log('  ok    ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail !== undefined ? '\n        ' + detail : '')); }
}
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(label, a === e, 'got ' + a + '\n        expected ' + e);
}

function block(i) {
  let depth = 0, started = false;
  const out = [];
  for (let k = i; k < lines.length; k++) {
    out.push(lines[k]);
    for (const ch of lines[k]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  return null;
}
function fn(name) {
  const i = lines.findIndex(l => new RegExp('^\\s*function ' + name + '\\(').test(l));
  return i < 0 ? null : block(i);
}

// ---------------------------------------------------------------- the rule
const escapeHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let F = {};
try {
  const src = ['_sfTitleKey', '_sfTitleStarts', 'highlightMatch', '_homeOrderChipName', '_homeNewest'].map(n => fn(n) || '').join('\n');
  F = new Function('escapeHtml', src + '\nreturn { key: typeof _sfTitleKey === "function" ? _sfTitleKey : null, starts: typeof _sfTitleStarts === "function" ? _sfTitleStarts : null, hi: highlightMatch, chipName: typeof _homeOrderChipName === "function" ? _homeOrderChipName : null, newest: typeof _homeNewest === "function" ? _homeNewest : null };')(escapeHtml);
} catch (e) { console.error('could not slice: ' + e.message); }
const starts = (title, q) => F.starts ? F.starts({ title }, q) : null;

console.log('a song is found by the first letters of its title');
const LIB = ['10,000 Reasons (Bless the Lord)', 'All The Earth is Hopeful', 'Angels We Have Heard On High', 'He Leadeth Me',
  'Here I am Lord (I the Lord of Sea and Sky)', 'How Great Is Our God', '"Joy to the World"', 'Él Shaddai', 'Lord, I Need You'];
const find = q => LIB.filter(t => starts(t, q));
eq('"he" finds the titles that begin "He", not every "the" and "Heard"', find('he'), ['He Leadeth Me', 'Here I am Lord (I the Lord of Sea and Sky)']);
eq('  "lord" finds "Lord, I Need You", not "Bless the Lord" or "Here I am Lord"', find('lord'), ['Lord, I Need You']);
eq('  digits are letters too: "10"', find('10'), ['10,000 Reasons (Bless the Lord)']);
eq('  case and spacing do not matter', find('  HOW   gr'), ['How Great Is Our God']);
eq('  a leading quote is skipped, on either side', [find('joy'), find('"joy')], [['"Joy to the World"'], ['"Joy to the World"']]);
eq('  accents are not needed', find('el sh'), ['Él Shaddai']);
eq('  an empty box finds everything', find('').length, LIB.length);
const hi = F.hi ? F.hi('"Joy to the World"', 'jo') : '';
check('the suggestion marks the letters typed, after a leading quote', hi === '&quot;<mark style="background:#fef08a;padding:0 2px;border-radius:2px;">Jo</mark>y to the World&quot;', hi);
check('  and escapes the title', F.hi && F.hi('<b>Hi</b>', 'x') === '&lt;b&gt;Hi&lt;/b&gt;', F.hi && F.hi('<b>Hi</b>', 'x'));

console.log('\nthe list and the suggestions use that one rule');
const afs = fn('applyFiltersAndSort') || '', rss = fn('renderSearchSuggestions') || '';
check('the list filters by _sfTitleStarts', /result = result\.filter\(function\(s\) \{ return _sfTitleStarts\(s, f\.q\); \}\);/.test(afs));
check('  the suggestions too', /STATE\.songs\.filter\(function\(s\) \{ return _sfTitleStarts\(s, query\); \}\)/.test(rss));
check('  neither searches artist, theme or scripture any more', !/s\.artist, s\.theme, s\.scripture/.test(afs + rss));
check('  the box says so', /placeholder="Type the first letters of a song title\.\.\."/.test(SRC));

console.log('\nfive seconds of how to search, as the page opens');
const hint = fn('_sfSearchHint') || '';
check('opening the Songs page shows it', /renderSongbooksList\(\);\r?\n\s*\/\/[^\n]*\r?\n\s*\/\/[^\n]*\r?\n\s*setTimeout\(_sfSearchHint, 350\);/.test(SRC));
check('  for five seconds', /timer = setTimeout\(end, 5000\);/.test(hint));
check('  gone the moment the box is touched or typed in', /inp\.addEventListener\('focus', end\);/.test(hint) && /inp\.addEventListener\('input', end\);/.test(hint) && /inp\.addEventListener\('pointerdown', end\);/.test(hint));
check('  not over words already typed, nor a hidden box', /if \(!inp \|\| inp\.value \|\| inp\.offsetParent === null/.test(hint));
check('  above the filters, whose header puts every child at z-index 1',
  /#songFinderView #sfCommandHeader > \.sf-search-field\.sf-search-flash \{ position: relative; z-index: 60; \}/.test(SRC));
check('  and still for anyone who asks for less motion', /@media \(prefers-reduced-motion: reduce\) \{\r?\n\s*\.sf-search-hint, \.sf-search-hint > i, \.sf-search-flash #searchInput/.test(SRC));

console.log('\nthe home cards');
check('"Song Finder" is "Songs / Songbooks"', /<div class="home-nav-label font-cinzel">Songs \/ Songbooks<\/div>/.test(SRC) && !/<div class="home-nav-label font-cinzel">Song Finder<\/div>/.test(SRC));
const songsCard = (SRC.match(/<div class="home-nav-card home-nav-songs" data-view="songFinderView">[\s\S]*?\r?\n          <\/div>/) || [''])[0];
const ordersCard = (SRC.match(/<div class="home-nav-card home-nav-orders" data-view="worshipOrderView">[\s\S]*?\r?\n          <\/div>/) || [''])[0];
check('  the two cards with chips are not buttons, but have one over the whole card',
  /<button type="button" class="home-nav-hit"/.test(songsCard) && /<button type="button" class="home-nav-hit"/.test(ordersCard) &&
  /id="homeRecentSongbooks"/.test(songsCard) && /id="homeRecentOrders"/.test(ordersCard));
const chips = fn('_homeRecentChips') || '';
check('  a chip opens its book or order, not the page under it', /e\.stopPropagation\(\);/.test(chips) &&
  /window\.WO\.loadOrder\(id\)/.test(chips) && /openStandaloneSongbook\('sb-' \+ id\)/.test(chips));
check('  and sits above the cover', /\.home-nav-recent \{\r?\n\s*position: relative; z-index: 1;/.test(SRC));
const recent = fn('renderHomeRecent') || '';
check('  the three orders edited last', /orders = _homeNewest\(orders, 3\);/.test(recent));
check('  the songbooks read lightly: the newest three, and the ones opened here by id, three columns',
  /var cols = 'id, name, created_date';/.test(recent) &&
  /\.from\('songbooks'\)\.select\(cols\)\.order\('created_date', \{ ascending: false \}\)\.limit\(3\)/.test(recent) &&
  /\.from\('songbooks'\)\.select\(cols\)\.in\('id', openedIds\)/.test(recent));

// (2026-11-07, later) "can it be any songbook that was accessed -- not just
// private ones but also from the service (8 Nov for example)".
console.log('\nthe Songs card: the songbooks opened last, of either kind');
const remember = fn('_sbRememberOpened') || '';
const openSb = fn('openSongbook') || '', openModal = fn('_openSongbookModal') || '';
check('every way into a songbook records it, on this device -- a service\'s and one of My Songbooks',
  /try \{ _sbRememberOpened\(\); \} catch \(e\) \{\}/.test(openSb) && /try \{ _sbRememberOpened\(\); \} catch \(e\) \{\}/.test(openModal) &&
  /localStorage\.setItem\('lhc_recent_songbooks'/.test(remember) && /kind: standalone \? 'songbook' : 'order'/.test(remember));
check('  a service\'s chip opens its Songbook, not the order', /\} else if \(k === 'sborder'\) \{\r?\n\s*if \(typeof openSongbookFromOrder === 'function'\) openSongbookFromOrder\(id\);/.test(chips));
check('  the card is drawn from what was opened', /var books = _homeRecentBooks\(opened, byId, cache\.known \|\| null, cache\.newest \|\| \[\]\);/.test(recent));
let RB = null;
try { RB = new Function((fn('_homeRecentBooks') || '') + '\nreturn typeof _homeRecentBooks === "function" ? _homeRecentBooks : null;')(); } catch (e) { RB = null; }
const show = list => (list || []).map(x => x.kind + ':' + x.name);
const OPENED = [{ kind: 'order', id: 'o8', name: 'Service - Nov 8' }, { kind: 'songbook', id: 'b1', name: 'LHC Caroling 2026' },
  { kind: 'order', id: 'oGone', name: 'Service - Oct 4' }, { kind: 'songbook', id: 'bGone', name: 'Old book' }, { kind: 'order', id: 'o1', name: 'Service - Nov 1' }];
const ORDERS = { o8: { title: 'Service - Nov 8' }, o1: { title: 'Service - Nov 1' } };
const NEWEST = [{ id: 'b1', name: 'LHC Caroling 2026' }, { id: 'b2', name: 'LHC Jubilee' }, { id: 'b3', name: 'Pastor Sunday' }];
if (RB) {
  eq('a service book and one of My Songbooks, as opened; gone ones left out', show(RB(OPENED, ORDERS, { b1: { name: 'LHC Caroling 2026' }, bGone: null }, NEWEST)),
    ['sborder:Service - Nov 8', 'songbook:LHC Caroling 2026', 'sborder:Service - Nov 1']);
  eq('  fewer than three opened: the newest of My Songbooks fill in, once each', show(RB(OPENED.slice(0, 2), ORDERS, null, NEWEST)),
    ['sborder:Service - Nov 8', 'songbook:LHC Caroling 2026', 'songbook:LHC Jubilee']);
  eq('  nothing opened yet on this device: the newest three, as before', show(RB([], ORDERS, null, NEWEST)),
    ['songbook:LHC Caroling 2026', 'songbook:LHC Jubilee', 'songbook:Pastor Sunday']);
  eq('  a book opened since the last read keeps its name; one asked for and missing is gone',
    show(RB([{ kind: 'songbook', id: 'bNew', name: 'Watchnight' }, { kind: 'songbook', id: 'bGone', name: 'Old' }], null, { bGone: null }, [])),
    ['songbook:Watchnight']);
  eq('  a renamed book shows its new name', show(RB([{ kind: 'songbook', id: 'b1', name: 'Carols' }], null, { b1: { name: 'LHC Caroling 2026' } }, [])),
    ['songbook:LHC Caroling 2026']);
} else check('a service book and one of My Songbooks, as opened; gone ones left out', false, '_homeRecentBooks not found');
check('  never a songbook\'s pseudo-order among the orders', /String\(o\.id\)\.indexOf\('standalone_'\) !== 0/.test(recent));
if (F.newest) {
  eq('  newest by last edit; undated last', F.newest([{ id: 'a', t: '2026-10-01' }, { id: 'b', t: '' }, { id: 'c', t: '2026-11-07' }, { id: 'd', t: '2026-11-01' }], 3).map(x => x.id), ['c', 'd', 'a']);
} else check('  newest by last edit; undated last', false, '_homeNewest not found');
if (F.chipName) {
  eq('  an order called "Service - <date>" shows its date; a named one, its name',
    [F.chipName({ title: 'Service - Nov 8', serviceDate: 'Nov 8' }), F.chipName({ title: 'Service - 11 Oct 2026', serviceDate: 'Oct 11' }),
     F.chipName({ title: 'Carols by Candlelight', serviceDate: 'Dec 20' }), F.chipName({ title: '', serviceDate: 'Dec 27' }), F.chipName({})],
    ['Nov 8', 'Oct 11', 'Carols by Candlelight', 'Dec 27', 'Service Order']);
} else check('  an order called "Service - <date>" shows its date; a named one, its name', false, '_homeOrderChipName not found');
check('  beside the words only when the names fit there whole', /function _homeRecentFit\(card\)/.test(SRC) && /_homeRecentFit\(card\);/.test(chips) &&
  /\.home-nav-card\.has-recent:not\(\.recent-below\) \{ grid-template-areas: "icon label recent" "icon \. stat"; \}/.test(SRC));

console.log('\none name to a card, bigger and bolder');
check('the second line under every name is gone, markup and CSS both', !/home-nav-desc/.test(SRC));
check('  the name is 0.88rem + 6px at weight 800 on a desk', /\.home-nav-label \{\r?\n\s*font-size: 1\.25rem;\r?\n\s*font-weight: 800;/.test(SRC));
check('  and 0.78rem + 6px on a phone', /\.home-nav-label \{ grid-area: label; font-size: 1\.15rem;/.test(SRC));
// The one that cannot be seen in the rule: 800 asked of a family loaded
// at 500;700 is 700, silently. Without this the card is never bolder.
check('  Cinzel is actually fetched at 800', /family=Cinzel:wght@500;700;800&/.test(SRC));
check('  one row on a phone, so the card is no taller for the bigger name', /grid-template-areas: "icon label stat";/.test(SRC));
const rosterStat = fn('_homeRosterStat') || '';
check('  the count drops "this month", which the page around it says', /' service' \+ \(dateCount !== 1 \? 's' : ''\);/.test(rosterStat) && !/this month/.test(rosterStat));

console.log('\nthe roster count and the room around');
check('the Roster card counts what Upcoming Services reads, not the retired Apps Script',
  /HOME_STATE\.rosterCurrent = results\[0\] \|\| \[\];\r?\n\s*HOME_STATE\.rosterNext = results\[1\] \|\| \[\];\r?\n\s*_homeRosterStat\(\);/.test(SRC));
check('the jubilee strip ten pixels shorter, on a desk (the mark) and a phone (the mark and its gaps)',
  /\.home-jubilee-mark \{ width: 52px; height: 52px;/.test(SRC) &&
  /\.home-jubilee \{ flex-direction: column; text-align: center; gap: 8px; padding: 9px 14px 8px; \}/.test(SRC) &&
  /\.home-jubilee-mark \{ width: 56px; height: 56px; \}/.test(SRC));
check('more room before Upcoming Services', /\.home-nav-grid \{ grid-template-columns: 1fr; gap: 7px; margin-bottom: 18px; \}/.test(SRC));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  console.log(failed ? 'negative control: failed as expected' : 'negative control: everything PASSED against source expected to be broken');
  process.exit(failed ? 0 : 1);
}
process.exit(failed ? 1 : 0);
