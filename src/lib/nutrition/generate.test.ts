import { describe, expect, it } from 'vitest';
import type { MealCombo, Selection } from '@/types/nutrition';
import { COMBOS_PER_MEAL } from './constants';
import {
  comboKey,
  comboProteinGroup,
  generateDayPlan,
  generateMealCombos,
  pickDiverse,
  proteinGroupOf,
} from './generate';
import { calcDayTargets, calcMealTargets } from './targets';
import {
  EXAMPLE_PROFILES,
  FOODS,
  LUNCH,
  REF_YEAR,
  SEASONINGS,
  food,
  selectAll,
} from './test-fixtures';

const ALL = selectAll();
const only = (...ids: string[]): Selection => ({
  foods: Object.fromEntries(ids.map((id) => [id, 'ok'])),
  seasonings: ALL.seasonings,
});
const meal = (
  selection: Selection,
  extra: { locked?: string[]; seen?: string[] } = {},
) =>
  generateMealCombos({
    foods: FOODS,
    seasonings: SEASONINGS,
    selection,
    targets: LUNCH,
    ...extra,
  });
const ids = (c: MealCombo) => c.items.map((i) => i.food.id);
const byCat = (c: MealCombo, cat: string) =>
  c.items.filter((i) => i.food.category === cat);

describe('proteinGroupOf', () => {
  it('maps every protein food to a group and no other food', () => {
    expect(
      FOODS.filter((f) => f.category === 'protein' && !proteinGroupOf(f)).map(
        (f) => f.id,
      ),
    ).toEqual([]);
    expect(proteinGroupOf(food('chicken-breast'))).toBe('meat');
    expect(proteinGroupOf(food('squid'))).toBe('seafood');
    expect(proteinGroupOf(food('greek-yogurt'))).toBe('eggBeanDairy');
    expect(proteinGroupOf(food('lentil'))).toBeUndefined();
  });
});

describe('comboKey', () => {
  it('is the sorted food ids, independent of order', () => {
    expect(
      comboKey({
        protein: food('salmon'),
        fibers: [food('kale'), food('broccoli')],
        carb: food('potato'),
      }),
    ).toBe('broccoli+kale+potato+salmon');
  });
});

