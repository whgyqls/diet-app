// Combo -> grams per food, following the kcal fill order (PLAN.md 4.2, 5-2). Pure functions.
import type { Food, Per100g, Seasoning } from '@/types/food';
import type {
  ComboFoods,
  MealTargets,
  NutrientTotals,
  PortionResult,
  SeasoningUse,
} from '@/types/nutrition';
import {
  CARB_TOPUP_FOOD_IDS,
  KCAL_FILL_ORDER,
  KCAL_PER_GRAM,
  MAX_OIL_KINDS_PER_MEAL,
  PORTION_SOLVER_MAX_ITER,
  VEGGIE_DEFAULT_G,
} from './constants';
import { carbCapGrams } from './scoring';

export const ZERO_TOTALS: NutrientTotals = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  netCarbs: 0,
  fiber: 0,
  fat: 0,
  satFat: 0,
  sodium: 0,
  cholesterol: 0,
};

/** Net carbs per 100 g; negative (fiber > carbs) counts as 0. */
export function netCarbs(p: Per100g): number {
  return Math.max(0, p.carbs - p.fiber);
}

export function nutrientsOf(food: Food, grams: number): NutrientTotals {
  const k = grams / 100;
  const p = food.per100g;
  return {
    kcal: p.kcal * k,
    protein: p.protein * k,
    carbs: p.carbs * k,
    netCarbs: netCarbs(p) * k,
    fiber: p.fiber * k,
    fat: p.fat * k,
    satFat: p.satFat * k,
    sodium: p.sodium * k,
    cholesterol: p.cholesterol * k,
  };
}

/** Oils carry no fat field in the data; they are pure fat, so fat = kcal / 9. */
export function seasoningNutrients(
  s: Seasoning,
  units: number,
): NutrientTotals {
  return {
    kcal: s.perUnit.kcal * units,
    protein: 0,
    carbs: s.perUnit.carbs * units,
    netCarbs: s.perUnit.carbs * units,
    fiber: 0,
    fat: s.oil ? (s.perUnit.kcal * units) / KCAL_PER_GRAM.fat : 0,
    satFat: (s.perUnit.satFat ?? 0) * units,
    sodium: s.perUnit.sodium * units,
    cholesterol: 0,
  };
}

export function addTotals(
  a: NutrientTotals,
  b: NutrientTotals,
): NutrientTotals {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    netCarbs: a.netCarbs + b.netCarbs,
    fiber: a.fiber + b.fiber,
    fat: a.fat + b.fat,
    satFat: a.satFat + b.satFat,
    sodium: a.sodium + b.sodium,
    cholesterol: a.cholesterol + b.cholesterol,
  };
}

function clampPortion(food: Food, g: number): number {
  return Math.min(food.portion.max, Math.max(food.portion.min, g));
}

/** Grams needed for `amount` of a nutrient with `per100` per 100 g, rounded to the food's step and clamped. */
function portionFor(food: Food, amount: number, per100: number): number {
  if (per100 <= 0 || !Number.isFinite(amount)) return food.portion.min;
  const { step } = food.portion;
  return clampPortion(
    food,
    Math.round(((amount / per100) * 100) / step) * step,
  );
}

type Grams = Map<Food, number>;
type Field = keyof NutrientTotals;

function per100(f: Food, field: Field): number {
  return field === 'netCarbs' ? netCarbs(f.per100g) : f.per100g[field];
}

/** One nutrient summed over the foods (and oil), skipping `skip`. Allocation-free: this runs ~1M times per meal. */
function sumOf(
  g: Grams,
  field: Field,
  oil?: SeasoningUse,
  skip?: Food,
): number {
  let s = 0;
  for (const [f, grams] of g)
    if (f !== skip) s += (per100(f, field) * grams) / 100;
  if (oil && oil.units > 0)
    s += seasoningNutrients(oil.seasoning, oil.units)[field];
  return s;
}

function totalsOf(g: Grams, oil?: SeasoningUse): NutrientTotals {
  let t = ZERO_TOTALS;
  for (const [f, grams] of g) t = addTotals(t, nutrientsOf(f, grams));
  if (oil && oil.units > 0)
    t = addTotals(t, seasoningNutrients(oil.seasoning, oil.units));
  return t;
}

