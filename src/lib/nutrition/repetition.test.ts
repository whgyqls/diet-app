import { describe, expect, it } from 'vitest';
import type { MealCombo } from '@/types/nutrition';
import { repeatThreshold, repeatedFoods } from './repetition';
import { food } from './test-fixtures';

/** Only `items` matter for repetition. */
const combo = (items: [string, number][]): MealCombo =>
  ({
    items: items.map(([id, grams]) => ({ food: food(id), grams })),
  }) as unknown as MealCombo;

const withTofu = (grams: number, veg: string) =>
  combo([
    ['tofu', grams],
    [veg, 100],
  ]);

describe('repeatThreshold = ceil(0.8 * n)', () => {
  it.each([
    [3, 3],
    [4, 4],
    [5, 4],
    [10, 8],
    [15, 12],
    [25, 20],
  ])('n=%i -> %i', (n, expected) => {
    expect(repeatThreshold(n)).toBe(expected);
  });

  it('is not pushed up by floating point noise (0.07 * 100 = 7.000000000000001)', () => {
    expect(0.07 * 100).toBeGreaterThan(7); // the trap
    expect(Math.ceil(0.07 * 100)).toBe(8); // what a plain ceil would give
    expect(repeatThreshold(100, 0.07)).toBe(7);
    expect(repeatThreshold(50, 0.14)).toBe(7);
  });

  it('equals exact integer math ceil(4n / 5) for every n up to 200 (n=5 gives 4, never 5)', () => {
    for (let n = 1; n <= 200; n++)
      expect(repeatThreshold(n), `n=${n}`).toBe(Math.floor((4 * n + 4) / 5));
    expect(repeatThreshold(5)).toBe(4);
  });
});

describe('repeatedFoods', () => {
  const vegs = ['cabbage', 'lettuce', 'perilla-leaf', 'cabbage', 'lettuce'];

  it('5 cards: 3 with the same food is fine, 4 triggers, 5 triggers', () => {
    const mk = (n: number) =>
      vegs.map((v, i) =>
        i < n
          ? withTofu(300, v)
          : combo([
              ['chicken-breast', 150],
              [v, 100],
            ]),
      );
    expect(
      repeatedFoods(mk(3)).find((r) => r.foodId === 'tofu'),
    ).toBeUndefined();
    expect(repeatedFoods(mk(4)).find((r) => r.foodId === 'tofu')).toMatchObject(
      {
        count: 4,
        total: 5,
      },
    );
    expect(repeatedFoods(mk(5)).find((r) => r.foodId === 'tofu')).toMatchObject(
      {
        count: 5,
        total: 5,
      },
    );
  });

  it('3 cards: needs all 3 (2 of 3 is not repetition)', () => {
    const two = [
      withTofu(300, 'cabbage'),
      withTofu(300, 'lettuce'),
      combo([
        ['chicken-breast', 150],
        ['perilla-leaf', 100],
      ]),
    ];
    const three = [
      withTofu(300, 'cabbage'),
      withTofu(300, 'lettuce'),
      withTofu(300, 'perilla-leaf'),
    ];
    expect(repeatedFoods(two).map((r) => r.foodId)).not.toContain('tofu');
    expect(repeatedFoods(three).map((r) => r.foodId)).toContain('tofu');
  });

  it('fewer than REPEAT_WARN_MIN_COMBOS cards never warn, even if identical', () => {
    expect(repeatedFoods([])).toEqual([]);
    expect(repeatedFoods([withTofu(300, 'cabbage')])).toEqual([]);
    expect(
      repeatedFoods([withTofu(300, 'cabbage'), withTofu(300, 'cabbage')]),
    ).toEqual([]);
  });

  it('reports the grams only when every appearance has the same weight', () => {
    const same = [
      'cabbage',
      'lettuce',
      'perilla-leaf',
      'cabbage',
      'lettuce',
    ].map((v) => withTofu(300, v));
    const diff = same.map((c, i) =>
      withTofu(
        i === 0 ? 250 : 300,
        ['cabbage', 'lettuce', 'perilla-leaf', 'cabbage', 'lettuce'][i],
      ),
    );
    expect(repeatedFoods(same).find((r) => r.foodId === 'tofu')?.grams).toBe(
      300,
    );
    const d = repeatedFoods(diff).find((r) => r.foodId === 'tofu')!;
    expect(d.count).toBe(5);
    expect(d.grams).toBeUndefined();
  });

  it('lists the most repeated food first (a food counts once per card)', () => {
    // tofu in 5 cards, cabbage in 4, lettuce in 1
    const cards = Array.from({ length: 5 }, (_, i) =>
      combo([['tofu', 300], i < 4 ? ['cabbage', 100] : ['lettuce', 100]]),
    );
    expect(repeatedFoods(cards).map((r) => [r.foodId, r.count])).toEqual([
      ['tofu', 5],
      ['cabbage', 4],
    ]);
  });
});
