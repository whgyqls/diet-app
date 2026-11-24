// The /api/explain flow with its dependencies passed in, so it can be tested without network or database.
// Order: same origin -> signed in -> valid request -> cache -> daily limits -> AI -> check -> cache.
// Whatever goes wrong after the request is valid, the answer is 200 with the fallback sentence.
import { EXPLAIN_LIMITS, utcDay } from './config';
import { fallbackText } from './fallback';
import { cacheKeyText, explainRequestSchema, toInput } from './payload';
import { checkExplanation, parseModelText } from './validate';
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
};

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

  const fallback = (reason: FallbackReason): HandlerResult => ({
    status: 200,
    body: { text: fallbackText(input), source: 'fallback', reason },
  });

  const hash = deps.hash(cacheKeyText(input, deps.model));
  const cached = await deps.cacheGet(hash).catch(() => null);
  if (cached) return { status: 200, body: { text: cached, source: 'cache' } };

  let allowed: boolean;
  try {
    allowed = await deps.consume(userId, utcDay(deps.now()));
  } catch {
    return fallback('UNAVAILABLE');
  }
  if (!allowed) return fallback('LIMIT');

  const res = await deps.call(input, deps.model);
  if (!res.ok)
    return fallback(res.reason === 'RATE_LIMIT' ? 'LIMIT' : 'UNAVAILABLE');
  const text = parseModelText(res.content);
  if (text === null || !checkExplanation(text, input).ok)
    return fallback('INVALID');

  await deps.cachePut(hash, deps.model, text).catch(() => {});
  return { status: 200, body: { text, source: 'ai' } };
}
