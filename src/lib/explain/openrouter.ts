// One chat completions call to OpenRouter (OpenAI compatible), with fetch. Server side only: the caller passes
// the key in. Never throws; a failure comes back as a reason.
import {
  APP_TITLE,
  EXPLAIN_LIMITS,
  OPENROUTER_URL,
  modelsForRequest,
} from './config';
import { SYSTEM_PROMPT, userPrompt } from './prompt';
import type { ExplainInput } from './types';

export type BadDetail =
  | 'NO_CHOICES'
  | 'NO_MESSAGE'
  | 'CONTENT_NULL'
  | 'CONTENT_NOT_STRING'
  | 'CONTENT_EMPTY';

/** Facts about the call for the log: names and numbers only, never any text of the answer. */
export type CallMeta = {
  /** The model OpenRouter really used. */
  model?: string;
  /** Why generation stopped ("stop", "length", ...). */
  finish?: string;
  tokens?: number;
  reasoningTokens?: number;
};

export type CallResult =
  | ({ ok: true; content: string } & CallMeta)
  | ({
      ok: false;
      reason: 'NO_KEY' | 'RATE_LIMIT' | 'TIMEOUT' | 'HTTP' | 'BAD_RESPONSE';
      /** HTTP status, or the numeric error code of a 200 response that only carries an error. */
      status?: number;
      /** For BAD_RESPONSE: which part was missing; "+REASONING" when there was reasoning text but no content. */
      detail?: string;
    } & CallMeta &
      Refusal);

/**
 * Who said no, for the log (names and numbers only; the error message and the provider's raw payload are never
 * read). `platform` = OpenRouter's own free-model limit (it sends X-RateLimit-* headers), `provider` = a 429
 * without them, which comes from the upstream provider.
 */
export type Refusal = {
  scope?: 'platform' | 'provider';
  provider?: string;
  providerCode?: string | number;
  rlLimit?: number;
  rlRemaining?: number;
  /** Seconds until the platform limit resets. */
  rlResetIn?: number;
  /** Seconds, from the Retry-After header. */
  retryAfter?: number;
  /** OpenRouter's own message of a failed request (not a 429), made safe by safeMessage. */
  message?: string;
};

/**
 * OpenRouter's error message, short and safe for a log line: only plain characters, anything that looks like a
 * key or token (24+ letters, digits, _ or -) hidden, at most 120 characters. The raw payload is never read.
 */
export function safeMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw
    .replace(/[A-Za-z0-9_-]{24,}/g, '…')
    .replace(/[^A-Za-z0-9 .,:/()…-]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return text === '' ? undefined : text;
}

const header = (res: Response, name: string): number | undefined => {
  const n = Number(res.headers.get(name));
  return res.headers.get(name) !== null && Number.isFinite(n) ? n : undefined;
};

/** Reads only the provider's name and code, and the rate limit headers, from an error response. */
async function readRefusal(
  res: Response,
  rateLimited: boolean,
  now: () => number = Date.now,
): Promise<Refusal> {
  let meta: Record<string, unknown> | undefined;
  let message: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: { message?: unknown; metadata?: Record<string, unknown> };
    } | null;
    meta = body?.error?.metadata;
    // The message of a 429 says nothing more than the headers do; the others (400...) say what was wrong.
    if (!rateLimited) message = safeMessage(body?.error?.message);
  } catch {
    // not JSON: the headers still tell something
  }
  const name = meta?.provider_name;
  const code = meta?.provider_code;
  const provider = typeof name === 'string' ? name : undefined;
  const providerCode =
    typeof code === 'number' || typeof code === 'string' ? code : undefined;
  const rlLimit = header(res, 'x-ratelimit-limit');
  const rlRemaining = header(res, 'x-ratelimit-remaining');
  const reset = header(res, 'x-ratelimit-reset');
  const platform =
    rlLimit !== undefined || rlRemaining !== undefined || reset !== undefined;
  return omitUndefined({
    // OpenRouter's own free-model limit always sends X-RateLimit-* headers; a 429 without them comes from the
    // upstream provider (its name and code are logged when OpenRouter passes them on).
    scope: rateLimited
      ? platform
        ? ('platform' as const)
        : ('provider' as const)
      : undefined,
    provider,
    providerCode,
    rlLimit,
    rlRemaining,
    // X-RateLimit-Reset is milliseconds since the Unix epoch
    rlResetIn:
      reset === undefined
        ? undefined
        : Math.max(0, Math.round((reset - now()) / 1000)),
    retryAfter: header(res, 'retry-after'),
    message,
  });
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const omitUndefined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export async function callOpenRouter(args: {
  apiKey: string | undefined;
  model: string;
  /** Models to try, in order, when `model` errors (OpenRouter's `models` array). */
  fallbacks?: readonly string[];
  input: ExplainInput;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}): Promise<CallResult> {
  const { apiKey, model, input } = args;
  if (!apiKey) return { ok: false, reason: 'NO_KEY' };
  const doFetch = args.fetchImpl ?? fetch;
  const models = modelsForRequest(model, args.fallbacks ?? []);
  try {
    const res = await doFetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': APP_TITLE,
      },
      body: JSON.stringify({
        // one model: `model`; several: the `models` array in priority order
        ...(models.length > 1 ? { models } : { model }),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(input) },
        ],
        max_tokens: EXPLAIN_LIMITS.maxTokens,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(
        args.timeoutMs ?? EXPLAIN_LIMITS.serverTimeoutMs,
      ),
    });
    if (!res.ok) {
      const refusal = await readRefusal(res, res.status === 429, args.now);
      return res.status === 429
        ? { ok: false, reason: 'RATE_LIMIT', ...refusal }
        : { ok: false, reason: 'HTTP', status: res.status, ...refusal };
    }
    const b = (await res.json()) as Record<string, unknown> | null;
    const choice = (b?.choices as Record<string, unknown>[] | undefined)?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;
    const usage = b?.usage as Record<string, unknown> | undefined;
    const details = usage?.completion_tokens_details as
      Record<string, unknown> | undefined;
    const meta: CallMeta = omitUndefined({
      model: str(b?.model),
      finish: str(choice?.finish_reason),
      tokens: num(usage?.completion_tokens),
      reasoningTokens: num(details?.reasoning_tokens),
    });
    const content = message?.content;
    if (typeof content === 'string' && content.trim())
      return { ok: true, content, ...meta };

    // Nothing usable. Say which part was missing (the log needs it), without keeping any text.
    const hasReasoning =
      (typeof message?.reasoning === 'string' &&
        message.reasoning.trim() !== '') ||
      (Array.isArray(message?.reasoning_details) &&
        message.reasoning_details.length > 0);
    const base: BadDetail =
      !Array.isArray(b?.choices) || !choice
        ? 'NO_CHOICES'
        : !message
          ? 'NO_MESSAGE'
          : content === null || content === undefined
            ? 'CONTENT_NULL'
            : typeof content !== 'string'
              ? 'CONTENT_NOT_STRING'
              : 'CONTENT_EMPTY';
    const errCode = num(
      (b?.error as Record<string, unknown> | undefined)?.code,
    );
    return omitUndefined({
      ok: false as const,
      reason: 'BAD_RESPONSE' as const,
      detail: base + (hasReasoning ? '+REASONING' : ''),
      status: base === 'NO_CHOICES' ? errCode : undefined,
      ...meta,
    });
  } catch (e) {
    const timeout =
      e instanceof Error &&
      (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, reason: timeout ? 'TIMEOUT' : 'HTTP' };
  }
}
