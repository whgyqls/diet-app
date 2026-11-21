// Single home for nutrition constants (CLAUDE.md). Rules and sources: PLAN.md chapters 3.2, 4, 5.
import type { Goal, MealType, MealsPerDay, Sex } from '@/types/nutrition';

// ---- Data validation (Phase 1) --------------------------------------------

/** Energy factors (kcal per g) used to sanity-check food data. Fiber counted at 2 kcal/g. */
export const KCAL_PER_GRAM = {
  protein: 4,
  netCarbs: 4,
  fiber: 2,
  fat: 9,
} as const;

/** Allowed relative gap between stated kcal and kcal computed from macros. */
export const KCAL_CHECK_TOLERANCE = 0.2;

/** Food groups whose stated kcal is legitimately below the macro formula (skipped in the kcal check). */
export const KCAL_CHECK_EXCLUDED_GROUPS: readonly string[] = ['버섯'];

// ---- Daily targets (PLAN.md 4) ----------------------------------------------

/** Mifflin-St Jeor: 10*kg + 6.25*cm - 5*age + offset. */
export const MIFFLIN_ST_JEOR = {
  perKg: 10,
  perCm: 6.25,
  perYear: 5,
  offset: { male: 5, female: -161 } satisfies Record<Sex, number>,
} as const;

/** Index 0 = activity level 1. */
export const ACTIVITY_FACTORS = [1.2, 1.375, 1.55, 1.725, 1.9] as const;

export const GOAL_KCAL_FACTOR: Record<Goal, number> = {
  lose: 0.85,
  maintain: 1.0,
  gain: 1.1,
};

/** Safety floor for daily kcal. Lower user-set values raise KCAL_BELOW_FLOOR. */
export const KCAL_FLOOR: Record<Sex, number> = { female: 1200, male: 1500 };

/** Protein g/kg defaults and limits. Sources in PLAN.md 4.1. */
export const PROTEIN_PER_KG_DEFAULT: Record<Goal, number> = {
  lose: 1.6,
  maintain: 1.2,
  gain: 1.6,
};
/** Upper bound when kcal fill step 4 raises protein (conservative, kidney health). Maintenance stays at 1.6. */
export const PROTEIN_PER_KG_FILL_MAX: Record<Goal, number> = {
  lose: 2.0,
  maintain: 1.6,
  gain: 2.0,
};
/** Range for user-set protein. Min = KDRI 2020 adult RNI (~0.91 g/kg). */
export const PROTEIN_PER_KG_USER_MIN = 0.9;
export const PROTEIN_PER_KG_USER_MAX = 2.0;

/** Base net carbs (carbs - fiber) as a share of daily kcal: fill step 2. */
export const NET_CARB_KCAL_RATIO: Record<Goal, number> = {
  lose: 0.2,
  maintain: 0.25,
  gain: 0.3,
};
/**
 * Default diet: total carbs (net carbs + fiber) up to this share of the kcal eaten. Fill step 6 may add whole
 * grains and legumes up to it. Weight loss 45% = lower bound of the IOM AMDR (45-65%); maintenance and gain 50%,
 * inside the IOM range and closer to KDRI 2020's 55-65% (PLAN.md 4.1-3).
 */
export const TOTAL_CARB_KCAL_RATIO_MAX: Record<Goal, number> = {
  lose: 0.45,
  maintain: 0.5,
  gain: 0.5,
};
/** Default diet: total carbs per day at least the KDRI 2020 adult EAR (100 g). */
export const TOTAL_CARB_DAY_MIN_G = 100;
/** Carb foods step 6 may grow: whole grains and legumes. */
export const CARB_TOPUP_FOOD_IDS: readonly string[] = [
  'brown-rice',
  'multigrain-rice',
  'oat-rice',
  'oats',
  'chickpea',
  'lentil',
];

/**
 * Fat caps as a share of kcal (PLAN.md 4.1-2). Default diet: step 3 fills to 30%, step 5 to 35%
 * (IOM AMDR upper bound). Fat is only ever added through fat-category foods (nuts, seeds, avocado) and
 * cold-pressed oils, and each fat step keeps fat <= the cap share of the kcal actually eaten.
 */
