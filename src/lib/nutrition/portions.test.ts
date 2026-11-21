import { describe, expect, it } from 'vitest';
import type { Food } from '@/types/food';
import type { ComboFoods, MealTargets, PortionResult } from '@/types/nutrition';
import { calcPortions, netCarbs, nutrientsOf } from './portions';
import { KCAL_FILL_ORDER_LOW_CARB } from './constants';
import { LUNCH, food, makeFood, seasoning } from './test-fixtures';

const grams = (r: PortionResult, id: string) =>
  r.items.find((i) => i.food.id === id)?.grams;

function solve(
  combo: ComboFoods,
  t: MealTargets = LUNCH,
  oilIds: string[] = [],
): PortionResult {
  const r = calcPortions(combo, t, oilIds.map(seasoning));
  if (!r) throw new Error('combo rejected');
  return r;
}

function onStep(f: Food, g: number) {
  return (
    g >= f.portion.min &&
    g <= f.portion.max &&
    (g - f.portion.min) % f.portion.step === 0
  );
}

describe('netCarbs', () => {
  it('is carbs - fiber, and 0 when fiber > carbs', () => {
    expect(netCarbs(food('sweet-potato').per100g)).toBeCloseTo(39.4 - 3.8, 6);
    const odd = makeFood({
      id: 'odd',
      category: 'fiber',
      per100g: {
        kcal: 20,
        protein: 1,
        carbs: 2,
        fiber: 3,
        fat: 0,
        satFat: 0,
        sodium: 0,
        cholesterol: 0,
      },
    });
    expect(netCarbs(odd.per100g)).toBe(0);
    expect(nutrientsOf(odd, 200).netCarbs).toBe(0);
  });
});

describe('calcPortions: minimal selection (protein 1 + fiber 1, no carb, no fat)', () => {
  // chicken 23 g protein/100 g, cabbage 2.5 g fiber/100 g. Fiber 10.5 needed -> cabbage to its max 200 g.
  // Step 1: (33.6 - 2.8) / 0.23 = 133.9 -> 130 g. Step 4 raises chicken while protein <= 42 -> 170 g.
  const r = solve({
    protein: food('chicken-breast'),
    fibers: [food('cabbage')],
  });

  it('fills fiber by raising the vegetable to its max', () => {
    expect(grams(r, 'cabbage')).toBe(200);
  });

  it('raises protein to the 2.0 g/kg meal share when kcal is short (step 4)', () => {
    expect(grams(r, 'chicken-breast')).toBe(170);
    expect(r.totals.protein).toBeLessThanOrEqual(LUNCH.protein.max);
    expect(r.kcalByStep.proteinBase).toBeCloseTo(130 * 1.06, 6);
    expect(r.kcalByStep.proteinToMax).toBeCloseTo(40 * 1.06, 6);
  });

  it('has no carb, fat or oil kcal and reports the remaining gap through totals', () => {
    expect(r.kcalByStep.carbsToLimit).toBe(0);
    expect(r.kcalByStep.fatToStage1).toBe(0);
    expect(r.kcalByStep.fatToStage2).toBe(0);
    expect(r.oils).toEqual([]);
    expect(r.totals.kcal).toBeLessThan(LUNCH.kcal);
  });

  it('kcal by step adds up to the total', () => {
    const sum = Object.values(r.kcalByStep).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(r.totals.kcal, 6);
  });
});

