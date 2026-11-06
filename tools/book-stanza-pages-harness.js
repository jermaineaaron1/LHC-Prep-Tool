'use strict';
// Harness for where Book Mode's pages break (CLAUDE.md gotcha 66).
//
// WHY THIS EXISTS
// From the operator (2026-11-06): in Book Mode a chord line sat at the foot
// of a page with its words over the leaf ("Em  Am7" with "From the grave to
// the sky" on the next page). Pages were cut every 1,123px wherever that
// fell -- through a chord-and-words pair, even through a line. Now:
//   - a page ends where a stanza ends (a run of lines between blank lines,
//     or the lines under a [Verse] / [Chorus] label); a stanza that does not
//     fit goes whole to the next page, its label with it;
//   - only a stanza taller than a page is split, and then between pairs,
//     never between a chord line and the words under it;
//   - each page is cut at the next page's first line, so a stanza carried
//     over is not half-shown at the foot of the page before.
//
// USAGE
//   node tools/book-stanza-pages-harness.js                 # ../Index.html
//   node tools/book-stanza-pages-harness.js path/to/file.html
//   node tools/book-stanza-pages-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the change
// (`git show b4bf738:Index.html > x`).
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

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + String(detail).slice(0, 400) : '')); }
}

// A song laid out as the book lays it out: a label, chord and words lines,
// blank lines, each with its height.
const H = { H: 31, c: 29, l: 36, _: 44 };
function layout(shape, start) {
  let y = start || 120;
  return shape.split('').map(ch => {
    const gap = ch === 'H' ? 25 : ch === 'c' ? 16 : 0;
    y += gap;
    const it = { type: { H: 'header', c: 'chord', l: 'lyric', _: 'empty' }[ch], top: y, bottom: y + H[ch] };
    y = it.bottom + (ch === 'l' ? 8 : 0);
    return it;
  });
}

