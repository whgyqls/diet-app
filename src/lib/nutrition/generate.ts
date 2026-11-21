// Combo generation, scoring, diversity (MMR) and day planning (PLAN.md 5). Pure functions.
import type { Food, Seasoning } from '@/types/food';
import type {
  ComboFoods,
  DayPlan,
  DayTargets,
  GenerateFailReason,
  MealCombo,
  MealOptions,
  MealPlan,
  MealTargets,
  MealType,
  MicroKey,
  NutrientTotals,
  PortionedFood,
  Profile,
  RecommendationConditions,
  Selection,
  TargetOverrides,
  UnmetTarget,
} from '@/types/nutrition';
import {
  CARB_TOLERANCE_G,
  COMBOS_PER_MEAL,
  DAY_PLAN_OPTIONS_PER_GROUP,
  DAY_PLAN_OPTIONS_PER_INCLUDE,
  DAY_PLAN_OPTIONS_PER_MEAL,
  FAVORITE_BONUS,
  FIBER_SETS_PER_MEAL,
  FIBER_SET_REPEAT_PENALTY,
  KCAL_PER_GRAM,
  MEAL_KCAL_WARN_RATIO,
  LOW_CARB_NO_CARB_BONUS,
  MMR_PENALTY,
  MICRO_KEYS,
  MICRO_SHORTFALL_RATIO,
  MICROS_HARD_FROM_FOOD,
  MMR_POOL_SIZE,
  PROTEIN_GROUPS,
  type ProteinGroup,
  SAT_FAT_KCAL_RATIO_MAX,
  SCORE_WEIGHTS,
  UNMET_TARGET_TOLERANCE,
} from './constants';
import {
  ZERO_TOTALS,
  addTotals,
  calcPortions,
  seasoningNutrients,
} from './portions';
import { computeFlags } from './flags';
import { carbCapGrams, scoreCombo } from './scoring';
import { seasoningPlanner } from './seasoning';
import { resolveStyles } from './styles';
import { calcDayTargets, calcMealTargets } from './targets';

