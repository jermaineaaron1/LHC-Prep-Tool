/** Estimate server clock offset using the midpoint of a no-cache request. */
export async function measureServerClockOffset(): Promise<number> {
  const sentAt = Date.now();
  const response = await fetch('/api/vocal-hero/clock', { cache: 'no-store' });
  const receivedAt = Date.now();
  if (!response.ok) throw new Error('Unable to synchronise the game clock.');
  const { now } = await response.json() as { now: number };
  return now - ((sentAt + receivedAt) / 2);
}