describe('calcPortions: steps and limits', () => {
  it('fills carbs up to the net-carb limit (within half a step)', () => {
    const t = { ...LUNCH, netCarbMax: 50 };
    const r = solve(
      {
        protein: food('chicken-breast'),
        carb: food('white-rice'),
        fibers: [food('broccoli')],
      },
      t,
    );
    const rice = food('white-rice');
    const halfStepNc = (netCarbs(rice.per100g) * rice.portion.step) / 100 / 2;
    expect(Math.abs(r.totals.netCarbs - 50)).toBeLessThanOrEqual(
      halfStepNc + 1e-9,
    );
  });

  it('uses the carb minimum when nothing is left in the net-carb budget', () => {
    const t = { ...LUNCH, netCarbMax: 1 };
    const r = solve(
      {
        protein: food('chicken-breast'),
        carb: food('sweet-potato'),
        fibers: [food('cabbage')],
      },
      t,
    );
    expect(grams(r, 'sweet-potato')).toBe(food('sweet-potato').portion.min);
  });

  it('keeps every portion on its own step grid within min/max (step 50 foods included)', () => {
    // Roomy fat caps so the fatty proteins (egg, Greek yogurt) can still take a fat source.
    const t: MealTargets = {
      ...LUNCH,
      kcal: 800,
      fat: { stage1: 35, stage2: 40, stage3: 45 },
    };
    for (const p of ['egg', 'tofu', 'greek-yogurt', 'chicken-breast']) {
      const r = solve(
        {
          protein: food(p),
          carb: food('oats'),
          fibers: [food('spinach'), food('perilla-leaf')],
          fat: food('almond'),
        },
        t,
        ['olive-oil'],
      );
      for (const it of r.items)
        expect(onStep(it.food, it.grams), `${it.food.id} ${it.grams}`).toBe(
          true,
        );
    }
  });

  it('starts vegetables at 100 g (or their max) and never lowers them', () => {
    const r = solve({
      protein: food('chicken-breast'),
      carb: food('chickpea'),
      fibers: [food('broccoli'), food('perilla-leaf')],
    });
    expect(grams(r, 'perilla-leaf')).toBe(60);
    expect(grams(r, 'broccoli')).toBeGreaterThanOrEqual(100);
  });

  it('never goes above the portion max even with a huge target', () => {
    const t: MealTargets = {
      ...LUNCH,
      kcal: 3000,
      protein: { base: 150, max: 200 },
      // Fat caps are shares of the kcal eaten; make them roomy so only portion.max binds.
      fat: { stage1: 300, stage2: 300, stage3: 300 },
    };
    const r = solve(
      {
        protein: food('chicken-breast'),
        fibers: [food('cabbage')],
        fat: food('walnut'),
      },
      t,
      ['olive-oil'],
    );
    expect(grams(r, 'chicken-breast')).toBe(250);
    expect(grams(r, 'walnut')).toBe(30);
    expect(r.oils).toEqual([{ seasoning: seasoning('olive-oil'), units: 2 }]);
  });
});

describe('calcPortions: other foods reduce the meat', () => {
  const base = (r: PortionResult) => r.kcalByStep.proteinBase;

  it('lentils and chickpeas lower the base chicken amount', () => {
    const plain = solve({
      protein: food('chicken-breast'),
      fibers: [food('cabbage')],
    });
    const lentil = solve({
      protein: food('chicken-breast'),
      carb: food('lentil'),
      fibers: [food('cabbage')],
    });
    const chickpea = solve({
      protein: food('chicken-breast'),
      carb: food('chickpea'),
      fibers: [food('cabbage')],
    });
    expect(base(lentil)).toBeLessThan(base(plain));
    expect(base(chickpea)).toBeLessThan(base(plain));
    expect(grams(lentil, 'chicken-breast')!).toBeLessThan(
      grams(plain, 'chicken-breast')!,
    );
  });

  it('a nut fat source lowers the base chicken amount too', () => {
    const plain = solve({
      protein: food('chicken-breast'),
      fibers: [food('cabbage')],
    });
    const nuts = solve({
      protein: food('chicken-breast'),
      fibers: [food('cabbage')],
      fat: food('pumpkin-seed'),
    });
    expect(base(nuts)).toBeLessThan(base(plain));
  });

  it('counts fiber from carbs and fat sources, so vegetables grow less', () => {
    // Low fiber target so broccoli does not hit its max in both cases.
    const t = { ...LUNCH, fiberMin: 5 };
    const plain = solve(
      { protein: food('chicken-breast'), fibers: [food('broccoli')] },
      t,
    );
    const withChia = solve(
      {
        protein: food('chicken-breast'),
        fibers: [food('broccoli')],
        fat: food('chia'),
      },
      t,
    );
    expect(grams(withChia, 'broccoli')!).toBeLessThan(
      grams(plain, 'broccoli')!,
    );
  });
});

