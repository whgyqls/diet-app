// "Must include" foods of a day (PLAN.md 4.6 includeFoods): what can be picked and what is dropped. Pure functions.
import type { Food, FoodCategory } from '@/types/food';
import type { Selection } from '@/types/nutrition';
import { INCLUDE_PER_MEAL_MAX, OIL_GROUP } from './constants';

/**
 * Oils are not part of a combo's `items` (they are a separate slot), so the day never counts them as included.
 * They cannot be asked for.
 */
export const isIncludable = (f: Pick<Food, 'group'>): boolean =>
  f.group !== OIL_GROUP;

/** How many foods of each category the day can hold: the per-meal limit times the number of meals. */
export function includeCapacity(
  mealsPerDay: number,
): Record<FoodCategory, number> {
  return {
    protein: INCLUDE_PER_MEAL_MAX.protein * mealsPerDay,
    carb: INCLUDE_PER_MEAL_MAX.carb * mealsPerDay,
    fiber: INCLUDE_PER_MEAL_MAX.fiber * mealsPerDay,
    fat: INCLUDE_PER_MEAL_MAX.fat * mealsPerDay,
  };
}

/** Whether `food` can be added to `current` without going over its category's capacity. */
export function canAddInclude(
  current: readonly string[],
  food: Pick<Food, 'id' | 'category'>,
  foods: readonly Pick<Food, 'id' | 'category'>[],
  mealsPerDay: number,
): boolean {
  if (current.includes(food.id)) return true;
  const used = foods.filter(
    (f) => f.category === food.category && current.includes(f.id),
  ).length;
  return used < includeCapacity(mealsPerDay)[food.category];
}

export type DropReason = 'NOT_SELECTED' | 'STYLE_EXCLUDED' | 'UNKNOWN';

/** Keeps the ids the engine can still use; the rest are dropped with the reason. Order is kept, duplicates removed. */
export function effectiveIncludes(
  ids: readonly string[],
  selection: Selection,
  foods: readonly Food[],
  isExcluded: (f: Food) => boolean,
): { kept: string[]; dropped: { id: string; reason: DropReason }[] } {
  const kept: string[] = [];
  const dropped: { id: string; reason: DropReason }[] = [];
  for (const id of new Set(ids)) {
    const f = foods.find((x) => x.id === id);
    if (!f || !isIncludable(f)) dropped.push({ id, reason: 'UNKNOWN' });
    else if (!selection.foods[id]) dropped.push({ id, reason: 'NOT_SELECTED' });
    else if (isExcluded(f)) dropped.push({ id, reason: 'STYLE_EXCLUDED' });
    else kept.push(id);
  }
  return { kept, dropped };
}
