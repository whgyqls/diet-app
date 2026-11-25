import { describe, expect, it } from 'vitest';
import { FOODS } from '@/lib/nutrition/test-fixtures';
import { isFoodExcludedByStyles } from '@/lib/nutrition/styleExclusion';
import { includeDroppedText } from '@/lib/ui-labels';
import type { NutrientTotals, Selection } from '@/types/nutrition';
import type { DayPlanData } from './dayPlans';
import { includeFromDayPlan } from './dayPlanInclude';

const totals: NutrientTotals = {
  kcal: 500,
  protein: 30,
  carbs: 50,
  netCarbs: 45,
  fiber: 5,
  fat: 10,
  satFat: 2,
  sodium: 300,
  cholesterol: 50,
};
const name = (id: string) => FOODS.find((f) => f.id === id)?.name ?? id;
const item = (foodId: string) => ({
  foodId,
  name: name(foodId),
  grams: 100,
  basis: 'raw' as const,
});
const meal = (
  mealType: 'breakfast' | 'lunch' | 'dinner',
  ids: string[],
  oils: string[] = [],
) => ({
  mealType,
  items: ids.map(item),
  oils: oils.map(item),
  seasonings: [],
  totals,
});
const plan = (...meals: ReturnType<typeof meal>[]): DayPlanData => ({
  v: 1,
  meals,
  totals,
});
const sel = (...ids: string[]): Selection => ({
  foods: Object.fromEntries(ids.map((i) => [i, 'ok' as const])),
  seasonings: {},
});
const none = () => false;
const ctx = (
  selection: Selection,
  mealsPerDay = 3,
  isExcluded: (f: (typeof FOODS)[number]) => boolean = none,
) => ({
  selection,
  foods: FOODS,
  isExcluded,
  mealsPerDay,
});

const THREE_MEALS = plan(
  meal('breakfast', ['chicken-breast', 'white-rice', 'cabbage', 'lettuce']),
  meal('lunch', ['beef-eye-round', 'brown-rice', 'broccoli', 'almond']),
  meal('dinner', ['salmon', 'sweet-potato', 'spinach', 'tomato']),
);
const ALL = [
  'chicken-breast',
  'white-rice',
  'cabbage',
  'lettuce',
  'beef-eye-round',
  'brown-rice',
  'broccoli',
  'almond',
  'salmon',
  'sweet-potato',
  'spinach',
  'tomato',
];