describe('calcPortions: fat fill (steps 3 and 5)', () => {
  const combo = {
    protein: food('chicken-breast'),
    carb: food('brown-rice'),
    fibers: [food('broccoli')],
    fat: food('almond'),
  };

  it('never exceeds the meal kcal target or the 35% fat cap', () => {
    const r = solve(combo, LUNCH, ['olive-oil']);
    expect(r.totals.kcal).toBeLessThanOrEqual(LUNCH.kcal);
    expect(r.totals.fat).toBeLessThanOrEqual(LUNCH.fat.stage2);
  });

  it('adds nothing in steps 5 and 6 when all fat stages are equal', () => {
    const t = { ...LUNCH, fat: { stage1: 20, stage2: 20, stage3: 20 } };
    const r = solve(combo, t, ['olive-oil']);
    expect(r.kcalByStep.fatToStage2).toBe(0);
    expect(r.kcalByStep.fatToStage3).toBe(0);
    expect(r.totals.fat).toBeLessThanOrEqual(20);
  });

  it('uses one kind of oil, the first one given, within its max units', () => {
    const r = solve(
      { protein: food('cod'), fibers: [food('cabbage')] },
      LUNCH,
      ['perilla-oil', 'olive-oil'],
    );
    expect(r.oils.map((o) => o.seasoning.id)).toEqual(['perilla-oil']);
    expect(r.oils[0].units).toBeLessThanOrEqual(
      seasoning('perilla-oil').maxUnitsPerMeal,
    );
    expect(r.kcalByStep.fatToStage1).toBeGreaterThan(0);
  });

  it('rejects a combo whose fat source does not fit at its minimum portion', () => {
    // mackerel ~160 g already carries ~24 g fat > stage 1 (17.8 g)
    expect(
      calcPortions(
        {
          protein: food('mackerel'),
          fibers: [food('cabbage')],
          fat: food('avocado'),
        },
        LUNCH,
        [],
      ),
    ).toBeNull();
  });

  it('kcal by step adds up to the total with every step in use', () => {
    const r = solve(combo, { ...LUNCH, kcal: 900 }, ['olive-oil']);
    const sum = Object.values(r.kcalByStep).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(r.totals.kcal, 6);
    expect(r.totals.fiber).toBeCloseTo(
      r.items.reduce((a, i) => a + (i.food.per100g.fiber * i.grams) / 100, 0),
      6,
    );
  });
});

describe('calcPortions: default-diet steps 5-6 and extra totals', () => {
  it('keeps fat within 35% of the kcal actually eaten (no 45% step in the default diet)', () => {
    // Protein is capped, so only fat or carbs could add kcal; fat must stop at 35% of what is eaten.
    const t: MealTargets = {
      ...LUNCH,
      kcal: 700,
      protein: { base: 30, max: 30 },
      fat: { stage1: 23, stage2: 27, stage3: 27 },
    };
    const r = solve(
      { protein: food('cod'), fibers: [food('cabbage')], fat: food('walnut') },
      t,
      ['olive-oil'],
    );
    expect(r.kcalByStep.fatToStage3).toBe(0);
    expect((r.totals.fat * 9) / r.totals.kcal).toBeLessThanOrEqual(0.35 + 1e-9);
  });

  // Protein headroom (cap 80 g) so legumes, which carry protein, can still be added in step 6.
  const roomy: MealTargets = {
    ...LUNCH,
    kcal: 900,
    protein: { base: 30, max: 80 },
    fat: { stage1: 10, stage2: 10, stage3: 10 },
    netCarbMax: 15, // small base ratio so step 6 has room to add
    totalCarbMax: 101.25, // 45% of the 900 kcal target
  };

  it('step 6 grows a whole grain or legume while total carbs stay within 45% of the kcal eaten', () => {
    for (const c of ['brown-rice', 'lentil']) {
      const r = solve(
        { protein: food('cod'), carb: food(c), fibers: [food('cabbage')] },
        roomy,
      );
      expect(r.kcalByStep.carbsTopUp, c).toBeGreaterThan(0);
      expect((r.totals.carbs * 4) / r.totals.kcal, c).toBeLessThanOrEqual(
        0.45 + 1e-9,
      );
    }
  });

  it('the carb cap follows the kcal eaten, not the target: more kcal from other steps leave more carb room', () => {
    const lean = solve(
      {
        protein: food('cod'),
        carb: food('brown-rice'),
        fibers: [food('cabbage')],
      },
      roomy,
    );
    const withFat = solve(
      {
        protein: food('cod'),
        carb: food('brown-rice'),
        fibers: [food('cabbage')],
        fat: food('almond'),
      },
      roomy,
      ['olive-oil'],
    );
    expect(withFat.totals.kcal).toBeGreaterThan(lean.totals.kcal);
    expect(grams(withFat, 'brown-rice')!).toBeGreaterThan(
      grams(lean, 'brown-rice')!,
    );
  });

  it('step 6 never grows refined carbs (white rice, potato)', () => {
    for (const c of ['white-rice', 'potato']) {
      const r = solve(
        { protein: food('cod'), carb: food(c), fibers: [food('cabbage')] },
        roomy,
      );
      expect(r.kcalByStep.carbsTopUp, c).toBe(0);
    }
  });

  it('steps 5-6 add no protein-carrying food once protein is at the goal cap', () => {
    // Protein cap = base, so step 4 adds nothing and protein sits at the cap after the base step.
    const t: MealTargets = {
      ...LUNCH,
      kcal: 900,
      protein: { base: 30, max: 30 },
      totalCarbMax: 120,
    };
    const r = solve(
      {
        protein: food('chicken-breast'),
        carb: food('lentil'),
        fibers: [food('cabbage')],
        fat: food('pumpkin-seed'),
      },
      t,
    );
    expect(r.kcalByStep.carbsTopUp).toBe(0);
    expect(grams(r, 'pumpkin-seed')).toBe(food('pumpkin-seed').portion.min);
    expect(r.totals.kcal).toBeLessThan(t.kcal);
  });

  it('step 6 is skipped when the user set net carbs (carbTopUp false)', () => {
    const r = solve(
      {
        protein: food('cod'),
        carb: food('brown-rice'),
        fibers: [food('cabbage')],
      },
      { ...roomy, carbTopUp: false },
    );
    expect(r.kcalByStep.carbsTopUp).toBe(0);
  });

  it('counts total carbs and cholesterol', () => {
    const r = solve(
      { protein: food('egg'), carb: food('oats'), fibers: [food('spinach')] },
      LUNCH,
    );
    const sum = (k: 'carbs' | 'cholesterol') =>
      r.items.reduce((a, i) => a + (i.food.per100g[k] * i.grams) / 100, 0);
    expect(r.totals.carbs).toBeCloseTo(sum('carbs'), 9);
    expect(r.totals.cholesterol).toBeCloseTo(sum('cholesterol'), 9);
    expect(grams(r, 'egg')).toBeLessThanOrEqual(100); // max 2 eggs per meal
  });

  it('counts saturated fat from foods and oils', () => {
    const r = solve(
      { protein: food('beef-tenderloin'), fibers: [food('cabbage')] },
      LUNCH,
      ['olive-oil'],
    );
    const expected =
      r.items.reduce((a, i) => a + (i.food.per100g.satFat * i.grams) / 100, 0) +
      r.oils.reduce(
        (a, o) => a + (o.seasoning.perUnit.satFat ?? 0) * o.units,
        0,
      );
    expect(r.totals.satFat).toBeCloseTo(expected, 9);
    expect(r.totals.satFat).toBeGreaterThan(0);
  });
});