describe('generateMealCombos', () => {
  const full = meal(ALL);

  it(`returns ${COMBOS_PER_MEAL} combos of protein 1 + carb 0-1 + fiber 1-2 + fat 0-1`, () => {
    expect(full.reason).toBeUndefined();
    expect(full.combos).toHaveLength(COMBOS_PER_MEAL);
    for (const c of full.combos) {
      expect(byCat(c, 'protein')).toHaveLength(1);
      expect(byCat(c, 'carb').length).toBeLessThanOrEqual(1);
      expect(byCat(c, 'fiber').length).toBeGreaterThanOrEqual(1);
      expect(byCat(c, 'fiber').length).toBeLessThanOrEqual(2);
      expect(byCat(c, 'fat').length).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    expect(meal(ALL).combos.map((c) => c.key)).toEqual(
      full.combos.map((c) => c.key),
    );
  });

  it('spreads the top picks over different proteins (MMR)', () => {
    const proteins = new Set(
      full.combos.map((c) => byCat(c, 'protein')[0].food.id),
    );
    expect(proteins.size).toBeGreaterThanOrEqual(4);
  });

  it('keeps totals consistent: kcal by step adds up, gap and warning follow the totals', () => {
    for (const c of full.combos) {
      const sum = Object.values(c.kcalByStep).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(c.totals.kcal, 6);
      expect(c.kcalGap).toBeCloseTo(Math.max(0, LUNCH.kcal - c.totals.kcal), 6);
      expect(c.kcalWarning).toBe(c.totals.kcal < LUNCH.kcal * 0.8);
    }
  });

  it('works with the minimum selection: one protein and one vegetable, nothing else', () => {
    const r = meal(only('chicken-breast', 'cabbage'));
    expect(r.combos).toHaveLength(1);
    expect(ids(r.combos[0])).toEqual(['chicken-breast', 'cabbage']);
  });

  it('never adds a carb when no carb is selected', () => {
    const sel = {
      ...ALL,
      foods: Object.fromEntries(
        FOODS.filter((f) => f.category !== 'carb').map((f) => [
          f.id,
          'ok' as const,
        ]),
      ),
    };
    const r = meal(sel);
    expect(r.combos.length).toBeGreaterThan(0);
    for (const c of r.combos) expect(byCat(c, 'carb')).toEqual([]);
  });

  it('explains why nothing can be made', () => {
    expect(meal(only('cabbage', 'white-rice')).reason).toBe('NEED_PROTEIN');
    expect(meal(only('chicken-breast', 'white-rice')).reason).toBe(
      'NEED_FIBER',
    );
    expect(
      meal(only('chicken-breast', 'cabbage'), {
        seen: ['cabbage+chicken-breast'],
      }).reason,
    ).toBe('NO_MATCH');
  });

  it('keeps locked foods in every combo', () => {
    const r = meal(ALL, { locked: ['salmon', 'broccoli'] });
    expect(r.combos.length).toBeGreaterThan(0);
    for (const c of r.combos)
      expect(ids(c)).toEqual(expect.arrayContaining(['salmon', 'broccoli']));
  });

  it('excludes combos already seen ("다시 추천")', () => {
    const seen = full.combos.map((c) => c.key);
    const again = meal(ALL, { seen });
    expect(again.combos).toHaveLength(COMBOS_PER_MEAL);
    expect(again.combos.filter((c) => seen.includes(c.key))).toEqual([]);
  });

  it('a favorite protein shows up in the top picks', () => {
    // Pick a protein that is not among the unfavored top picks, then favor it.
    const base = meal(ALL).combos;
    const used = new Set(base.flatMap((c) => ids(c)));
    const candidate = FOODS.find(
      (f) => f.category === 'protein' && !used.has(f.id),
    )!;
    const fav = {
      ...ALL,
      foods: { ...ALL.foods, [candidate.id]: 'favorite' as const },
    };
    expect(base.some((c) => ids(c).includes(candidate.id))).toBe(false);
    expect(meal(fav).combos.some((c) => ids(c).includes(candidate.id))).toBe(
      true,
    );
  });

  it('runs one meal with everything selected in under a second', () => {
    const start = performance.now();
    meal(ALL);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('pickDiverse', () => {
  const fake = (key: string, protein: string, total: number): MealCombo =>
    ({
      key,
      items: [{ food: { ...food('chicken-breast'), id: protein }, grams: 100 }],
      score: { total },
    }) as unknown as MealCombo;

  it('prefers a slightly worse combo with a different protein over a repeat', () => {
    const picked = pickDiverse(
      [fake('a1', 'a', 0.1), fake('a2', 'a', 0.11), fake('b1', 'b', 0.2)],
      2,
    );
    expect(picked.map((c) => c.key)).toEqual(['a1', 'b1']);
  });

  it('still repeats when the alternative is much worse', () => {
    const picked = pickDiverse(
      [fake('a1', 'a', 0.1), fake('a2', 'a', 0.11), fake('b1', 'b', 2)],
      2,
    );
    expect(picked.map((c) => c.key)).toEqual(['a1', 'a2']);
  });
});

describe('generateDayPlan', () => {
  const examplePlans = EXAMPLE_PROFILES.map(({ profile: p }) =>
    generateDayPlan({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: ALL,
      profile: p,
      refYear: REF_YEAR,
    }),
  );
  const { profile } = EXAMPLE_PROFILES[1];
  const plan = examplePlans[1];

  it('puts a different protein group in each meal (meat / seafood / egg·bean·dairy)', () => {
    expect(plan.meals.map((m) => m.mealType)).toEqual([
      'breakfast',
      'lunch',
      'dinner',
    ]);
    const groups = plan.meals.map((m) => comboProteinGroup(m.combos[0]));
    expect(new Set(groups).size).toBe(3);
    for (const m of plan.meals)
      expect(m.combos.length).toBeLessThanOrEqual(COMBOS_PER_MEAL);
  });

  it('repeats no food across the day (protein, carb, vegetables, fat source) when the selection allows', () => {
    for (const day of examplePlans) {
      const foods = day.meals.flatMap((m) => ids(m.combos[0]));
      expect(foods.length).toBe(new Set(foods).size);
    }
  });

  it('keeps day total carbs between 100 g and the 45% cap + 2 g', () => {
    for (const day of examplePlans) {
      expect(day.totals.carbs).toBeLessThanOrEqual(
        day.targets.totalCarbMax + 2,
      );
      expect(day.totals.carbs).toBeGreaterThanOrEqual(day.targets.totalCarbMin);
    }
  });

  it('repeats a vegetable only when too few are selected', () => {
    const day = generateDayPlan({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: only('chicken-breast', 'salmon', 'tofu', 'cabbage'),
      profile,
      refYear: REF_YEAR,
    });
    expect(day.meals.every((m) => ids(m.combos[0]).includes('cabbage'))).toBe(
      true,
    );
  });

  it('spreads over the groups the user selected and repeats a group only when it must', () => {
    const sel = only(
      'chicken-breast',
      'beef-round',
      'salmon',
      'cabbage',
      'broccoli',
      'spinach',
    );
    const two = generateDayPlan({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: sel,
      profile,
      refYear: REF_YEAR,
    });
    const groups = two.meals.map((m) => comboProteinGroup(m.combos[0]));
    expect(new Set(groups)).toEqual(new Set(['meat', 'seafood']));
    const proteins = two.meals.map(
      (m) => byCat(m.combos[0], 'protein')[0].food.id,
    );
    expect(new Set(proteins).size).toBe(3);
  });

  it('uses the calculated meal targets and sums the chosen combos', () => {
    const day = calcDayTargets(profile, REF_YEAR).targets;
    expect(plan.meals.map((m) => m.targets)).toEqual(calcMealTargets(day, 3));
    expect(plan.totals.kcal).toBeCloseTo(
      plan.meals.reduce((a, m) => a + m.combos[0].totals.kcal, 0),
      6,
    );
  });

  it('default diet stays within the official limits: fat <= 35%, saturated fat < 10%, cholesterol <= 300 mg', () => {
    for (const day of examplePlans) {
      const sat = (day.totals.satFat * 9) / day.totals.kcal;
      const fat = (day.totals.fat * 9) / day.totals.kcal;
      expect(fat).toBeLessThanOrEqual(0.35 + 1e-9);
      expect(sat).toBeLessThan(0.1);
      expect(day.totals.cholesterol).toBeLessThanOrEqual(300);
    }
  });

  it('default diet raises no flag except HIGH_PROTEIN', () => {
    for (const day of examplePlans)
      expect(day.flags.filter((f) => f !== 'HIGH_PROTEIN')).toEqual([]);
  });

  it('keeps day sodium within the 2,000 mg cap, without chasing a minimum, and never raises LOW_SODIUM from intake', () => {
    for (const day of examplePlans) {
      expect(day.totals.sodium).toBeLessThanOrEqual(2000);
      expect(day.flags).not.toContain('LOW_SODIUM');
    }
  });

  it('lists micronutrients below the KDRI value as shortfalls', () => {
    for (const day of examplePlans) {
      for (const s of day.shortfalls) {
        expect(s.amount).toBeLessThan(s.reference);
        expect(s.ratio).toBeCloseTo(s.amount / s.reference, 9);
        expect(s.hardFromFood).toBe(s.nutrient === 'vitaminD');
      }
      const listed = new Set(day.shortfalls.map((s) => s.nutrient));
      for (const k of Object.keys(day.micros) as (keyof typeof day.micros)[])
        expect(listed.has(k)).toBe(day.micros[k] < day.targets.micros[k]);
    }
  });

  it('flags HIGH_SAT_FAT when only fatty foods are selected', () => {
    const day = generateDayPlan({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: only(
        'greek-yogurt',
        'beef-tenderloin',
        'mackerel',
        'cabbage',
        'kale',
        'spinach',
      ),
      profile,
      refYear: REF_YEAR,
    });
    const sat = (day.totals.satFat * 9) / day.totals.kcal;
    expect(sat).toBeGreaterThanOrEqual(0.1);
    expect(day.flags).toContain('HIGH_SAT_FAT');
    expect(day.flags).not.toContain('HIGH_FAT_MOSTLY_UNSAT');
  });

  it('flags HIGH_PROTEIN when the planned protein goes above 1.6 g/kg', () => {
    expect(plan.flags.includes('HIGH_PROTEIN')).toBe(
      plan.totals.protein > profile.weightKg * 1.6,
    );
  });

  it('allows the same protein when only one is selected', () => {
    const one = generateDayPlan({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: only('chicken-breast', 'cabbage', 'broccoli', 'spinach'),
      profile,
      refYear: REF_YEAR,
    });
    expect(
      one.meals.every(
        (m) => byCat(m.combos[0], 'protein')[0].food.id === 'chicken-breast',
      ),
    ).toBe(true);
  });

  it('passes the failure reason through', () => {
    const none = generateDayPlan({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: only('cabbage'),
      profile,
      refYear: REF_YEAR,
    });
    expect(none.reason).toBe('NEED_PROTEIN');
    expect(none.meals.every((m) => m.combos.length === 0)).toBe(true);
  });
});
