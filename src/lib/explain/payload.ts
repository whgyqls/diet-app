// What leaves the app for the AI. The browser sends ids and numbers; the server checks them against its own
// data, takes the names from there, rounds everything and builds the one canonical input. Pure functions.
import { z } from 'zod';
import { FOODS, SEASONINGS } from '@/lib/data/load';
import type { Food, Seasoning } from '@/types/food';
import type { Goal, MealCombo } from '@/types/nutrition';
import { PROMPT_VERSION } from './config';
import type { ExplainInput, ExplainRequest } from './types';

const num = (max: number) => z.number().finite().min(0).max(max);
const id = z.string().min(1).max(64);

/** Strict: unknown keys (an email, a weight, a target) make the request invalid instead of being forwarded. */
export const explainRequestSchema = z
  .object({
    goal: z.enum(['lose', 'maintain', 'gain']),
    items: z
      .array(z.object({ id, grams: num(2000) }).strict())
      .min(1)
      .max(6),
    oils: z.array(z.object({ id, grams: num(500) }).strict()).max(2),
    seasonings: z.array(z.object({ id, units: num(50) }).strict()).max(6),
    free: z.array(id).max(12),
    totals: z
      .object({
        kcal: num(5000),
        protein: num(500),
        carbs: num(1000),
        fat: num(500),
        satFat: num(300),
        fiber: num(200),
        sodium: num(10000),
      })
      .strict(),
  })
  .strict();

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

const byId = <T extends { id: string }>(list: readonly T[]) =>
  new Map(list.map((x) => [x.id, x]));

/**
 * The canonical input, or null when an id is unknown. Numbers are rounded the way the card shows them
 * (grams, kcal, g and mg whole; seasoning units and saturated fat to one decimal).
 */
export function toInput(
  req: ExplainRequest,
  foods: readonly Food[] = FOODS,
  seasonings: readonly Seasoning[] = SEASONINGS,
): ExplainInput | null {
  const f = byId(foods);
  const s = byId(seasonings);
  const items: ExplainInput['items'] = [];
  for (const i of req.items) {
    const food = f.get(i.id);
    if (!food) return null;
    items.push({ name: food.name, grams: r0(i.grams), basis: food.basis });
  }
  const oils: ExplainInput['oils'] = [];
  for (const o of req.oils) {
    const food = f.get(o.id);
    if (!food) return null;
    oils.push({ name: food.name, grams: r0(o.grams) });
  }
  const picks: ExplainInput['seasonings'] = [];
  for (const p of req.seasonings) {
    const se = s.get(p.id);
    if (!se) return null;
    picks.push({ name: se.name, units: r1(p.units), unit: se.unit.label });
  }
  const free: string[] = [];
  for (const x of req.free) {
    const se = s.get(x);
    if (!se) return null;
    free.push(se.name);
  }
  const t = req.totals;
  return {
    goal: req.goal,
    items,
    oils,
    seasonings: picks,
    free,
    totals: {
      kcal: r0(t.kcal),
      protein: r0(t.protein),
      carbs: r0(t.carbs),
      fat: r0(t.fat),
      satFat: r1(t.satFat),
      fiber: r0(t.fiber),
      sodium: r0(t.sodium),
    },
  };
}

/** The request for one card (browser side). */
export function requestFromCombo(combo: MealCombo, goal: Goal): ExplainRequest {
  return {
    goal,
    items: combo.items.map((i) => ({ id: i.food.id, grams: i.grams })),
    oils: combo.oils.map((i) => ({ id: i.food.id, grams: i.grams })),
    seasonings: combo.seasonings.picks.map((p) => ({
      id: p.seasoning.id,
      units: p.units,
    })),
    free: combo.seasonings.free.map((x) => x.id),
    totals: {
      kcal: combo.totals.kcal,
      protein: combo.totals.protein,
      carbs: combo.totals.carbs,
      fat: combo.totals.fat,
      satFat: combo.totals.satFat,
      fiber: combo.totals.fiber,
      sodium: combo.totals.sodium,
    },
  };
}

/**
 * The text the cache key is made of: the canonical input, the model and the prompt version. Nothing else, so
 * the same combo gives the same key for every user (no user id, no target numbers, no meal type).
 */
export function cacheKeyText(input: ExplainInput, model: string): string {
  return JSON.stringify({ v: PROMPT_VERSION, model, input });
}

/** Every number the AI is allowed to quote: the ones in the input. */
export function allowedNumbers(input: ExplainInput): Set<number> {
  const out = new Set<number>();
  for (const i of input.items) out.add(i.grams);
  for (const o of input.oils) out.add(o.grams);
  for (const s of input.seasonings) out.add(s.units);
  for (const v of Object.values(input.totals)) out.add(v);
  return out;
}

export type { Goal };
