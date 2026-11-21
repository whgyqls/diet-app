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

  it('has 81 foods (68 from Phase 1 + 13 fat sources from Phase 2)', () => {
    expect(foods).toHaveLength(81);
    expect(foods.filter((f) => f.category === 'fat')).toHaveLength(13);
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

  it('has no cholesterol in plant foods', () => {
    expect(
      foods
        .filter((f) => ['carb', 'fiber', 'fat'].includes(f.category))
        .filter((f) => f.per100g.cholesterol > 0)
        .map((f) => f.id),
    ).toEqual(['flaxseed']); // the only plant entry with a non-zero value in the source CSV (2 mg)
  });

  it('caps eggs at 2 per meal (100 g)', () => {
    expect(foods.find((f) => f.id === 'egg')?.portion.max).toBe(100);
  });

  it('has saturated fat no larger than total fat', () => {
    expect(
      foods.filter((f) => f.per100g.satFat > f.per100g.fat).map((f) => f.id),
    ).toEqual([]);
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

  it('marks exactly the three cold-pressed oils as oil, none of them salty or free', () => {
    const oils = seasonings.filter((s) => s.oil);
    expect(oils.map((s) => s.id).sort()).toEqual(['olive-oil', 'perilla-oil', 'sesame-oil']);
    expect(oils.filter((s) => s.perUnit.sodium > 0 || s.free)).toEqual([]);
    expect(oils.filter((s) => s.perUnit.satFat === undefined)).toEqual([]);
    expect(oils.find((s) => s.id === 'olive-oil')?.name).toBe('엑스트라버진 올리브유');
  });

  it('shares no ids with foods', () => {
    const foodIds = new Set(foods.map((f) => f.id));
    expect(seasonings.filter((s) => foodIds.has(s.id)).map((s) => s.id)).toEqual([]);
  });
});
