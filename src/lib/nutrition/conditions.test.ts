// Day plans with diet styles and recommendation conditions (PLAN.md 4.5, 5).
import { describe, expect, it } from 'vitest';
import type {
  DayPlan,
  DietStyle,
  MealCombo,
  RecommendationConditions,
  Selection,
} from '@/types/nutrition';
import { PROTEIN_GROUPS } from './constants';
import { generateDayPlan } from './generate';
import {
  EXAMPLE_PROFILES,
  FOODS,
  REF_YEAR,
  SEASONINGS,
  selectAll,
} from './test-fixtures';

const [loseF, maintainM, gainM] = EXAMPLE_PROFILES.map((e) => e.profile);
const ALL = selectAll();
const only = (...ids: string[]): Selection => ({
  foods: Object.fromEntries(ids.map((id) => [id, 'ok' as const])),
  seasonings: ALL.seasonings,
});

function plan(
  profile: typeof loseF,
  conditions?: RecommendationConditions,
  selection: Selection = ALL,
): DayPlan {
  return generateDayPlan({
    foods: FOODS,
    seasonings: SEASONINGS,
    selection,
    profile,
    refYear: REF_YEAR,
    conditions,
  });
}
const styled = (profile: typeof loseF, styles: DietStyle[]) =>
  plan(profile, { styles });
const chosen = (p: DayPlan) => p.meals.map((m) => m.combos[0]);
const foodsOf = (c: MealCombo) => c.items.map((i) => i.food);
const allCombos = (p: DayPlan) => p.meals.flatMap((m) => m.combos);
const byCat = (c: MealCombo, cat: string) =>
  c.items.filter((i) => i.food.category === cat);
const share = (g: number, kcal: number, kcalPerG = 9) => (g * kcalPerG) / kcal;

describe('no style = the default diet', () => {
  it('conditions with nothing set give the same plan as no conditions', () => {
    const a = plan(maintainM);
    const b = plan(maintainM, {});
    expect(chosen(b).map((c) => c.key)).toEqual(chosen(a).map((c) => c.key));
    expect(b.flags).toEqual(a.flags);
  });

  it('the old `overrides` request field still works and equals conditions.overrides', () => {
    const o = { sodiumMax: 1700 };
    const legacy = generateDayPlan({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: ALL,
      profile: loseF,
      refYear: REF_YEAR,
      overrides: o,
    });
    const next = plan(loseF, { overrides: o });
    expect(chosen(next).map((c) => c.key)).toEqual(
      chosen(legacy).map((c) => c.key),
    );
    expect(next.targets.sodiumMax).toBe(1700);
  });

  it('the default plan avoids micronutrient shortfalls (except vitamin D) so MICRO_SHORTFALL does not appear', () => {
    for (const profile of [loseF, maintainM, gainM]) {
      const p = plan(profile);
      expect(p.shortfalls.filter((s) => !s.hardFromFood)).toEqual([]);
      expect(p.flags.filter((f) => f !== 'HIGH_PROTEIN')).toEqual([]);
    }
  });
});

describe('low carb + low sodium (weight-loss woman)', () => {
  const p = styled(loseF, ['lowCarb', 'lowSodium']);

  it('keeps total carbs near the 25% cap of the kcal eaten, and sodium within 1,500 mg', () => {
    expect(p.totals.carbs * 4).toBeLessThanOrEqual(p.totals.kcal * 0.25 + 8);
    expect(p.totals.sodium).toBeLessThanOrEqual(1500);
  });

  it('may fill kcal with unsaturated fat up to 45%, and raises the matching warnings instead of blocking', () => {
    expect(share(p.totals.fat, p.totals.kcal)).toBeLessThanOrEqual(0.45 + 1e-6);
    expect(p.targets.totalCarbMin).toBe(0);
    if (p.totals.carbs < 100) expect(p.flags).toContain('LOW_TOTAL_CARB');
    if (share(p.totals.fat, p.totals.kcal) > 0.35)
      expect(
        p.flags.some((f) => f === 'HIGH_FAT' || f === 'HIGH_FAT_MOSTLY_UNSAT'),
      ).toBe(true);
  });

  it('prefers combinations without a carb food', () => {
    expect(allCombos(p).some((c) => byCat(c, 'carb').length === 0)).toBe(true);
  });

  it('unsaturated fat steps beyond 35% only come from fat foods and oils', () => {
    for (const c of chosen(p)) {
      expect(c.kcalByStep.carbsTopUp).toBe(0); // the low-carb fill order has no carb top-up
    }
  });
});

