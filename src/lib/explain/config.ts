// AI explanation settings (not nutrition constants). The model name lives only here (default) and in the
// OPENROUTER_MODEL environment variable (override). Limits are counted by the DB function ai_try_consume.

/** Free router: OpenRouter picks a free model. Replace it here, or set OPENROUTER_MODEL, to use another one. */
export const DEFAULT_MODEL = 'openrouter/free';
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
  /** Longer than the server's, so the server answers (with its fallback) before the browser gives up. */
  clientTimeoutMs: 10_000,
  maxBodyBytes: 8_192,
  maxTokens: 300,
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
