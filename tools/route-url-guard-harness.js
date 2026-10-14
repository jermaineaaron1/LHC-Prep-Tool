'use strict';
// Every API route that fetches a URL the caller supplied must check the host.
//
// WHY THIS EXISTS
// A route handed a URL and told to fetch it will, without a host check, fetch
// anything reachable from the deployment -- internal addresses included -- and
// two of ours then hand what comes back to a model that describes it. That is
// a server-side request forgery with a readout, and it burns the Gemini quota
// doing it.
//
// parse-song-sheet had the guard from the start, with a comment saying exactly
// why. parse-lectionary was written later to the same shape and had no host
// check at all -- only a file-extension check, which constrains nothing,
// because http://169.254.169.254/latest/meta-data/x.pdf ends in .pdf. Probed
// against the live deployment it fetched example.com and reported the status
// back, and attempted the link-local address.
//
// Nothing caught that. The route typechecked, the suite passed, and the guard
// simply was not there. So this exists: not to re-check the one route that was
// fixed, but to notice the next one written without it.
//
// HOW IT DECIDES
// A route is "exposed" when it reads a url-shaped value out of the request --
// destructured from `await req.json()`, or pulled from searchParams -- and
// then passes that same identifier to fetch(). A URL the route builds itself
// from a fixed base is not caller-supplied and is not flagged; bible-passage
// is the case that matters there, since it fetches a constructed API URL.
//
// An exposed route passes when it calls a host guard BEFORE the fetch.
//
// USAGE
//   node tools/route-url-guard-harness.js
//   node tools/route-url-guard-harness.js --expect-broken
//
// Exit code 0 = every exposed route is guarded, 1 = one is not.

const fs = require('fs');
const path = require('path');

const EXPECT_BROKEN = process.argv.includes('--expect-broken');
const API = path.join(__dirname, '..', 'app', 'api');

function routes(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routes(p));
    else if (e.name === 'route.ts') out.push(p);
  }
  return out;
}

const results = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  results.push(ok);
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  if (!ok) console.log('         expected ' + e + '\n         got      ' + a);
}

// The names a guard may go by. Adding a route with a new one means adding it
// here, which is the point at which somebody reads this comment.
const GUARDS = /\bisOwnStorage\s*\(|\bisAllowedSource\s*\(/;

// Which identifiers in a route carry something the caller chose.
//
// This is a heuristic over the source text, not a type checker, and it is
// written to the shapes these routes actually use. The first version only
// understood `const { url } = await req.json()` and found ONE of the three
// known routes -- it missed `payload = await req.json()` followed by
// `payload.url`, and it missed a fetch inside `pageUrls.map(p => fetch(p))`.
// Those are the two shapes a new route is most likely to be written in, so a
// detector blind to them would have given exactly the false assurance this
// file exists to prevent.
//
// The guard against it going blind again is the assertion below that all
// three known routes are still found. If somebody writes a fourth shape, that
// assertion keeps passing while the new route goes unchecked -- so it is worth
// knowing that this catches common shapes, not all possible ones.
function analyse(src) {
  const tainted = new Set();

  // Seeds: straight out of the request.
  [...src.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+req\.json\(\)/g)]
    .forEach(m => m[1].split(',').forEach(part => {
      const name = part.trim().split(':').pop().trim().replace(/\s*=.*$/, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) tainted.add(name);
    }));
  [...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*await\s+req\.json\(\)/g)]
    .forEach(m => tainted.add(m[1]));
  [...src.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*await\s+req\.json\(\)/g)]
    .forEach(m => tainted.add(m[1]));
  [...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\(?\s*(?:await\s+)?[\w.]*searchParams\.get\(/g)]
    .forEach(m => tainted.add(m[1]));

  // Spread, to a fixed point: an assignment whose right-hand side mentions
  // something tainted is itself tainted -- unless it builds a URL on a literal
  // base, which is the bible-passage case and is not caller-chosen at all.
  const assigns = [...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+?)?=\s*([^;\n]+)/g)]
    .map(m => ({ name: m[1], rhs: m[2] }));
  // A callback parameter bound by iterating a tainted array carries the taint.
  const iterated = [...src.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*(?:map|forEach|flatMap|filter)\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/g)]
    .map(m => ({ from: m[1], param: m[2] }));

  for (let pass = 0; pass < 6; pass++) {
    let grew = false;
    // Property NAMES are not variables. `exportTask.result.files[0].url`
    // mentions no tainted identifier, but a naive scan saw the trailing
    // `.url` and matched the caller's `url` -- which is how convert-pptx was
    // reported unguarded twice over. Strip the accessors, then look.
    const mentions = rhs => [...rhs.replace(/\.\s*[A-Za-z_$][\w$]*/g, '.').matchAll(/[A-Za-z_$][\w$]*/g)]
      .some(w => tainted.has(w[0]));
    const buildsOnLiteral = rhs => /^\s*[`'"]https?:\/\//.test(rhs);
    // A fetch to a FIXED address launders the taint.
    //
    // convert-pptx sends the caller's url in the BODY of a request to
    // cloudconvert.com, then downloads the result from a url in their reply.
    // Following the taint through that made it look like the caller had
    // chosen the download address, and the harness reported the route as
    // unguarded. It is not: the address came back from a service we chose to
    // call. The question for a host guard is only ever "can the caller choose
    // the ADDRESS", and past a literal host they cannot.
    //
    // Left in rather than special-cased away, because this is the one false
    // positive the first version produced and the comment is cheaper than
    // rediscovering why.
    const launders = rhs => /fetch\(\s*[`'"]https?:\/\//.test(rhs);
    assigns.forEach(({ name, rhs }) => {
      if (!tainted.has(name) && mentions(rhs) && !buildsOnLiteral(rhs) && !launders(rhs)) {
        tainted.add(name); grew = true;
      }
    });
    iterated.forEach(({ from, param }) => {
      if (tainted.has(from) && !tainted.has(param)) { tainted.add(param); grew = true; }
    });
    if (!grew) break;
  }

  const fetched = [...new Set([...src.matchAll(/\bfetch\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)].map(m => m[1]))];
  return { fetched, exposed: fetched.filter(id => tainted.has(id)) };
}

