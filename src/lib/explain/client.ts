// Browser side of the AI explanation: one POST, a timeout, and the fallback sentence for any failure.
// The same combo is asked once per page visit (module cache); the server has its own shared cache.
import { EXPLAIN_LIMITS } from './config';
import { fallbackText } from './fallback';
import { toInput } from './payload';
import type { ExplainRequest, ExplainResponse } from './types';

const seen = new Map<string, ExplainResponse>();

function localFallback(
  req: ExplainRequest,
  reason: 'BUSY' | 'UNAVAILABLE',
): ExplainResponse {
  const input = toInput(req);
  return {
    text: input ? fallbackText(input) : '',
    source: 'fallback',
    reason,
  };
}

export async function fetchExplanation(
  req: ExplainRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ExplainResponse> {
  const key = JSON.stringify(req);
  const hit = seen.get(key);
  if (hit) return hit;
  let out: ExplainResponse;
  try {
    const res = await fetchImpl('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: key,
      signal: AbortSignal.timeout(EXPLAIN_LIMITS.clientTimeoutMs),
    });
    const body = (await res.json()) as Partial<ExplainResponse>;
    out =
      res.ok && typeof body.text === 'string' && body.source
        ? (body as ExplainResponse)
        : localFallback(req, 'UNAVAILABLE');
  } catch (e) {
    // Gave up waiting: the AI side is slow, so "try again later". Anything else (offline...) is plain failure.
    const slow =
      e instanceof Error &&
      (e.name === 'TimeoutError' || e.name === 'AbortError');
    out = localFallback(req, slow ? 'BUSY' : 'UNAVAILABLE');
  }
  // A failure is not remembered, so pressing the button again can try again.
  if (out.source !== 'fallback') seen.set(key, out);
  return out;
}