export const FAT_KCAL_RATIO_STAGE1 = 0.3;
export const FAT_KCAL_RATIO_STAGE2 = 0.35;
/**
 * Not used by the default diet. Reserved for a future "low-carb" style: unsaturated fat sources only,
 * up to 45% of kcal (fill step fatToStage3 in KCAL_FILL_ORDER_LOW_CARB).
 */
export const FAT_KCAL_RATIO_UNSAT_MAX_LOW_CARB = 0.45;
/** Saturated fat: aim below 7% of kcal (KDRI 2020, 19+), weak penalty 7-10%, strong at 10%+ (WHO, DGA). */
export const SAT_FAT_KCAL_RATIO_TARGET = 0.07;
export const SAT_FAT_KCAL_RATIO_MAX = 0.1;
/** KDRI 2020: cholesterol below 300 mg/day (19+). Above it is penalized. */
export const CHOLESTEROL_DAY_MAX_MG = 300;

/** Fiber above this per day gets a weak penalty (split across meals by ratio). */
export const FIBER_DAY_SOFT_MAX = 50;
/** WHO recommendation. The default diet only keeps below it; users may set it lower. */
export const SODIUM_DAY_MAX = 2000;

// ---- KDRI 2020 reference intakes by sex and age (PLAN.md 4.1-3) ---------------
// Source: Ministry of Health and Welfare press release 2020-12-23, attachment 5 (2020 KDRI summary table),
// checked against the original. RNI where one exists, else AI (potassium, vitamin D, fiber).

export type AgeBand = '19-29' | '30-49' | '50-64' | '65-74' | '75+';
export type MicroKey =
  'calcium' | 'iron' | 'potassium' | 'vitaminC' | 'vitaminA' | 'vitaminD';
export const MICRO_KEYS: readonly MicroKey[] = [
  'calcium',
  'iron',
  'potassium',
  'vitaminC',
  'vitaminA',
  'vitaminD',
];
/** fiber g, calcium/iron/potassium/vitaminC mg, vitaminA μg RAE, vitaminD μg (per day). */
export type KdriRow = { fiber: number } & Record<MicroKey, number>;

export const KDRI_2020: Record<Sex, Record<AgeBand, KdriRow>> = {
  male: {
    '19-29': {
      fiber: 30,
      calcium: 800,
      iron: 10,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 800,
      vitaminD: 10,
    },
    '30-49': {
      fiber: 30,
      calcium: 800,
      iron: 10,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 800,
      vitaminD: 10,
    },
    '50-64': {
      fiber: 30,
      calcium: 750,
      iron: 10,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 750,
      vitaminD: 10,
    },
    '65-74': {
      fiber: 25,
      calcium: 700,
      iron: 9,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 700,
      vitaminD: 15,
    },
    '75+': {
      fiber: 25,
      calcium: 700,
      iron: 9,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 700,
      vitaminD: 15,
    },
  },
  female: {
    '19-29': {
      fiber: 20,
      calcium: 700,
      iron: 14,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 650,
      vitaminD: 10,
    },
    '30-49': {
      fiber: 20,
      calcium: 700,
      iron: 14,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 650,
      vitaminD: 10,
    },
    '50-64': {
      fiber: 20,
      calcium: 800,
      iron: 8,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 600,
      vitaminD: 10,
    },
    '65-74': {
      fiber: 20,
      calcium: 800,
      iron: 8,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 600,
      vitaminD: 15,
    },
    '75+': {
      fiber: 20,
      calcium: 800,
      iron: 7,
      potassium: 3500,
      vitaminC: 100,
      vitaminA: 600,
      vitaminD: 15,
    },
  },
};
/** Age bands' lower bounds; ages under 19 use the 19-29 row (the app is for adults). */
export const AGE_BANDS: readonly { from: number; band: AgeBand }[] = [
  { from: 75, band: '75+' },
  { from: 65, band: '65-74' },
  { from: 50, band: '50-64' },
  { from: 30, band: '30-49' },
  { from: 0, band: '19-29' },
];
/**
 * A micronutrient is listed as short, and weakly penalized, only when the day total is below this share of its
 * KDRI value (allows for day-to-day variation).
 */
