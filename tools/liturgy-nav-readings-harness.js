'use strict';
// Regression harness for the Liturgy page's section nav, and for the
// Auto-Fill readings landing where the page actually reads them.
//
// WHY THIS EXISTS
//
// 1. AUTO-FILL SAVED INTO A TABLE NOTHING READS.
//    The Readings cards are drawn from SBQ_READINGS.getRange, which reads
//    the `roster` -- role ids reading1/psalm/reading2/gospel, 162 rows live.
//    "Auto-Fill from Bulletin" saved through SBQ_LECTIONARY.saveSlot, which
//    writes `lectionary_readings`: a passage-TEXT cache whose only reader is
//    its own read-modify-write. The save then repainted from a local
//    variable, so it looked like it had worked and the references were gone
//    on the next load. The table held ONE row, dated 2026-08-02 -- the one
//    time somebody tried it.
//
//    This is the kind of bug a textual check cannot catch: the old code read
//    perfectly well, and even carried a comment claiming it shared the
//    manual picker's pipeline. So the save is RUN here, against a stub that
//    records which module was written to.
//
// 2. TWO OF THE FIVE SECTIONS NEVER LIT UP.
//    selectOccasion(null) toggled `active` on data-occasion === null, which
//    matches nothing, and showAllServices cleared every button. So opening
//    Readings or Services left the whole nav dark and the page never said
//    where you were. Only Liturgies, Memories and Library highlighted.
//    There were five copies of that logic; there is now one, _litSyncNav,
//    and it is run here against a stub DOM.
//
// 3. The mobile strip exists because the sidebar is behind a hamburger on a
//    phone: changing section took open drawer, tap, drawer closes. The strip
//    carries the same class and data-libfilter as the sidebar entries, which
//    is what lets one function light both -- so that correspondence is
//    checked, not assumed.
//
// USAGE
//   node tools/liturgy-nav-readings-harness.js
//   node tools/liturgy-nav-readings-harness.js path/to/file.html
//   node tools/liturgy-nav-readings-harness.js <file> --expect-broken
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

const syncSrc = extractFunction('_litSyncNav');
const saveSrc = extractFunction('saveLectionaryReview');

console.log('Reading ' + path.basename(INDEX));
console.log('  _litSyncNav            ' + (syncSrc ? 'found' : 'ABSENT'));
console.log('  saveLectionaryReview   ' + (saveSrc ? 'found' : 'ABSENT') + '\n');

if (!saveSrc) { console.error('Could not slice saveLectionaryReview.'); process.exit(1); }

// The gate for --expect-broken is _litSyncNav alone: a structural marker that
// is present after the change and absent before it.
//
// It deliberately does NOT also test that the save targets the roster. Where
// the save lands is the whole point of the checks below, and a gate strict
// enough to notice it would exit here with a one-line message instead of
// running them -- so reverting the save would be reported by a regex rather
// than by a test that watched it write to the wrong module.
if (!syncSrc) {
  if (EXPECT_BROKEN) {
    console.log('(pre-change) Auto-Fill wrote lectionary_readings, which the Readings');
    console.log('page never reads, and the section nav had five copies of its active');
    console.log('state, two of which lit nothing at all.');
    console.log('\n--expect-broken: the pre-change shape is what passes');
    process.exit(0);
  }
  console.error('_litSyncNav is gone — the nav active state has been forked again.');
  process.exit(1);
}

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// ---- a stub DOM, just enough for _litSyncNav ------------------------------
function btn(cls, attrs) {
  const o = {
    _cls: new Set(cls.split(' ')),
    _attrs: attrs || {},
    getAttribute: k => (k in o._attrs ? o._attrs[k] : null),
    classList: {
      add: c => o._cls.add(c),
      remove: c => o._cls.delete(c),
      contains: c => o._cls.has(c),
      toggle: (c, on) => { if (on) o._cls.add(c); else o._cls.delete(c); }
    },
    get active() { return o._cls.has('active'); }
  };
  return o;
}

function makeDom() {
  // Two of each of the three: one in the sidebar, one in the mobile strip.
  // That duplication is the whole point -- one call must light both.
  //
  // Three since Liturgies and Library were folded into Memories. The
  // fixture mirrors the real strip on purpose: let it keep five and the
  // harness would happily prove that _litSyncNav lights a button no
  // page has.
  const KEYS = ['dashboard', 'all-services', 'memories'];
  const sidebar = KEYS.map(k => btn('lit-nav-occ-btn', { 'data-libfilter': k }));
  const strip   = KEYS.map(k => btn('lit-nav-occ-btn', { 'data-libfilter': k }));
  const folders = ['gen-prayers', 'gen-media'].map(f => btn('lit-gen-folder-btn', { 'data-gen-folder': f }));
  const all = sidebar.concat(strip).concat(folders);
  const scrolled = [];
  const document = {
    querySelectorAll(sel) {
      if (sel === '.lit-nav-occ-btn') return sidebar.concat(strip);
      if (sel === '.lit-gen-folder-btn') return folders;
      return [];
    },
    querySelector(sel) {
      if (sel === '#litTopNav .lit-nav-occ-btn.active') return strip.find(b => b.active) || null;
      return null;
    }
  };
  // scrollIntoView lives on the element the query returns.
  strip.forEach(b => { b.scrollIntoView = () => scrolled.push(b.getAttribute('data-libfilter')); });
  const fn = new Function('document', syncSrc + '\nreturn _litSyncNav;')(document);
  const lit = key => sidebar.concat(strip).filter(b => b.active).map(b => b.getAttribute('data-libfilter'));
  return { fn, sidebar, strip, folders, KEYS, lit, scrolled, all };
}

