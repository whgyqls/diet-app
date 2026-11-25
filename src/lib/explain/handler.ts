// The /api/explain flow with its dependencies passed in, so it can be tested without network or database.
// Order: same origin -> signed in -> valid request -> cache -> daily limits -> AI tries -> check -> cache.
// The AI is asked one model at a time (config.ts MODEL_ATTEMPTS). A try that fails (429, error, no text, an answer
// our checks refuse) goes on to the next model while time is left. Whatever goes wrong after the request is
// valid, the answer is 200 with the fallback sentence.
import { EXPLAIN_LIMITS, utcDay, type ModelAttempt } from './config';
import { fallbackText } from './fallback';
import { cacheKeyText, explainRequestSchema, toInput } from './payload';
import { checkExplanation, extractExplanation } from './validate';
import type { CallResult, Refusal } from './openrouter';
import type { ExplainInput, ExplainResponse, FallbackReason } from './types';

export type ExplainDeps = {
  /** The first model: the one the cache key is made with. */
  model: string;
  /** The tries, in order (config.ts attemptsFor). */
  attempts: readonly ModelAttempt[];
  now: () => Date;
  isSameOrigin: (origin: string | null, host: string | null) => boolean;
  /** The verified session's user id, or null. */
  getUserId: () => Promise<string | null>;
  hash: (text: string) => string;
  cacheGet: (hash: string) => Promise<string | null>;
  /** Insert that ignores a row that already exists (two requests for the same combo at once). `model` is the one that wrote the text. */
  cachePut: (hash: string, model: string, text: string) => Promise<void>;
  /** True when the call was counted (both daily limits allow it). */
  consume: (userId: string, day: string) => Promise<boolean>;
  /** Gives one counted call back (a failure that is not the user's). */
  refund: (userId: string, day: string) => Promise<void>;
  /** One request to one model. `timeoutMs` is how long it may take. */
  call: (
    input: ExplainInput,
    attempt: {
      model: string;
      extra?: ModelAttempt['extra'];
      timeoutMs: number;
    },
  ) => Promise<CallResult>;
  /** One log line per fallback, failed try that was followed by another, and success after several tries (console.warn). */
  log: (line: string) => void;
};

/** A value in a log line: only plain characters, short. It never carries the answer, the key or user data. */
const clean = (v: string | number) =>
  String(v)
    .replace(/[^\w.\-/:+가-힣]/g, '_')
    .slice(0, 60);

type Why = {
  reason: FallbackReason;
  cause: string;
  detail?: string;
  model?: string;
  finish?: string;
  status?: number;
  tokens?: number;
  reasoningTokens?: number;
  /** How long the AI call took, in ms. */
  ms?: number;
  /** Whether the counted call was given back: yes, or no because giving back failed. */
  refund?: 'yes' | 'failed';
  /** The number of tries, when there was more than one. */
  attempts?: number;
  /** Which try this line is about, and the model it asked. */
  tried?: number;
  asked?: string;
} & Refusal;

/** A message of OpenRouter: already made safe where it was read; here it is cut and quoted again. */
const cleanMsg = (v: string) =>
  `"${v.replace(/[^A-Za-z0-9 .,:/()…-]/g, '_').slice(0, 120)}"`;

function line(kind: 'fallback' | 'attempt' | 'ok', w: Partial<Why>): string {
  const parts: [string, string | number | undefined][] = [
    ['try', w.tried],
    ['asked', w.asked],
    ['reason', w.reason],
    ['cause', w.cause],
    ['detail', w.detail],
    ['status', w.status],
    ['msg', w.message === undefined ? undefined : cleanMsg(w.message)],
    ['scope', w.scope],
    ['provider', w.provider],
    ['provider_code', w.providerCode],
    ['model', w.model],
    ['finish', w.finish],
    ['tokens', w.tokens],
    ['reasoning_tokens', w.reasoningTokens],
    ['rl_limit', w.rlLimit],
    ['rl_remaining', w.rlRemaining],
    ['rl_reset_in', w.rlResetIn],
    ['retry_after', w.retryAfter],
    ['ms', w.ms],
    ['refund', w.refund],
    ['attempts', w.attempts],
  ];
  return (
    `[explain] ${kind} ` +
    parts
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) =>
        k === 'msg' ? `${k}=${v}` : `${k}=${clean(v as string | number)}`,
      )
      .join(' ')
  );
}

export const logLine = (w: Why): string => line('fallback', w);

export type HandlerResult = {
  status: number;
  body: { error: string } | ExplainResponse;
};

/** Failures of the AI call whose counted call is given back. */
const REFUNDED = new Set(['RATE_LIMIT', 'TIMEOUT', 'HTTP', 'NO_KEY']);

const error = (status: number, code: string): HandlerResult => ({
  status,
  body: { error: code },
});

type Outcome =
  | { ok: true; text: string }
  | {
      ok: false;
      why: Why;
      /** The AI side failed before it gave an answer: the counted call is given back (if every try was like this). */
      refundable: boolean;
      /** An answer came but our checks refused it: the same model may be asked once more. */
      refused: boolean;
    };

