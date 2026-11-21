import { describe, expect, it } from 'vitest';
import type { MealType } from '@/types/nutrition';
import type { SavedCombo } from './savedCombos';
import { groupSavedByMeal, savedDateText, savedSummary } from './savedView';

const saved = (
  id: string,
  mealType: MealType,
  savedAt: number,
  over: Partial<SavedCombo> = {},
): SavedCombo => ({
  id,
  savedAt,
  mealType,
  requestFingerprint: 'fp',
  signature: `sig-${id}`,
  items: [
    { foodId: 'chicken-breast', name: '닭가슴살', grams: 150, basis: 'raw' },
    { foodId: 'white-rice', name: '쌀밥', grams: 200, basis: 'cooked' },
  ],
  oils: [{ foodId: 'olive-oil', name: '올리브유', grams: 4.5, basis: 'raw' }],
  seasonings: [{ id: 'salt', name: '소금', units: 0.5, unitLabel: '작은술' }],
  totals: {
    kcal: 612.4,
    protein: 44.5,
    carbs: 60.2,
    netCarbs: 55,
    fiber: 5.2,
    fat: 17.8,
    satFat: 3,
    sodium: 599.6,
    cholesterol: 90,
  },
  ...over,
});

describe('groupSavedByMeal', () => {
  it('orders the groups breakfast, lunch, dinner and leaves out empty ones', () => {
    const groups = groupSavedByMeal([
      saved('d', 'dinner', 1),
      saved('l', 'lunch', 2),
    ]);
    expect(groups.map((g) => g.mealType)).toEqual(['lunch', 'dinner']);
  });

  it('keeps every combo of a meal together, newest first', () => {
    const groups = groupSavedByMeal([
      saved('old', 'lunch', 100),
      saved('b', 'breakfast', 50),
      saved('new', 'lunch', 300),
      saved('mid', 'lunch', 200),
    ]);
    expect(groups.map((g) => g.mealType)).toEqual(['breakfast', 'lunch']);
    expect(groups[1].items.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
  });

  it('is stable for equal times and does not change the input', () => {
    const input = [saved('a', 'lunch', 5), saved('b', 'lunch', 5)];
    const copy = [...input];
    const groups = groupSavedByMeal(input);
    expect(groups[0].items.map((s) => s.id)).toEqual(['a', 'b']);
    expect(input).toEqual(copy);
  });

  it('returns no groups for an empty list', () => {
    expect(groupSavedByMeal([])).toEqual([]);
  });
});

describe('savedSummary', () => {
  it('rounds the totals for display and keeps oils and seasonings', () => {
    const s = savedSummary(saved('x', 'lunch', 1));
    expect(s.totals).toEqual({
      kcal: 612,
      protein: 45, // 44.5 rounds up
      carbs: 60,
      fat: 18,
      fiber: 5,
      sodium: 600,
    });
    expect(s.items).toEqual([
      { name: '닭가슴살', grams: 150, basis: 'raw' },
      { name: '쌀밥', grams: 200, basis: 'cooked' },
    ]);
    expect(s.oils).toEqual([{ name: '올리브유', grams: 4.5 }]);
    expect(s.seasonings).toEqual([{ name: '소금', text: '0.5작은술' }]);
  });

  it('shows whole seasoning units without a trailing .0', () => {
    const s = savedSummary(
      saved('x', 'lunch', 1, {
        seasonings: [
          { id: 'soy', name: '저염간장', units: 1, unitLabel: '큰술' },
        ],
      }),
    );
    expect(s.seasonings[0].text).toBe('1큰술');
  });

  it('handles a combo without oils or seasonings', () => {
    const s = savedSummary(
      saved('x', 'lunch', 1, { oils: [], seasonings: [] }),
    );
    expect(s.oils).toEqual([]);
    expect(s.seasonings).toEqual([]);
  });
});

describe('savedDateText', () => {
  it('formats month and day', () => {
    expect(savedDateText(Date.UTC(2026, 10, 22, 3, 0), 'UTC')).toBe(
      '11월 22일',
    );
    expect(savedDateText(Date.UTC(2026, 0, 5, 3, 0), 'UTC')).toBe('1월 5일');
  });

  it('uses the given time zone (the user sees their own day)', () => {
    const t = Date.UTC(2026, 10, 22, 20, 0); // 22 Nov 20:00 UTC = 23 Nov 05:00 in Seoul
    expect(savedDateText(t, 'UTC')).toBe('11월 22일');
    expect(savedDateText(t, 'Asia/Seoul')).toBe('11월 23일');
  });
});
