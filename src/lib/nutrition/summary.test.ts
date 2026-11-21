import { describe, expect, it } from 'vitest';
import type { DayPlan } from '@/types/nutrition';
import { dayBars } from './summary';
import { LUNCH } from './test-fixtures';

const targets = {
  ...LUNCH,
  kcal: 1500,
  protein: { base: 100, max: 120 },
  totalCarbMax: 150,
  fat: { stage1: 40, stage2: 50, stage3: 50 },
  fiberMin: 25,
  sodiumMax: 2000,
};
const plan = (
  over: Partial<DayPlan['totals']>,
): Pick<DayPlan, 'targets' | 'totals'> => ({
  targets,
  totals: {
    kcal: 1500,
    protein: 100,
    carbs: 150,
    netCarbs: 120,
    fiber: 30,
    fat: 50,
    satFat: 10,
    sodium: 1000,
    cholesterol: 100,
    ...over,
  },
});

describe('dayBars', () => {
  it('returns the six bars in screen order with units', () => {
    const bars = dayBars(plan({}));
    expect(bars.map((b) => [b.key, b.unit])).toEqual([
      ['kcal', 'kcal'],
      ['protein', 'g'],
      ['carbs', 'g'],
      ['fat', 'g'],
      ['fiber', 'g'],
      ['sodium', 'mg'],
    ]);
  });

  it('uses the right target per nutrient and kind (reach vs limit)', () => {
    const b = Object.fromEntries(dayBars(plan({})).map((x) => [x.key, x]));
    expect(b.protein).toMatchObject({ target: 100, kind: 'reach' });
    expect(b.carbs).toMatchObject({ target: 150, kind: 'limit' });
    expect(b.fat).toMatchObject({ target: 50, kind: 'limit' });
    expect(b.fiber).toMatchObject({ target: 25, kind: 'reach' });
    expect(b.sodium).toMatchObject({ target: 2000, kind: 'limit' });
  });

  it('ratio = actual / target and rounds shown values', () => {
    const b = Object.fromEntries(
      dayBars(plan({ sodium: 1500.4, protein: 49.6 })).map((x) => [x.key, x]),
    );
    expect(b.sodium.actual).toBe(1500);
    expect(b.sodium.ratio).toBeCloseTo(1500.4 / 2000, 6);
    expect(b.protein.actual).toBe(50);
  });

  it('flags a limit that is exceeded, never a reach target', () => {
    const b = Object.fromEntries(
      dayBars(plan({ sodium: 2100, carbs: 151, protein: 300 })).map((x) => [
        x.key,
        x,
      ]),
    );
    expect(b.sodium.over).toBe(true);
    expect(b.carbs.over).toBe(true);
    expect(b.protein.over).toBe(false);
  });
});
