// Is this a URL our own Supabase storage served?
//
// WHY THIS EXISTS
// Several routes are handed a URL by the browser and fetch it on the server.
// Without a host check such a route will fetch anything reachable from the
// deployment -- internal addresses included -- and, in two of the three
// cases here, hand the contents to a model that describes them back. That is
// a server-side request forgery with a readout.
//
// parse-song-sheet already had this guard and a comment saying exactly that.
// parse-lectionary, written later and to the same shape, had no host check at
// all: only a file-extension check, which constrains nothing, because
// http://169.254.169.254/latest/meta-data/x.pdf ends in .pdf. Probed against
// the live deployment it fetched example.com and reported the status, and
// attempted the link-local address.
//
// convert-pptx-to-slides had a third version, `hostname.endsWith('.supabase.co')`,
// which admits ANY Supabase project rather than ours -- anybody with a free
// account could host a file and have this server fetch it.
//
// Three routes, three different answers to one question, one of them "no
// answer". So it is written once here and imported.
//
// NOT a general URL allowlist: it answers only "did our own storage serve
// this", which is the question every caller actually has.
export function isOwnStorage(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  // http would let a man in the middle choose what the server reads.
  if (u.protocol !== 'https:') return false;

  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  let allowedHost = '';
  try { allowedHost = configured ? new URL(configured).hostname : ''; } catch { allowedHost = ''; }

  // Falling back to the SHAPE of a Supabase host rather than to `true`, so a
  // missing environment variable narrows this to Supabase-hosted content
  // instead of silently opening it to the whole internet.
  return allowedHost
    ? u.hostname === allowedHost
    : /^[a-z0-9-]+\.supabase\.co$/i.test(u.hostname);
}
