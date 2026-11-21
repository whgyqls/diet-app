// Types for the nutrition engine (src/lib/nutrition). Weights in g, sodium in mg.
import type { KcalFillStep, MicroKey } from '@/lib/nutrition/constants';
import type { Food, Seasoning } from './food';

export type { MicroKey };

export type DietStyle =
  | 'lowCarb'
  | 'lowSodium'
  | 'veggieForward'
  | 'highProtein'
  | 'pescatarian'
  | 'lactoOvo';

export type Sex = 'female' | 'male';
export type Goal = 'lose' | 'maintain' | 'gain';
export type ActivityLevel = 1 | 2 | 3 | 4 | 5;
export type MealsPerDay = 2 | 3;
export type MealType = 'breakfast' | 'lunch' | 'dinner';

export type Profile = {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: Goal;
  mealsPerDay: MealsPerDay;
};

/** User-set targets. Missing fields fall back to the automatic calculation. */
export type TargetOverrides = {
  kcal?: number;
  protein?: { perKg: number } | { g: number };
  netCarbs?: { ratio: number } | { g: number };
  fat?: { ratio: number } | { g: number };
  sodiumMax?: number;
};

/** Style-resolved settings (styles.ts). Undefined number = the style does not touch it. */
export type StyleSettings = {
  styles: DietStyle[];
  excludedGroups: string[]; // food.group values that are left out
  totalCarbRatioMax?: number;
  dropTotalCarbMin: boolean;
  fatMaxRatio?: number;
  lowCarbFill: boolean; // use KCAL_FILL_ORDER_LOW_CARB
  sodiumMax?: number;
  seasoningBudgetRatio?: number;
  fiberDayMin?: number;
  requireTwoFiberSources: boolean;
  veggieStartG?: number;
  netCarbMultiplier?: number;
  proteinPerKgBase?: number;
  proteinPerKgFillMax?: number;
  preferNoCarb: boolean;
};

/** How a plan is built (from the default diet and the chosen styles). */
export type PlanRules = {
  fillOrder: readonly KcalFillStep[];
  veggieStartG: number;
  requireTwoFiberSources: boolean;
  excludedGroups: readonly string[];
  preferNoCarb: boolean;
  seasoningBudgetRatio: number; // share of the seasoning sodium budget salty seasonings may use
};

/** Per-meal options of a recommendation request. */
export type MealOptions = {
  kcalRatio?: number; // share of the day kcal (0-1)
  carb?: 'required' | 'none';
  veggieCount?: 1 | 2;
};

/**
 * What the user asked for (screen controls now, an AI-parsed natural-language request in Phase 6).
 * It only holds conditions; every number is still computed by the engine.
 */
export type RecommendationConditions = {
  styles?: DietStyle[];
  overrides?: TargetOverrides;
  excludeFoods?: string[]; // food ids that must not appear
  includeFoods?: string[]; // food ids that must appear at least once in the day
  meals?: Partial<Record<MealType, MealOptions>>;
};

/**
 * Grams unless noted. fat.stage1/2 = fat caps for kcal fill steps 3 and 5 (30/35% of kcal);
 * fat.stage3 = the highest fat the diet allows (default = stage2; a future low-carb style raises it to 45%).
 * netCarbMax = base net carbs (step 2). totalCarbMax = total carbs (incl. fiber) cap that step 6 fills to.
 */
export type NutrientTargets = {
  goal: Goal;
  kcal: number;
  protein: { base: number; max: number };
  netCarbMax: number;
  totalCarbMax: number;
  totalCarbMin: number; // KDRI EAR 100 g/day
  carbTopUp: boolean; // false when the user set net carbs: step 6 does not raise them
  fat: { stage1: number; stage2: number; stage3: number };
  satFatTarget: number; // 7% of kcal
  satFatMax: number; // 10% of kcal
  cholesterolMax: number; // mg
  fiberMin: number;
  fiberSoftMax: number; // weak penalty above this
  sodiumMax: number; // mg
  micros: Record<MicroKey, number>; // KDRI reference for the person (share of it per meal)
  rules: PlanRules;
};

export type DayTargets = NutrientTargets;
export type MealTargets = NutrientTargets & {
  mealType: MealType;
  ratio: number;
};

export type TargetFlagCode =
  | 'KCAL_BELOW_FLOOR'
  | 'PROTEIN_BELOW_MIN'
  | 'PROTEIN_CLAMPED_TO_MAX'
  | 'SODIUM_CLAMPED_TO_MAX';
export type HealthFlagCode =
  | 'HIGH_PROTEIN'
  | 'LOW_SODIUM'
  | 'LOW_NET_CARB'
  | 'LOW_TOTAL_CARB'
  | 'HIGH_FAT_MOSTLY_UNSAT'
  | 'HIGH_FAT'
  | 'HIGH_SAT_FAT'
  | 'HIGH_CHOLESTEROL'
  | 'LOW_KCAL'
  | 'MICRO_SHORTFALL';
