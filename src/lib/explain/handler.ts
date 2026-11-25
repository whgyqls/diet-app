// The /api/explain flow with its dependencies passed in, so it can be tested without network or database.
// Order: same origin -> signed in -> valid request -> cache -> daily limits -> AI -> check -> cache.
// Whatever goes wrong after the request is valid, the answer is 200 with the fallback sentence.
import { EXPLAIN_LIMITS, utcDay } from './config';
import { fallbackText } from './fallback';
import { cacheKeyText, explainRequestSchema, toInput } from './payload';
import { checkExplanation, extractExplanation } from './validate';
import type { CallResult, Refusal } from './openrouter';
import type { ExplainInput, ExplainResponse, FallbackReason } from './types';

export type ExplainDeps = {
  model: string;
  now: () => Date;
  isSameOrigin: (origin: string | null, host: string | null) => boolean;
  /** The verified session's user id, or null. */
  getUserId: () => Promise<string | null>;
  hash: (text: string) => string;
  cacheGet: (hash: string) => Promise<string | null>;
  /** Insert that ignores a row that already exists (two requests for the same combo at once). */
  cachePut: (hash: string, model: string, text: string) => Promise<void>;
  /** True when the call was counted (both daily limits allow it). */
  consume: (userId: string, day: string) => Promise<boolean>;
  /** Gives one counted call back (a failure that is not the user's). */
  refund: (userId: string, day: string) => Promise<void>;
  /** `single`: ask the first model alone (no `models` list). `timeoutMs`: how long this call may take. */
  call: (
    input: ExplainInput,
    model: string,
    opts?: { single?: boolean; timeoutMs?: number },
  ) => Promise<CallResult>;
  /** Whether a request lists more than one model, so that a request refused with a 400 can be asked again alone. */
  hasFallbackModels: boolean;
  /** One log line per fallback, retry and retried success (the route passes console.warn). */
  log: (line: string) => void;
};

/** A value in a log line: only plain characters, short. It never carries the answer, the key or user data. */
const clean = (v: string | number) =>
  String(v)
    .replace(/[^\w.\-/:+가-힣]/g, '_')
    .slice(0, 60);

/** How the answer was asked for, when it was not the plain first request. */
type Via = 'single_retry';

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
  via?: Via;
} & Refusal;

/** A message of OpenRouter: already made safe where it was read; here it is cut and quoted again. */
const cleanMsg = (v: string) =>
  `"${v.replace(/[^A-Za-z0-9 .,:/()…-]/g, '_').slice(0, 120)}"`;

function line(kind: 'fallback' | 'retry' | 'ok', w: Partial<Why>): string {
  const parts: [string, string | number | undefined][] = [
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
    ['via', w.via],
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

  const startedAt = deps.now().getTime();
  let res = await deps.call(input, deps.model);
  let via: Via | undefined;
  // A request that lists several models and was refused with a 400 (a bad `models` list, or one model id it does
  // not take) is asked again with the first model alone, in the time that is left. The 400 is logged first, so
  // the log still shows what was wrong when the second request works.
  if (
    deps.hasFallbackModels &&
    !res.ok &&
    res.reason === 'HTTP' &&
    res.status === 400
  ) {
    const left =
      EXPLAIN_LIMITS.serverTimeoutMs - (deps.now().getTime() - startedAt);
    deps.log(
      line('retry', {
        reason: 'UNAVAILABLE',
        cause: 'HTTP',
        status: res.status,
        message: res.message,
        ms: deps.now().getTime() - startedAt,
        via: 'single_retry',
      }),
    );
    if (left >= EXPLAIN_LIMITS.minRetryMs) {
      res = await deps.call(input, deps.model, {
        single: true,
        timeoutMs: left,
      });
      via = 'single_retry';
    }
  }
  const ms = deps.now().getTime() - startedAt;
  const seen = {
    model: res.model,
    finish: res.finish,
    tokens: res.tokens,
    reasoningTokens: res.reasoningTokens,
    ms,
    via,
  };
  // An answer cut off by the token limit is never shown, even when the part that arrived looks fine, and an
  // empty one that was cut off (reasoning used the whole budget) is reported as cut off, not as a bad response.
  if (res.finish === 'length')
    return fallback({
      reason: 'INVALID',
      cause: 'TRUNCATED',
      detail: res.ok ? undefined : res.detail,
      ...seen,
    });
  if (!res.ok) {
    // Not the user's doing (the AI side said no, was slow or unreachable, or no key): give the count back.
    // An answer that came but was refused by our checks (below) stays counted: the AI side did the work.
    let refund: Why['refund'];
    if (REFUNDED.has(res.reason)) {
      refund = await deps.refund(userId, day).then(
        () => 'yes' as const,
        () => 'failed' as const,
      );
    }
    const busy = res.reason === 'RATE_LIMIT' || res.reason === 'TIMEOUT';
    return fallback({
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
      refund,
      ...seen,
    });
  }
  const found = extractExplanation(res.content, input);
  if (!found.ok)
    return fallback({
      reason: 'INVALID',
      cause: found.reason,
      detail: found.detail,
      ...seen,
    });
  const checked = checkExplanation(found.text, input);
  if (!checked.ok)
    return fallback({
      reason: 'INVALID',
      cause: checked.reason,
      detail: checked.detail,
      ...seen,
    });
  const text = found.text;
  if (via)
    deps.log(
      line('ok', {
        model: res.model,
        finish: res.finish,
        tokens: res.tokens,
        ms,
        via,
      }),
    );

  await deps.cachePut(hash, deps.model, text).catch(() => {});
  return { status: 200, body: { text, source: 'ai' } };
}
