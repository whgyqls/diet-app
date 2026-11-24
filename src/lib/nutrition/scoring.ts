// Combo score: weighted relative errors against the meal targets, minus a favorite bonus (PLAN.md 5-4).
import type {
  MealTargets,
  MicroKey,
  NutrientTotals,
  ScoreBreakdown,
} from '@/types/nutrition';
import {
  CARB_TOLERANCE_G,
  FAVORITE_BONUS,
  KCAL_PER_GRAM,
  KCAL_SCORE_INSIDE_WEIGHT,
  KCAL_SCORE_TOLERANCE_RATIO,
  MICRO_KEYS,
  MICRO_SHORTFALL_RATIO,
  MICROS_HARD_FROM_FOOD,
  SCORE_WEIGHTS,
} from './constants';

/** Relative excess over `limit`, ignoring the first `slack` units. */
const over = (value: number, limit: number, slack = 0) =>
  limit > 0 ? Math.max(0, value - limit - slack) / limit : 0;
/** Relative shortfall below `min`. */
const under = (value: number, min: number) =>
  min > 0 ? Math.max(0, min - value) / min : 0;

/**
 * Total-carb cap in grams for a meal/day that actually provides `kcalEaten`: the 45% share of the kcal eaten
 * (like fat), not of the target. `t.totalCarbMax` is the goal's share (45% / 50%) of the target kcal.
 */
export function carbCapGrams(
  t: Pick<MealTargets, 'totalCarbMax' | 'kcal'>,
  kcalEaten: number,
): number {
  return t.kcal > 0 ? (t.totalCarbMax * kcalEaten) / t.kcal : 0;
}

/** Small slope inside ±tolerance, full weight on the part beyond it. Continuous at the edge. */
function kcalPenalty(kcal: number, target: number): number {
  const err = Math.abs(kcal - target) / target;
  const inside = Math.min(err, KCAL_SCORE_TOLERANCE_RATIO);
  const beyond = Math.max(0, err - KCAL_SCORE_TOLERANCE_RATIO);
  return KCAL_SCORE_INSIDE_WEIGHT * inside + SCORE_WEIGHTS.kcal * beyond;
}

/**
 * Fat and saturated fat are judged as shares of the kcal actually eaten (what the user sees), using the
 * targets' gram caps converted to shares of the target kcal.
 */
function shareOver(
  grams: number,
  capGrams: number,
  t: MealTargets,
  kcal: number,
): number {
  if (kcal <= 0) return 0;
  const capShare = (capGrams * KCAL_PER_GRAM.fat) / t.kcal;
  const share = (grams * KCAL_PER_GRAM.fat) / kcal;
  return capShare > 0 ? Math.max(0, share - capShare) / capShare : 0;
}

/** Lower is better. 0 = every target met. `micros` omitted = no micronutrient term. */
export function scoreCombo(
  totals: NutrientTotals,
  t: MealTargets,
  favorites: number,
  micros?: Record<MicroKey, number>,
  styleBonus = 0,
): ScoreBreakdown {
  const w = SCORE_WEIGHTS;
  const kcalEaten = totals.kcal;
  const proteinErr =
    totals.protein < t.protein.base
      ? (t.protein.base - totals.protein) / t.protein.base
      : over(totals.protein, t.protein.max);
  // Saturated fat: weak between the 7% target and the 10% cap, strong beyond the cap.
  const satToCap = Math.min(totals.satFat, t.satFatMax);
  const parts = {
    kcal: kcalPenalty(totals.kcal, t.kcal),
    protein: w.protein * proteinErr,
    carbOver:
      w.carbOver *
      over(totals.carbs, carbCapGrams(t, totals.kcal), CARB_TOLERANCE_G),
    carbUnder: w.carbUnder * under(totals.carbs, t.totalCarbMin),
    fiberUnder: w.fiberUnder * under(totals.fiber, t.fiberMin),
    fiberOver: w.fiberOver * over(totals.fiber, t.fiberSoftMax),
    sodiumOver: w.sodiumOver * over(totals.sodium, t.sodiumMax),
    fatOver: w.fatOver * shareOver(totals.fat, t.fat.stage3, t, totals.kcal),
    satFatOver:
      w.satFatOver * shareOver(totals.satFat, t.satFatMax, t, totals.kcal),
    satFatAboveTarget:
      w.satFatAboveTarget * shareOver(satToCap, t.satFatTarget, t, totals.kcal),
    // Always on and small: of two combos with the same other scores, the one with less saturated fat wins.
    satFatLow:
      kcalEaten > 0 && t.satFatTarget > 0
        ? w.satFatLow *
          Math.min(
            1,
            (totals.satFat * KCAL_PER_GRAM.fat) /
              kcalEaten /
              ((t.satFatTarget * KCAL_PER_GRAM.fat) / t.kcal),
          )
        : 0,
    cholesterolOver:
      w.cholesterolOver * over(totals.cholesterol, t.cholesterolMax),
    microUnder: micros
      ? w.microUnder *
        MICRO_KEYS.filter((k) => !MICROS_HARD_FROM_FOOD.includes(k)).reduce(
          (a, k) => a + under(micros[k], t.micros[k] * MICRO_SHORTFALL_RATIO),
          0,
        )
      : 0,
    favorite: -FAVORITE_BONUS * favorites,
    styleBonus: -styleBonus,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total, ...parts };
}
