// Day summary from the chosen combo of each meal (PLAN.md 5-6, 4.4). Pure: sums, flags, shortfalls.
// Used by generateDayPlan and by the plan screen when the user picks another combo (no recalculation of combos).
import type { Food } from '@/types/food';
import type {
  DayPlan,
  DayTargets,
  FlagCode,
  GenerateFailReason,
  MealCombo,
  MealPlan,
  MealTargets,
  MealType,
  MicroKey,
  NutrientTotals,
  PortionedFood,
  Profile,
  UnmetTarget,
} from '@/types/nutrition';
import {
  MICRO_KEYS,
  MICRO_SHORTFALL_RATIO,
  MICROS_HARD_FROM_FOOD,
  UNMET_TARGET_TOLERANCE,
} from './constants';
import { computeFlags } from './flags';
import { ZERO_TOTALS, addTotals } from './portions';

/** Micronutrients of the portioned foods. Missing source values count as 0 (an underestimate). */
export function microsOf(items: PortionedFood[]): Record<MicroKey, number> {
  const out = Object.fromEntries(MICRO_KEYS.map((k) => [k, 0])) as Record<
    MicroKey,
    number
  >;
  for (const { food, grams } of items)
    for (const k of MICRO_KEYS)
      out[k] += ((food.micro100g?.[k] ?? 0) * grams) / 100;
  return out;
}

export type SummarizeDayInput = {
  targets: DayTargets;
  profile: Profile;
  /** Warnings that come from the settings (calcDayTargets().flags). */
  settingFlags: readonly FlagCode[];
  meals: {
    mealType: MealType;
    targets: MealTargets;
    combos: MealCombo[];
    /** The combo eaten at this meal. Default: combos[0]. */
    picked?: MealCombo;
  }[];
  includeFoods: string[];
  reason?: GenerateFailReason;
};

export function summarizeDay(input: SummarizeDayInput): DayPlan {
  const { targets, profile, settingFlags } = input;
  const meals: MealPlan[] = input.meals.map((m) => ({
    mealType: m.mealType,
    targets: m.targets,
    combos: m.combos,
  }));
  const chosen: (MealCombo | undefined)[] = input.meals.map(
    (m) => m.picked ?? m.combos[0],
  );
  const planned = chosen.every((c) => c !== undefined);

  const totals: NutrientTotals = chosen.reduce(
    (a, c) => (c ? addTotals(a, c.totals) : a),
    ZERO_TOTALS,
  );
  const micros = microsOf(
    chosen.flatMap((c) => (c ? [...c.items, ...c.oils] : [])),
  );
  // Warnings are computed once from the final values (flags.ts); with no plan only the setting ones.
  const flagDetails = computeFlags({
    profile,
    targets,
    settingFlags,
    ...(planned ? { intake: { totals, micros } } : {}),
  });
  const shortfalls = MICRO_KEYS.filter(
    (k) => micros[k] < targets.micros[k] * MICRO_SHORTFALL_RATIO,
  ).map((k) => ({
    nutrient: k,
    amount: micros[k],
    reference: targets.micros[k],
    ratio: micros[k] / targets.micros[k],
    hardFromFood: MICROS_HARD_FROM_FOOD.includes(k),
  }));
  const unmet = (
    nutrient: UnmetTarget['nutrient'],
    target: number,
    actual: number,
  ): UnmetTarget[] =>
    planned && actual < target * UNMET_TARGET_TOLERANCE
      ? [{ nutrient, target, actual, short: target - actual }]
      : [];
  const dayFoods = chosen.flatMap((c) =>
    c ? c.items.map((i: { food: Food }) => i.food.id) : [],
  );
  return {
    targets,
    meals,
    totals,
    micros,
    shortfalls,
    flags: flagDetails.map((f) => f.code),
    flagDetails,
    unmetTargets: [
      ...unmet('protein', targets.protein.base, totals.protein),
      ...unmet('fiber', targets.fiberMin, totals.fiber),
      ...unmet('kcal', targets.kcal, totals.kcal),
    ],
    missingIncludes: input.includeFoods.filter((id) => !dayFoods.includes(id)),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}
