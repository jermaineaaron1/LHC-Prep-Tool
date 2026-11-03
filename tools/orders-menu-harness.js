'use strict';
// Harness for the Orders menu and an order's three steps.
//
// WHY THIS EXISTS
// The Orders menu listed every order there had ever been, so on a phone the
// header and two or three cards filled the screen and this week's service
// was a scroll away. It now lists the latest ten -- the most recently edited
// first -- with the rest behind See more, as an archive under a heading of
// its own; a search looks through all of them, because the order somebody
// searches for is usually an old one.
//
// It also holds the colours that tell the three steps apart (the builder
// green, the Songbook blue, LCD Projection a light red), which are easy to
// lose to a later rule with a stronger selector.
//
// USAGE
//   node tools/orders-menu-harness.js                 # ../Index.html
//   node tools/orders-menu-harness.js path/to/file.html
//   node tools/orders-menu-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show 8bfc996:Index.html > x`).
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

const SRC = fs.readFileSync(INDEX, 'utf8');
const lines = SRC.split('\n');
const has = re => re.test(SRC);

function extract(header) {
  const startIdx = lines.findIndex(l => l.indexOf(header) !== -1);
  if (startIdx < 0) return null;
  let depth = 0, started = false;
  const out = [];
  for (let i = startIdx; i < lines.length; i++) {
    out.push(lines[i].replace(/\r$/, ''));
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return out.join('\n');
  }
  return null;
}

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

console.log('The list of orders');
const fnNames = ['function _woOrderTime(', 'function _woGetFilteredOrders(', 'function renderSavedOrders('];
const fns = fnNames.map(extract);
const capLine = (SRC.match(/^\s*var WO_ORDERS_SHOWN = \d+;/m) || [''])[0];
check('the list is sliced out of the page', fns.every(Boolean) && !!capLine);

if (fns.every(Boolean) && capLine) {
  const L = new Function(
    'var savedOrders = [], _woSearchQuery = "", _woActiveFilter = "all", _woShowArchive = false;\n' +
    'var _woOrderCounts = {}, _woOpenMoreMenuIdx = null, _woSelectMode = false;\n' +
    'var window = {};\n' +
    'var box = { innerHTML: "" };\n' +
    'function $(id) { return id === "woSavedOrdersContainer" ? box : null; }\n' +
    'function escapeHtml(s) { return String(s); }\n' +
    'function escapeJsArg(s) { return String(s); }\n' +
    'function formatRelativeTime() { return "just now"; }\n' +
    'function sanitizeServiceDate(s) { return s; }\n' +
    'function _bindOrderCardOpenGestures() {}\n' +
    capLine + '\n' + fns.join('\n') + '\n' +
    'return { render: function(o) { savedOrders = o.orders; _woSearchQuery = o.q || ""; _woShowArchive = !!o.archive; renderSavedOrders(); return box.innerHTML; } };')();

  // Fourteen orders, listed in no particular order: order 13 is the newest.
  const orders = [];
  for (let i = 0; i < 14; i++) {
    orders.push({ id: 'o' + i, title: 'Service ' + i, type: i === 3 ? 'special' : 'traditional',
                  lastEdited: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() });
  }
  const shuffled = orders.slice().reverse();
  shuffled.push(shuffled.shift());   // the newest last, so a list taken as it comes is wrong
  const titles = html => (html.match(/<span class="wo-order-title-text">[^<]*<\/span>/g) || []).map(t => t.replace(/<[^>]+>/g, ''));

  const top = L.render({ orders: shuffled });
  const t = titles(top);
  check('only the latest ten are listed', t.length === 10, t.length + ' cards');
  check('...the most recently edited first', t[0] === 'Service 13' && t[9] === 'Service 4', t.join(', '));
  check('...and See more says how many more are archived',
    /<button class="wo-orders-more" onclick="WO\._woToggleArchive\(true\)">[^]*See more <span>4 archived<\/span><\/button>/.test(top));

  const all = L.render({ orders: shuffled, archive: true });
  const ta = titles(all);
  check('See more lists the rest after them, under an Archived heading',
    ta.length === 14 && ta[13] === 'Service 0' &&
    all.indexOf('wo-orders-archive-head') > all.indexOf('Service 4<') && all.indexOf('wo-orders-archive-head') < all.indexOf('Service 3<'));
  check('...and offers the latest ten again', /onclick="WO\._woToggleArchive\(false\)"[^>]*>[^]*Show only the latest 10<\/button>/.test(all));

  const found = L.render({ orders: shuffled, q: 'service 1' });
  const tf = titles(found);
  check('a search looks through the archive too, and needs no See more',
    tf.length === 5 && tf.indexOf('Service 1') !== -1 && found.indexOf('wo-orders-more') === -1, tf.join(', '));

  const few = L.render({ orders: orders.slice(0, 7) });
  check('ten or fewer: all of them, and no button', titles(few).length === 7 && few.indexOf('wo-orders-more') === -1);

  // Each card still carries its REAL index into savedOrders: every handler on
  // it (Open, Rename, Delete) indexes the full array.
  const cardOf = {};
  top.split('data-order-idx="').slice(1).forEach(part => {
    const m = part.match(/^(\d+)">[^]*?<span class="wo-order-title-text">([^<]*)</);
    if (m) cardOf[m[2]] = +m[1];
  });
  check('a card keeps its index into the whole list, not its place on screen',
    cardOf['Service 13'] === 13 && cardOf['Service 12'] === 0, JSON.stringify(cardOf));
}
check('See more is wired to the module', has(/_woToggleArchive: _woToggleArchive,/));
check('the header is 25px shorter on a phone',
  has(/\.wo-hero \{ padding-top: 14px; padding-bottom: 14px; margin-bottom: 13px; \}/) && has(/\.wo-hero-subtitle \{ margin-bottom: 8px; \}/));

console.log('\nThe three steps of an order');
check('the Songbook\'s card is blue',
  has(/#worshipOrderView \.wo-mode-card--song \.wo-mode-card-icon \{ background: linear-gradient\(135deg, #173f8a, #3b82f6\);/) &&
  has(/#worshipOrderView \.wo-mode-card--song \{ border-color: #c9dcf6; \}/));
check('LCD Projection\'s card is a light red',
  has(/#worshipOrderView \.wo-mode-card--lcd \.wo-mode-card-icon \{ background: linear-gradient\(135deg, #c24141, #f28b8b\);/) &&
  has(/#worshipOrderView \.wo-mode-card--lcd \{ border-color: #f5d0d0; \}/));
check('...and the tabs above carry the same colours on their numbers',
  has(/#worshipOrderView #woSongbookStepBtn \.wo-step-num \{ background: #3b82f6; \}/) &&
  has(/#worshipOrderView #woServiceOrderBtn \.wo-step-num \{ background: #ec7a7a; \}/));
// These rules come after the old ones, and must: same selectors, later wins.
const oldSong = SRC.indexOf('#worshipOrderView .wo-mode-card {');
const newSong = SRC.indexOf('#worshipOrderView .wo-mode-card--song {');
check('...after the card\'s own border, which would otherwise win', oldSong > 0 && newSong > oldSong);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
