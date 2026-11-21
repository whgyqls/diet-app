import { describe, expect, it } from 'vitest';
import type { Profile } from '@/types/nutrition';
import { calcDayTargets, calcMealTargets } from './targets';
import { EXAMPLE_PROFILES, REF_YEAR } from './test-fixtures';

const [loseF, maintainM, gainM] = EXAMPLE_PROFILES.map((e) => e.profile);

function expectProtein(
  p: { base: number; max: number },
  base: number,
  max: number,
) {
  expect(p.base).toBeCloseTo(base, 6);
  expect(p.max).toBeCloseTo(max, 6);
}

describe('calcDayTargets (automatic)', () => {
  it('computes Mifflin-St Jeor x activity x goal for a woman losing weight', () => {
    // BMR = 600 + 1018.75 - 150 - 161 = 1307.75; x1.375 x0.85
    const { targets, flags } = calcDayTargets(loseF, REF_YEAR);
    expect(targets.kcal).toBeCloseTo(1307.75 * 1.375 * 0.85, 6);
    expectProtein(targets.protein, 96, 120);
    expect(targets.netCarbMax).toBeCloseTo((targets.kcal * 0.2) / 4, 6);
    expect(targets.fat.stage1).toBeCloseTo((targets.kcal * 0.3) / 9, 6);
    expect(targets.fat.stage2).toBeCloseTo((targets.kcal * 0.35) / 9, 6);
    // default diet: no 45% step, so the highest fat cap is 35%
    expect(targets.fat.stage3).toBeCloseTo((targets.kcal * 0.35) / 9, 6);
    expect(targets.satFatMax).toBeCloseTo((targets.kcal * 0.1) / 9, 6);
    expect(targets.totalCarbMax).toBeCloseTo((targets.kcal * 0.45) / 4, 6);
    expect(targets.totalCarbMin).toBe(100);
    expect(targets.carbTopUp).toBe(true);
    expect(targets.satFatTarget).toBeCloseTo((targets.kcal * 0.07) / 9, 6);
    expect(targets.cholesterolMax).toBe(300);
    // KDRI 2020 woman 30-49
    expect(targets.fiberMin).toBe(20);
    expect(targets.micros).toEqual({
      calcium: 700,
      iron: 14,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 650,
      vitaminD: 10,
    });
    expect(targets.fiberSoftMax).toBe(50);
    expect(targets.goal).toBe('lose');
    expect(targets.sodiumMax).toBe(2000);
    expect(flags).toEqual([]);
  });

  it('uses 1.2 g/kg for maintenance (filling up to 1.6) and 1.6 g/kg for muscle gain (filling up to 2.0)', () => {
    const m = calcDayTargets(maintainM, REF_YEAR).targets;
    expect(m.kcal).toBeCloseTo(1698.75 * 1.55, 6);
    expectProtein(m.protein, 90, 120);
    expect(m.netCarbMax).toBeCloseTo((m.kcal * 0.25) / 4, 6);
    expect(m.totalCarbMax).toBeCloseTo((m.kcal * 0.45) / 4, 6);
    // KDRI 2020 man 30-49
    expect(m.fiberMin).toBe(30);
    expect(m.micros).toEqual({
      calcium: 800,
      iron: 10,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 800,
      vitaminD: 10,
    });

    const g = calcDayTargets(gainM, REF_YEAR).targets;
    expect(g.kcal).toBeCloseTo(1648.75 * 1.55 * 1.1, 6);
    expectProtein(g.protein, 112, 140);
    expect(g.netCarbMax).toBeCloseTo((g.kcal * 0.3) / 4, 6);
  });

  it('applies the kcal floor (female 1200, male 1500) to automatic values without a warning', () => {
    const small: Profile = {
      ...loseF,
      weightKg: 40,
      heightCm: 150,
      birthYear: 1956,
      activityLevel: 1,
    };
    const res = calcDayTargets(small, REF_YEAR);
    expect(res.targets.kcal).toBe(1200);
    expect(res.flags).toEqual([]);
    const smallMan: Profile = { ...small, sex: 'male' };
    expect(calcDayTargets(smallMan, REF_YEAR).targets.kcal).toBe(1500);
  });

  it('uses refYear for age', () => {
    const a = calcDayTargets(maintainM, 2026).targets.kcal;
    const b = calcDayTargets(maintainM, 2036).targets.kcal;
    expect(a - b).toBeCloseTo(50 * 1.55, 6);
  });
});