/** Steps 1-2 with vegetables: protein, carbs and vegetables depend on each other, so iterate to a fixed point. */
function solveBase(combo: ComboFoods, t: MealTargets, g: Grams): void {
  const { protein, carb, fibers, fat } = combo;
  for (const v of fibers) g.set(v, clampPortion(v, VEGGIE_DEFAULT_G));
  if (fat) g.set(fat, fat.portion.min);
  if (carb) g.set(carb, carb.portion.min);
  g.set(protein, protein.portion.min);
  const byDensity =
    fibers.length > 1
      ? [...fibers].sort(
          (a, b) =>
            b.per100g.fiber - a.per100g.fiber || a.id.localeCompare(b.id),
        )
      : fibers;

  for (let iter = 0; iter < PORTION_SOLVER_MAX_ITER; iter++) {
    const before = [...g.values()];

    if (carb) {
      g.set(
        carb,
        portionFor(
          carb,
          t.netCarbMax - sumOf(g, 'netCarbs', undefined, carb),
          netCarbs(carb.per100g),
        ),
      );
    }
    g.set(
      protein,
      portionFor(
        protein,
        t.protein.base - sumOf(g, 'protein', undefined, protein),
        protein.per100g.protein,
      ),
    );

    // Vegetables: reset to default, then grow the most fiber-dense one first until fiber is met.
    for (const v of fibers) g.set(v, clampPortion(v, VEGGIE_DEFAULT_G));
    let fiber = sumOf(g, 'fiber');
    for (const v of byDensity) {
      const perStep = (v.per100g.fiber * v.portion.step) / 100;
      let grams = g.get(v)!;
      while (fiber < t.fiberMin && grams + v.portion.step <= v.portion.max) {
        grams += v.portion.step;
        fiber += perStep;
      }
      g.set(v, grams);
    }

    const after = [...g.values()];
    if (after.every((x, i) => x === before[i])) break;
  }
}

/**
 * Fat steps: grow the fat source, then one oil, while kcal <= target and fat stays within the cap's share
 * of the kcal actually eaten (cap share = fatCap / target kcal), so a meal short of kcal is not fat-heavy.
 */
function fillFat(
  combo: ComboFoods,
  t: MealTargets,
  g: Grams,
  oil: SeasoningUse | undefined,
  fatCap: number,
): void {
  const f = combo.fat;
  const dF = f ? nutrientsOf(f, f.portion.step) : undefined;
  const dOil = oil ? seasoningNutrients(oil.seasoning, 1) : undefined;
  const capShare = (fatCap * KCAL_PER_GRAM.fat) / t.kcal;
  // Later steps must not push protein past the goal's cap that step 4 filled to (nuts carry protein).
  const proteinCap = Math.max(t.protein.max, sumOf(g, 'protein', oil));
  const fits = (d: NutrientTotals) => {
    const kcal = sumOf(g, 'kcal', oil) + d.kcal;
    const fat = sumOf(g, 'fat', oil) + d.fat;
    return (
      kcal <= t.kcal &&
      fat * KCAL_PER_GRAM.fat <= capShare * kcal &&
      sumOf(g, 'protein', oil) + d.protein <= proteinCap
    );
  };
  for (;;) {
    if (f && dF && g.get(f)! + f.portion.step <= f.portion.max && fits(dF)) {
      g.set(f, g.get(f)! + f.portion.step);
      continue;
    }
    if (
      oil &&
      dOil &&
      oil.units < oil.seasoning.maxUnitsPerMeal &&
      fits(dOil)
    ) {
      oil.units += 1;
      continue;
    }
    return;
  }
}

/** Step 4: raise the protein food while protein <= max share and kcal <= target. */
function fillProtein(
  combo: ComboFoods,
  t: MealTargets,
  g: Grams,
  oil: SeasoningUse | undefined,
): void {
  const p = combo.protein;
  const d = nutrientsOf(p, p.portion.step);
  let protein = sumOf(g, 'protein', oil);
  let kcal = sumOf(g, 'kcal', oil);
  let grams = g.get(p)!;
  while (
    grams + p.portion.step <= p.portion.max &&
    protein + d.protein <= t.protein.max &&
    kcal + d.kcal <= t.kcal
  ) {
    grams += p.portion.step;
    protein += d.protein;
    kcal += d.kcal;
  }
  g.set(p, grams);
}

/** Step 6 (default diet): grow a whole-grain/legume carb while total carbs <= the cap and kcal <= target. */
function fillCarbs(
  combo: ComboFoods,
  t: MealTargets,
  g: Grams,
  oil: SeasoningUse | undefined,
): void {
  const c = combo.carb;
  if (!c || !t.carbTopUp || !CARB_TOPUP_FOOD_IDS.includes(c.id)) return;
  const d = nutrientsOf(c, c.portion.step);
  let carbs = sumOf(g, 'carbs', oil);
  let kcal = sumOf(g, 'kcal', oil);
  let protein = sumOf(g, 'protein', oil);
  const proteinCap = Math.max(t.protein.max, protein); // legumes carry protein
  let grams = g.get(c)!;
  // The 45% cap is a share of the kcal actually eaten (like fat), checked with the step added.
  while (
    grams + c.portion.step <= c.portion.max &&
    carbs + d.carbs <= carbCapGrams(t, kcal + d.kcal) &&
    kcal + d.kcal <= t.kcal &&
    protein + d.protein <= proteinCap
  ) {
    grams += c.portion.step;
    carbs += d.carbs;
    kcal += d.kcal;
    protein += d.protein;
  }
  g.set(c, grams);
}

