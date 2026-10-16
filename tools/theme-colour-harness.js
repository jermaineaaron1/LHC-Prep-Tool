'use strict';
// Regression harness for the colours a theme change must not touch.
//
// WHY THIS EXISTS
// Rebranding the app to the 55th-anniversary green meant recolouring about
// two thousand hex and rgba values. A sweep that size cannot tell what a
// colour MEANS, and three kinds of colour in here are not branding at all:
//
//   The seven liturgical altar colours. Green for Ordinary Time, Purple for
//   Advent and Lent, Red for Pentecost and the martyrs, White for Christmas
//   and Easter, Gold for festivals, Blue where Advent uses it, Rose for
//   Gaudete and Laetare. They say what season the church is in. A green
//   Advent is not a theming bug, it is wrong about the calendar -- and the
//   sweep reached for Purple and Blue twice before being stopped.
//
//   Third-party marks. Spotify green and WhatsApp green belong to Spotify
//   and WhatsApp.
//
//   The colour PICKERS. The pen palette and the sticky notes are boxes of
//   crayons, not chrome. Both lost their blue to the sweep and ended up
//   offering the same green twice, which is how you find out that a palette
//   needs every hue it has.
//
// It also pins the projection background. That one is neither branding nor
// theology: it is what every lyric slide is thrown onto, and tinting it
// tints the words on the wall.
//
// USAGE
//   node tools/theme-colour-harness.js
//   node tools/theme-colour-harness.js path/to/file.html
//
// Exit code 0 = all checks passed, 1 = something failed.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const INDEX = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'Index.html');
if (!fs.existsSync(INDEX)) { console.error('No such file: ' + INDEX); process.exit(1); }
const src = fs.readFileSync(INDEX, 'utf8');

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

console.log('Reading ' + path.basename(INDEX) + '\n');

// ---------------------------------------------------------------------------
console.log('the liturgical altar colours say what season it is');
{
  // Background AND text colour for each, because a sweep that recoloured only
  // one of the pair would leave the season legible but wrong.
  const ALTAR = {
    Green:  ['rgba(34, 197, 94, 0.18)',  '#065f46'],
    Purple: ['rgba(168, 85, 247, 0.18)', '#4c1d95'],
    White:  ['#f1f5f9',                  '#1e293b'],
    Red:    ['rgba(239, 68, 68, 0.18)',  '#7f1d1d'],
    Gold:   ['rgba(234, 179, 8, 0.18)',  '#713f12'],
    Blue:   ['rgba(59, 130, 246, 0.18)', '#1e3a8a'],
    Rose:   ['rgba(244, 114, 182, 0.18)','#831843'],
  };
  for (const [season, [bg, fg]] of Object.entries(ALTAR)) {
    const rule = new RegExp('td\\[data-color="' + season + '"\\]\\s*\\{([^}]*)\\}');
    const m = src.match(rule);
    if (!m) { check(season + ' has a rule', false, true); continue; }
    check(season + ' keeps its colour', m[1].includes(bg) && m[1].includes(fg), true);
  }
}

// ---------------------------------------------------------------------------
console.log('\nother people\'s brand colours stay theirs');
{
  const count = (hex) => (src.match(new RegExp(hex, 'gi')) || []).length;
  check('Spotify green is present', count('1DB954') > 0, true);
  check('WhatsApp green is present', count('25D366') > 0, true);
}

// ---------------------------------------------------------------------------
console.log('\na colour picker still offers a range of colours');
{
  // The failure is subtle: the palette still has the right NUMBER of swatches,
  // two of them are just the same colour now. So this counts distinct hues.
  const hueOf = (hex) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return -1;                        // greys have no hue
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return Math.round(h * 60 + 360) % 360;
  };
  const spread = (hexes) => new Set(hexes.map(hueOf).filter(h => h >= 0).map(h => Math.round(h / 30))).size;

  const pen = [...src.matchAll(/class="wo-draw-color[^"]*"\s+data-color="(#[0-9a-fA-F]{6})"/g)].map(m => m[1]);
  check('the pen palette has its swatches', pen.length >= 5, true);
  check('and they are not all the same colour', spread(pen) >= 4, true);
  check('the pen palette still offers a blue', pen.some(h => { const x = hueOf(h); return x >= 195 && x <= 260; }), true);

  const sticky = (src.match(/var STICKY_COLORS = \[([^\]]+)\]/) || [, ''])[1]
    .match(/#[0-9a-fA-F]{6}/g) || [];
  check('the sticky notes have their colours', sticky.length >= 6, true);
  check('and no two of them are identical', sticky.length, new Set(sticky.map(s => s.toLowerCase())).size);
  check('the sticky notes still offer a blue', sticky.some(h => { const x = hueOf(h); return x >= 195 && x <= 260; }), true);
}

// ---------------------------------------------------------------------------
console.log('\nthe projection ground stays neutral');
{
  // Lyrics are thrown onto this. A green tint here is a green tint on the wall.
  check('slate-900 is still the projection background', /#0f172a/i.test(src), true);
}

// ---------------------------------------------------------------------------
console.log('\nthe app wears the jubilee green');
{
  const root = (src.match(/:root\s*\{([\s\S]*?)\}/) || [, ''])[1];
  const brand = (root.match(/--brand:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  check('--brand is set', !!brand, true);
  if (brand) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(brand.substr(i, 2), 16));
    check('--brand is a green (' + brand + ')', g > r && g > b, true);
  }
  check('--jubilee-mint is defined', /--jubilee-mint:/.test(root), true);
  check('the splash wears the reversed mark', /lhc-jubilee-55-light\.png/.test(src), true);
  check('the home page wears the dark-ink mark', /lhc-jubilee-55\.png/.test(src), true);
  check('the slogan is on the page', /Rooting, Growing and Fruiting/.test(src), true);
  check('Colossians 1:6 is cited', /Colossians 1:6/.test(src), true);
  check('Colossians 2:6 is cited', /Colossians 2:6/.test(src), true);

  for (const f of ['lhc-jubilee-55.png', 'lhc-jubilee-55-light.png']) {
    check(f + ' is in public/', fs.existsSync(path.join(__dirname, '..', 'public', f)), true);
  }
}

// ---------------------------------------------------------------------------
const failed = results.filter(ok => !ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
process.exit(failed ? 1 : 0);