const files = routes(API).sort();
console.log('Scanned ' + files.length + ' API route(s) under app/api\n');

const exposedRoutes = [];
files.forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const { exposed } = analyse(src);
  if (exposed.length) exposedRoutes.push({ f, src, exposed });
});

console.log('routes that fetch a URL the caller supplied');
if (!exposedRoutes.length) {
  // Not a pass: it means the detection stopped working, since we know of
  // three. A harness that finds nothing to check is not a harness.
  check('at least the three known ones were found', 0, 'at least 3');
} else {
  exposedRoutes.forEach(({ f, exposed }) =>
    console.log('       ' + path.relative(API, f).replace(/\\/g, '/') + '   via ' + exposed.join(', ')));
  check('the three known ones are still detected', exposedRoutes.length >= 3, true);
}

console.log('\nand every one of them checks the host first');
exposedRoutes.forEach(({ f, src, exposed }) => {
  const name = path.relative(API, f).replace(/\\route\.ts$/, '').replace(/\\/g, '/');
  const guardAt = src.search(GUARDS);
  // The FIRST fetch of a caller-supplied identifier. A guard after it has
  // already let the request out.
  const fetchAt = Math.min(...exposed.map(id => {
    const i = src.search(new RegExp('\\bfetch\\(\\s*' + id + '\\s*[,)]'));
    return i < 0 ? Infinity : i;
  }));
  check(name + ' calls a host guard', guardAt !== -1, true);
  if (guardAt !== -1) {
    check('  and does it before fetching', guardAt < fetchAt, true);
  }
});

// The guard itself, once, rather than three slightly different ones. The
// loosest of the three admitted any Supabase project rather than ours.
console.log('\nthere is one guard, not one per route');
const libFile = path.join(API, '_lib', 'isOwnStorage.ts');
check('the shared guard exists', fs.existsSync(libFile), true);
if (fs.existsSync(libFile)) {
  const lib = fs.readFileSync(libFile, 'utf8');
  check('  it refuses anything but https', /u\.protocol !== 'https:'/.test(lib), true);
  check('  it pins to the configured project host',
    /u\.hostname === allowedHost/.test(lib), true);
  // Falling back to `true` on a missing env var would open it to everything,
  // which is the failure mode worth naming.
  check('  and narrows, rather than opens, when the env var is missing',
    /\^\[a-z0-9-\]\+\\\.supabase\\\.co\$/.test(lib), true);

  const localCopies = files.filter(f =>
    /function isOwnStorage\s*\(/.test(fs.readFileSync(f, 'utf8')));
  check('  no route keeps its own copy', localCopies.map(f => path.relative(API, f)), []);
}

console.log('\n' + '='.repeat(60));
const pass = results.filter(Boolean).length;
console.log(pass + '/' + results.length + ' checks passed');
if (EXPECT_BROKEN) {
  if (pass === results.length) {
    console.log('\nBUT --expect-broken was given and everything passed.');
    process.exit(1);
  }
  console.log('\nFailures above are expected for pre-fix source.');
  process.exit(0);
}
if (pass === results.length) console.log('No route will fetch an address a stranger chose.');
process.exit(pass === results.length ? 0 : 1);
