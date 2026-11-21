// Profile -> daily and per-meal targets (PLAN.md 4). Pure functions.
import type {
  DayTargets,
  Flag,
  FlagCode,
  MealOptions,
  MealTargets,
  MealType,
  MealsPerDay,
  MicroKey,
  Profile,
  StyleSettings,
  TargetOverrides,
} from '@/types/nutrition';
import {
  ACTIVITY_FACTORS,
  AGE_BANDS,
  type AgeBand,
  CHOLESTEROL_DAY_MAX_MG,
  FAT_KCAL_RATIO_STAGE1,
  FAT_KCAL_RATIO_STAGE2,
  FIBER_DAY_SOFT_MAX,
  GOAL_KCAL_FACTOR,
  KCAL_FILL_ORDER,
  KCAL_FILL_ORDER_LOW_CARB,
  KCAL_FLOOR,
  KCAL_PER_GRAM,
  KDRI_2020,
  type KdriRow,
  MEAL_SPLIT,
  MICRO_KEYS,
  MIFFLIN_ST_JEOR,
  NET_CARB_KCAL_RATIO,
  PROTEIN_PER_KG_DEFAULT,
  PROTEIN_PER_KG_FILL_MAX,
  PROTEIN_PER_KG_USER_MAX,
  PROTEIN_PER_KG_USER_MIN,
  SAT_FAT_KCAL_RATIO_MAX,
  SAT_FAT_KCAL_RATIO_TARGET,
  SEASONING_SODIUM_BUDGET_RATIO,
  SODIUM_DAY_MAX,
  TOTAL_CARB_DAY_MIN_G,
  TOTAL_CARB_KCAL_RATIO_MAX,
  VEGGIE_DEFAULT_G,
} from './constants';
import { computeFlags } from './flags';
import { resolveStyles } from './styles';

export function ageOf(profile: Profile, refYear: number): number {
  return refYear - profile.birthYear;
}

export function ageBand(age: number): AgeBand {
  return AGE_BANDS.find((b) => age >= b.from)!.band;
}

/** KDRI 2020 row (fiber + micronutrients) for the person's sex and age. */
export function kdriFor(profile: Profile, refYear: number): KdriRow {
  return KDRI_2020[profile.sex][ageBand(ageOf(profile, refYear))];
}

export function bmr(profile: Profile, refYear: number): number {
  return (
    MIFFLIN_ST_JEOR.perKg * profile.weightKg +
    MIFFLIN_ST_JEOR.perCm * profile.heightCm -
    MIFFLIN_ST_JEOR.perYear * ageOf(profile, refYear) +
    MIFFLIN_ST_JEOR.offset[profile.sex]
  );
}

/**
 * Default diet -> styles -> user overrides. `styles` defaults to "no style".
 * `flags` are the setting-based warnings (see computeFlags in flags.ts for the full set).
 */
export function calcDayTargets(
  profile: Profile,
  refYear: number,
  overrides: TargetOverrides = {},
  styles: StyleSettings = resolveStyles([], profile.goal),
): { targets: DayTargets; flags: FlagCode[] } {
  const settingFlags: FlagCode[] = [];
  const { weightKg, goal, sex } = profile;
  const kdri = kdriFor(profile, refYear);

  const autoKcal = Math.max(
    KCAL_FLOOR[sex],
    bmr(profile, refYear) *
      ACTIVITY_FACTORS[profile.activityLevel - 1] *
      GOAL_KCAL_FACTOR[goal],
  );
  const kcal = overrides.kcal ?? autoKcal;
  if (kcal < KCAL_FLOOR[sex]) settingFlags.push('KCAL_BELOW_FLOOR');

  let protein: DayTargets['protein'];
  if (overrides.protein) {
    let g =
      'g' in overrides.protein
        ? overrides.protein.g
        : overrides.protein.perKg * weightKg;
    const userMax = weightKg * PROTEIN_PER_KG_USER_MAX;
    if (g > userMax) {
      g = userMax;
      settingFlags.push('PROTEIN_CLAMPED_TO_MAX');
    }
    if (g < weightKg * PROTEIN_PER_KG_USER_MIN)
      settingFlags.push('PROTEIN_BELOW_MIN');
    // A user-set protein is respected as is: kcal filling does not raise it.
    protein = { base: g, max: g };
  } else {
    protein = {
      base:
        weightKg *
        Math.max(PROTEIN_PER_KG_DEFAULT[goal], styles.proteinPerKgBase ?? 0),
      max:
        weightKg *
        Math.max(
          PROTEIN_PER_KG_FILL_MAX[goal],
          styles.proteinPerKgFillMax ?? 0,
        ),
    };
  }

  const netCarbMax = overrides.netCarbs
    ? 'g' in overrides.netCarbs
      ? overrides.netCarbs.g
      : (kcal * overrides.netCarbs.ratio) / KCAL_PER_GRAM.netCarbs
    : (kcal *
        Math.min(
          NET_CARB_KCAL_RATIO[goal] * (styles.netCarbMultiplier ?? 1),
          styles.totalCarbRatioMax ?? Infinity,
        )) /
      KCAL_PER_GRAM.netCarbs;
  // A user-set net-carb amount is respected as is: step 6 does not raise it.
  const carbTopUp = !overrides.netCarbs;
  const totalCarbMax =
    (kcal * (styles.totalCarbRatioMax ?? TOTAL_CARB_KCAL_RATIO_MAX[goal])) /
    KCAL_PER_GRAM.netCarbs;

  let fat: DayTargets['fat'];
  if (overrides.fat) {
    const g =
      'g' in overrides.fat
        ? overrides.fat.g
        : (kcal * overrides.fat.ratio) / KCAL_PER_GRAM.fat;
    fat = { stage1: g, stage2: g, stage3: g };
  } else {
    const stage2 = (kcal * FAT_KCAL_RATIO_STAGE2) / KCAL_PER_GRAM.fat;
    // Default diet: nothing beyond 35%. The low-carb style allows unsaturated fat up to 45%.
    fat = {
      stage1: (kcal * FAT_KCAL_RATIO_STAGE1) / KCAL_PER_GRAM.fat,
      stage2,
      stage3: styles.fatMaxRatio
        ? Math.max(stage2, (kcal * styles.fatMaxRatio) / KCAL_PER_GRAM.fat)
        : stage2,
    };
  }

  let sodiumMax = overrides.sodiumMax ?? styles.sodiumMax ?? SODIUM_DAY_MAX;
  if (sodiumMax > SODIUM_DAY_MAX) {
    sodiumMax = SODIUM_DAY_MAX;
    settingFlags.push('SODIUM_CLAMPED_TO_MAX');
  }

  const targets: DayTargets = {
    goal,
    kcal,
    protein,
    netCarbMax,
    totalCarbMax,
    totalCarbMin: styles.dropTotalCarbMin ? 0 : TOTAL_CARB_DAY_MIN_G,
    carbTopUp,
    fat,
    satFatTarget: (kcal * SAT_FAT_KCAL_RATIO_TARGET) / KCAL_PER_GRAM.fat,
    satFatMax: (kcal * SAT_FAT_KCAL_RATIO_MAX) / KCAL_PER_GRAM.fat,
    cholesterolMax: CHOLESTEROL_DAY_MAX_MG,
    fiberMin: Math.max(kdri.fiber, styles.fiberDayMin ?? 0),
    fiberSoftMax: FIBER_DAY_SOFT_MAX,
    sodiumMax,
    micros: Object.fromEntries(MICRO_KEYS.map((k) => [k, kdri[k]])) as Record<
      MicroKey,
      number
    >,
    rules: {
      fillOrder: styles.lowCarbFill
        ? KCAL_FILL_ORDER_LOW_CARB
        : KCAL_FILL_ORDER,
      veggieStartG: styles.veggieStartG ?? VEGGIE_DEFAULT_G,
      requireTwoFiberSources: styles.requireTwoFiberSources,
      excludedGroups: styles.excludedGroups,
      preferNoCarb: styles.preferNoCarb,
      seasoningBudgetRatio:
        styles.seasoningBudgetRatio ?? SEASONING_SODIUM_BUDGET_RATIO,
    },
  };
  const flags = computeFlags({ profile, targets, settingFlags }).map(
    (f: Flag) => f.code,
  );
  return { targets, flags };
}

