// Asking Gemini when Gemini is busy.
//
// WHY THIS EXISTS
// On 2026-11-14, the day the Liturgy Library's liturgy reader went live, its
// first two real calls were both answered 503 "This model is currently
// experiencing high demand ... try again later". Nothing was wrong with the
// request; Google's flash model was overloaded. A spell like that is usually
// seconds to minutes, and the lighter flash-lite model is often free when
// flash is not -- so a busy answer goes to the next model, and round again
// after a short wait, before the person is told to try again.
//
// Only BUSY answers are retried (503 / UNAVAILABLE, 429 / RESOURCE_EXHAUSTED,
// "overloaded", "high demand"). Any other error from the first model is a real
// one -- a bad file, a refused request -- and is passed straight back, because
// asking again would only fail again, more slowly. A backup model that fails
// some other way after the first was busy (it may not exist for this key) is
// noted in the reasons and not asked again; the rest carry on.
//
// The whole run is kept inside a time budget: the route's function stops at
// 60s, and a whole liturgy takes a good part of that to write back once a
// model does answer. No new try starts after the budget is spent.

// reasons: what each model last said, "<model>: <reason>", so the person --
// and whoever looks into it -- can tell Google being overloaded from a
// free-tier key being turned away from a backup model this key cannot use.
// Every try of the first live week said only "busy", and those three read the
// same until the reason was shown (2026-11-14).
export class AiBusyError extends Error {
  readonly busy = true;
  readonly reasons: string[];
  constructor(message: string, reasons: string[] = []) {
    super(message);
    this.name = 'AiBusyError';
    this.reasons = reasons;
  }
}

// An error as one short line (pure): Gemini's errors carry a JSON body --
// {"error":{"code":503,"message":"...","status":"UNAVAILABLE"}} -- whose code,
// status and message say it all; anything else is cut to 200 characters.
export function reasonOf(err: unknown): string {
  const text = errorText(err);
  const at = text.indexOf('{');
  if (at !== -1) {
    try {
      const body = JSON.parse(text.slice(at));
      const e = body && (body.error || body);
      if (e && (e.code || e.status || e.message)) {
        return [e.code, e.status].filter(Boolean).join(' ') + (e.message ? ': ' + String(e.message).replace(/\s+/g, ' ').trim().slice(0, 200) : '');
      }
    } catch { /* not JSON */ }
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
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
  waits?: number[];                        // the wait before each round after the first (default 2.5s)
  rounds?: number;                         // how many times round the models (default 2)
  sleep?: (ms: number) => Promise<void>;   // for the harness
  now?: () => number;                      // for the harness
};

// Asks the models in turn, round and round: the first, the next, then (after
// a short wait) each of them once more. Resolves to the first answer and the
// model that gave it; rejects with the first model's own error when it is not
// a busy one, or with AiBusyError when every try was busy (or the budget ran
// out).
//
// In TURN, not each model twice before the next: an overloaded model is slow
// to say no (about ten seconds each, the whole PDF sent every time, measured
// live 2026-11-14), and asking it twice first spent the budget before the
// lighter model was ever asked ("not asked: out of time").
export async function withBusyRetry<T>(models: string[], attempt: (model: string) => Promise<T>, opts: RetryOptions = {}): Promise<{ value: T; model: string }> {
  const sleep = opts.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now || Date.now;
  const waits = opts.waits && opts.waits.length ? opts.waits : [2500];
  const rounds = typeof opts.rounds === 'number' ? opts.rounds : 2;
  const budget = typeof opts.budgetMs === 'number' ? opts.budgetMs : 25000;
  const start = now();
  let busy: unknown = null;
  // The last thing each model said, in the order they were asked; a model
  // that failed some way other than busy is not asked again.
  const said: { [model: string]: string } = {};
  const out: { [model: string]: boolean } = {};
  const reasons = () => models.filter((k) => said[k]).map((k) => k + ': ' + said[k]);
  const outOfTime = () => {
    models.forEach((k) => { if (!said[k]) said[k] = 'not asked: out of time'; });
    return new AiBusyError(busy ? errorText(busy) : 'out of time', reasons());
  };
  for (let round = 0; round < rounds; round++) {
    if (round > 0) {
      if (models.every((k) => out[k])) break;
      if (now() - start > budget) throw outOfTime();
      await sleep(waits[Math.min(round - 1, waits.length - 1)]);
    }
    for (let m = 0; m < models.length; m++) {
      const model = models[m];
      if (out[model]) continue;
      if (now() - start > budget) throw outOfTime();
      try {
        return { value: await attempt(model), model };
      } catch (err) {
        said[model] = reasonOf(err);
        if (!isBusy(err)) {
          // The first answer of all being a real error is the file or the
          // request: passed straight back, never asked again.
          if (!busy) throw err;
          // A backup failing another way (it may not exist for this key) is
          // worth knowing -- it is in the reasons -- and is not asked again.
          out[model] = true;
          continue;
        }
        busy = err;
      }
    }
  }
  throw new AiBusyError(errorText(busy), reasons());
}