describe('includeFromDayPlan', () => {
  it('takes over every food of the saved meals, in the order of the meals, with nothing skipped', () => {
    const r = includeFromDayPlan(THREE_MEALS, ctx(sel(...ALL)));
    expect(r.ids).toEqual(ALL);
    expect(r.skipped).toEqual([]);
  });

  it('takes a food that is in several meals once', () => {
    const p = plan(
      meal('lunch', ['chicken-breast', 'cabbage']),
      meal('dinner', ['chicken-breast', 'cabbage', 'lettuce']),
    );
    const r = includeFromDayPlan(
      p,
      ctx(sel('chicken-breast', 'cabbage', 'lettuce')),
    );
    expect(r.ids).toEqual(['chicken-breast', 'cabbage', 'lettuce']);
    expect(r.skipped).toEqual([]);
  });

  it('skips a food that is not selected now (NOT_SELECTED) and keeps the rest', () => {
    const r = includeFromDayPlan(
      THREE_MEALS,
      ctx(sel(...ALL.filter((x) => x !== 'cabbage' && x !== 'salmon'))),
    );
    expect(r.ids).toEqual(ALL.filter((x) => x !== 'cabbage' && x !== 'salmon'));
    expect(r.skipped).toEqual([
      { id: 'cabbage', reason: 'NOT_SELECTED' },
      { id: 'salmon', reason: 'NOT_SELECTED' },
    ]);
  });

  it('skips a food the current styles leave out (STYLE_EXCLUDED)', () => {
    const r = includeFromDayPlan(
      THREE_MEALS,
      ctx(sel(...ALL), 3, (f) =>
        isFoodExcludedByStyles(f, ['lactoOvo'], 'lose'),
      ),
    );
    expect(r.skipped.map((s) => s.id)).toEqual([
      'chicken-breast',
      'beef-eye-round',
      'salmon',
    ]);
    expect(new Set(r.skipped.map((s) => s.reason))).toEqual(
      new Set(['STYLE_EXCLUDED']),
    );
    expect(r.ids).not.toContain('chicken-breast');
  });

  it('skips oils (OIL) even when they are selected, and a food that is not in the data (UNKNOWN)', () => {
    const p = plan(
      meal(
        'lunch',
        ['chicken-breast', 'no-such-food', 'cabbage'],
        ['olive-oil'],
      ),
      meal('dinner', ['chicken-breast'], ['olive-oil', 'perilla-oil']),
    );
    const r = includeFromDayPlan(
      p,
      ctx(sel('chicken-breast', 'cabbage', 'olive-oil', 'perilla-oil')),
    );
    expect(r.ids).toEqual(['chicken-breast', 'cabbage']);
    expect(r.skipped).toEqual([
      { id: 'no-such-food', reason: 'UNKNOWN' },
      { id: 'olive-oil', reason: 'OIL' },
      { id: 'perilla-oil', reason: 'OIL' },
    ]);
  });

  describe('the limit of each category for the number of meals now (CAP)', () => {
    it('with 2 meals instead of 3, the later foods of a category are the ones left out', () => {
      // 3 proteins, 3 carbs, 6 fibers... saved for 3 meals; now 2 meals: protein 2, carb 2, fiber 4, fat 2
      const p = plan(
        meal('breakfast', [
          'chicken-breast',
          'white-rice',
          'cabbage',
          'lettuce',
        ]),
        meal('lunch', ['beef-eye-round', 'brown-rice', 'broccoli', 'spinach']),
        meal('dinner', ['salmon', 'sweet-potato', 'tomato', 'paprika']),
      );
      const selection = sel(
        'chicken-breast',
        'white-rice',
        'cabbage',
        'lettuce',
        'beef-eye-round',
        'brown-rice',
        'broccoli',
        'spinach',
        'salmon',
        'sweet-potato',
        'tomato',
        'paprika',
      );
      const r = includeFromDayPlan(p, ctx(selection, 2));
      expect(r.ids).toEqual([
        'chicken-breast',
        'white-rice',
        'cabbage',
        'lettuce',
        'beef-eye-round',
        'brown-rice',
        'broccoli',
        'spinach',
      ]);
      expect(r.skipped).toEqual([
        { id: 'salmon', reason: 'CAP' },
        { id: 'sweet-potato', reason: 'CAP' },
        { id: 'tomato', reason: 'CAP' },
        { id: 'paprika', reason: 'CAP' },
      ]);
    });
    it('fits exactly when the number of meals is the same', () => {
      const r = includeFromDayPlan(THREE_MEALS, ctx(sel(...ALL), 3));
      expect(r.skipped).toEqual([]);
    });
    it('a food that is skipped for another reason does not use up a place', () => {
      const p = plan(
        meal('breakfast', ['chicken-breast']),
        meal('lunch', ['beef-eye-round']),
        meal('dinner', ['salmon']),
      );
      // 2 meals: protein limit 2. chicken is not selected, so beef and salmon both fit.
      const r = includeFromDayPlan(p, ctx(sel('beef-eye-round', 'salmon'), 2));
      expect(r.ids).toEqual(['beef-eye-round', 'salmon']);
      expect(r.skipped).toEqual([
        { id: 'chicken-breast', reason: 'NOT_SELECTED' },
      ]);
    });
  });

  it('reports each skipped food once and never lists it as taken over', () => {
    const p = plan(
      meal('lunch', ['cabbage', 'cabbage']),
      meal('dinner', ['cabbage']),
    );
    const r = includeFromDayPlan(p, ctx(sel()));
    expect(r.skipped).toEqual([{ id: 'cabbage', reason: 'NOT_SELECTED' }]);
    expect(r.ids).toEqual([]);
  });

  it('is empty for nothing selected at all, and does not change what it is given', () => {
    const before = JSON.stringify(THREE_MEALS);
    const s = sel();
    const r = includeFromDayPlan(THREE_MEALS, ctx(s));
    expect(r.ids).toEqual([]);
    expect(r.skipped).toHaveLength(ALL.length);
    expect(JSON.stringify(THREE_MEALS)).toBe(before);
    expect(s).toEqual(sel());
  });
});

describe('includeDroppedText: the notice for foods that were not taken over', () => {
  it('says each reason in the agreed words', () => {
    expect(
      includeDroppedText([{ name: '양배추', reason: 'NOT_SELECTED' }]),
    ).toBe('양배추을(를) 선택에서 뺐어서 꼭 넣을 재료에서도 뺐어요.');
    expect(
      includeDroppedText([{ name: '닭가슴살', reason: 'STYLE_EXCLUDED' }]),
    ).toBe(
      '닭가슴살은(는) 선택한 스타일에서 제외돼서 꼭 넣을 재료에서 뺐어요.',
    );
    expect(includeDroppedText([{ name: '연어', reason: 'CAP' }])).toBe(
      '연어은(는) 하루 끼니 수 기준 상한 때문에 뺐어요.',
    );
    expect(includeDroppedText([{ name: '올리브유', reason: 'OIL' }])).toBe(
      '기름은 꼭 넣을 재료로 고를 수 없어서 뺐어요.',
    );
    expect(includeDroppedText([{ name: 'x', reason: 'UNKNOWN' }])).toBe(
      '찾을 수 없는 재료는 뺐어요.',
    );
  });
  it('says the oil and the unknown-food sentence only once however many there are', () => {
    const text = includeDroppedText([
      { name: '올리브유', reason: 'OIL' },
      { name: '들기름', reason: 'OIL' },
      { name: 'a', reason: 'UNKNOWN' },
      { name: 'b', reason: 'UNKNOWN' },
      { name: '연어', reason: 'CAP' },
    ]);
    expect(text).toBe(
      '기름은 꼭 넣을 재료로 고를 수 없어서 뺐어요. 찾을 수 없는 재료는 뺐어요. 연어은(는) 하루 끼니 수 기준 상한 때문에 뺐어요.',
    );
  });
  it('is empty for nothing', () => {
    expect(includeDroppedText([])).toBe('');
  });
});
