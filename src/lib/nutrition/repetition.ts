// "The same food shows up in nearly every card" notice (PLAN.md 3.3 / Phase 4). Pure.
import type { MealCombo } from '@/types/nutrition';
import {
  RATIO_EPSILON,
  REPEAT_WARN_MIN_COMBOS,
  REPEAT_WARN_RATIO,
} from './constants';

/** ceil(ratio * n) without floating point noise (0.7 * 10 = 7.000000000000001 must give 7, not 8). */
export function repeatThreshold(n: number, ratio = REPEAT_WARN_RATIO): number {
  return Math.ceil(n * ratio - RATIO_EPSILON);
}

export type RepeatedFood = {
  foodId: string;
  count: number; // cards that contain it
  total: number; // cards
  /** Set only when every appearance has the same weight. */
  grams?: number;
};

/** Foods in at least ceil(0.8 * n) of the n cards, most repeated first. Fewer than 3 cards: nothing. */
export function repeatedFoods(combos: MealCombo[]): RepeatedFood[] {
  const total = combos.length;
  if (total < REPEAT_WARN_MIN_COMBOS) return [];
  const need = repeatThreshold(total);
  const seen = new Map<string, number[]>();
  for (const c of combos) {
    const once = new Map<string, number>(); // a food counts once per card
    for (const i of c.items)
      if (!once.has(i.food.id)) once.set(i.food.id, i.grams);
    for (const [id, g] of once) seen.set(id, [...(seen.get(id) ?? []), g]);
  }
  return [...seen.entries()]
    .filter(([, grams]) => grams.length >= need)
    .map(([foodId, grams]) => ({
      foodId,
      count: grams.length,
      total,
      ...(grams.every((g) => g === grams[0]) ? { grams: grams[0] } : {}),
    }))
    .sort((a, b) => b.count - a.count || a.foodId.localeCompare(b.foodId));
}
