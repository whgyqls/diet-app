// AI explanation settings (not nutrition constants). The model names live only here. The OPENROUTER_MODEL
// environment variable is an optional override of the first one (it is not set in production).
// Limits are counted by the DB function ai_try_consume.

/**
 * The model asked first. A fixed free model whose reasoning is off by default: the free router
 * (openrouter/free) may pick a reasoning model that spends the token budget thinking and returns no text.
 */
export const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';
/** Tried in this order when the first model errors (rate limit, provider down). Only free models: a paid one would be billed. */
export const FALLBACK_MODELS: readonly string[] = [
  'google/gemma-4-31b-it:free',
];
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Shown to OpenRouter as the app name. Nothing about the user. */
export const APP_TITLE = 'wonmul-diet';

/** Bump when the prompt or the output rules change: it is part of the cache key. */
export const PROMPT_VERSION = 2;

export const EXPLAIN_LIMITS = {
  /** Calls per user per UTC day (cache hits are free). */
  userPerDay: 5,
  /** Calls for the whole site per UTC day. The free quota is 50 a day, so keep a margin. */
  sitePerDay: 45,
  serverTimeoutMs: 8_000,
  /** Longer than the server's whole run (8 s for the AI call + login, cache and count steps + a cold start). */
  clientTimeoutMs: 15_000,
  maxBodyBytes: 8_192,
  maxTokens: 600,
  minTextChars: 10,
  maxTextChars: 220,
  maxSentences: 3,
} as const;

/** The model for this run: OPENROUTER_MODEL when set and not blank, else the default. */
export function pickModel(envValue: string | undefined): string {
  const m = envValue?.trim();
  return m ? m : DEFAULT_MODEL;
}

/** The UTC date (YYYY-MM-DD) a call is counted on. */
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);
