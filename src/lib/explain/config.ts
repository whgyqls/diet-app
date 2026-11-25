// AI explanation settings (not nutrition constants). The model names live only here. The OPENROUTER_MODEL
// environment variable is an optional override of the first one (it is not set in production).
// Limits are counted by the DB function ai_try_consume.

/**
 * The model asked first. A fixed free model whose reasoning is off by default: the free router
 * (openrouter/free) may pick a reasoning model that spends the token budget thinking and returns no text.
 */
export const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';

/** One try of the explanation: one model, asked alone, with its own extra request fields and time. */
export type ModelAttempt = {
  model: string;
  /**
   * Extra request fields for this model only. A model that thinks by default must be told not to: the thinking
   * tokens count against max_tokens and leave no text. `effort: "none"` is refused by nemotron (503); `enabled:
   * false` works (2026-11-25, 4 of 4 calls gave text with 0 reasoning tokens). Models that do not think by
   * default (the Gemma ones) get nothing extra: a value they do not take could be refused.
   */
  extra?: { reasoning?: { enabled: boolean } };
  /** The longest this try may take. */
  timeoutMs: number;
  /** The try is skipped when less than this is left of the server's total time. */
  minMs: number;
};

/**
 * The free models, in the order they are tried, one request each. A failure (429, error, no text, a refused
 * answer) goes on to the next one while time is left. Gemma is fast but both models are served by Google, whose
 * free quota is often used up (429 in 0.15 s); nemotron is from Nvidia but takes 17-24 s even with reasoning off.
 * Only free models: a paid one would be billed.
 */
export const MODEL_ATTEMPTS: readonly ModelAttempt[] = [
  { model: DEFAULT_MODEL, timeoutMs: 10_000, minMs: 3_000 },
  { model: 'google/gemma-4-31b-it:free', timeoutMs: 10_000, minMs: 3_000 },
  {
    model: 'nvidia/nemotron-3.5-super-vl:free',
    extra: { reasoning: { enabled: false } },
    timeoutMs: 35_000,
    minMs: 30_000,
  },
];

/** The attempts of this run. `first` (OPENROUTER_MODEL, not set in production) replaces the first model only. */
export function attemptsFor(first: string): ModelAttempt[] {
  const [head, ...rest] = MODEL_ATTEMPTS;
  return first === head.model
    ? [...MODEL_ATTEMPTS]
    : [{ ...head, model: first, extra: undefined }, ...rest];
}
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Shown to OpenRouter as the app name. Nothing about the user. */
export const APP_TITLE = 'wonmul-diet';

/** Bump when the prompt or the output rules change: it is part of the cache key. */
export const PROMPT_VERSION = 2;

export const EXPLAIN_LIMITS = {
  /** Calls per user per UTC day (cache hits are free). */
  userPerDay: 15,
  /** Calls for the whole site per UTC day. The free quota is 50 a day, so keep a margin. */
  sitePerDay: 45,
  /** The whole server side of one request: all tries together. (Netlify allows 60 s for a synchronous function.) */
  serverTotalMs: 45_000,
  /** A try is repeated once with the same model only when this many times its own duration is left. */
  repeatFactor: 2,
  /** Longer than the server's whole run, so the server answers (with its fallback sentence) before the browser gives up. */
  clientTimeoutMs: 50_000,
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
