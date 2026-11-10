// Local preview server for this worktree. Mirrors app/route.ts: serves
// dist/index.html at "/".
//
// IT IS NOT A SANDBOX BY DEFAULT, SO IT MAKES ITSELF ONE.
//
// The Supabase URL and anon key are hardcoded in the page, so the app
// served from here talks to the SAME production database as the live
// site. A "throwaway" order built on localhost once created a real order
// row and six files in the live storage bucket; the network panel looked
// clean and it was only found days later.
//
// So the page is rewritten on the way out:
//
//   1. The Phone-view write guard is forced ON. That guard is the script
//      right after the first supabase-js tag (CLAUDE.md gotcha 33), and
//      once `window.__SBM_PREVIEW` is set it wraps createClient before any
//      app code runs: insert / upsert / update / delete / rpc / storage
//      writes return a chainable error that sends nothing, channels listen
//      but never send, and fetch lets only GET and HEAD out.
//
//   2. The SECOND supabase-js tag is stripped. The page loads the library
//      twice, and the second load would replace the wrapped createClient
//      with a writable one -- which is how the guard was defeated the
//      first time it was tried.
//
// Set LHC_ALLOW_WRITES=1 to serve the page untouched. Only do that when
// the task really is to write to production, and say so out loud.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3040);
const ALLOW_WRITES = process.env.LHC_ALLOW_WRITES === '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// The guard's own early exit, and what replaces it. Matched by regex
// because Index.html is CRLF throughout and a literal with "\n" in it
// silently matches nothing -- which is how this first failed.
const GUARD_OFF = /( *)if \(!pv\) return;(\r?\n *)window\.__SBM_PREVIEW = pv;/g;
const GUARD_ON = "$1pv = pv || 'local-preview';   // forced on by .claude/preview-server.js" +
  '$2window.__SBM_PREVIEW = pv;';

const SECOND_TAG =
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>';

function readOnly(html) {
  const guards = (html.match(GUARD_OFF) || []).length;
  if (guards !== 1) {
    throw new Error('preview-server: expected exactly 1 write-guard anchor, found ' + guards +
      ' -- the guard has moved; fix this before serving, or production is writable.');
  }
  html = html.replace(GUARD_OFF, GUARD_ON);

  // Only the LAST one is the re-load that would undo the wrap; the first
  // is the one the guard itself runs after.
  const last = html.lastIndexOf(SECOND_TAG);
  const first = html.indexOf(SECOND_TAG);
  if (last === first) {
    throw new Error('preview-server: expected a second supabase-js tag and found one');
  }
  html = html.slice(0, last) +
    '<!-- second supabase-js tag removed by .claude/preview-server.js: it would ' +
    'replace the read-only createClient -->' + html.slice(last + SECOND_TAG.length);

  return html;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = url.pathname === '/' ? 'dist/index.html' : url.pathname.slice(1);

  // Vercel serves everything in public/ from the root, so /lhc-luther-rose.png
  // is public/lhc-luther-rose.png once deployed. Without this fallback the
  // page looks broken locally in exactly the places it works in production,
  // which sends you hunting for a bug that is not there.
  let abs = path.join(ROOT, file);
  const ok = p => p.startsWith(ROOT) && fs.existsSync(p) && !fs.statSync(p).isDirectory();
  if (!ok(abs)) {
    const pub = path.join(ROOT, 'public', file);
    if (ok(pub)) abs = pub;
  }
  if (!ok(abs)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
    return;
  }

  if (path.extname(abs) === '.html' && !ALLOW_WRITES) {
    let html;
    try {
      html = readOnly(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(err.message));
      console.error(err.message);
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES['.html'] });
    res.end(html);
    return;
  }

  res.writeHead(200, { 'Content-Type': TYPES[path.extname(abs)] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
}).listen(PORT, () => {
  console.log('preview server on http://localhost:' + PORT +
    (ALLOW_WRITES ? '  [LHC_ALLOW_WRITES=1 — WRITES GO TO PRODUCTION]' : '  [read-only: writes to production are refused]'));
});
