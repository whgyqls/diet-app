import { describe, expect, it } from 'vitest';
import foodsJson from '../../../data/foods.json';
import seasoningsJson from '../../../data/seasonings.json';
import {
  KCAL_CHECK_EXCLUDED_GROUPS,
  KCAL_CHECK_TOLERANCE,
  KCAL_PER_GRAM,
} from '@/lib/nutrition/constants';
import { foodsFileSchema, seasoningsFileSchema } from './schemas';

const foodsResult = foodsFileSchema.safeParse(foodsJson);
const seasoningsResult = seasoningsFileSchema.safeParse(seasoningsJson);
const foods = foodsResult.success ? foodsResult.data.foods : [];
const seasonings = seasoningsResult.success ? seasoningsResult.data.seasonings : [];

function duplicates(ids: string[]): string[] {
  return ids.filter((id, i) => ids.indexOf(id) !== i);
}

describe('data/foods.json', () => {
  it('passes the schema', () => {
    expect(foodsResult.error?.issues ?? []).toEqual([]);
  });

  it('has 68 foods', () => {
    expect(foods).toHaveLength(68);
  });

  it('has no duplicate ids', () => {
    expect(duplicates(foods.map((f) => f.id))).toEqual([]);
  });

  it('has stated kcal within tolerance of 4P + 4(C-F) + 2F + 9fat (mushrooms excluded)', () => {
    const offenders = foods
      .filter((f) => !KCAL_CHECK_EXCLUDED_GROUPS.includes(f.group))
      .map((f) => {
        const { kcal, protein, carbs, fiber, fat } = f.per100g;
        const computed =
          KCAL_PER_GRAM.protein * protein +
          KCAL_PER_GRAM.netCarbs * (carbs - fiber) +
          KCAL_PER_GRAM.fiber * fiber +
          KCAL_PER_GRAM.fat * fat;
        return { id: f.id, kcal, computed: Math.round(computed), gap: Math.abs(kcal - computed) / kcal };
      })
      .filter((r) => r.gap > KCAL_CHECK_TOLERANCE);
    expect(offenders).toEqual([]);
  });

  it('has portion min <= max', () => {
    expect(foods.filter((f) => f.portion.min > f.portion.max).map((f) => f.id)).toEqual([]);
  });

  it('has portion min and max divisible by step', () => {
    const bad = foods.filter((f) => f.portion.min % f.portion.step !== 0 || f.portion.max % f.portion.step !== 0);
    expect(bad.map((f) => f.id)).toEqual([]);
  });
});

describe('data/seasonings.json', () => {
  it('passes the schema', () => {
    expect(seasoningsResult.error?.issues ?? []).toEqual([]);
  });

  it('has no duplicate ids', () => {
    expect(duplicates(seasonings.map((s) => s.id))).toEqual([]);
  });

  it('shares no ids with foods', () => {
    const foodIds = new Set(foods.map((f) => f.id));
    expect(seasonings.filter((s) => foodIds.has(s.id)).map((s) => s.id)).toEqual([]);
  });
});
