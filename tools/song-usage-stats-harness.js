'use strict';
// Regression harness for "how often is this song used".
//
// WHY THIS EXISTS
// The Song Finder sidebar ranked songs under the heading "Trending", and the
// ranking was wrong in a way that put the wrong songs at the very top.
//
// The `orders` table holds two kinds of row: real worship orders, and the
// `standalone_sb_*` pseudo-orders a songbook creates to keep its annotations
// in. The old count walked `order_items` and counted every row, so songbook
// membership was already counted as order usage -- and then the sidebar added
// songbook membership on top of it. Counted twice.
//
// On the live library that was not a rounding error. The four songs at the
// top of the list -- "This is the Day", "Every Praise", "My Life is in Your
// Hands", "Rooted in Grace" -- had been added to ZERO orders. Every song
// that had actually been sung sat below them on "1 time". The list was
// upside down.
//
// Meanwhile the song's own page called a different function, which did
// exclude the pseudo-orders, so the same song on the same screen read
// "3 times" in the sidebar and "Used in 0 orders" in its header.
//
// THE PART THAT IS EASY TO GET WRONG
// Two of these rules only bite on data that looks fine:
//
//   An order counts ONCE however many times the song is in it. A song used
//   as both the opening and the closing hymn is one service, not two.
//
//   Songbooks must not rank. They are shown -- the hover card lists them --
//   but a song compiled into three songbooks and never sung must not
//   outrank a song sung twice. That is the exact failure being fixed, so it
//   is checked as an ORDERING, not just as a number.
//
// HOW IT WORKS
// It reimplements nothing: it slices the real _sfBuildUsageIndex and
// _sfRankByOrders out of Index.html and runs them against made-up rows.
// The counting was deliberately split from the fetching so that this is
// possible -- a harness that could only read the code would have passed
// against the double-count, which is how the double-count survived.
//
// USAGE
//   node tools/song-usage-stats-harness.js
//   node tools/song-usage-stats-harness.js path/to/file.html
//   node tools/song-usage-stats-harness.js <file> --expect-broken
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

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

const buildSrc = extractFunction('_sfBuildUsageIndex');
const rankSrc  = extractFunction('_sfRankByOrders');

console.log('Reading ' + path.basename(INDEX));
console.log('  _sfBuildUsageIndex  ' + (buildSrc ? 'found' : 'ABSENT'));
console.log('  _sfRankByOrders     ' + (rankSrc ? 'found' : 'ABSENT') + '\n');

if (!buildSrc || !rankSrc) {
  if (EXPECT_BROKEN) {
    console.log('(pre-change) there is no shared usage index. The sidebar counted raw');
    console.log('order_items rows -- pseudo-orders included -- and then added songbook');
    console.log('membership on top, so songbook-only songs led the Trending list.');
    console.log('\n--expect-broken: the pre-change shape is what passes');
    process.exit(0);
  }
  console.error('The shared usage index is gone — usage counting has been forked again.');
  process.exit(1);
}

const api = new Function(
  buildSrc + '\n' + rankSrc +
  '\nreturn { build: _sfBuildUsageIndex, rank: _sfRankByOrders };')();

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// ---- stub rows, shaped exactly like the live tables ------------------------
const ORDERS = [
  { id: 'order_a', title: 'Advent 1', service_date: 'Nov 29', last_edited: '2026-01-03' },
  { id: 'order_b', title: 'Advent 2', service_date: 'Dec 6',  last_edited: '2026-01-02' },
  { id: 'order_c', title: 'Christmas Day', service_date: 'Dec 25', last_edited: '2026-01-01' },
  // A songbook's pseudo-order. It is a real row in `orders`, which is what
  // makes it so easy to count by accident.
  { id: 'standalone_sb_1', title: 'Hymns for Advent', service_date: '', last_edited: '2026-01-04' },
];
const BOOKS = [
  { id: 'sb_1', name: 'Hymns for Advent', song_ids: ['sung_twice', 'book_only', 'book_only_2'] },
  { id: 'sb_2', name: 'Youth Songbook',   song_ids: ['book_only', 'book_only_2'] },
  { id: 'sb_3', name: 'Choir Folder',     song_ids: ['book_only'] },
];
const item = (o, s, extra) => Object.assign({ order_id: o, source_id: s, item_type: 'song' }, extra || {});

