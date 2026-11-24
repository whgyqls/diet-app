// One chat completions call to OpenRouter (OpenAI compatible), with fetch. Server side only: the caller passes
// the key in. Never throws; a failure comes back as a reason.
import { APP_TITLE, EXPLAIN_LIMITS, OPENROUTER_URL } from './config';
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
    } & CallMeta);

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
}): Promise<CallResult> {
  const { apiKey, model, input } = args;
  if (!apiKey) return { ok: false, reason: 'NO_KEY' };
  const doFetch = args.fetchImpl ?? fetch;
  const models = [
    ...new Set([model, ...(args.fallbacks ?? [])].filter(Boolean)),
  ];
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
    if (res.status === 429) return { ok: false, reason: 'RATE_LIMIT' };
    if (!res.ok) return { ok: false, reason: 'HTTP', status: res.status };
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