// ---------------------------------------------------------------------------
console.log('the nav says which section you are in');
{
  const d = makeDom();
  d.fn('dashboard');
  // Two entries, because the sidebar and the strip both have a Readings
  // button. This is the bug that started it: Readings lit nothing.
  check('Readings lights up', d.lit(), ['dashboard', 'dashboard']);
  d.fn('all-services');
  check('so does Services', d.lit(), ['all-services', 'all-services']);
  d.fn('memories');
  check('and Memories', d.lit(), ['memories', 'memories']);
  // Liturgies and Library are gone from the strip, so there is nothing
  // left for _litSyncNav to light for them. What it must still do is not
  // light anything when handed a key the strip no longer carries.
  d.fn('library');
  check('a key the strip no longer has lights nothing', d.lit(), []);

  // Back to a key that exists, because what follows is about lighting
  // both copies of one button, not about the keys themselves.
  d.fn('memories');
  check('only ever one section at a time', d.lit().length, 2);
  check('the sidebar copy is lit', d.sidebar.filter(b => b.active).length, 1);
  check('and the mobile copy with it', d.strip.filter(b => b.active).length, 1);
}

// ---------------------------------------------------------------------------
console.log('\nno section, and the folder buttons');
{
  const d = makeDom();
  d.fn('library');
  d.fn(null);
  // Drilling into one service from Services: none of the five is the truth.
  check('null clears every section', d.lit(), []);

  d.folders[0].classList.add('active');
  d.fn('memories');
  check('picking a section clears the folder highlights',
    d.folders.filter(b => b.active).length, 0);
}

// ---------------------------------------------------------------------------
console.log('\nthe active chip is scrolled into view');
{
  // The strip scrolls sideways on a phone and Library sits off the right
  // edge at 360px, so lighting it is not enough on its own.
  const d = makeDom();
  d.fn('memories');
  check('the strip is scrolled to the active chip', d.scrolled, ['memories']);
  const d2 = makeDom();
  d2.fn(null);
  check('and not scrolled when nothing is active', d2.scrolled, []);
}

