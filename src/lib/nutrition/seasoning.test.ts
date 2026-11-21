import { describe, expect, it } from 'vitest';
import type { Seasoning } from '@/types/food';
import type { Selection } from '@/types/nutrition';
import { recommendSeasonings } from './seasoning';
import { LUNCH, SEASONINGS, food, selectAll } from './test-fixtures';
import { nutrientsOf } from './portions';

const mk = (
  id: string,
  sodium: number,
  maxUnitsPerMeal: number,
  extra: Partial<Seasoning> = {},
): Seasoning => ({
  id,
  name: id,
  unit: { label: '작은술', grams: 5 },
  perUnit: { kcal: 5, carbs: 0.5, sodium },
  maxUnitsPerMeal,
  ...extra,
});

const A = mk('a', 100, 2);
const B = mk('b', 150, 1);
const FREE = mk('free', 0, 3, { free: true });
const OIL = mk('oil', 0, 2, {
  oil: true,
  perUnit: { kcal: 40, carbs: 0, sodium: 0 },
});
const ALL = [A, B, FREE, OIL];
const allOk: Selection['seasonings'] = {
  a: 'ok',
  b: 'ok',
  free: 'ok',
  oil: 'ok',
};
const t = (sodiumMax: number) => ({ ...LUNCH, sodiumMax });
const summary = (r: ReturnType<typeof recommendSeasonings>) =>
  r.picks.map((p) => `${p.seasoning.id}x${p.units}`);

describe('recommendSeasonings', () => {
  it('budget = meal sodium cap - sodium already in the food; salty seasonings get 60% of it', () => {
    const r = recommendSeasonings(300, t(560), ALL, allOk);
    expect(r.budget).toBe(260);
    expect(r.allowed).toBeCloseTo(156, 9);
  });

  it('uses one salty seasoning, as much as fits in 60% of the budget', () => {
    // allowed 156: a x1 = 100, a x2 = 200 (too much), b x1 = 150 -> b
    expect(summary(recommendSeasonings(0, t(260), ALL, allOk))).toEqual([
      'bx1',
    ]);
    // allowed 126: only a x1 fits
    expect(summary(recommendSeasonings(0, t(210), ALL, allOk))).toEqual([
      'ax1',
    ]);
  });

  it('prefers favorites over using more of the budget', () => {
    const fav = { ...allOk, a: 'favorite' as const };
    expect(summary(recommendSeasonings(0, t(260), ALL, fav))).toEqual(['ax1']);
  });

  it('never suggests oils or free seasonings as salty picks, and lists selected free ones', () => {
    const r = recommendSeasonings(0, t(1000), ALL, allOk);
    expect(r.picks.every((p) => !p.seasoning.free && !p.seasoning.oil)).toBe(
      true,
    );
    expect(r.free.map((s) => s.id)).toEqual(['free']);
  });

  it('suggests nothing salty when the food alone uses up the budget', () => {
    const salty = [food('squid'), food('young-cabbage'), food('celery')];
    const sodium = salty.reduce(
      (a, f) => a + nutrientsOf(f, f.portion.max).sodium,
      0,
    );
    expect(sodium).toBeGreaterThan(700);
    const r = recommendSeasonings(
      sodium,
      t(700),
      SEASONINGS,
      selectAll().seasonings,
    );
    expect(r.picks).toEqual([]);
    expect(r.reason).toBe('NO_SODIUM_BUDGET');
    expect(r.free.length).toBeGreaterThan(0);
  });

  it('reports NO_SODIUM_BUDGET when even one unit does not fit', () => {
    const r = recommendSeasonings(0, t(90), ALL, allOk);
    expect(r.picks).toEqual([]);
    expect(r.reason).toBe('NO_SODIUM_BUDGET');
  });

  it('reports NO_SALTY_SELECTED when the user picked no salty seasoning', () => {
    const r = recommendSeasonings(0, t(700), ALL, { free: 'ok', oil: 'ok' });
    expect(r.picks).toEqual([]);
    expect(r.reason).toBe('NO_SALTY_SELECTED');
    expect(recommendSeasonings(0, t(700), ALL, {}).free).toEqual([]);
  });

  it('keeps to one salty seasoning and 60% of the budget even when more would fit and the meal is low in sodium', () => {
    // budget 700: a x2 (200) + b x1 (150) would fit, but only one kind and at most 420 mg are allowed
    const r = recommendSeasonings(0, t(700), ALL, allOk);
    expect(r.allowed).toBeCloseTo(420, 9);
    expect(r.picks).toHaveLength(1);
    const used = r.picks.reduce(
      (a, p) => a + p.seasoning.perUnit.sodium * p.units,
      0,
    );
    expect(used).toBeLessThanOrEqual(420);
  });

  it('stays within the budget and per-seasoning limits on real data', () => {
    for (const budget of [0, 50, 120, 333, 700]) {
      const r = recommendSeasonings(
        0,
        t(budget),
        SEASONINGS,
        selectAll().seasonings,
      );
      const used = r.picks.reduce(
        (a, p) => a + p.seasoning.perUnit.sodium * p.units,
        0,
      );
      expect(used).toBeLessThanOrEqual(budget * 0.6);
      expect(r.picks.length).toBeLessThanOrEqual(1);
      for (const p of r.picks)
        expect(p.units).toBeLessThanOrEqual(p.seasoning.maxUnitsPerMeal);
    }
  });
});