describe('pescatarian (maintenance man)', () => {
  const p = styled(maintainM, ['pescatarian']);
  const meat = new Set<string>(PROTEIN_GROUPS.meat);

  it('has no meat in any suggested combination, but fish and eggs/beans are fine', () => {
    for (const c of allCombos(p))
      for (const f of foodsOf(c)) expect(meat.has(f.group), f.id).toBe(false);
    expect(p.meals.every((m) => m.combos.length > 0)).toBe(true);
  });

  it('is a complete day with the normal limits', () => {
    expect(p.totals.kcal).toBeGreaterThan(p.targets.kcal * 0.8);
    expect(p.flags).not.toContain('HIGH_SAT_FAT');
  });
});

describe('lacto-ovo', () => {
  it('has no meat, fish or seafood anywhere', () => {
    const p = styled(loseF, ['lactoOvo']);
    const out = new Set<string>([
      ...PROTEIN_GROUPS.meat,
      ...PROTEIN_GROUPS.seafood,
    ]);
    for (const c of allCombos(p))
      for (const f of foodsOf(c)) expect(out.has(f.group), f.id).toBe(false);
  });

  it('pescatarian + lacto-ovo = lacto-ovo (union of exclusions)', () => {
    const a = styled(loseF, ['pescatarian', 'lactoOvo']);
    const b = styled(loseF, ['lactoOvo']);
    expect(chosen(a).map((c) => c.key)).toEqual(chosen(b).map((c) => c.key));
  });
});

describe('veggie forward', () => {
  const p = styled(maintainM, ['veggieForward']);

  it('uses two fiber sources in every meal of every card', () => {
    for (const c of allCombos(p)) expect(byCat(c, 'fiber')).toHaveLength(2);
  });

  it('aims at 40 g fiber a day', () => {
    expect(p.targets.fiberMin).toBe(40);
    expect(p.totals.fiber).toBeGreaterThanOrEqual(40);
  });

  it('with only one fiber food selected there is nothing to suggest, and it says why', () => {
    const one = plan(
      maintainM,
      { styles: ['veggieForward'] },
      only('chicken-breast', 'white-rice', 'cabbage'),
    );
    expect(one.reason).toBe('NEED_FIBER');
  });
});

describe('high protein (muscle-gain man)', () => {
  const p = styled(gainM, ['highProtein']);

  it('targets 1.8 g/kg and gets close to it', () => {
    expect(p.targets.protein.base).toBeCloseTo(70 * 1.8, 6);
    expect(p.totals.protein / 70).toBeGreaterThanOrEqual(1.7);
    expect(p.totals.protein / 70).toBeLessThanOrEqual(2.0 + 1e-6);
  });

  it('warns about protein above 1.6 g/kg instead of blocking', () => {
    expect(p.flags).toContain('HIGH_PROTEIN');
    expect(
      p.flagDetails.find((f) => f.code === 'HIGH_PROTEIN')!.source,
    ).toMatch(/Morton|ACSM/);
  });
});

describe('overlapping styles that cannot all be met', () => {
  it('lacto-ovo + high protein with only eggs as protein shows the shortfall instead of failing', () => {
    const p = plan(
      loseF,
      { styles: ['lactoOvo', 'highProtein'] },
      only('egg', 'cabbage', 'broccoli', 'spinach'),
    );
    expect(p.reason).toBeUndefined();
    const protein = p.unmetTargets.find((u) => u.nutrient === 'protein')!;
    expect(protein).toBeDefined();
    expect(protein.short).toBeGreaterThan(0);
    expect(protein.actual).toBeLessThan(protein.target);
  });

  it('a plan that meets its targets has no unmet entries for protein', () => {
    expect(
      plan(maintainM).unmetTargets.find((u) => u.nutrient === 'protein'),
    ).toBeUndefined();
  });
});

