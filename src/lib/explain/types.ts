import type { Goal } from '@/types/nutrition';

/** What the browser sends: ids and numbers only. Names come from the server's own data. */
export type ExplainRequest = {
  goal: Goal;
  items: { id: string; grams: number }[];
  oils: { id: string; grams: number }[];
  seasonings: { id: string; units: number }[];
  free: string[];
  totals: {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    satFat: number;
    fiber: number;
    sodium: number;
  };
};

/** The only things that go to the AI (and into the cache key): no account, no body data, no target numbers. */
export type ExplainInput = {
  goal: Goal;
  items: { name: string; grams: number; basis: 'raw' | 'cooked' }[];
  oils: { name: string; grams: number }[];
  seasonings: { name: string; units: number; unit: string }[];
  free: string[];
  totals: ExplainRequest['totals'];
};

export type ExplainSource = 'ai' | 'cache' | 'fallback';
/** LIMIT: our daily limits. BUSY: the AI side is rate limiting or too slow (try again later). */
export type FallbackReason = 'LIMIT' | 'BUSY' | 'UNAVAILABLE' | 'INVALID';
export type ExplainResponse = {
  text: string;
  source: ExplainSource;
  reason?: FallbackReason;
};
