// Shared data types for data/foods.json and data/seasonings.json (PLAN.md section 6).

/** fat = nuts, seeds, avocado: whole foods rich in unsaturated fat. */
export type FoodCategory = 'protein' | 'carb' | 'fiber' | 'fat';
export type WeightBasis = 'raw' | 'cooked';

/** Nutrients per 100 g. Weights in g, sodium in mg. */
export type Per100g = {
  kcal: number;
  protein: number;
  carbs: number;
  fiber: number;
  fat: number;
  satFat: number; // saturated fatty acids
  sodium: number;
  cholesterol: number; // mg
};

/** Micronutrients per 100 g. mg, except vitaminA (μg RAE) and vitaminD (μg). Missing = not in source data. */
export type Micro100g = {
  potassium?: number;
  calcium?: number;
  iron?: number;
  vitaminA?: number;
  vitaminC?: number;
  vitaminD?: number; // μg
};

export type SourceFile =
  'raw_foods_utf8.csv' | 'integrated_foods_utf8.csv' | 'USDA FoodData Central';

/** 추정 = derived by calculation, 보충 = blank filled from another entry, 가슴살 기준값 = chicken breast values used as a stand-in. */
export type SourceFlag = '추정' | '보충' | '가슴살 기준값';

export type SourceItem = {
  file: SourceFile;
  code: string; // 식품코드 (or FDC ID for USDA)
  name: string; // 식품명 as written in the source
};

export type FoodSource = {
  items: SourceItem[];
  method: string; // how the values were derived from items (Korean, for reviewers)
  flags?: SourceFlag[];
};

export type Portion = { min: number; max: number; step: number }; // g

export type ServingUnit = { label: string; grams: number };

export type Food = {
  id: string;
  name: string;
  category: FoodCategory;
  group: string;
  basis: WeightBasis;
  per100g: Per100g;
  micro100g?: Micro100g;
  note?: string;
  source?: FoodSource;
  _todo?: string;
  portion: Portion;
  unit?: ServingUnit;
  cookingHint: string;
};

export type Seasoning = {
  id: string;
  name: string;
  unit: ServingUnit;
  perUnit: { kcal: number; carbs: number; sodium: number; satFat?: number };
  free?: boolean;
  /** Cold-pressed oil (pure fat). Used by the kcal fill steps, not by the sodium budget. */
  oil?: boolean;
  maxUnitsPerMeal: number;
};

export type FoodsFile = { _note?: string; version: string; foods: Food[] };
export type SeasoningsFile = {
  _note?: string;
  version: string;
  seasonings: Seasoning[];
};