export const MICRO_SHORTFALL_RATIO = 0.9;
/**
 * Micronutrients that are hard to cover from food alone (vitamin D: sun and fortified foods). A shortfall is
 * still listed, with a note, but it is not penalized in the score.
 */
export const MICROS_HARD_FROM_FOOD: readonly MicroKey[] = ['vitaminD'];

export const MEAL_SPLIT: Record<
  MealsPerDay,
  readonly { mealType: MealType; ratio: number }[]
> = {
  3: [
    { mealType: 'breakfast', ratio: 0.3 },
    { mealType: 'lunch', ratio: 0.35 },
    { mealType: 'dinner', ratio: 0.35 },
  ],
  2: [
    { mealType: 'lunch', ratio: 0.5 },
    { mealType: 'dinner', ratio: 0.5 },
  ],
};

// ---- Health flags (PLAN.md 4.4) ---------------------------------------------

export const HIGH_PROTEIN_WARN_PER_KG = 1.6;
/** KDRI 2020 sodium adequate intake. LOW_SODIUM fires only when the user *sets* the sodium cap below it. */
export const LOW_SODIUM_WARN_MG = 1500;
export const LOW_NET_CARB_WARN_G = 50;
/** Day fat above this share of kcal raises HIGH_FAT_MOSTLY_UNSAT (when saturated fat is under its cap). */
export const HIGH_FAT_WARN_RATIO = 0.35;

// ---- Portions and kcal fill order (PLAN.md 4.2, 5-2) -------------------------

export type KcalFillStep =
  | 'proteinBase'
  | 'carbsToLimit'
  | 'fatToStage1'
  | 'proteinToMax'
  | 'fatToStage2'
  | 'fatToStage3'
  | 'carbsTopUp'
  | 'reportGap';

/**
 * Default diet (all goals, PLAN.md 4.2). Steps 1-2 are solved together with the vegetables (they depend on
 * each other's protein/fiber); the later steps run in this order, each only up to the kcal target.
 */
export const KCAL_FILL_ORDER: readonly KcalFillStep[] = [
  'proteinBase', // 1 base protein
  'carbsToLimit', // 2 net carbs to the base ratio
  'fatToStage1', // 3 fat to 30%
  'proteinToMax', // 4 protein up to the goal's cap
  'fatToStage2', // 5 fat to 35%
  'carbsTopUp', // 6 whole grains / legumes until total carbs reach 45%
  'reportGap', // 7 what is still missing
];
/** Reserved for the future "low-carb" style: unsaturated fat to 45% before any carb top-up. Not used yet. */
export const KCAL_FILL_ORDER_LOW_CARB: readonly KcalFillStep[] = [
  'proteinBase',
  'carbsToLimit',
  'fatToStage1',
  'proteinToMax',
  'fatToStage2',
  'fatToStage3',
  'reportGap',
];

/** Meal kcal below this share of the target gets a warning. */
export const MEAL_KCAL_WARN_RATIO = 0.8;

/** Each vegetable starts here and only grows when fiber is short. */
export const VEGGIE_DEFAULT_G = 100;
/** Upper bound for the protein/carb/vegetable fixed-point loop. */
export const PORTION_SOLVER_MAX_ITER = 10;
/** Kinds of cold-pressed oil used in one meal. */
export const MAX_OIL_KINDS_PER_MEAL = 1;

// ---- Seasonings (PLAN.md 5-3) -----------------------------------------------

/** Kinds of salty seasoning (salt, soy sauce, doenjang, ...) per meal. Free (no-sodium) ones come first. */
export const MAX_SALTY_SEASONINGS_PER_MEAL = 1;
/** Salty seasonings may use only this share of the meal's seasoning sodium budget. */
export const SEASONING_SODIUM_BUDGET_RATIO = 0.6;

// ---- Scoring and diversity (PLAN.md 5-4, 5-5, 5-6) ----------------------------