/**
 * Portions for one combo. `oils` = the user's cold-pressed oils in preference order.
 * Returns null when the fat source cannot fit at its minimum portion.
 */
export function calcPortions(
  combo: ComboFoods,
  t: MealTargets,
  oils: Seasoning[],
): PortionResult | null {
  const g: Grams = new Map();
  solveBase(combo, t, g);

  if (
    combo.fat &&
    (sumOf(g, 'fat') > t.fat.stage1 || sumOf(g, 'kcal') > t.kcal)
  )
    return null;

  const kcalOf = (f: Food | undefined) =>
    f ? nutrientsOf(f, g.get(f)!).kcal : 0;
  const proteinBaseKcal = kcalOf(combo.protein);
  const carbKcal = kcalOf(combo.carb);
  const veggieKcal = combo.fibers.reduce((a, v) => a + kcalOf(v), 0);

  const oilKinds = oils.filter((s) => s.oil).slice(0, MAX_OIL_KINDS_PER_MEAL);
  const oil: SeasoningUse | undefined = oilKinds[0]
    ? { seasoning: oilKinds[0], units: 0 }
    : undefined;
  const fatKcal = () =>
    kcalOf(combo.fat) +
    (oil ? seasoningNutrients(oil.seasoning, oil.units).kcal : 0);

  const byStep = {
    fatToStage1: 0,
    proteinToMax: 0,
    fatToStage2: 0,
    fatToStage3: 0,
    carbsTopUp: 0,
  };
  for (const step of KCAL_FILL_ORDER) {
    if (step === 'fatToStage1') {
      fillFat(combo, t, g, oil, t.fat.stage1);
      byStep.fatToStage1 = fatKcal();
    } else if (step === 'proteinToMax') {
      fillProtein(combo, t, g, oil);
      byStep.proteinToMax = kcalOf(combo.protein) - proteinBaseKcal;
    } else if (step === 'fatToStage2') {
      fillFat(combo, t, g, oil, t.fat.stage2);
      byStep.fatToStage2 = fatKcal() - byStep.fatToStage1;
    } else if (step === 'fatToStage3') {
      // Beyond 35% only unsaturated sources: fillFat only ever grows the fat-category food and the oil.
      fillFat(combo, t, g, oil, t.fat.stage3);
      byStep.fatToStage3 = fatKcal() - byStep.fatToStage1 - byStep.fatToStage2;
    } else if (step === 'carbsTopUp') {
      fillCarbs(combo, t, g, oil);
      byStep.carbsTopUp = kcalOf(combo.carb) - carbKcal;
    }
    // proteinBase and carbsToLimit are solved in solveBase; reportGap is the caller's job.
  }

  // Fat caps are shares of the kcal eaten, so the carbs added in the last step leave room for a little more
  // fat. Settle: repeat the last fat step and the carb top-up (same order) until neither adds anything.
  const lastFat = [...KCAL_FILL_ORDER]
    .reverse()
    .find((s) => s === 'fatToStage3' || s === 'fatToStage2');
  if (lastFat && KCAL_FILL_ORDER.includes('carbsTopUp')) {
    const cap = lastFat === 'fatToStage3' ? t.fat.stage3 : t.fat.stage2;
    for (let i = 0; i < PORTION_SOLVER_MAX_ITER; i++) {
      const before = sumOf(g, 'kcal', oil);
      const fatBefore = fatKcal();
      fillFat(combo, t, g, oil, cap);
      byStep[lastFat] += fatKcal() - fatBefore;
      const carbBefore = kcalOf(combo.carb);
      fillCarbs(combo, t, g, oil);
      byStep.carbsTopUp += kcalOf(combo.carb) - carbBefore;
      if (sumOf(g, 'kcal', oil) === before) break;
    }
  }

  const items = [combo.protein, combo.carb, ...combo.fibers, combo.fat]
    .filter((f): f is Food => f !== undefined)
    .map((food) => ({ food, grams: g.get(food)! }));
  const usedOils = oil && oil.units > 0 ? [oil] : [];

  return {
    items,
    oils: usedOils,
    totals: totalsOf(g, oil),
    kcalByStep: {
      proteinBase: proteinBaseKcal,
      carbsToLimit: carbKcal,
      veggies: veggieKcal,
      ...byStep,
    },
  };
}
