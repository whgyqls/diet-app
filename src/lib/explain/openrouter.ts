// One chat completions call to OpenRouter (OpenAI compatible), with fetch. Server side only: the caller passes
// the key in. Never throws; a failure comes back as a reason.
import { APP_TITLE, EXPLAIN_LIMITS, OPENROUTER_URL } from './config';
import { SYSTEM_PROMPT, userPrompt } from './prompt';
import type { ExplainInput } from './types';

export type CallResult =
  /** `model` (the one OpenRouter really used) and `finish` (e.g. "length" = cut off) are only for the log. */
  | { ok: true; content: string; model?: string; finish?: string }
  | {
      ok: false;
      reason: 'NO_KEY' | 'RATE_LIMIT' | 'TIMEOUT' | 'HTTP' | 'BAD_RESPONSE';
      /** HTTP status, when there was one. */
      status?: number;
    };

export async function callOpenRouter(args: {
  apiKey: string | undefined;
  model: string;
  input: ExplainInput;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<CallResult> {
  const { apiKey, model, input } = args;
  if (!apiKey) return { ok: false, reason: 'NO_KEY' };
  const doFetch = args.fetchImpl ?? fetch;
  try {
    const res = await doFetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': APP_TITLE,
      },
      body: JSON.stringify({
        model,
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
    const body: unknown = await res.json();
    const b = body as {
      model?: unknown;
      choices?: {
        message?: { content?: unknown };
        finish_reason?: unknown;
      }[];
    } | null;
    const content = b?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim())
      return { ok: false, reason: 'BAD_RESPONSE' };
    const finish = b?.choices?.[0]?.finish_reason;
    return {
      ok: true,
      content,
      ...(typeof b?.model === 'string' ? { model: b.model } : {}),
      ...(typeof finish === 'string' ? { finish } : {}),
    };
  } catch (e) {
    const timeout =
      e instanceof Error &&
      (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, reason: timeout ? 'TIMEOUT' : 'HTTP' };
  }
}
