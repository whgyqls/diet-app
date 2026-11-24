// Display values of the day targets (PLAN.md 3.1). Pure: screens only format these numbers.
import type { DayPlan, DayTargets } from '@/types/nutrition';

export type DaySummary = {
  kcal: number;
  protein: { base: number; max: number };
  netCarbMax: number;
  fat: { min: number; max: number };
  fiberMin: number;
  sodiumMax: number;
};

export function daySummary(t: DayTargets): DaySummary {
  return {
    kcal: Math.round(t.kcal),
    protein: {
      base: Math.round(t.protein.base),
      max: Math.round(t.protein.max),
    },
    netCarbMax: Math.round(t.netCarbMax),
    fat: { min: Math.round(t.fat.stage1), max: Math.round(t.fat.stage2) },
    fiberMin: Math.round(t.fiberMin),
    sodiumMax: Math.round(t.sodiumMax),
  };
}

export type DayBar = {
  key: 'kcal' | 'protein' | 'carbs' | 'fat' | 'satFat' | 'fiber' | 'sodium';
  actual: number; // rounded for display
  target: number; // rounded for display
  unit: 'kcal' | 'g' | 'mg';
  /** reach = aim for the target, limit = stay under it. */
  kind: 'reach' | 'limit';
  /** actual / target (unrounded actual); the screen clamps the bar width. */
  ratio: number;
  /** A limit that is exceeded. Reach targets are never "over". */
  over: boolean;
};

/** Day total vs target for the bars at the top of the plan screen (PLAN.md 3.3). */
export function dayBars(plan: Pick<DayPlan, 'targets' | 'totals'>): DayBar[] {
  const { targets: t, totals: a } = plan;
  const bar = (
    key: DayBar['key'],
    actual: number,
    target: number,
    unit: DayBar['unit'],
    kind: DayBar['kind'],
  ): DayBar => ({
    key,
    actual: Math.round(actual),
    target: Math.round(target),
    unit,
    kind,
    ratio: target > 0 ? actual / target : 0,
    over: kind === 'limit' && Math.round(actual) > Math.round(target),
  });
  return [
    bar('kcal', a.kcal, t.kcal, 'kcal', 'reach'),
    bar('protein', a.protein, t.protein.base, 'g', 'reach'),
    bar('carbs', a.carbs, t.totalCarbMax, 'g', 'limit'),
    bar('fat', a.fat, t.fat.stage2, 'g', 'limit'),
    // limit = the 7% target of PLAN.md 4.1-2 (over it: weak penalty; 10%: warning)
    bar('satFat', a.satFat, t.satFatTarget, 'g', 'limit'),
    bar('fiber', a.fiber, t.fiberMin, 'g', 'reach'),
    bar('sodium', a.sodium, t.sodiumMax, 'mg', 'limit'),
  ];
}