// ---------------------------------------------------------------------------
// The save is RUN. A reading of the old code would have passed: it looked
// right and its comment claimed it shared the manual picker's pipeline.
console.log('\nAuto-Fill saves where the page reads');
{
  function runSave(refs, opts) {
    opts = opts || {};
    const wrote = { roster: [], lectionary: [] };
    const inputs = {};
    refs.forEach((r, i) => { if (r !== null) inputs['lectReviewInput' + i] = { value: r }; });
    const env = {
      LECT_REVIEW_FIELD_KEYS: ['firstReading', 'psalm', 'secondReading', 'gospel'],
      READING_SLOT_LABELS: ['1st Reading', 'Psalm', '2nd Reading', 'Gospel'],
      _currentReadingDate: '2026-11-01',
      _passageTextCache: {},
      bbNormaliseReference: s => String(s).toLowerCase(),
      _fetchBiblePassagePromise: (ref) => Promise.resolve(
        opts.passageFails === ref
          ? { error: 'no such passage' }
          // Canonicalising, the way the real lookup does: this is what turns
          // a misspelled AI reference into the one that gets saved.
          : { reference: ref.replace(/^Isiah/, 'Isaiah'), translation: 'ESV', text: 'x', verseCount: 1 }),
      SBQ_READINGS: {
        setReference: (date, idx, ref) => {
          wrote.roster.push({ date, idx, ref });
          return Promise.resolve(ref);
        }
      },
      SBQ_LECTIONARY: {
        saveSlot: (date, idx, data) => { wrote.lectionary.push({ date, idx, data }); return Promise.resolve([]); }
      },
      reloadReadings: () => { wrote.reloaded = true; },
      closeLectionaryUploadModal: () => { wrote.closed = true; },
      showToast: (m, k) => { wrote.toast = { m, k }; },
      console: { error: () => {}, warn: () => {} },
      document: { getElementById: id => inputs[id] || null }
    };
    const keys = Object.keys(env);
    const fn = new Function(...keys, saveSrc + '\nreturn saveLectionaryReview;')(...keys.map(k => env[k]));
    fn();
    // Everything stubbed settles in microtasks; four chained saves need a
    // few turns, so this waits on a macrotask rather than guessing a count.
    return new Promise(r => setTimeout(() => r(wrote), 0));
  }

  (async () => {
    let w = await runSave(['Revelation 7:9-17', 'Psalm 34:1-10, 22', '1 John 3:1-3', 'Matthew 5:1-12']);

    // THE bug.
    check('every reading goes to the roster', w.roster.length, 4);
    check('and none to the text cache that nothing reads', w.lectionary.length, 0);
    check('under the right date', w.roster.every(r => r.date === '2026-11-01'), true);
    // Slot order is reading1 / psalm / reading2 / gospel, and a swap here
    // would file the Gospel as the Epistle without any visible error.
    check('in slot order', w.roster.map(r => r.idx), [0, 1, 2, 3]);
    check('with the references given',
      w.roster.map(r => r.ref),
      ['Revelation 7:9-17', 'Psalm 34:1-10, 22', '1 John 3:1-3', 'Matthew 5:1-12']);
    check('the page is reloaded from the database, not from what was typed', w.reloaded, true);
    check('and the dialog closes on success', w.closed, true);

    // The lookup's canonical spelling is what gets saved, not the AI's.
    w = await runSave(['Isiah 6:1-8', null, null, null]);
    check('a misspelled reference is saved as the canonical one',
      w.roster.map(r => r.ref), ['Isaiah 6:1-8']);

    w = await runSave([null, 'Psalm 23', null, null]);
    check('a blank slot is skipped, and the rest keep their index',
      w.roster.map(r => [r.idx, r.ref]), [[1, 'Psalm 23']]);

    // One bad reference must not take the other three with it.
    w = await runSave(['Revelation 7:9-17', 'Habbakuk 99:1', '1 John 3:1-3', null],
                      { passageFails: 'Habbakuk 99:1' });
    check('a reference that does not resolve is not saved', w.roster.length, 2);
    check('but the good ones still are', w.roster.map(r => r.idx), [0, 2]);
    check('and the dialog stays open to show which failed', !w.closed, true);
    check('the page still reloads, so the screen matches the database', w.reloaded, true);

    w = await runSave([null, null, null, null]);
    check('saving nothing writes nothing', w.roster.length, 0);

    // ---------------------------------------------------------------------
    console.log('\nthe markup the sync depends on');
    {
      // _litSyncNav finds both navs through one selector. If the strip ever
      // stopped carrying the class or the attribute, it would silently stop
      // highlighting while the sidebar carried on working.
      // The closing tag must be found AFTER the opening one: there is an
      // earlier <nav> on the page (the song workspace breadcrumb), and a bare
      // indexOf('</nav>') returns that one, slicing backwards to nothing.
      const navAt = raw.indexOf('<nav id="litTopNav"');
      const nav = navAt < 0 ? '' : raw.slice(navAt, raw.indexOf('</nav>', navAt));
      check('the mobile strip exists', nav.length > 0, true);
      // Three, not the five this once had. Memories grew a ribbon per
      // service, a search across everything and a ribbon for the things
      // filed to no service, which is the whole of what Liturgies and
      // Library were for -- Liturgies being the Library filtered to one
      // category, and the Library being the same ribbons without the
      // notes. Two entries that led to the same place were removed.
      ['dashboard', 'all-services', 'memories'].forEach(k => {
        check('  it has ' + k, nav.indexOf('data-libfilter="' + k + '"') !== -1, true);
      });
      // Named, so putting either back is a decision somebody makes on
      // purpose rather than a merge quietly restoring a dead end.
      ['liturgies', 'library'].forEach(k => {
        check('  and no longer ' + k, nav.indexOf('data-libfilter="' + k + '"') !== -1, false);
      });
      check('and its buttons share the sidebar class, which is how one call lights both',
        (nav.match(/class="lit-nav-occ-btn"/g) || []).length, 3);
      check('it is hidden until the sidebar becomes an overlay',
        /\.lit-topnav \{ display: none; \}/.test(raw), true);
      check('and appears at the same breakpoint the sidebar uses',
        /@media \(max-width: 768px\), \(max-width: 1200px\) and \(orientation: portrait\)/.test(raw), true);
      check('which is the breakpoint _isSidebarOverlayMode tests',
        /innerWidth <= 768\) return true;[\s\S]{0,120}innerWidth <= 1200 && window\.matchMedia\('\(orientation: portrait\)'\)/.test(raw), true);
    }

    const failed = results.filter(ok => !ok).length;
    console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
    if (EXPECT_BROKEN) {
      if (!failed) {
        console.log('\nBUT --expect-broken was given and everything passed.');
        console.log('This harness cannot tell the fix from its absence. Do not trust it.');
        process.exit(1);
      }
      console.log('\nFailures above are expected for pre-fix source.');
      process.exit(0);
    }
    process.exit(failed ? 1 : 0);
  })();
}
