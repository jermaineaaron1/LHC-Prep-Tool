'use strict';
// Regression harness: the page must run and look the same on iPhones and on
// the Android makers' own browsers, not only in desktop Chrome.
//
// WHY THIS EXISTS
// Every iOS browser is Safari underneath (Chrome on an iPhone included), and
// Samsung, Xiaomi and Honor phones ship their own browser on an older
// Chromium. A review on 2026-11-07, rendering the app in WebKit beside
// Chromium, found that what Chrome forgives they do not:
//
//   - A regex LOOKBEHIND, (?<=...), is a SyntaxError on Safari before 16.4.
//     A syntax error takes its whole <script> block down, and the one in
//     highlightChordsInLine sat in a block of ~8,000 lines.
//   - backdrop-filter needs -webkit-backdrop-filter on Safari before 18 (no
//     blur at all without it); user-select needs -webkit-user-select on every
//     Safari; mask-image needs -webkit-mask-image before Chrome 120.
//   - dvh/svh are dropped before Chrome 108 / Safari 15.4, and color-mix()
//     before Chrome 111 / Safari 16.2, unless a plain value comes first.
//   - webkitRequestFullscreen returns nothing, so .catch on its result threw
//     and stopped Book Mode before it laid out its pages.
//   - .at() (Chrome 92, Safari 15.4) is called by the app and the Tailwind
//     runtime; the first script polyfills it.
//
// `tools/check-inline-scripts.py` cannot see any of this: Node parses what
// Safari 15 cannot. See gotcha 71 in CLAUDE.md.
//
// USAGE
//   node tools/browser-compat-harness.js                  # checks ../Index.html
//   node tools/browser-compat-harness.js path/to/file.html
//   node tools/browser-compat-harness.js <file> --expect-broken
//
// --expect-broken is the negative control, for source from before the fix
// (`git show 86f18cf:Index.html > x`): every check must then FAIL.
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const EXPECT_BROKEN = args.includes('--expect-broken');
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
const raw = fs.readFileSync(INDEX, 'utf8');

let acorn = null;
try { acorn = require('acorn'); } catch (e) { /* eslint's parser; the regex scan below still runs */ }

const results = [];
function check(label, got, want, detail) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(EXPECT_BROKEN ? !ok : ok);
  const shown = EXPECT_BROKEN ? (!ok ? '  ok    (broken, as expected) ' : '  FAIL  (expected broken) ') : (ok ? '  ok    ' : '  FAIL  ');
  console.log(shown + label);
  if (!ok && !EXPECT_BROKEN && detail) console.log('          ' + detail);
}
function lineAt(i) { let n = 1; for (let k = 0; k < i; k++) if (raw.charCodeAt(k) === 10) n++; return n; }

// Inline scripts and style blocks, with where each starts.
const scripts = [], styles = [];
{
  const re = /<script([^>]*)>([\s\S]*?)<\/script\s*>/gi; let m;
  while ((m = re.exec(raw))) if (!/src=/i.test(m[1])) scripts.push({ at: m.index + m[0].indexOf('>') + 1, body: m[2] });
  const rs = /<style[^>]*>([\s\S]*?)<\/style\s*>/gi;
  while ((m = rs.exec(raw))) styles.push({ at: m.index + m[0].indexOf('>') + 1, body: m[1] });
}