describe('calcPortions: style rules on the targets', () => {
  const combo = {
    protein: food('cod'),
    fibers: [food('cabbage')],
    fat: food('walnut'),
  };

  it('vegetables start at rules.veggieStartG (150 g) instead of 100 g', () => {
    const t: MealTargets = {
      ...LUNCH,
      fiberMin: 1, // no growth needed, so the start amount stays visible
      rules: { ...LUNCH.rules, veggieStartG: 150 },
    };
    expect(grams(solve({ ...combo, fat: undefined }, t), 'cabbage')).toBe(150);
    expect(
      grams(
        solve({ ...combo, fat: undefined }, { ...t, rules: LUNCH.rules }),
        'cabbage',
      ),
    ).toBe(100);
  });

  it('a vegetable start above its portion max is cut to the max', () => {
    const t: MealTargets = {
      ...LUNCH,
      fiberMin: 1,
      rules: { ...LUNCH.rules, veggieStartG: 500 },
    };
    expect(grams(solve({ ...combo, fat: undefined }, t), 'cabbage')).toBe(
      food('cabbage').portion.max,
    );
  });

  it('the low-carb fill order adds unsaturated fat beyond 35% (step "fatToStage3"), the default order does not', () => {
    const base: MealTargets = {
      ...LUNCH,
      kcal: 700,
      protein: { base: 30, max: 30 },
      fat: { stage1: 23, stage2: 27, stage3: 35 }, // 30% / 35% / 45% of 700 kcal
    };
    const low = solve(
      combo,
      {
        ...base,
        rules: { ...base.rules, fillOrder: KCAL_FILL_ORDER_LOW_CARB },
      },
      ['olive-oil'],
    );
    const normal = solve(combo, { ...base, fat: { ...base.fat, stage3: 27 } }, [
      'olive-oil',
    ]);
    expect(low.kcalByStep.fatToStage3).toBeGreaterThan(0);
    expect(normal.kcalByStep.fatToStage3).toBe(0);
    expect((low.totals.fat * 9) / low.totals.kcal).toBeLessThanOrEqual(
      0.45 + 1e-9,
    );
    expect(low.totals.fat).toBeGreaterThan(normal.totals.fat);
  });

  it('the low-carb fill order never tops up carbs', () => {
    const t: MealTargets = {
      ...LUNCH,
      kcal: 900,
      protein: { base: 30, max: 80 },
      netCarbMax: 15,
      totalCarbMax: 101.25,
      rules: { ...LUNCH.rules, fillOrder: KCAL_FILL_ORDER_LOW_CARB },
    };
    const r = solve(
      {
        protein: food('cod'),
        carb: food('brown-rice'),
        fibers: [food('cabbage')],
      },
      t,
    );
    expect(r.kcalByStep.carbsTopUp).toBe(0);
  });
});