/**
 * Meal shares of the day. A meal with `kcalRatio` keeps it; the others share the rest in their usual
 * proportions. All set -> normalized to 1. Ratios outside (0, 1) are ignored.
 */
export function mealRatios(
  mealsPerDay: MealsPerDay,
  options: Partial<Record<MealType, MealOptions>> = {},
): { mealType: MealType; ratio: number }[] {
  const split = MEAL_SPLIT[mealsPerDay];
  const set = (m: MealType) => {
    const r = options[m]?.kcalRatio;
    return r !== undefined && r > 0 && r < 1 ? r : undefined;
  };
  // No per-meal ratio asked for: the usual split, exactly.
  if (split.every((m) => set(m.mealType) === undefined))
    return split.map((m) => ({ mealType: m.mealType, ratio: m.ratio }));
  const setSum = split.reduce((a, m) => a + (set(m.mealType) ?? 0), 0);
  const unset = split.filter((m) => set(m.mealType) === undefined);
  const unsetBase = unset.reduce((a, m) => a + m.ratio, 0);
  if (unset.length === 0 || setSum >= 1) {
    const total = split.reduce((a, m) => a + (set(m.mealType) ?? m.ratio), 0);
    return split.map((m) => ({
      mealType: m.mealType,
      ratio: (set(m.mealType) ?? m.ratio) / total,
    }));
  }
  return split.map((m) => ({
    mealType: m.mealType,
    ratio: set(m.mealType) ?? (m.ratio * (1 - setSum)) / unsetBase,
  }));
}

export function calcMealTargets(
  day: DayTargets,
  mealsPerDay: MealsPerDay,
  mealOptions: Partial<Record<MealType, MealOptions>> = {},
): MealTargets[] {
  return mealRatios(mealsPerDay, mealOptions).map(({ mealType, ratio }) => ({
    mealType,
    ratio,
    goal: day.goal,
    kcal: day.kcal * ratio,
    protein: { base: day.protein.base * ratio, max: day.protein.max * ratio },
    netCarbMax: day.netCarbMax * ratio,
    totalCarbMax: day.totalCarbMax * ratio,
    totalCarbMin: day.totalCarbMin * ratio,
    carbTopUp: day.carbTopUp,
    fat: {
      stage1: day.fat.stage1 * ratio,
      stage2: day.fat.stage2 * ratio,
      stage3: day.fat.stage3 * ratio,
    },
    satFatTarget: day.satFatTarget * ratio,
    satFatMax: day.satFatMax * ratio,
    cholesterolMax: day.cholesterolMax * ratio,
    fiberMin: day.fiberMin * ratio,
    fiberSoftMax: day.fiberSoftMax * ratio,
    sodiumMax: day.sodiumMax * ratio,
    micros: Object.fromEntries(
      MICRO_KEYS.map((k) => [k, day.micros[k] * ratio]),
    ) as Record<MicroKey, number>,
    rules: day.rules,
  }));
}