const atSrc = fn('_sbFsStanzaBreakAt'), startsSrc = fn('_sbFsPageStarts');
if (atSrc && startsSrc) {
  const At = (items, from, cap, total) => new Function(atSrc + '\nreturn _sbFsStanzaBreakAt.apply(null, arguments[0]);')([items, from, cap, total]);
  const Starts = (items, total, pageH, manual, pt, pb) => new Function(atSrc + '\n' + startsSrc + '\nreturn _sbFsPageStarts.apply(null, arguments[0]);')([items, total, pageH, manual, pt, pb]);
  const pageOf = (items, starts, total) => starts.map((s, i) => { const e = i + 1 < starts.length ? starts[i + 1] : total; return items.filter(it => it.top >= s - 0.5 && it.top < e - 0.5); });

  // The song in the operator's screenshot: Lord I Lift Your Name On High.
  const lord = layout('Hclclclcl_Hclclclcl_clclcl');
  const total = lord[lord.length - 1].bottom + 40;
  const starts = Starts(lord, total, 1123, null, 20, 0);
  const pages = pageOf(lord, starts, total);
  const lastOf = p => p.filter(it => it.type !== 'empty').pop();
  check('the song in the screenshot: the chorus ends a page, the next stanza starts the next, whole',
    pages.length === 2 && lastOf(pages[0]).type === 'lyric' && pages[1][0].type === 'chord' && pages[1].filter(it => it.type !== 'empty').length === 6,
    JSON.stringify(pages.map(p => p.map(it => it.type[0]).join(''))));
  check('...no page ends on a chord line', pages.every(p => lastOf(p).type !== 'chord'));

  // A label stays with its stanza.
  const labelled = layout('Hclclclcl_Hclclclclclclcl');
  const ls = Starts(labelled, labelled[labelled.length - 1].bottom + 40, 700, null, 20, 0);
  const lp = pageOf(labelled, ls, labelled[labelled.length - 1].bottom + 40);
  check('a stanza that does not fit goes to the next page with its [Chorus] label', lp.length >= 2 && lp[1][0].type === 'header' && lastOf(lp[0]).type !== 'header',
    JSON.stringify(lp.map(p => p.map(it => it.type[0]).join(''))));

  // A stanza taller than a page is split between pairs, never inside one.
  const tall = layout('H' + 'cl'.repeat(30));
  const tt = tall[tall.length - 1].bottom + 40;
  const tp = pageOf(tall, Starts(tall, tt, 1123, null, 20, 0), tt);
  check('only a stanza taller than a page is split, and then between pairs, never a chord from its words',
    tp.length >= 2 && tp.every(p => lastOf(p).type === 'lyric') && tp.slice(1).every(p => p[0].type === 'chord'), JSON.stringify(tp.map(p => p.length)));

  // Every page holds what fits on it.
  const big = layout('Hclclcl_clclcl_Hclclclcl_clcl_Hclclcl_clclclcl_clcl');
  const bt = big[big.length - 1].bottom + 40, bs = Starts(big, bt, 1123, null, 20, 0);
  check('every page holds no more than fits on it (the first with the title, the rest with a top margin)',
    bs.every((s, i) => { const e = i + 1 < bs.length ? bs[i + 1] : bt; return e - s <= 1123 - (i ? 20 : 0) + 0.5; }), JSON.stringify(bs));
  check('...and every page but a stanza too tall ends where a stanza ends',
    pageOf(big, bs, bt).slice(0, -1).every((p, i) => { const next = big.find(it => it.top >= bs[i + 1] - 0.5); return next && (next.type === 'header' || big[big.indexOf(next) - 1].type === 'empty'); }));
  check('nothing but blank space left over makes no page of its own', Starts(layout('Hcl_'), 400, 1123, null, 20, 0).length === 1);
  check('a break dragged in the page view is kept when it fits', JSON.stringify(Starts(lord, total, 1123, [600], 20, 0).slice(0, 2)) === '[0,600]');
  check('one line taller than a page is cut where the page runs out', At([{ type: 'lyric', top: 10, bottom: 3000 }], 0, 1000, 3000) === 1000);
} else check('the break rule is pure functions: _sbFsStanzaBreakAt, _sbFsPageStarts', false);

const build = fn('_sbFsBuildPages');
check('a one-column page is cut at the next page\'s first line, the pages after the first with a top margin',
  /var endY  = \(pi \+ 1 < pageBreaks\.length\) \? pageBreaks\[pi \+ 1\] : totalH;/.test(build) &&
  /'<div class="sbm-bk-clip" style="position:absolute;top:' \+ padTop \+ 'px;left:0;width:794px;height:' \+ clipH \+ 'px;overflow:hidden;">'/.test(build));
check('a two-column page\'s columns end where stanzas end, by the same rule', /function tcBreak\(fy, ch\) \{\n\s*return _sbFsStanzaBreakAt\(tcIt, fy, ch, tcTH\);/.test(build));
check('Book Mode and the print preview\'s page count use the rule', /return _sbFsPageStarts\(_sbFsItemsOf\(mDiv\), mDiv\.scrollHeight, A4H, manualBreaks, _SB_FS_PAD_TOP, _SB_FS_PAD_BOT\);/.test(fn('_sbFsBreaksFromDiv')));
check('a blank line is read as blank: "wo-lyrics-empty-line" holds "lyric" but is not a lyric line',
  /cls\.indexOf\('lyric-line'\) >= 0 \? 'lyric' : cls\.indexOf\('empty'\) >= 0 \? 'empty'/.test(fn('_sbFsItemsOf')) && !/indexOf\('lyric'\) >= 0/.test(fn('_sbFsItemsOf')));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (EXPECT_BROKEN) {
  if (failed > 0) { console.log('(--expect-broken: failures were expected, and there were some)'); process.exit(0); }
  console.log('(--expect-broken: expected failures, found none)'); process.exit(1);
}
process.exit(failed ? 1 : 0);
