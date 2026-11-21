// Display values of the day targets (PLAN.md 3.1). Pure: screens only format these numbers.
import type { DayTargets } from '@/types/nutrition';

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
