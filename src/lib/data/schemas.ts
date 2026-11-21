import { z } from 'zod';
import type { FoodsFile, SeasoningsFile } from '@/types/food';

const nonNeg = z.number().nonnegative();
const positive = z.number().positive();

const servingUnitSchema = z.strictObject({ label: z.string().min(1), grams: positive });

const sourceItemSchema = z.strictObject({
  file: z.enum(['raw_foods_utf8.csv', 'integrated_foods_utf8.csv', 'USDA FoodData Central']),
  code: z.string().min(1),
  name: z.string().min(1),
});

const foodSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  category: z.enum(['protein', 'carb', 'fiber', 'fat']),
  group: z.string().min(1),
  basis: z.enum(['raw', 'cooked']),
  per100g: z.strictObject({
    kcal: nonNeg,
    protein: nonNeg,
    carbs: nonNeg,
    fiber: nonNeg,
    fat: nonNeg,
    satFat: nonNeg,
    sodium: nonNeg,
    cholesterol: nonNeg,
  }),
  micro100g: z
    .strictObject({
      potassium: nonNeg.optional(),
      calcium: nonNeg.optional(),
      iron: nonNeg.optional(),
      vitaminA: nonNeg.optional(),
      vitaminC: nonNeg.optional(),
      vitaminD: nonNeg.optional(),
    })
    .optional(),
  note: z.string().min(1).optional(),
  source: z
    .strictObject({
      items: z.array(sourceItemSchema).min(1),
      method: z.string().min(1),
      flags: z.array(z.enum(['추정', '보충', '가슴살 기준값'])).min(1).optional(),
    })
    .optional(),
  _todo: z.string().optional(),
  portion: z.strictObject({ min: positive, max: positive, step: positive }),
  unit: servingUnitSchema.optional(),
  cookingHint: z.string(),
});

const seasoningSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  unit: servingUnitSchema,
  perUnit: z.strictObject({
    kcal: nonNeg,
    carbs: nonNeg,
    sodium: nonNeg,
    satFat: nonNeg.optional(),
  }),
  free: z.boolean().optional(),
  oil: z.boolean().optional(),
  maxUnitsPerMeal: z.number().int().positive(),
});

export const foodsFileSchema = z.strictObject({
  _note: z.string().optional(),
  version: z.string().min(1),
  foods: z.array(foodSchema).min(1),
}) satisfies z.ZodType<FoodsFile>;

export const seasoningsFileSchema = z.strictObject({
  _note: z.string().optional(),
  version: z.string().min(1),
  seasonings: z.array(seasoningSchema).min(1),
}) satisfies z.ZodType<SeasoningsFile>;