export type FlagCode = TargetFlagCode | HealthFlagCode;

/** A warning with its text and source, computed in flags.ts. basis: from a setting or from what is eaten. */
export type Flag = {
  code: FlagCode;
  message: string;
  source: string;
  basis: 'setting' | 'intake';
  detail?: string;
};

export type UnmetTarget = {
  nutrient: 'protein' | 'fiber' | 'kcal';
  target: number;
  actual: number;
  short: number; // target - actual, > 0
};

export type NutrientTotals = {
  kcal: number;
  protein: number;
  carbs: number; // total carbs (net carbs + fiber)
  netCarbs: number;
  fiber: number;
  fat: number;
  satFat: number;
  sodium: number;
  cholesterol: number; // mg
};

export type PrefStatus = 'ok' | 'favorite';
/** Missing id = cannot eat / not selected. */
export type Selection = {
  foods: Record<string, PrefStatus>;
  seasonings: Record<string, PrefStatus>;
};

/** One candidate meal: protein 1 + carb 0-1 + fiber 1-2 + fat source 0-1. */
export type ComboFoods = {
  protein: Food;
  carb?: Food;
  fibers: Food[];
  fat?: Food;
};

export type PortionedFood = { food: Food; grams: number };
export type SeasoningUse = { seasoning: Seasoning; units: number };

/** kcal added at each fill step (PLAN.md 4.2, steps 1-7). `veggies` and `seasonings` sit outside the numbered steps. */
export type KcalByStep = {
  proteinBase: number;
  carbsToLimit: number;
  veggies: number;
  fatToStage1: number;
  proteinToMax: number;
  fatToStage2: number;
  fatToStage3: number; // low-carb style only; 0 in the default diet
  carbsTopUp: number;
  seasonings: number;
};

export type PortionResult = {
  items: PortionedFood[];
  oils: PortionedFood[]; // cold-pressed oil (OIL_GROUP), separate from the fat-source slot
  totals: NutrientTotals; // foods + oils
  kcalByStep: Omit<KcalByStep, 'seasonings'>;
};

export type SeasoningResult = {
  budget: number; // mg left for seasonings: meal cap - food sodium
  allowed: number; // what salty seasonings may use: 60% of the budget
  picks: SeasoningUse[];
  free: Seasoning[];
  reason?: 'NO_SALTY_SELECTED' | 'NO_SODIUM_BUDGET';
};

export type ScoreBreakdown = {
  total: number;
  kcal: number;
  protein: number;
  carbOver: number;
  carbUnder: number;
  fiberUnder: number;
  fiberOver: number;
  sodiumOver: number;
  fatOver: number;
  satFatOver: number;
  satFatAboveTarget: number;
  cholesterolOver: number;
  microUnder: number;
  favorite: number;
  styleBonus: number; // negative = bonus (e.g. no carb food in the low-carb style)
};

export type MealCombo = {
  key: string;
  items: PortionedFood[];
  oils: PortionedFood[];
  seasonings: SeasoningResult;
  totals: NutrientTotals; // everything that is eaten, seasonings included
  kcalByStep: KcalByStep;
  kcalGap: number; // max(0, target - totals.kcal)
  kcalWarning: boolean; // totals.kcal < target * MEAL_KCAL_WARN_RATIO
  micros: Record<MicroKey, number>; // from foods (missing source values count as 0)
  score: ScoreBreakdown;
};

export type MealPlan = {
  mealType: MealType;
  targets: MealTargets;
  combos: MealCombo[];
};

export type DayPlan = {
  targets: DayTargets;
  meals: MealPlan[]; // combos[0] of each meal is the chosen one
  totals: NutrientTotals; // of the chosen combos
  micros: Record<MicroKey, number>; // of the chosen combos
  /** Micronutrients whose day total is below MICRO_SHORTFALL_RATIO of the KDRI value. */
  shortfalls: {
    nutrient: MicroKey;
    amount: number;
    reference: number;
    ratio: number;
    /** Hard to cover from food alone (vitamin D): show HARD_FROM_FOOD_NOTE with it; not penalized. */
    hardFromFood: boolean;
  }[];
  flags: FlagCode[];
  flagDetails: Flag[]; // same warnings with message, source and basis
  unmetTargets: UnmetTarget[]; // protein/fiber/kcal the chosen foods could not reach
  missingIncludes: string[]; // includeFoods that are not in the plan
  reason?: GenerateFailReason;
};

export type GenerateFailReason =
  'NEED_PROTEIN' | 'NEED_FIBER' | 'NEED_CARB' | 'NO_MATCH';