export function comboKey(c: ComboFoods): string {
  return [c.protein, c.carb, ...c.fibers, c.fat]
    .filter((f): f is Food => f !== undefined)
    .map((f) => f.id)
    .sort()
    .join('+');
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

/** Selected oils, favorites first. */
function orderedOils(
  seasonings: Seasoning[],
  prefs: Selection['seasonings'],
): Seasoning[] {
  const fav = (s: Seasoning) => (prefs[s.id] === 'favorite' ? 0 : 1);
  return seasonings
    .filter((s) => s.oil && prefs[s.id])
    .sort((a, b) => fav(a) - fav(b) || byId(a, b));
}

/** Per-user seasoning setup shared by every combo of a meal. */
export type ComboContext = {
  selection: Selection;
  oils: Seasoning[];
  suggestSeasonings: ReturnType<typeof seasoningPlanner>;
};

export function comboContext(
  seasonings: Seasoning[],
  selection: Selection,
): ComboContext {
  return {
    selection,
    oils: orderedOils(seasonings, selection.seasonings),
    suggestSeasonings: seasoningPlanner(seasonings, selection.seasonings),
  };
}

/** Portions + seasonings + score for one combo, or null if it cannot be portioned. */
export function buildMealCombo(
  combo: ComboFoods,
  t: MealTargets,
  ctx: ComboContext,
): MealCombo | null {
  const { selection } = ctx;
  const portions = calcPortions(combo, t, ctx.oils);
  if (!portions) return null;
  const seas = ctx.suggestSeasonings(portions.totals.sodium, t);
  const seasTotals = seas.picks.reduce(
    (a, p) => addTotals(a, seasoningNutrients(p.seasoning, p.units)),
    ZERO_TOTALS,
  );
  const totals = addTotals(portions.totals, seasTotals);
  const micros = microsOf(portions.items);
  const favorites =
    portions.items.filter((i) => selection.foods[i.food.id] === 'favorite')
      .length +
    [...portions.oils, ...seas.picks].filter(
      (u) => selection.seasonings[u.seasoning.id] === 'favorite',
    ).length;
  return {
    key: comboKey(combo),
    items: portions.items,
    oils: portions.oils,
    seasonings: seas,
    totals,
    kcalByStep: { ...portions.kcalByStep, seasonings: seasTotals.kcal },
    kcalGap: Math.max(0, t.kcal - totals.kcal),
    kcalWarning: totals.kcal < t.kcal * MEAL_KCAL_WARN_RATIO,
    micros,
    score: scoreCombo(
      totals,
      t,
      favorites,
      micros,
      t.rules.preferNoCarb && !combo.carb ? LOW_CARB_NO_CARB_BONUS : 0,
    ),
  };
}

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

/**
 * Vegetable sets (1-2) kept for one meal. Ranked on their own (fiber reached at default-to-max grams,
 * sodium, favorites), then picked greedily with a repeat penalty so the kept sets use varied vegetables.
 */
function fiberSets(
  fibers: Food[],
  t: MealTargets,
  prefs: Selection['foods'],
  locked: Set<string>,
  sizes: readonly number[],
): Food[][] {
  const sets: Food[][] = [];
  for (let i = 0; i < fibers.length; i++) {
    if (sizes.includes(1)) sets.push([fibers[i]]);
    if (sizes.includes(2))
      for (let j = i + 1; j < fibers.length; j++)
        sets.push([fibers[i], fibers[j]]);
  }
  const lockedFibers = fibers.filter((f) => locked.has(f.id));
  const allowed = sets.filter((s) => lockedFibers.every((f) => s.includes(f)));

  const quality = (set: Food[]) => {
    let fiber = 0;
    let sodium = 0;
    for (const v of set) {
      const g = Math.min(
        v.portion.max,
        Math.max(v.portion.min, t.rules.veggieStartG),
      );
      fiber += (v.per100g.fiber * g) / 100;
      sodium += (v.per100g.sodium * g) / 100;
    }
    for (const v of [...set].sort(
      (a, b) => b.per100g.fiber - a.per100g.fiber,
    )) {
      const g0 = Math.min(
        v.portion.max,
        Math.max(v.portion.min, t.rules.veggieStartG),
      );
      const extra = Math.min(
        v.portion.max - g0,
        Math.max(0, ((t.fiberMin - fiber) / v.per100g.fiber) * 100),
      );
      fiber += (v.per100g.fiber * extra) / 100;
      sodium += (v.per100g.sodium * extra) / 100;
    }
    const favorites = set.filter((v) => prefs[v.id] === 'favorite').length;
    return (
      SCORE_WEIGHTS.fiberUnder *
        (Math.max(0, t.fiberMin - fiber) / t.fiberMin) +
      SCORE_WEIGHTS.sodiumOver * (sodium / t.sodiumMax) -
      FAVORITE_BONUS * favorites
    );
  };

  const ranked = allowed
    .map((set) => ({
      set,
      q: quality(set),
      key: set.map((f) => f.id).join('+'),
    }))
    .sort((a, b) => a.q - b.q || a.key.localeCompare(b.key));

  const kept: Food[][] = [];
  const used = new Map<string, number>();
  const pool = [...ranked];
  while (kept.length < FIBER_SETS_PER_MEAL && pool.length > 0) {
    let best = 0;
    let bestVal = Infinity;
    pool.forEach((c, i) => {
      const v =
        c.q +
        FIBER_SET_REPEAT_PENALTY *
          c.set.reduce((a, f) => a + (used.get(f.id) ?? 0), 0);
      if (v < bestVal) {
        bestVal = v;
        best = i;
      }
    });
    const [chosen] = pool.splice(best, 1);
    kept.push(chosen.set);
    for (const f of chosen.set) used.set(f.id, (used.get(f.id) ?? 0) + 1);
  }
  return kept;
}

const proteinOf = (c: MealCombo) =>
  c.items.find((i) => i.food.category === 'protein')!.food.id;
const idOf = (c: MealCombo, cat: 'carb' | 'fat') =>
  c.items.find((i) => i.food.category === cat)?.food.id ?? 'none';
const veggiesOf = (c: MealCombo) =>
  c.items.filter((i) => i.food.category === 'fiber').map((i) => i.food.id);

function similarity(c: MealCombo, picked: MealCombo[]): number {
  let p = 0;
  for (const o of picked) {
    if (proteinOf(o) === proteinOf(c)) p += MMR_PENALTY.sameProtein;
    if (idOf(o, 'carb') === idOf(c, 'carb')) p += MMR_PENALTY.sameCarb;
    if (idOf(o, 'fat') === idOf(c, 'fat')) p += MMR_PENALTY.sameFat;
    const ov = veggiesOf(o);
    p +=
      MMR_PENALTY.sameVeggie *
      veggiesOf(c).filter((v) => ov.includes(v)).length;
  }
  return p;
}

/** MMR over best-first `candidates`: greedily take the combo with the best score + similarity penalty against those already taken. */
export function pickDiverse(candidates: MealCombo[], n: number): MealCombo[] {
  // candidates come sorted best-first; only the head can realistically win.
  const pool = candidates.slice(0, MMR_POOL_SIZE);
  const picked: MealCombo[] = [];
  while (picked.length < n && pool.length > 0) {
    let best = 0;
    let bestVal = Infinity;
    pool.forEach((c, i) => {
      const v = c.score.total + similarity(c, picked);
      if (v < bestVal) {
        bestVal = v;
        best = i;
      }
    });
    picked.push(pool.splice(best, 1)[0]);
  }
  return picked;
}

export type MealRequest = {
  foods: Food[];
  seasonings: Seasoning[];
  selection: Selection;
  targets: MealTargets;
  locked?: string[];
  seen?: Iterable<string>;
  count?: number;
  excludeFoods?: string[];
  options?: MealOptions;
};

/** Protein group of a protein food (by its `group`), undefined for non-protein foods. */
export function proteinGroupOf(food: Food): ProteinGroup | undefined {
  if (food.category !== 'protein') return undefined;
  return (Object.keys(PROTEIN_GROUPS) as ProteinGroup[]).find((g) =>
    (PROTEIN_GROUPS[g] as readonly string[]).includes(food.group),
  );
}

export function comboProteinGroup(c: MealCombo): ProteinGroup | undefined {
  return proteinGroupOf(
    c.items.find((i) => i.food.category === 'protein')!.food,
  );
}

export function generateMealCombos(req: MealRequest): {
  combos: MealCombo[];
  reason?: GenerateFailReason;
} {
  const { candidates, reason } = mealCandidates(req);
  if (reason) return { combos: [], reason };
  const combos = pickDiverse(candidates, req.count ?? COMBOS_PER_MEAL);
  return combos.length > 0 ? { combos } : { combos: [], reason: 'NO_MATCH' };
}

/** Every buildable combo for one meal, best score first. */
function mealCandidates(req: MealRequest): {
  candidates: MealCombo[];
  reason?: GenerateFailReason;
} {
  const { foods, seasonings, selection, targets } = req;
  const locked = new Set(req.locked ?? []);
  const seen = new Set(req.seen ?? []);
  const excludedIds = new Set(req.excludeFoods ?? []);
  const excludedGroups = new Set(targets.rules.excludedGroups);
  const selected = foods
    .filter(
      (f) =>
        selection.foods[f.id] &&
        !excludedIds.has(f.id) &&
        !excludedGroups.has(f.group),
    )
    .sort(byId);
  const of = (cat: Food['category']) =>
    selected.filter((f) => f.category === cat);
  const lockedIn = (list: Food[]) => list.filter((f) => locked.has(f.id));
  const opt = req.options ?? {};
  // The user's per-meal vegetable count wins over the style's "two fiber sources".
  const fiberSizes = opt.veggieCount
    ? [opt.veggieCount]
    : targets.rules.requireTwoFiberSources
      ? [2]
      : [1, 2];

  const proteins = of('protein');
  const fibers = of('fiber');
  if (proteins.length === 0) return { candidates: [], reason: 'NEED_PROTEIN' };
  if (fibers.length < Math.min(...fiberSizes))
    return { candidates: [], reason: 'NEED_FIBER' };

  // A locked food narrows its slot to that food; an unlocked optional slot may stay empty.
  const slot = (list: Food[], optional: boolean): (Food | undefined)[] => {
    const l = lockedIn(list);
    if (l.length > 0) return l;
    return optional ? [undefined, ...list] : list;
  };
  const proteinSlot = slot(proteins, false) as Food[];
  let carbSlot = slot(of('carb'), true);
  if (lockedIn(of('carb')).length === 0) {
    if (opt.carb === 'none') carbSlot = [undefined];
    if (opt.carb === 'required') {
      if (of('carb').length === 0)
        return { candidates: [], reason: 'NEED_CARB' };
      carbSlot = of('carb');
    }
  }
  const fatSlot = slot(of('fat'), true);
  const sets = fiberSets(fibers, targets, selection.foods, locked, fiberSizes);
  const locksOk = [proteinSlot, carbSlot, fatSlot].every(
    (s) => s.filter((f) => f && locked.has(f.id)).length <= 1,
  );

  const ctx = comboContext(seasonings, selection);
  const candidates: MealCombo[] = [];
  if (locksOk) {
    for (const protein of proteinSlot)
      for (const carb of carbSlot)
        for (const fat of fatSlot)
          for (const fiberSet of sets) {
            const combo: ComboFoods = { protein, carb, fibers: fiberSet, fat };
            if (seen.has(comboKey(combo))) continue;
            const built = buildMealCombo(combo, targets, ctx);
            if (built) candidates.push(built);
          }
  }
  candidates.sort(
    (a, b) => a.score.total - b.score.total || a.key.localeCompare(b.key),
  );
  return { candidates };
}

export type DayRequest = {
  foods: Food[];
  seasonings: Seasoning[];
  selection: Selection;
  profile: Profile;
  refYear: number;
  /** Styles, overrides, include/exclude foods and per-meal options. */
  conditions?: RecommendationConditions;
  /** Same as `conditions.overrides` (kept for existing callers). */
  overrides?: TargetOverrides;
  locked?: Partial<Record<MealType, string[]>>;
  seen?: Partial<Record<MealType, Iterable<string>>>;
};

type DayPick = {
  idx: number[];
  missing: number; // includeFoods not in the day
  violated: number; // how many day limits are broken
  groups: number;
  repeats: number;
  total: number; // summed meal scores + relative excess of broken limits
};

/**
 * Lexicographic: fewer missing includeFoods, fewer broken day limits, more protein groups, fewer repeated
 * foods, lower total. Limits count as broken/not (not by how much), so a limit no option can meet (e.g.
 * 100 g carbs with no carb food selected) does not override variety; how far it is missed still weighs in
 * `total`.
 */
function betterDay(a: DayPick, b: DayPick | undefined): boolean {
  if (!b) return true;
  if (a.missing !== b.missing) return a.missing < b.missing;
  if (a.violated !== b.violated) return a.violated < b.violated;
  if (a.groups !== b.groups) return a.groups > b.groups;
  if (a.repeats !== b.repeats) return a.repeats < b.repeats;
  return a.total < b.total;
}

/**
 * Day-level limits as relative excess (0 when met): total carbs within [100 g (0 in the low-carb style),
 * the carb cap of the kcal eaten + CARB_TOLERANCE_G], saturated fat < 10%, fat within the diet's cap,
 * cholesterol <= 300 mg, and each micronutrient (except vitamin D) at least 90% of its KDRI value.
 * Carb, fat and saturated-fat shares all use the kcal actually eaten.
 */
function dayLimitExcess(
  day: NutrientTotals,
  t: DayTargets,
  micros: Record<MicroKey, number>,
): number[] {
  const fatCapShare = (t.fat.stage3 * KCAL_PER_GRAM.fat) / t.kcal;
  const fatKcal = (g: number) => g * KCAL_PER_GRAM.fat;
  const carbCap = carbCapGrams(t, day.kcal);
  const carbShort =
    t.totalCarbMin > 0
      ? Math.max(0, t.totalCarbMin - day.carbs) / t.totalCarbMin
      : 0;
  return [
    Math.max(0, day.carbs - carbCap - CARB_TOLERANCE_G) / carbCap + carbShort,
    Math.max(0, fatKcal(day.satFat) / day.kcal - SAT_FAT_KCAL_RATIO_MAX) /
      SAT_FAT_KCAL_RATIO_MAX,
    Math.max(0, fatKcal(day.fat) / day.kcal - fatCapShare) / fatCapShare,
    Math.max(0, day.cholesterol - t.cholesterolMax) / t.cholesterolMax,
    ...MICRO_KEYS.filter((k) => !MICROS_HARD_FROM_FOOD.includes(k)).map(
      (k) =>
        Math.max(0, t.micros[k] * MICRO_SHORTFALL_RATIO - micros[k]) /
        t.micros[k],
    ),
  ];
}

/**
 * Index per meal. In order of priority:
 * (0) as few missing includeFoods as possible,
 * (1) as few broken day limits (dayLimitExcess) as possible,
 * (2) as many different protein groups as possible,
 * (3) as few foods repeated across meals as possible (protein, carb, vegetables, fat source),
 * (4) the lowest summed score. When the selection is too small, (2)-(3) give way.
 */
function chooseDay(
  meals: MealCombo[][],
  t: DayTargets,
  includeFoods: readonly string[],
): number[] {
  let best: DayPick | undefined;
  const walk = (m: number, chosen: MealCombo[], idx: number[]) => {
    if (m === meals.length) {
      const foods = chosen.flatMap((c) => c.items.map((i) => i.food.id));
      const day = chosen.reduce((a, c) => addTotals(a, c.totals), ZERO_TOTALS);
      const micros = chosen.reduce(
        (a, c) => {
          for (const k of MICRO_KEYS) a[k] += c.micros[k];
          return a;
        },
        Object.fromEntries(MICRO_KEYS.map((k) => [k, 0])) as Record<
          MicroKey,
          number
        >,
      );
      const excess = dayLimitExcess(day, t, micros);
      const pick: DayPick = {
        idx: [...idx],
        missing: includeFoods.filter((id) => !foods.includes(id)).length,
        violated: excess.filter((e) => e > 0).length,
        groups: new Set(chosen.map(comboProteinGroup)).size,
        repeats: foods.length - new Set(foods).size,
        total:
          chosen.reduce((a, c) => a + c.score.total, 0) +
          excess.reduce((a, e) => a + e, 0),
      };
      if (betterDay(pick, best)) best = pick;
      return;
    }
    meals[m].forEach((c, i) => walk(m + 1, [...chosen, c], [...idx, i]));
  };
  walk(0, [], []);
  return best?.idx ?? [];
}

/**
 * Options the day planner chooses from for one meal: a wider MMR list (varied proteins, carbs, fats,
 * vegetables), plus per protein group its best combos and its best combos that stay within the meal's
 * total-carb cap (so the day cap can be met with every group). `top` is the meal's own card list.
 */
function dayOptions(
  candidates: MealCombo[],
  t: MealTargets,
  includeFoods: readonly string[],
): { top: MealCombo[]; options: MealCombo[] } {
  const options = pickDiverse(candidates, DAY_PLAN_OPTIONS_PER_MEAL);
  const top = options.slice(0, COMBOS_PER_MEAL);
  for (const g of Object.keys(PROTEIN_GROUPS) as ProteinGroup[]) {
    const inGroup = candidates.filter((c) => comboProteinGroup(c) === g);
    const lowCarb = inGroup.filter(
      (c) => c.totals.carbs <= carbCapGrams(t, c.totals.kcal),
    );
    for (const list of [inGroup, lowCarb]) {
      options.push(
        ...list
          .filter((c) => !options.includes(c))
          .slice(0, DAY_PLAN_OPTIONS_PER_GROUP),
      );
    }
  }
  // The best combos that contain each includeFood, so the day can fit it somewhere.
  for (const id of includeFoods) {
    options.push(
      ...candidates
        .filter(
          (c) => c.items.some((i) => i.food.id === id) && !options.includes(c),
        )
        .slice(0, DAY_PLAN_OPTIONS_PER_INCLUDE),
    );
  }
  return { top, options };
}

export function generateDayPlan(req: DayRequest): DayPlan {
  const cond = req.conditions ?? {};
  const styles = resolveStyles(cond.styles ?? [], req.profile.goal);
  const { targets, flags: settingFlags } = calcDayTargets(
    req.profile,
    req.refYear,
    cond.overrides ?? req.overrides,
    styles,
  );
  const mealTargets = calcMealTargets(
    targets,
    req.profile.mealsPerDay,
    cond.meals,
  );
  const excluded = new Set(cond.excludeFoods ?? []);
  // An excluded food wins over an include of the same food.
  const includeFoods = (cond.includeFoods ?? []).filter(
    (id) => !excluded.has(id),
  );
  let reason: GenerateFailReason | undefined;

  const generated = mealTargets.map((t) => {
    const r = mealCandidates({
      foods: req.foods,
      seasonings: req.seasonings,
      selection: req.selection,
      targets: t,
      locked: req.locked?.[t.mealType],
      seen: req.seen?.[t.mealType],
      excludeFoods: cond.excludeFoods,
      options: cond.meals?.[t.mealType],
    });
    reason ??= r.reason ?? (r.candidates.length === 0 ? 'NO_MATCH' : undefined);
    return dayOptions(r.candidates, t, includeFoods);
  });

  const meals: MealPlan[] = mealTargets.map((t) => ({
    mealType: t.mealType,
    targets: t,
    combos: [],
  }));
  if (generated.every((g) => g.options.length > 0)) {
    const chosen = chooseDay(
      generated.map((g) => g.options),
      targets,
      includeFoods,
    );
    generated.forEach(({ top, options }, m) => {
      const first = options[chosen[m]];
      meals[m].combos = [first, ...top.filter((c) => c !== first)].slice(
        0,
        COMBOS_PER_MEAL,
      );
    });
  }
  const planned = meals.every((m) => m.combos.length > 0);

  const totals: NutrientTotals = meals.reduce(
    (a, m) => (m.combos[0] ? addTotals(a, m.combos[0].totals) : a),
    ZERO_TOTALS,
  );
  const micros = microsOf(
    meals.flatMap((m) => (m.combos[0] ? m.combos[0].items : [])),
  );
  // Warnings are computed once from the final values (flags.ts); with no plan only the setting ones.
  const flagDetails = computeFlags({
    profile: req.profile,
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
  const dayFoods = meals.flatMap((m) =>
    m.combos[0] ? m.combos[0].items.map((i) => i.food.id) : [],
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
    missingIncludes: includeFoods.filter((id) => !dayFoods.includes(id)),
    ...(reason ? { reason } : {}),
  };
}
