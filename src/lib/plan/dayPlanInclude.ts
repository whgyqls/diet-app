// "이 재료로 다시 추천받기": the foods of a saved day plan become the "must include" foods (6b) of a new
// recommendation. It is not the same plan again: the engine builds a new day around those foods. Pure.
import {
  canAddInclude,
  isIncludable,
  type DropReason,
} from '@/lib/nutrition/includeFoods';
import type { Food } from '@/types/food';
import type { Selection } from '@/types/nutrition';
import type { DayPlanData } from './dayPlans';

export type DayPlanIncludes = {
  /** Food ids for includeFoods, in the order of the saved meals. */
  ids: string[];
  /** The foods that could not be taken over, once each, with the reason. */
  skipped: { id: string; reason: DropReason }[];
};

/**
 * Walks the meals in their saved order (foods first, then oils) and takes over every food once. A food is left
 * out when it is not in the data any more, is an oil, is not selected now, is left out by the current styles, or
 * would go over the limit of its category for the number of meals now (the later ones in the saved order lose).
 */
export function includeFromDayPlan(
  plan: DayPlanData,
  ctx: {
    selection: Selection;
    foods: readonly Food[];
    isExcluded: (f: Food) => boolean;
    mealsPerDay: number;
  },
): DayPlanIncludes {
  const ids: string[] = [];
  const skipped: DayPlanIncludes['skipped'] = [];
  const seen = new Set<string>();
  const saved = plan.meals.flatMap((m) => [
    ...m.items.map((i) => i.foodId),
    ...m.oils.map((o) => o.foodId),
  ]);
  for (const id of saved) {
    if (seen.has(id)) continue;
    seen.add(id);
    const food = ctx.foods.find((f) => f.id === id);
    if (!food) skipped.push({ id, reason: 'UNKNOWN' });
    else if (!isIncludable(food)) skipped.push({ id, reason: 'OIL' });
    else if (!ctx.selection.foods[id])
      skipped.push({ id, reason: 'NOT_SELECTED' });
    else if (ctx.isExcluded(food))
      skipped.push({ id, reason: 'STYLE_EXCLUDED' });
    else if (!canAddInclude(ids, food, ctx.foods, ctx.mealsPerDay))
      skipped.push({ id, reason: 'CAP' });
    else ids.push(id);
  }
  return { ids, skipped };
}
