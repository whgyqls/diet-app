// Test-only helpers: real data parsed through the schemas, and a factory for synthetic foods.
import foodsJson from '../../../data/foods.json';
import seasoningsJson from '../../../data/seasonings.json';
import { foodsFileSchema, seasoningsFileSchema } from '@/lib/data/schemas';
import type { Food, Seasoning } from '@/types/food';
import type { MealTargets, Profile, Selection } from '@/types/nutrition';

export const FOODS: Food[] = foodsFileSchema.parse(foodsJson).foods;
export const SEASONINGS: Seasoning[] =
  seasoningsFileSchema.parse(seasoningsJson).seasonings;

export function food(id: string): Food {
  const f = FOODS.find((x) => x.id === id);
  if (!f) throw new Error(`no food ${id}`);
  return f;
}

export function seasoning(id: string): Seasoning {
  const s = SEASONINGS.find((x) => x.id === id);
  if (!s) throw new Error(`no seasoning ${id}`);
  return s;
}

export function makeFood(
  over: Partial<Food> & Pick<Food, 'id' | 'category'>,
): Food {
  return {
    name: over.id,
    group: 'test',
    basis: 'raw',
    per100g: {
      kcal: 100,
      protein: 0,
      carbs: 0,
      fiber: 0,
      fat: 0,
      satFat: 0,
      sodium: 0,
      cholesterol: 0,
    },
    portion: { min: 50, max: 200, step: 10 },
    cookingHint: '',
    ...over,
  };
}

export function selectAll(
  foods: Food[] = FOODS,
  seasonings: Seasoning[] = SEASONINGS,
): Selection {
  return {
    foods: Object.fromEntries(foods.map((f) => [f.id, 'ok' as const])),
    seasonings: Object.fromEntries(
      seasonings.map((s) => [s.id, 'ok' as const]),
    ),
  };
}

/** Lunch for a 60 kg woman losing weight (3 meals, 35%), rounded for readable tests. */
export const LUNCH: MealTargets = {
  mealType: 'lunch',
  ratio: 0.35,
  goal: 'lose',
  kcal: 535,
  protein: { base: 33.6, max: 42 },
  netCarbMax: 26.7,
  totalCarbMax: 60.2, // 45% of kcal
  totalCarbMin: 35, // 100 g/day x 0.35
  carbTopUp: true,
  fat: { stage1: 17.8, stage2: 20.8, stage3: 20.8 }, // default diet: stage 3 = stage 2 (35%)
  satFatTarget: 4.2,
  satFatMax: 5.9,
  cholesterolMax: 105,
  fiberMin: 10.5,
  fiberSoftMax: 17.5,
  sodiumMin: 525,
  sodiumMax: 700,
  // KDRI 2020 woman 30-49 x 0.35
  micros: {
    calcium: 245,
    iron: 4.9,
    potassium: 1225,
    vitaminC: 35,
    vitaminA: 227.5,
    vitaminD: 3.5,
  },
};

export const EXAMPLE_PROFILES: { label: string; profile: Profile }[] = [
  {
    label: '감량 여성 60kg',
    profile: {
      sex: 'female',
      birthYear: 1996,
      heightCm: 163,
      weightKg: 60,
      activityLevel: 2,
      goal: 'lose',
      mealsPerDay: 3,
    },
  },
  {
    label: '유지 남성 75kg',
    profile: {
      sex: 'male',
      birthYear: 1996,
      heightCm: 175,
      weightKg: 75,
      activityLevel: 3,
      goal: 'maintain',
      mealsPerDay: 3,
    },
  },
  {
    label: '근육 증가 남성 70kg',
    profile: {
      sex: 'male',
      birthYear: 1996,
      heightCm: 175,
      weightKg: 70,
      activityLevel: 3,
      goal: 'gain',
      mealsPerDay: 3,
    },
  },
];

export const REF_YEAR = 2026;
