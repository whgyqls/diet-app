import { beforeAll, describe, expect, it } from 'vitest';
import type { MealCombo, MealTargets, Selection } from '@/types/nutrition';
import { comboProteinGroup, generateMealCombos } from './generate';
import { generateMealOptions } from './mealOptions';
import { calcDayTargets, calcMealTargets } from './targets';
import { resolveStyles } from './styles';
import {
  EXAMPLE_PROFILES,
  FOODS,
  REF_YEAR,
  SEASONINGS,
  selectAll,
} from './test-fixtures';

const profile = EXAMPLE_PROFILES[1].profile;
const mealTargets = (): MealTargets[] => {
  const { targets } = calcDayTargets(
    profile,
    REF_YEAR,
    undefined,
    resolveStyles([], profile.goal),
  );
  return calcMealTargets(targets, 3);
};
let lunch: MealTargets;
beforeAll(() => {
  lunch = mealTargets()[1];
});

const base = (selection: Selection = selectAll()) => ({
  foods: FOODS,
  seasonings: SEASONINGS,
  selection,
  targets: lunch,
});
const keys = (c: MealCombo[]) => c.map((x) => x.key);

describe('generateMealOptions', () => {
  it('without dayContext it returns exactly what generateMealCombos returns', () => {
    const a = generateMealOptions({ ...base(), count: 5 });
    const b = generateMealCombos({ ...base(), count: 5 });
    expect(keys(a.combos)).toEqual(keys(b.combos));
    expect(a.exhausted).toBe(false);
  });

  it('never returns a combo that was already seen', () => {
    const first = generateMealOptions({ ...base(), count: 5 }).combos;
    const next = generateMealOptions({
      ...base(),
      count: 5,
      seen: keys(first),
    }).combos;
    expect(next).toHaveLength(5);
    for (const k of keys(next)) expect(keys(first)).not.toContain(k);
  });

  it('keeps locked foods in every combo', () => {
    const { combos } = generateMealOptions({
      ...base(),
      count: 5,
      locked: ['beef-eye-round', 'cabbage'],
    });
    expect(combos.length).toBeGreaterThan(0);
    for (const c of combos) {
      const ids = c.items.map((i) => i.food.id);
      expect(ids).toContain('beef-eye-round');
      expect(ids).toContain('cabbage');
    }
  });

  it('is exhausted when fewer combos exist than requested', () => {
    const tiny: Selection = {
      foods: { 'chicken-breast': 'ok', cabbage: 'ok' },
      seasonings: {},
    };
    const r = generateMealOptions({ ...base(tiny), count: 5 });
    expect(r.combos.length).toBeGreaterThan(0);
    expect(r.combos.length).toBeLessThan(5);
    expect(r.exhausted).toBe(true);
  });

  it('exhausts when every combo has been seen', () => {
    const tiny: Selection = {
      foods: { 'chicken-breast': 'ok', cabbage: 'ok' },
      seasonings: {},
    };
    const all = generateMealOptions({ ...base(tiny), count: 50 }).combos;
    const r = generateMealOptions({ ...base(tiny), count: 5, seen: keys(all) });
    expect(r.combos).toEqual([]);
    expect(r.exhausted).toBe(true);
  });

  it('passes the engine failure reason through', () => {
    const r = generateMealOptions({
      ...base({ foods: { 'chicken-breast': 'ok' }, seasonings: {} }),
    });
    expect(r).toMatchObject({
      combos: [],
      exhausted: true,
      reason: 'NEED_FIBER',
    });
  });
});

describe('generateMealOptions with dayContext (soft penalty)', () => {
  it('puts a different protein group first when another meal already uses that group', () => {
    const plain = generateMealOptions({ ...base(), count: 5 }).combos;
    const group = comboProteinGroup(plain[0])!;
    const ctx = generateMealOptions({
      ...base(),
      count: 5,
      dayContext: { otherPicked: [plain[0]] },
    }).combos;
    expect(comboProteinGroup(ctx[0])).not.toBe(group);
    const same = (l: MealCombo[]) =>
      l.filter((c) => comboProteinGroup(c) === group).length;
    expect(same(ctx)).toBeLessThanOrEqual(same(plain));
  });

  it('does not remove anything: with only one protein group selected it still returns combos', () => {
    const meatOnly: Selection = {
      foods: {
        'chicken-breast': 'ok',
        'beef-eye-round': 'ok',
        cabbage: 'ok',
        lettuce: 'ok',
      },
      seasonings: {},
    };
    const plain = generateMealOptions({ ...base(meatOnly), count: 5 }).combos;
    const ctx = generateMealOptions({
      ...base(meatOnly),
      count: 5,
      dayContext: { otherPicked: [plain[0]] },
    });
    expect(ctx.combos.length).toBe(plain.length);
    expect(ctx.combos.map((c) => comboProteinGroup(c))).toEqual(
      ctx.combos.map(() => 'meat'),
    );
  });

  it('prefers combos that repeat fewer foods of the other meals', () => {
    const plain = generateMealOptions({ ...base(), count: 5 }).combos;
    const other = plain[0];
    const shared = (c: MealCombo) =>
      c.items.filter((i) => other.items.some((o) => o.food.id === i.food.id))
        .length;
    const ctx = generateMealOptions({
      ...base(),
      count: 5,
      dayContext: { otherPicked: [other] },
    }).combos;
    const avg = (l: MealCombo[]) =>
      l.reduce((a, c) => a + shared(c), 0) / l.length;
    expect(avg(ctx)).toBeLessThan(avg(plain));
  });
});

describe('generateMealOptions: telling an impossible lock from "nothing new left"', () => {
  const some = (extra: Partial<Parameters<typeof generateMealOptions>[0]>) =>
    generateMealOptions({ ...base(), count: 4, ...extra });

  it('an impossible lock gives NO_MATCH even when seen is not empty (a reroll always has a picked key in seen)', () => {
    const shown = some({}).combos;
    const r = some({
      locked: ['chicken-breast', 'beef-eye-round'], // two proteins cannot be in one meal
      seen: [shown[0].key],
    });
    expect(r.combos).toEqual([]);
    expect(r.reason).toBe('NO_MATCH');
  });

  it('a possible lock whose combos were all seen is exhausted, without a reason', () => {
    const tiny: Selection = {
      foods: { 'chicken-breast': 'ok', cabbage: 'ok' },
      seasonings: {},
    };
    const all = generateMealOptions({
      ...base(tiny),
      count: 50,
      locked: ['cabbage'],
    }).combos;
    const r = generateMealOptions({
      ...base(tiny),
      count: 4,
      locked: ['cabbage'],
      seen: all.map((c) => c.key),
    });
    expect(r.combos).toEqual([]);
    expect(r.exhausted).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('with nothing seen and no lock, an empty result still reports NO_MATCH', () => {
    const r = generateMealOptions({
      ...base({
        foods: { 'chicken-breast': 'ok', cabbage: 'ok' },
        seasonings: {},
      }),
      excludeFoods: ['cabbage'],
    });
    expect(r.combos).toEqual([]);
    expect(r.reason).toBeDefined();
  });
});