// ---------------------------------------------------------------------------
console.log('\nno regex lookbehind in any script (a SyntaxError on Safari < 16.4)');
{
  const found = [];
  if (acorn) {
    scripts.forEach(s => {
      let ast; try { ast = acorn.parse(s.body, { ecmaVersion: 'latest', locations: true }); } catch (e) { return; }
      (function walk(n) {
        if (!n || typeof n.type !== 'string') return;
        if (n.type === 'Literal' && n.regex && /\(\?<[=!]/.test(n.regex.pattern)) found.push(lineAt(s.at) + n.loc.start.line - 1);
        if (n.type === 'Literal' && typeof n.value === 'string' && /\(\?<[=!]/.test(n.value)) found.push(lineAt(s.at) + n.loc.start.line - 1);
        for (const k in n) { if (k === 'loc') continue; const c = n[k]; if (Array.isArray(c)) c.forEach(walk); else if (c && typeof c.type === 'string') walk(c); }
      })(ast);
    });
  } else {
    scripts.forEach(s => { const re = /\(\?<[=!]/g; let m; while ((m = re.exec(s.body))) found.push(lineAt(s.at + m.index)); });
  }
  check('no (?<= or (?<! in a regex', found, [], 'at line(s) ' + found.join(', '));
}

// ---------------------------------------------------------------------------
console.log('\nevery inline script parses as ES2018 (Safari 11.1 / Chrome 64 syntax)');
if (acorn) {
  const bad = [];
  scripts.forEach(s => {
    try { acorn.parse(s.body, { ecmaVersion: 2018 }); }
    catch (e) { bad.push('block at line ' + lineAt(s.at) + ': ' + e.message); }
  });
  // Lookbehind is ES2018 to the parser, so this is about syntax beyond it
  // (??, ?., ??=, class fields...), which the pre-fix source does not use
  // either: under --expect-broken this one is reported, not flipped.
  if (EXPECT_BROKEN) console.log('  (info) ' + (bad.length ? bad.join('; ') : 'all parse'));
  else check('all ' + scripts.length + ' blocks parse', bad, [], bad.join(' | '));
} else console.log('  (skipped: acorn not installed)');

// ---------------------------------------------------------------------------
console.log('\n.at() is polyfilled before any other script runs');
{
  const firstSrc = raw.search(/<script[^>]*src=/i);
  const head = raw.slice(0, firstSrc);
  check('Array/String .at defined ahead of the first external script', /Object\.defineProperty\(p, 'at'/.test(head), true);
}

// ---------------------------------------------------------------------------
// The declaration block (rule, inline style or JS string) a match sits in.
function blockAround(i) {
  let a = i, b = i;
  while (a > 0 && i - a < 3000 && !'{"\'`'.includes(raw[a - 1])) a--;
  while (b < raw.length && b - i < 3000 && !'}"\'`'.includes(raw[b])) b++;
  return raw.slice(a, b);
}
function unprefixed(prop) {
  const re = new RegExp('(^|[^-\\w])' + prop + '\\s*:\\s*[^;}"\'`\\r\\n<>]', 'g');
  const out = []; let m;
  while ((m = re.exec(raw))) {
    const at = m.index + m[1].length;
    if (blockAround(at).indexOf('-webkit-' + prop) < 0) out.push(lineAt(at));
  }
  return out;
}
console.log('\nthe prefixes Safari still needs are written beside the standard property');
for (const prop of ['backdrop-filter', 'user-select', 'mask-image', 'appearance']) {
  const miss = unprefixed(prop);
  check(prop + ' always has -webkit-' + prop, miss, [], 'missing at line(s) ' + miss.slice(0, 20).join(', '));
}

// ---------------------------------------------------------------------------
console.log('\nnewer CSS values have a plain value before them');
{
  let postcss = null;
  try { postcss = require('postcss'); } catch (e) {}
  if (!postcss) console.log('  (skipped: postcss not installed)');
  else {
    const noVh = [], noMix = [];
    styles.forEach(s => {
      let root; try { root = postcss.parse(s.body); } catch (e) { return; }
      root.walkRules(r => {
        const decls = r.nodes.filter(n => n.type === 'decl');
        decls.forEach((d, i) => {
          const before = decls.slice(0, i).some(x => x.prop === d.prop);
          if (/\d(dvh|svh|lvh)\b/.test(d.value) && !before) noVh.push(lineAt(s.at + d.source.start.offset));
          if (/color-mix\(/.test(d.value) && !before) noMix.push(lineAt(s.at + d.source.start.offset));
        });
      });
    });
    check('dvh / svh / lvh always follow a vh value', noVh, [], 'at line(s) ' + noVh.join(', '));
    check('color-mix() always follows a plain colour', noMix, [], 'at line(s) ' + noMix.join(', '));
  }
}

// ---------------------------------------------------------------------------
console.log('\na fullscreen request is never chained without checking for a promise');
{
  // req.call(x).catch(...) where req may be webkitRequestFullscreen, which
  // returns undefined.
  const re = /\b\w+\.call\([\w.]+\)\.catch\(/g; const bad = []; let m;
  while ((m = re.exec(raw))) {
    const near = raw.slice(Math.max(0, m.index - 400), m.index);
    if (/webkitRequestFullscreen|mozRequestFullScreen/.test(near)) bad.push(lineAt(m.index));
  }
  check('no req.call(el).catch(...) after a prefixed fullscreen fallback', bad, [], 'at line(s) ' + bad.join(', '));
}

// ---------------------------------------------------------------------------
console.log('\nforced dark modes are opted out of (the page has no dark design)');
{
  check('<meta name="color-scheme" content="only light">', /<meta name="color-scheme" content="only light"/.test(raw), true);
}

// ---------------------------------------------------------------------------
console.log('\nthe bottom bar\'s icons are from the free Font Awesome set');
{
  // fa-grid-2 is Pro-only; the page loads the free 6.5.1 set, so it drew nothing.
  check('no fa-grid-2', /fa-grid-2\b/.test(raw), false);
}

console.log('\n================================');
const passed = results.filter(Boolean).length;
console.log(passed + '/' + results.length + ' checks passed' + (EXPECT_BROKEN ? ' (as broken)' : ''));
if (passed !== results.length) process.exit(1);
