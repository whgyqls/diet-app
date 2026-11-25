import { describe, expect, it } from 'vitest';
import { FOODS } from './test-fixtures';
import {
  canAddInclude,
  effectiveIncludes,
  includeCapacity,
  isIncludable,
} from './includeFoods';
import { INCLUDE_PER_MEAL_MAX, OIL_GROUP } from './constants';
import type { Selection } from '@/types/nutrition';

const ofCat = (c: string) => FOODS.filter((f) => f.category === c);
const sel = (...ids: string[]): Selection => ({
  foods: Object.fromEntries(ids.map((i) => [i, 'ok' as const])),
  seasonings: {},
});

describe('includeCapacity', () => {
  it('is the per-meal limit times the meals of the day', () => {
    const c = includeCapacity(3);
    expect(c.protein).toBe(INCLUDE_PER_MEAL_MAX.protein * 3);
    expect(c.fiber).toBe(INCLUDE_PER_MEAL_MAX.fiber * 3);
    expect(includeCapacity(2).fiber).toBe(INCLUDE_PER_MEAL_MAX.fiber * 2);
  });
});

describe('canAddInclude', () => {
  const proteins = ofCat('protein');
  it('allows foods up to the category capacity and refuses the next one', () => {
    const cap = includeCapacity(2).protein;
    const current = proteins.slice(0, cap).map((f) => f.id);
    expect(
      canAddInclude(current.slice(0, cap - 1), proteins[cap - 1], FOODS, 2),
    ).toBe(true);
    expect(canAddInclude(current, proteins[cap], FOODS, 2)).toBe(false);
  });
  it('a food already in the list can always stay', () => {
    const cap = includeCapacity(2).protein;
    const current = proteins.slice(0, cap).map((f) => f.id);
    expect(canAddInclude(current, proteins[0], FOODS, 2)).toBe(true);
  });
  it('other categories are counted separately', () => {
    const current = proteins
      .slice(0, includeCapacity(2).protein)
      .map((f) => f.id);
    expect(canAddInclude(current, ofCat('carb')[0], FOODS, 2)).toBe(true);
  });
});

describe('effectiveIncludes', () => {
  const [a, b, c] = ofCat('protein');
  it('keeps selected foods in order and removes duplicates', () => {
    const r = effectiveIncludes(
      [b.id, a.id, b.id],
      sel(a.id, b.id),
      FOODS,
      () => false,
    );
    expect(r.kept).toEqual([b.id, a.id]);
    expect(r.dropped).toEqual([]);
  });
  it('drops a food that is no longer selected', () => {
    const r = effectiveIncludes([a.id, c.id], sel(a.id), FOODS, () => false);
    expect(r.kept).toEqual([a.id]);
    expect(r.dropped).toEqual([{ id: c.id, reason: 'NOT_SELECTED' }]);
  });
  it('drops a food the styles exclude', () => {
    const r = effectiveIncludes(
      [a.id, b.id],
      sel(a.id, b.id),
      FOODS,
      (f) => f.id === b.id,
    );
    expect(r.dropped).toEqual([{ id: b.id, reason: 'STYLE_EXCLUDED' }]);
  });
  it('drops unknown ids and oils', () => {
    const oil = FOODS.find((f) => f.group === OIL_GROUP);
    expect(oil).toBeDefined();
    expect(isIncludable(oil!)).toBe(false);
    const r = effectiveIncludes(
      ['nope', oil!.id],
      sel(oil!.id),
      FOODS,
      () => false,
    );
    expect(r.kept).toEqual([]);
    // a food that is not in the data and an oil are told apart (they get different notices)
    expect(r.dropped.map((d) => d.reason)).toEqual(['UNKNOWN', 'OIL']);
  });
});