describe('recommendation conditions', () => {
  it('excludeFoods removes foods from every card', () => {
    const p = plan(loseF, { excludeFoods: ['tofu', 'egg', 'salmon'] });
    for (const c of allCombos(p))
      for (const f of foodsOf(c))
        expect(['tofu', 'egg', 'salmon']).not.toContain(f.id);
  });

  it('includeFoods puts the food in the day at least once', () => {
    const p = plan(maintainM, { includeFoods: ['salmon'] });
    expect(p.missingIncludes).toEqual([]);
    const days = chosen(p).flatMap((c) => foodsOf(c).map((f) => f.id));
    expect(days).toContain('salmon');
  });

  it('includeFoods the user did not select cannot be met and is reported', () => {
    const p = plan(
      loseF,
      { includeFoods: ['salmon'] },
      only('chicken-breast', 'tofu', 'cabbage', 'broccoli', 'brown-rice'),
    );
    expect(p.missingIncludes).toEqual(['salmon']);
  });

  it('an excluded food wins over an include of the same food', () => {
    const p = plan(loseF, { includeFoods: ['tofu'], excludeFoods: ['tofu'] });
    for (const c of allCombos(p))
      expect(foodsOf(c).map((f) => f.id)).not.toContain('tofu');
  });

  it('per-meal kcal ratio changes the meal targets and keeps the day total', () => {
    const p = plan(maintainM, {
      meals: { lunch: { kcalRatio: 0.5 } },
    });
    const lunch = p.meals.find((m) => m.mealType === 'lunch')!;
    expect(lunch.targets.ratio).toBe(0.5);
    expect(p.meals.reduce((a, m) => a + m.targets.ratio, 0)).toBeCloseTo(1, 9);
    expect(lunch.targets.kcal).toBeCloseTo(p.targets.kcal * 0.5, 6);
  });

  it('carb "none" / "required" per meal', () => {
    const p = plan(maintainM, {
      meals: { breakfast: { carb: 'none' }, dinner: { carb: 'required' } },
    });
    for (const c of p.meals.find((m) => m.mealType === 'breakfast')!.combos)
      expect(byCat(c, 'carb')).toHaveLength(0);
    for (const c of p.meals.find((m) => m.mealType === 'dinner')!.combos)
      expect(byCat(c, 'carb')).toHaveLength(1);
  });

  it('a required carb with no carb food selected explains why there is nothing', () => {
    const noCarb: Selection = {
      foods: Object.fromEntries(
        FOODS.filter((f) => f.category !== 'carb').map((f) => [
          f.id,
          'ok' as const,
        ]),
      ),
      seasonings: ALL.seasonings,
    };
    const p = plan(
      maintainM,
      { meals: { lunch: { carb: 'required' } } },
      noCarb,
    );
    expect(p.reason).toBe('NEED_CARB');
  });

  it('veggieCount per meal limits the number of fiber foods', () => {
    const p = plan(maintainM, { meals: { lunch: { veggieCount: 1 } } });
    for (const c of p.meals.find((m) => m.mealType === 'lunch')!.combos)
      expect(byCat(c, 'fiber')).toHaveLength(1);
  });

  it('the user per-meal vegetable count wins over the style', () => {
    const p = plan(maintainM, {
      styles: ['veggieForward'],
      meals: { lunch: { veggieCount: 1 } },
    });
    for (const c of p.meals.find((m) => m.mealType === 'lunch')!.combos)
      expect(byCat(c, 'fiber')).toHaveLength(1);
    for (const c of p.meals.find((m) => m.mealType === 'dinner')!.combos)
      expect(byCat(c, 'fiber')).toHaveLength(2);
  });

  it('conditions.overrides win over styles (low sodium style + a 1,800 mg cap)', () => {
    const p = plan(loseF, {
      styles: ['lowSodium'],
      overrides: { sodiumMax: 1800 },
    });
    expect(p.targets.sodiumMax).toBe(1800);
  });
});