// ---------------------------------------------------------------------------
console.log('counting where a song is used');
{
  const idx = api.build([
    item('order_a', 'sung_twice'),
    item('order_b', 'sung_twice'),
    // Opening AND closing hymn of the same service. One service.
    item('order_c', 'sung_once'), item('order_c', 'sung_once'),
    // The pseudo-order. Not a service.
    item('standalone_sb_1', 'book_only'),
    item('standalone_sb_1', 'book_only'),
    // An order that has since been deleted.
    item('order_deleted', 'ghost'),
    // Not a song.
    item('order_a', 'some_liturgy', { item_type: 'liturgy' }),
    // Junk rows that must not throw.
    item('order_a', ''), { order_id: 'order_a', item_type: 'song' }, null,
  ], ORDERS, BOOKS);

  check('a song in two orders counts two', idx.sung_twice.orderCount, 2);
  check('twice in one order is still one order', idx.sung_once.orderCount, 1);
  check('a songbook pseudo-order is not an order', (idx.book_only || {}).orderCount, 0);
  check('a row pointing at a deleted order counts nothing', idx.ghost, undefined);
  check('a liturgy item is not a song', idx.some_liturgy, undefined);
  check('a row with no song id is skipped', idx[''], undefined);

  check('songbook membership is read from song_ids', idx.book_only.songbookCount, 3);
  check('a song can be in a book and in orders', idx.sung_twice.songbookCount, 1);

  // THE regression. These two numbers used to be added together.
  check('books are counted apart from orders',
    [idx.book_only.orderCount, idx.book_only.songbookCount], [0, 3]);

  // The hover card names what it links to, so the index has to carry it.
  check('an order carries its title', idx.sung_twice.orders[0].title, 'Advent 1');
  check('and its service date', idx.sung_twice.orders[0].serviceDate, 'Nov 29');
  check('and its id, to open it', idx.sung_twice.orders[0].id, 'order_a');
  check('newest order first', idx.sung_twice.orders.map(o => o.id), ['order_a', 'order_b']);
  check('a songbook carries its name and id',
    [idx.book_only.songbooks[0].name, idx.book_only.songbooks[0].id], ['Hymns for Advent', 'sb_1']);
}

// ---------------------------------------------------------------------------
console.log('\nnothing to count');
{
  check('no rows at all is an empty index', api.build([], [], []), {});
  check('undefined arguments do not throw', api.build(), {});
  check('a songbook with no songs adds nobody',
    Object.keys(api.build([], [], [{ id: 'sb_x', name: 'Empty', song_ids: [] }])), []);
}

// ---------------------------------------------------------------------------
console.log('\nthe ranking the sidebar and the home page share');
{
  const idx = api.build([
    item('order_a', 'sung_twice'), item('order_b', 'sung_twice'),
    item('order_c', 'sung_once'),
    item('standalone_sb_1', 'book_only'),
  ], ORDERS, BOOKS);

  const songs = [
    { id: 'sung_twice', title: 'Be Thou My Vision' },
    { id: 'sung_once',  title: 'Amazing Grace' },
    { id: 'book_only',  title: 'A Book Song' },
    { id: 'book_only_2',title: 'Another Book Song' },
    { id: 'never',      title: 'Never Used' },
  ];
  const ranked = api.rank(songs, idx, 10);

  check('ranked by how many orders', ranked.map(x => x.song.id), ['sung_twice', 'sung_once']);

  // THE regression, as an ordering. "A Book Song" is in three songbooks and
  // no service; under the old count it scored 5 and led the list.
  check('a song in three books and no service is not listed',
    ranked.some(x => x.song.id === 'book_only'), false);
  check('a song in nothing at all is not listed',
    ranked.some(x => x.song.id === 'never'), false);
  check('the counts handed to the view are order counts',
    ranked.map(x => x.orderCount), [2, 1]);
  check('and the songbook count travels alongside, unranked',
    ranked.map(x => x.songbookCount), [1, 0]);
  check('each row carries the orders the card will list',
    ranked[0].orders.map(o => o.title), ['Advent 1', 'Advent 2']);
}

// ---------------------------------------------------------------------------
console.log('\nsongbooks are shown but never rank');
{
  // The case above cannot catch a ranking that adds the two together: every
  // song with no order is filtered out first, and among the survivors the
  // combined total happened to give the same order. It needs a song that IS
  // in an order and is in enough songbooks to overtake on the combined score.
  //
  //   sung_more   2 orders, 0 songbooks   -- sung twice, compiled never
  //   book_heavy  1 order,  3 songbooks   -- sung once, compiled three times
  //
  // Sung twice wins. Adding the two together would reverse it, which is the
  // old behaviour wearing the new function's name.
  const idx = api.build([
    item('order_a', 'sung_more'), item('order_b', 'sung_more'),
    item('order_c', 'book_heavy'),
  ], ORDERS, [
    { id: 'sb_1', name: 'One',   song_ids: ['book_heavy'] },
    { id: 'sb_2', name: 'Two',   song_ids: ['book_heavy'] },
    { id: 'sb_3', name: 'Three', song_ids: ['book_heavy'] },
  ]);
  const ranked = api.rank([
    { id: 'book_heavy', title: 'Compiled Often' },
    { id: 'sung_more',  title: 'Sung Often' },
  ], idx, 10);

  check('the song sung more often comes first',
    ranked.map(x => x.song.id), ['sung_more', 'book_heavy']);
  check('even though the other is in more things overall',
    [ranked[0].orderCount + ranked[0].songbookCount,
     ranked[1].orderCount + ranked[1].songbookCount], [2, 4]);
}

