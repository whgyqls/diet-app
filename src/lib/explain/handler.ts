// The /api/explain flow with its dependencies passed in, so it can be tested without network or database.
// Order: same origin -> signed in -> valid request -> cache -> daily limits -> AI -> check -> cache.
// Whatever goes wrong after the request is valid, the answer is 200 with the fallback sentence.
import { EXPLAIN_LIMITS, utcDay } from './config';
import { fallbackText } from './fallback';
import { cacheKeyText, explainRequestSchema, toInput } from './payload';
import { checkExplanation, extractExplanation } from './validate';
import type { CallResult } from './openrouter';
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
  call: (input: ExplainInput, model: string) => Promise<CallResult>;
  /** One log line per fallback (the route passes console.warn). */
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
};

export function logLine(w: Why): string {
  const parts: [string, string | number | undefined][] = [
    ['reason', w.reason],
    ['cause', w.cause],
    ['detail', w.detail],
    ['status', w.status],
    ['model', w.model],
    ['finish', w.finish],
    ['tokens', w.tokens],
    ['reasoning_tokens', w.reasoningTokens],
    ['ms', w.ms],
  ];
  return (
    '[explain] fallback ' +
    parts
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${clean(v!)}`)
      .join(' ')
  );
}

export type HandlerResult = {
  status: number;
  body: { error: string } | ExplainResponse;
};

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

  let allowed: boolean;
  try {
    allowed = await deps.consume(userId, utcDay(deps.now()));
  } catch {
    return fallback({ reason: 'UNAVAILABLE', cause: 'CONSUME_ERROR' });
  }
  if (!allowed) return fallback({ reason: 'LIMIT', cause: 'LIMIT' });

  const startedAt = deps.now().getTime();
  const res = await deps.call(input, deps.model);
  const ms = deps.now().getTime() - startedAt;
  const seen = {
    model: res.model,
    finish: res.finish,
    tokens: res.tokens,
    reasoningTokens: res.reasoningTokens,
    ms,
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
  if (!res.ok)
    return fallback({
      reason: res.reason === 'RATE_LIMIT' ? 'LIMIT' : 'UNAVAILABLE',
      cause: res.reason,
      detail: res.detail,
      status: res.status,
      ...seen,
    });
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

  await deps.cachePut(hash, deps.model, text).catch(() => {});
  return { status: 200, body: { text, source: 'ai' } };
}