/** What one model's call came to: a text we may show, or why not. */
function judge(res: CallResult, input: ExplainInput): Outcome {
  const seen = {
    model: res.model,
    finish: res.finish,
    tokens: res.tokens,
    reasoningTokens: res.reasoningTokens,
  };
  // An answer cut off by the token limit is never shown, even when the part that arrived looks fine, and an
  // empty one that was cut off (reasoning used the whole budget) is reported as cut off, not as a bad response.
  if (res.finish === 'length')
    return {
      ok: false,
      refundable: false,
      refused: false,
      why: {
        reason: 'INVALID',
        cause: 'TRUNCATED',
        detail: res.ok ? undefined : res.detail,
        ...seen,
      },
    };
  if (!res.ok) {
    const busy = res.reason === 'RATE_LIMIT' || res.reason === 'TIMEOUT';
    return {
      ok: false,
      refundable: REFUNDED.has(res.reason),
      refused: false,
      why: {
        reason: busy ? 'BUSY' : 'UNAVAILABLE',
        cause: res.reason,
        detail: res.detail,
        status: res.status,
        scope: res.scope,
        provider: res.provider,
        providerCode: res.providerCode,
        rlLimit: res.rlLimit,
        rlRemaining: res.rlRemaining,
        rlResetIn: res.rlResetIn,
        retryAfter: res.retryAfter,
        message: res.message,
        ...seen,
      },
    };
  }
  const found = extractExplanation(res.content, input);
  if (!found.ok)
    return {
      ok: false,
      refundable: false,
      refused: true,
      why: {
        reason: 'INVALID',
        cause: found.reason,
        detail: found.detail,
        ...seen,
      },
    };
  const checked = checkExplanation(found.text, input);
  if (!checked.ok)
    return {
      ok: false,
      refundable: false,
      refused: true,
      why: {
        reason: 'INVALID',
        cause: checked.reason,
        detail: checked.detail,
        ...seen,
      },
    };
  return { ok: true, text: found.text };
}

export async function handleExplain(
  deps: ExplainDeps,
  req: { origin: string | null; host: string | null; bodyText: string },
): Promise<HandlerResult> {
  if (!deps.isSameOrigin(req.origin, req.host)) return error(403, 'forbidden');
  const userId = await deps.getUserId().catch(() => null);
  if (!userId) return error(401, 'unauthorized');
  if (Buffer.byteLength(req.bodyText) > EXPLAIN_LIMITS.maxBodyBytes)
    return error(413, 'too_large');

  let json: unknown;
  try {
    json = JSON.parse(req.bodyText);
  } catch {
    return error(400, 'bad_request');
  }
  const parsed = explainRequestSchema.safeParse(json);
  const input = parsed.success ? toInput(parsed.data) : null;
  if (!input) return error(400, 'bad_request');

  const fallback = (why: Why): HandlerResult => {
    deps.log(logLine(why));
    return {
      status: 200,
      body: {
        text: fallbackText(input),
        source: 'fallback',
        reason: why.reason,
      },
    };
  };

  const hash = deps.hash(cacheKeyText(input, deps.model));
  const cached = await deps.cacheGet(hash).catch(() => null);
  if (cached) return { status: 200, body: { text: cached, source: 'cache' } };

  const day = utcDay(deps.now());
  let allowed: boolean;
  try {
    allowed = await deps.consume(userId, day);
  } catch {
    return fallback({ reason: 'UNAVAILABLE', cause: 'CONSUME_ERROR' });
  }
  if (!allowed) return fallback({ reason: 'LIMIT', cause: 'LIMIT' });

  // The tries. Each model is asked alone, with its own extra fields and its own time (never more than is left
  // of the server's total). A model whose answer our checks refused is asked once more when twice its last
  // duration is left; any other failure goes straight on to the next model.
  const startedAt = deps.now().getTime();
  const elapsed = () => deps.now().getTime() - startedAt;
  const failures: { why: Why; tried: number; asked: string; took: number }[] =
    [];
  let tried = 0;
  let everyFailureRefundable = true;
  for (const a of deps.attempts) {
    let repeated = false;
    for (;;) {
      const left = EXPLAIN_LIMITS.serverTotalMs - elapsed();
      if (left < a.minMs) break;
      tried++;
      const t0 = deps.now().getTime();
      const res = await deps.call(input, {
        model: a.model,
        extra: a.extra,
        timeoutMs: Math.min(a.timeoutMs, left),
      });
      const took = deps.now().getTime() - t0;
      const out = judge(res, input);
      if (out.ok) {
        for (const f of failures)
          deps.log(
            line('attempt', {
              ...f.why,
              tried: f.tried,
              asked: f.asked,
              ms: f.took,
            }),
          );
        if (tried > 1)
          deps.log(
            line('ok', {
              tried,
              asked: a.model,
              model: res.model,
              finish: res.finish,
              tokens: res.tokens,
              ms: elapsed(),
            }),
          );
        await deps
          .cachePut(hash, res.model ?? a.model, out.text)
          .catch(() => {});
        return { status: 200, body: { text: out.text, source: 'ai' } };
      }
      failures.push({ why: out.why, tried, asked: a.model, took });
      if (!out.refundable) everyFailureRefundable = false;
      const repeatable =
        out.refused &&
        !repeated &&
        EXPLAIN_LIMITS.serverTotalMs - elapsed() >=
          Math.max(a.minMs, took * EXPLAIN_LIMITS.repeatFactor);
      if (!repeatable) break;
      repeated = true;
    }
  }

  // Nothing worked. Earlier failed tries are logged as such, the last one becomes the fallback line.
  const last = failures.pop();
  for (const f of failures)
    deps.log(
      line('attempt', { ...f.why, tried: f.tried, asked: f.asked, ms: f.took }),
    );
  if (!last)
    return fallback({ reason: 'UNAVAILABLE', cause: 'NO_TIME', ms: elapsed() });
  // Given back only when no try got as far as an answer: the AI side did no work for it.
  let refund: Why['refund'];
  if (everyFailureRefundable)
    refund = await deps.refund(userId, day).then(
      () => 'yes' as const,
      () => 'failed' as const,
    );
  return fallback({
    ...last.why,
    ms: elapsed(),
    refund,
    attempts: tried > 1 ? tried : undefined,
  });
}