describe('calcDayTargets (overrides)', () => {
  it('keeps a user kcal below the floor but flags it', () => {
    const { targets, flags } = calcDayTargets(loseF, REF_YEAR, { kcal: 1100 });
    expect(targets.kcal).toBe(1100);
    expect(targets.netCarbMax).toBeCloseTo((1100 * 0.2) / 4, 6);
    expect(flags).toContain('KCAL_BELOW_FLOOR');
  });

  it('does not flag a user kcal exactly at the floor', () => {
    expect(calcDayTargets(loseF, REF_YEAR, { kcal: 1200 }).flags).not.toContain(
      'KCAL_BELOW_FLOOR',
    );
  });

  it('takes protein as g/kg or g; a user protein is not raised by kcal filling (max = base)', () => {
    expectProtein(
      calcDayTargets(loseF, REF_YEAR, { protein: { perKg: 1.2 } }).targets
        .protein,
      72,
      72,
    );
    expectProtein(
      calcDayTargets(loseF, REF_YEAR, { protein: { g: 80 } }).targets.protein,
      80,
      80,
    );
  });

  it('flags protein below 0.9 g/kg but keeps it', () => {
    const { targets, flags } = calcDayTargets(loseF, REF_YEAR, {
      protein: { perKg: 0.8 },
    });
    expect(targets.protein.base).toBeCloseTo(48, 6);
    expect(flags).toContain('PROTEIN_BELOW_MIN');
    expect(
      calcDayTargets(loseF, REF_YEAR, { protein: { perKg: 0.9 } }).flags,
    ).not.toContain('PROTEIN_BELOW_MIN');
  });

  it('clamps protein above 2.0 g/kg', () => {
    const { targets, flags } = calcDayTargets(loseF, REF_YEAR, {
      protein: { g: 150 },
    });
    expectProtein(targets.protein, 120, 120);
    expect(flags).toContain('PROTEIN_CLAMPED_TO_MAX');
  });

  it('takes net carbs and fat as a kcal ratio or grams; user values are not extended by steps 6-7', () => {
    const t1 = calcDayTargets(maintainM, REF_YEAR, {
      kcal: 2000,
      netCarbs: { ratio: 0.3 },
      fat: { ratio: 0.35 },
    }).targets;
    expect(t1.netCarbMax).toBeCloseTo(150, 6);
    expect(t1.fat.stage1).toBeCloseTo((2000 * 0.35) / 9, 6);
    expect(t1.fat.stage2).toBeCloseTo((2000 * 0.35) / 9, 6);
    expect(t1.fat.stage3).toBeCloseTo((2000 * 0.35) / 9, 6);
    expect(t1.carbTopUp).toBe(false);
    const t2 = calcDayTargets(maintainM, REF_YEAR, {
      netCarbs: { g: 120 },
      fat: { g: 70 },
    }).targets;
    expect(t2.netCarbMax).toBe(120);
    expect(t2.fat).toEqual({ stage1: 70, stage2: 70, stage3: 70 });
    expect(t2.carbTopUp).toBe(false);
  });

  it('lets sodium go lower but clamps it to 2000 mg', () => {
    expect(
      calcDayTargets(loseF, REF_YEAR, { sodiumMax: 1600 }).targets.sodiumMax,
    ).toBe(1600);
    const high = calcDayTargets(loseF, REF_YEAR, { sodiumMax: 2500 });
    expect(high.targets.sodiumMax).toBe(2000);
    expect(high.flags).toContain('SODIUM_CLAMPED_TO_MAX');
  });
});

describe('KDRI 2020 by age', () => {
  it('uses the row for the age band (man 65-74: fiber 25, vitamin D 15)', () => {
    const old = calcDayTargets(
      { ...maintainM, birthYear: REF_YEAR - 70 },
      REF_YEAR,
    ).targets;
    expect(old.fiberMin).toBe(25);
    expect(old.micros.vitaminD).toBe(15);
    expect(old.micros.calcium).toBe(700);
  });

  it('woman 50-64: iron 8, calcium 800', () => {
    const t = calcDayTargets(
      { ...loseF, birthYear: REF_YEAR - 55 },
      REF_YEAR,
    ).targets;
    expect(t.micros.iron).toBe(8);
    expect(t.micros.calcium).toBe(800);
  });

  it('has a default sodium cap of 2,000 mg and raises no LOW_SODIUM flag for it', () => {
    const { targets, flags } = calcDayTargets(loseF, REF_YEAR);
    expect(targets.sodiumMax).toBe(2000);
    expect(flags).not.toContain('LOW_SODIUM');
  });
});