/** Weights on relative errors. Lower total score = better. */
export const SCORE_WEIGHTS = {
  kcal: 1.0,
  protein: 1.0,
  carbOver: 1.5, // total carbs above the 45% cap (+ tolerance)
  carbUnder: 1.0, // total carbs below the 100 g/day share
  fiberUnder: 1.0,
  fiberOver: 0.2, // weak: fiber above the soft max
  satFatOver: 3.0, // strong: saturated fat at/above 10% of kcal
  satFatAboveTarget: 0.5, // weak: between 7% and 10%
  cholesterolOver: 1.0, // above the 300 mg/day share
  microUnder: 0.05, // weak, per micronutrient below its KDRI share
  sodiumOver: 1.5,
  fatOver: 1.0,
} as const;
/** Inside this share of the kcal target (±) the kcal penalty is only the small inside weight below. */
export const KCAL_SCORE_TOLERANCE_RATIO = 0.1;
/** Small weight on the relative kcal error inside the tolerance, so ~95-100% beats ~90%. */
export const KCAL_SCORE_INSIDE_WEIGHT = 0.3;
/** Total carbs may go this many grams over the cap without a penalty (per meal; the day total is held to the same). */
export const CARB_TOLERANCE_G = 2;
/** Subtracted per favorite food or seasoning in the combo. */
export const FAVORITE_BONUS = 0.05;

/** MMR penalties added per already-picked combo that shares the item. */
export const MMR_PENALTY = {
  sameProtein: 0.3,
  sameCarb: 0.1,
  sameFat: 0.05,
  sameVeggie: 0.03,
} as const;

/**
 * Protein groups by food `group`. The meals of one day use different groups when the user selected enough
 * groups (PLAN.md 5-6).
 */
export const PROTEIN_GROUPS = {
  meat: ['닭', '소고기', '돼지고기', '오리'],
  seafood: ['생선', '해산물'],
  eggBeanDairy: ['달걀·콩', '유제품'],
} as const satisfies Record<string, readonly string[]>;
export type ProteinGroup = keyof typeof PROTEIN_GROUPS;
export const PROTEIN_GROUP_LABELS: Record<ProteinGroup, string> = {
  meat: '육류',
  seafood: '생선·해산물',
  eggBeanDairy: '달걀·콩·유제품',
};
/** Best combos per protein group added to each meal's options when planning the day. */
export const DAY_PLAN_OPTIONS_PER_GROUP = 2;
/** Diverse (MMR) combos per meal the day planner chooses from, besides the per-group ones. */
export const DAY_PLAN_OPTIONS_PER_MEAL = 15;
/** MMR only looks at this many best-scoring candidates (keeps it fast). */
export const MMR_POOL_SIZE = 2000;

export const COMBOS_PER_MEAL = 5;
/** Vegetable sets kept per meal before combining with proteins/carbs/fats (keeps generation fast). */
export const FIBER_SETS_PER_MEAL = 12;
/** Penalty per vegetable shared with an already-kept set, so the kept sets are not all built on one vegetable. */
export const FIBER_SET_REPEAT_PENALTY = 0.15;

// ---- Food cards (PLAN.md 3.2) -----------------------------------------------

/** Non-category nutrient per 100 g that earns a bonus badge (PLAN.md 5-3-1). */
export const BONUS_PROTEIN_MIN_PER100G = 8;
export const BONUS_FIBER_MIN_PER100G = 5;

/** MFDS daily reference values (1일 영양성분 기준치). mg, vitaminA in μg RAE. */
export const DAILY_VALUES = {
  potassium: 3500,
  calcium: 700,
  iron: 12,
  vitaminA: 700,
  vitaminC: 100,
} as const;
/** A micronutrient chip needs at least this share of the daily value in one serving. */
export const MICRO_CHIP_MIN_DV_RATIO = 0.15;
/** Serving = unit.grams if present, else this clamped to the food's portion range. */
export const SERVING_DEFAULT_G = 100;

export const LOW_FAT_MAX_PER100G = 3;
export const HIGH_SODIUM_MIN_PER100G = 150;
export const HIGH_FAT_PROTEIN_MIN_PER100G = 10;
export const MAX_CHIPS = 2;