// ---------------------------------------------------------------------------
console.log('\nties, limits and missing rows');
{
  const idx = api.build([
    item('order_a', 's1'), item('order_a', 's2'), item('order_a', 's3'),
  ], ORDERS, [{ id: 'sb_1', name: 'Book', song_ids: ['s2'] }]);

  const songs = [
    { id: 's3', title: 'Charlie' }, { id: 's1', title: 'Alpha' }, { id: 's2', title: 'Bravo' },
  ];
  const ranked = api.rank(songs, idx, 10);
  // All on one order each: the book breaks the tie, then the alphabet.
  check('a tie is broken by songbook count, then title',
    ranked.map(x => x.song.id), ['s2', 's1', 's3']);

  const many = [];
  const items = [];
  for (let i = 0; i < 20; i++) {
    many.push({ id: 'm' + i, title: 'Song ' + i });
    items.push(item('order_a', 'm' + i));
  }
  const bigIdx = api.build(items, ORDERS, []);
  check('the limit is honoured', api.rank(many, bigIdx, 10).length, 10);
  check('and a different limit is too', api.rank(many, bigIdx, 8).length, 8);

  check('a song the index has never heard of is skipped, not crashed',
    api.rank([{ id: 'unknown', title: 'X' }], {}, 10), []);
  check('no index at all is survivable', api.rank(songs, null, 10), []);
}

// ---------------------------------------------------------------------------
console.log('\nhow it is wired in');
{
  // Deliberately few textual checks, and none of them stand in for the
  // behaviour above. What they pin is that there is still only ONE ranking.
  check('the sidebar ranks through the shared function',
    /var ranked = _sfRankByOrders\(songs, usage, 10\)/.test(raw), true);
  check('the home page ranks through the same one',
    /_sfRankByOrders\(songs, STATE\.usageIndex, 8\)/.test(raw), true);

  // The home page used to sort by the use_count column, which is 0 on every
  // row in the live library, so it silently showed an alphabetical list.
  const home = raw.slice(raw.indexOf('function renderHomeTrendingSongs'));
  const homeBody = home.slice(0, home.indexOf('\n  }\r\n'));
  check('and no longer sorts by the empty use_count column',
    /\(b\.useCount \|\| 0\) - \(a\.useCount \|\| 0\)/.test(homeBody), false);

  // The separate songbook tally the sidebar used to add on top.
  check('the second songbook tally is gone', /_sfSongbookCounts/.test(raw), false);

  // One source of truth: the song page must not count for itself again.
  check('the song page reads the shared index',
    /SBQ\.getSongUsage = function\(songId\) \{[\s\S]{0,400}getSongUsageIndex\(\)/.test(raw), true);
  check('an order is excluded by prefix in exactly one place',
    (raw.match(/\/\^standalone_\/\.test\(it\.order_id\)/g) || []).length, 1);

  // The hover card has to be able to open what it names.
  check('the card can open an order', /kind === 'order'/.test(raw) && /WO\.loadOrder\(id\)/.test(raw), true);
  check('the card can open a songbook',
    /kind === 'songbook'/.test(raw) && /WO\.openSongbookStandalone\(id\)/.test(raw), true);
  check('the card lives on <body>, not inside the 320px scroller',
    /document\.body\.appendChild\(el\)/.test(raw) && /#sfUsageCard \{[^}]*position: fixed/.test(raw), true);
  check('and the hide is delayed so the pointer can reach it',
    /_sfCancelHideUsageCard\(\)/.test(raw) && /_sfHideUsageCard\(160\)/.test(raw), true);
  check('the badge is focusable, so this is not mouse-only',
    /<button type="button" class="stat-usage-badge/.test(raw), true);

  // Picking a suggestion while a song page is open must replace the song.
  const sug = raw.slice(raw.indexOf('function _sfOpenFromSuggestion'));
  const sugBody = sug.slice(0, sug.indexOf('\n  }\r\n'));
  check('the suggestion handler exists', sugBody.length > 0, true);
  check('it notices a song page is already open',
    /classList\.contains\('show'\)/.test(sugBody) && /currentLyricsPreviewSong/.test(sugBody), true);
  check('and opens the picked song in it',
    /openLyricsPreviewModal\(song\)/.test(sugBody), true);
  check('picking the song already open does nothing',
    /currentLyricsPreviewSong\.id === song\.id\) return/.test(sugBody), true);
}

// ---------------------------------------------------------------------------
const failed = results.filter(ok => !ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