describe('health flags', () => {
  it('HIGH_PROTEIN only above 1.6 g/kg', () => {
    expect(
      calcDayTargets(loseF, REF_YEAR, { protein: { perKg: 1.6 } }).flags,
    ).not.toContain('HIGH_PROTEIN');
    expect(
      calcDayTargets(loseF, REF_YEAR, { protein: { perKg: 1.7 } }).flags,
    ).toContain('HIGH_PROTEIN');
  });

  it('LOW_SODIUM only below 1500 mg', () => {
    expect(
      calcDayTargets(loseF, REF_YEAR, { sodiumMax: 1500 }).flags,
    ).not.toContain('LOW_SODIUM');
    expect(
      calcDayTargets(loseF, REF_YEAR, { sodiumMax: 1499 }).flags,
    ).toContain('LOW_SODIUM');
  });

  it('LOW_NET_CARB only below 50 g/day', () => {
    expect(
      calcDayTargets(loseF, REF_YEAR, { netCarbs: { g: 50 } }).flags,
    ).not.toContain('LOW_NET_CARB');
    expect(
      calcDayTargets(loseF, REF_YEAR, { netCarbs: { g: 49 } }).flags,
    ).toContain('LOW_NET_CARB');
  });
});

describe('calcMealTargets', () => {
  const day = calcDayTargets(maintainM, REF_YEAR).targets;

  it('splits 3 meals 30/35/35 and the splits add back up to the day', () => {
    const meals = calcMealTargets(day, 3);
    expect(meals.map((m) => m.mealType)).toEqual([
      'breakfast',
      'lunch',
      'dinner',
    ]);
    const sum = (f: (m: (typeof meals)[number]) => number) =>
      meals.reduce((a, m) => a + f(m), 0);
    expect(sum((m) => m.kcal)).toBeCloseTo(day.kcal, 6);
    expect(sum((m) => m.protein.base)).toBeCloseTo(day.protein.base, 6);
    expect(sum((m) => m.protein.max)).toBeCloseTo(day.protein.max, 6);
    expect(sum((m) => m.netCarbMax)).toBeCloseTo(day.netCarbMax, 6);
    expect(sum((m) => m.fat.stage2)).toBeCloseTo(day.fat.stage2, 6);
    expect(sum((m) => m.fat.stage3)).toBeCloseTo(day.fat.stage3, 6);
    expect(sum((m) => m.satFatMax)).toBeCloseTo(day.satFatMax, 6);
    expect(sum((m) => m.totalCarbMax)).toBeCloseTo(day.totalCarbMax, 6);
    expect(sum((m) => m.totalCarbMin)).toBeCloseTo(day.totalCarbMin, 6);
    expect(sum((m) => m.cholesterolMax)).toBeCloseTo(day.cholesterolMax, 6);
    expect(sum((m) => m.micros.calcium)).toBeCloseTo(day.micros.calcium, 6);
    expect(sum((m) => m.sodiumMax)).toBeCloseTo(day.sodiumMax, 6);
    expect(meals[0].kcal).toBeCloseTo(day.kcal * 0.3, 6);
  });

  it('splits the KDRI fiber minimum by meal ratio (man 30 g, woman 20 g)', () => {
    expect(calcMealTargets(day, 3).map((m) => m.fiberMin)).toEqual([
      9, 10.5, 10.5,
    ]);
    const woman = calcMealTargets(
      calcDayTargets(loseF, REF_YEAR).targets,
      3,
    ).map((m) => m.fiberMin);
    expect(woman[0]).toBeCloseTo(6, 9);
    expect(woman[1]).toBeCloseTo(7, 9);
  });

  it('passes the goal through and splits the fiber soft max by ratio', () => {
    const meals = calcMealTargets(day, 3);
    expect(meals.every((m) => m.goal === 'maintain')).toBe(true);
    expect(meals.map((m) => m.fiberSoftMax)).toEqual([15, 17.5, 17.5]);
  });

  it('splits 2 meals 50/50', () => {
    const meals = calcMealTargets(day, 2);
    expect(meals.map((m) => m.ratio)).toEqual([0.5, 0.5]);
    expect(meals[1].kcal).toBeCloseTo(day.kcal / 2, 6);
  });
});
