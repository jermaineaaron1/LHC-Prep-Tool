// Asking Gemini when Gemini is busy.
//
// WHY THIS EXISTS
// On 2026-11-14, the day the Liturgy Library's liturgy reader went live, its
// first two real calls were both answered 503 "This model is currently
// experiencing high demand ... try again later". Nothing was wrong with the
// request; Google's flash model was overloaded. A spell like that is usually
// seconds to minutes, and the lighter flash-lite model is often free when
// flash is not -- so a busy answer is tried once more after a short wait, and
// then on the next model, before the person is told to try again.
//
// Only BUSY answers are retried (503 / UNAVAILABLE, 429 / RESOURCE_EXHAUSTED,
// "overloaded", "high demand"). Any other error from the first model is a real
// one -- a bad file, a refused request -- and is passed straight back, because
// asking again would only fail again, more slowly. An error from a backup
// model after the first was busy (it may not exist for this key) ends the
// tries with "busy", which is what the person can act on.
//
// The whole run is kept inside a time budget: the route's function stops at
// 60s, and a whole liturgy takes a good part of that to write back once a
// model does answer. No new try starts after the budget is spent.

export class AiBusyError extends Error {
  readonly busy = true;
  constructor(message: string) {
    super(message);
    this.name = 'AiBusyError';
  }
}

const BUSY_RE = /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|try again later/i;

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return typeof err === 'string' ? err : JSON.stringify(err); } catch { return String(err); }
}

export function isBusy(err: unknown): boolean {
  const status = (err as { status?: unknown; code?: unknown } | null);
  if (status && (status.status === 503 || status.status === 429 || status.code === 503 || status.code === 429)) return true;
  return BUSY_RE.test(errorText(err));
}

export type RetryOptions = {
  budgetMs?: number;                       // no try starts after this long (default 25s)
  waits?: number[];                        // the wait before the second try, per model (default 2.5s, then 1.5s)
  sleep?: (ms: number) => Promise<void>;   // for the harness
  now?: () => number;                      // for the harness
};

// Calls attempt(model) for each model in turn, each up to twice when the
// answer is busy. Resolves to the first answer and the model that gave it;
// rejects with the first model's own error when it is not a busy one, or with
// AiBusyError when every try was busy (or the budget ran out).
export async function withBusyRetry<T>(models: string[], attempt: (model: string) => Promise<T>, opts: RetryOptions = {}): Promise<{ value: T; model: string }> {
  const sleep = opts.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now || Date.now;
  const waits = opts.waits && opts.waits.length ? opts.waits : [2500, 1500];
  const budget = typeof opts.budgetMs === 'number' ? opts.budgetMs : 25000;
  const start = now();
  let busy: unknown = null;
  for (let m = 0; m < models.length; m++) {
    for (let tries = 0; tries < 2; tries++) {
      if (now() - start > budget) throw new AiBusyError(busy ? errorText(busy) : 'out of time');
      try {
        return { value: await attempt(models[m]), model: models[m] };
      } catch (err) {
        if (!isBusy(err)) {
          if (!busy) throw err;
          // The first model was busy; this backup failed some other way.
          throw new AiBusyError(errorText(busy));
        }
        busy = err;
        if (tries === 0) await sleep(waits[Math.min(m, waits.length - 1)]);
      }
    }
  }
  throw new AiBusyError(errorText(busy));
}
