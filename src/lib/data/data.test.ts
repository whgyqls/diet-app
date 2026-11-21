import { describe, expect, it } from 'vitest';
import foodsJson from '../../../data/foods.json';
import seasoningsJson from '../../../data/seasonings.json';
import {
  KCAL_CHECK_EXCLUDED_GROUPS,
  KCAL_CHECK_TOLERANCE,
  KCAL_PER_GRAM,
  OIL_GROUP,
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

  it('has 84 foods (68 from Phase 1 + 13 fat sources from Phase 2 + 3 oils moved from seasonings)', () => {
    expect(foods).toHaveLength(84);
    expect(foods.filter((f) => f.category === 'fat')).toHaveLength(16);
  });

  it('has the three cold-pressed oils as fat foods in the oil group, 1 tsp = 4.5 g, 4.5-9 g per meal (sesame oil 4.5 g)', () => {
    const oils = foods.filter((f) => f.group === OIL_GROUP);
    expect(oils.map((f) => f.id).sort()).toEqual(['olive-oil', 'perilla-oil', 'sesame-oil']);
    for (const f of oils) {
      expect(f.category, f.id).toBe('fat');
      expect(f.basis, f.id).toBe('raw');
      expect(f.unit, f.id).toEqual({ label: '작은술', grams: 4.5 });
      expect(f.portion, f.id).toEqual({
        min: 4.5,
        max: f.id === 'sesame-oil' ? 4.5 : 9, // sesame oil: 1 tsp per meal (strong flavor)
        step: 4.5,
      });
      expect(f.per100g.sodium, f.id).toBeLessThanOrEqual(7); // olive oil 7 mg/100 g in the CSV = 0.3 mg per tsp
      expect(f.per100g.fat, f.id).toBeGreaterThan(99);
    }
    expect(oils.find((f) => f.id === 'olive-oil')?.name).toBe('엑스트라버진 올리브유');
  });

  it('takes the oil values from the raw-food CSV (식품성분표 유지류)', () => {
    const code = (id: string) => foods.find((f) => f.id === id)?.source?.items.map((i) => [i.file, i.code]);
    expect(code('olive-oil')).toEqual([['raw_foods_utf8.csv', 'R114-017000000-0000']]);
    expect(code('perilla-oil')).toEqual([['raw_foods_utf8.csv', 'R114-003000000-0000']]);
    expect(code('sesame-oil')).toEqual([['raw_foods_utf8.csv', 'R114-020000000-0000']]);
    const sat = (id: string) => foods.find((f) => f.id === id)?.per100g.satFat;
    expect(sat('olive-oil')).toBe(15.7); // CSV 15.73, rounded to 1 decimal like every food
    expect(sat('perilla-oil')).toBe(8.8);
    expect(sat('sesame-oil')).toBe(14.9);
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

  it('no longer holds the oils (they are fat foods now)', () => {
    expect(seasonings.filter((s) => s.id.endsWith('-oil')).map((s) => s.id)).toEqual([]);
    expect(seasonings).toHaveLength(13);
  });

  it('shares no ids with foods', () => {
    const foodIds = new Set(foods.map((f) => f.id));
    expect(seasonings.filter((s) => foodIds.has(s.id)).map((s) => s.id)).toEqual([]);
  });
});
