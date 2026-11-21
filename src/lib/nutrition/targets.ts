// Profile -> daily and per-meal targets (PLAN.md 4). Pure functions.
import type {
  DayTargets,
  FlagCode,
  MealTargets,
  MealsPerDay,
  MicroKey,
  Profile,
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
  HIGH_PROTEIN_WARN_PER_KG,
  KCAL_FLOOR,
  KCAL_PER_GRAM,
  KDRI_2020,
  type KdriRow,
  LOW_NET_CARB_WARN_G,
  LOW_SODIUM_WARN_MG,
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
  SODIUM_DAY_MAX,
  SODIUM_DAY_MIN,
  TOTAL_CARB_DAY_MIN_G,
  TOTAL_CARB_KCAL_RATIO_MAX,
} from './constants';

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

export function calcDayTargets(
  profile: Profile,
  refYear: number,
  overrides: TargetOverrides = {},
): { targets: DayTargets; flags: FlagCode[] } {
  const flags: FlagCode[] = [];
  const { weightKg, goal, sex } = profile;
  const kdri = kdriFor(profile, refYear);

  const autoKcal = Math.max(
    KCAL_FLOOR[sex],
    bmr(profile, refYear) *
      ACTIVITY_FACTORS[profile.activityLevel - 1] *
      GOAL_KCAL_FACTOR[goal],
  );
  const kcal = overrides.kcal ?? autoKcal;
  if (kcal < KCAL_FLOOR[sex]) flags.push('KCAL_BELOW_FLOOR');

  let protein: DayTargets['protein'];
  if (overrides.protein) {
    let g =
      'g' in overrides.protein
        ? overrides.protein.g
        : overrides.protein.perKg * weightKg;
    const userMax = weightKg * PROTEIN_PER_KG_USER_MAX;
    if (g > userMax) {
      g = userMax;
      flags.push('PROTEIN_CLAMPED_TO_MAX');
    }
    if (g < weightKg * PROTEIN_PER_KG_USER_MIN) flags.push('PROTEIN_BELOW_MIN');
    // A user-set protein is respected as is: kcal filling does not raise it.
    protein = { base: g, max: g };
  } else {
    protein = {
      base: weightKg * PROTEIN_PER_KG_DEFAULT[goal],
      max: weightKg * PROTEIN_PER_KG_FILL_MAX[goal],
    };
  }

  const netCarbMax = overrides.netCarbs
    ? 'g' in overrides.netCarbs
      ? overrides.netCarbs.g
      : (kcal * overrides.netCarbs.ratio) / KCAL_PER_GRAM.netCarbs
    : (kcal * NET_CARB_KCAL_RATIO[goal]) / KCAL_PER_GRAM.netCarbs;
  // A user-set net-carb amount is respected as is: step 6 does not raise it.
  const carbTopUp = !overrides.netCarbs;
  const totalCarbMax =
    (kcal * TOTAL_CARB_KCAL_RATIO_MAX) / KCAL_PER_GRAM.netCarbs;

  let fat: DayTargets['fat'];
  if (overrides.fat) {
    const g =
      'g' in overrides.fat
        ? overrides.fat.g
        : (kcal * overrides.fat.ratio) / KCAL_PER_GRAM.fat;
    fat = { stage1: g, stage2: g, stage3: g };
  } else {
    const stage2 = (kcal * FAT_KCAL_RATIO_STAGE2) / KCAL_PER_GRAM.fat;
    // Default diet: nothing beyond 35% (the 45% low-carb step is not part of it).
    fat = {
      stage1: (kcal * FAT_KCAL_RATIO_STAGE1) / KCAL_PER_GRAM.fat,
      stage2,
      stage3: stage2,
    };
  }

  let sodiumMax = overrides.sodiumMax ?? SODIUM_DAY_MAX;
  if (sodiumMax > SODIUM_DAY_MAX) {
    sodiumMax = SODIUM_DAY_MAX;
    flags.push('SODIUM_CLAMPED_TO_MAX');
  }

  if (protein.base > weightKg * HIGH_PROTEIN_WARN_PER_KG)
    flags.push('HIGH_PROTEIN');
  if (sodiumMax < LOW_SODIUM_WARN_MG) flags.push('LOW_SODIUM');
  if (netCarbMax < LOW_NET_CARB_WARN_G) flags.push('LOW_NET_CARB');

  return {
    targets: {
      goal,
      kcal,
      protein,
      netCarbMax,
      totalCarbMax,
      totalCarbMin: TOTAL_CARB_DAY_MIN_G,
      carbTopUp,
      fat,
      satFatTarget: (kcal * SAT_FAT_KCAL_RATIO_TARGET) / KCAL_PER_GRAM.fat,
      satFatMax: (kcal * SAT_FAT_KCAL_RATIO_MAX) / KCAL_PER_GRAM.fat,
      cholesterolMax: CHOLESTEROL_DAY_MAX_MG,
      fiberMin: kdri.fiber,
      fiberSoftMax: FIBER_DAY_SOFT_MAX,
      sodiumMin: Math.min(SODIUM_DAY_MIN, sodiumMax),
      sodiumMax,
      micros: Object.fromEntries(MICRO_KEYS.map((k) => [k, kdri[k]])) as Record<
        MicroKey,
        number
      >,
    },
    flags,
  };
}

export function calcMealTargets(
  day: DayTargets,
  mealsPerDay: MealsPerDay,
): MealTargets[] {
  return MEAL_SPLIT[mealsPerDay].map(({ mealType, ratio }) => ({
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
    sodiumMin: day.sodiumMin * ratio,
    sodiumMax: day.sodiumMax * ratio,
    micros: Object.fromEntries(
      MICRO_KEYS.map((k) => [k, day.micros[k] * ratio]),
    ) as Record<MicroKey, number>,
  }));
}
