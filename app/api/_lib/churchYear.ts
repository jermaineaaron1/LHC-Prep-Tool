// Dates read from a church-year document (pure).
//
// A lectionary or a Prayers of the Day document runs through a church year:
// Advent in late November to the November after. It prints "Sun. Jan. 10"
// with no year, and the reader is told one year to assume -- so every date
// from January on came back a year early: the first import of the church's
// "Prayer of the Day YearB_26-27" (2026-11-21) would have put Epiphany,
// Lent and Easter 2027 in 2026.
//
// rollYears mends that afterwards, in the document's own order: when the
// first date is in the second half of the year assumed (a church year starts
// in Advent), a date in that same year whose month comes before the first
// date's month is in the next year, and once the dates have gone into the
// next year every later date still in the year assumed follows them -- the
// November at the end of a church year is the next November. A date already
// given the next year, or a document that starts in the first half of the
// year, is left as it is.
export function rollYears<T extends { date: string }>(entries: T[], yearHint: unknown): T[] {
  const y = parseInt(String(yearHint), 10);
  if (!y || !entries.length) return entries;
  const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const first = entries.find((e) => ok(e.date));
  if (!first) return entries;
  const fy = +first.date.slice(0, 4), fm = +first.date.slice(5, 7);
  if (fy !== y || fm < 7) return entries;
  let rolled = false;
  return entries.map((e) => {
    if (!ok(e.date)) return e;
    const ey = +e.date.slice(0, 4), em = +e.date.slice(5, 7);
    if (ey === y + 1) { rolled = true; return e; }
    if (ey === y && (rolled || em < fm)) {
      rolled = true;
      return { ...e, date: (y + 1) + e.date.slice(4) };
    }
    return e;
  });
}
