// A Google Doc handed over as a Word (.docx) file, for the Liturgy Library's
// Make ready (2026-11-15).
//
// The church keeps several of its liturgies as Google Docs (the three Advent
// liturgies among them), and Make ready read only Word, PDF and Excel files
// in our own storage. Google will export a document as .docx to anyone who
// may view it, so a Doc shared as "Anyone with the link can view" is read
// exactly as an uploaded Word file is -- in the browser, headings and bold
// lines as written, no AI. A browser cannot fetch the export itself (Google
// sends no CORS headers), so /api/google-doc fetches it and hands the bytes
// on. Only that one address is ever fetched: the host and path are fixed
// here, and the id may hold nothing but a document id's characters.

export const GDOC_ID = /^[A-Za-z0-9_-]{20,128}$/;
export const GDOC_MAX_BYTES = 20 * 1024 * 1024;

// The export address for a document id (pure), or null for anything that is
// not one.
export function gdocExportUrl(id: string): string | null {
  return GDOC_ID.test(String(id || '')) ? `https://docs.google.com/document/d/${id}/export?format=docx` : null;
}

// Is this a .docx (pure)? A .docx is a zip, which starts "PK\x03\x04". A
// document nobody outside may see comes back as Google's sign-in page --
// HTML, with a 200 -- so the status alone says nothing.
export function looksLikeDocx(bytes: Uint8Array): boolean {
  return !!bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
