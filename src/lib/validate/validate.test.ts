import { describe, expect, it } from 'vitest';
import { KNOWN_IDS } from '@/lib/data/knownIds';
import {
  isDietStyle,
  isMealType,
  sanitizeKit,
  sanitizeOverrides,
  sanitizeSavedCombo,
  sanitizeSelection,
  sanitizeStyles,
} from './validate';

const known = KNOWN_IDS;
const FOOD = 'chicken-breast';
const OTHER_FOOD = 'white-rice';
const SEASONING = 'salt';

const totals = {
  kcal: 612,
  protein: 45,
  carbs: 60,
  netCarbs: 55,
  fiber: 5,
  fat: 18,
  satFat: 3,
  sodium: 600,
  cholesterol: 90,
};
const combo = () => ({
  id: 'c1',
  savedAt: 1000,
  mealType: 'lunch',
  requestFingerprint: 'fp',
  signature: 'sig',
  items: [
    { foodId: FOOD, name: '닭가슴살', grams: 150, basis: 'raw' },
    { foodId: OTHER_FOOD, name: '쌀밥', grams: 200, basis: 'cooked' },
  ],
  oils: [],
  seasonings: [
    { id: SEASONING, name: '소금', units: 0.5, unitLabel: '작은술' },
  ],
  totals,
});

describe('test data', () => {
  it('uses ids that exist', () => {
    expect(known.foods.has(FOOD)).toBe(true);
    expect(known.foods.has(OTHER_FOOD)).toBe(true);
    expect(known.seasonings.has(SEASONING)).toBe(true);
  });
});

describe('whitelists', () => {
  it('knows the six styles and three meals only', () => {
    for (const s of [
      'lowCarb',
      'lowSodium',
      'veggieForward',
      'highProtein',
      'pescatarian',
      'lactoOvo',
    ])
      expect(isDietStyle(s)).toBe(true);
    for (const s of ['keto', '', 'toString', '__proto__', 1, null])
      expect(isDietStyle(s)).toBe(false);
    expect(isMealType('lunch')).toBe(true);
    expect(isMealType('snack')).toBe(false);
    expect(isMealType('constructor')).toBe(false);
  });

  it('sanitizeStyles keeps known styles once, in order', () => {
    expect(sanitizeStyles(['lowSodium', 'x', 'lowCarb', 'lowSodium'])).toEqual([
      'lowSodium',
      'lowCarb',
    ]);
    expect(sanitizeStyles('lowCarb')).toEqual([]);
    expect(sanitizeStyles(null)).toEqual([]);
  });
});

describe('sanitizeSelection', () => {
  it('keeps known ids with a valid status and drops everything else', () => {
    const out = sanitizeSelection(
      {
        foods: {
          [FOOD]: 'favorite',
          [OTHER_FOOD]: 'ok',
          'no-such-food': 'ok',
          [SEASONING]: 'ok', // a seasoning id in foods
          'chicken-thigh': 'maybe',
        },
        seasonings: { [SEASONING]: 'ok', [FOOD]: 'ok', x: 'favorite' },
      },
      known,
    );
    expect(out).toEqual({
      foods: { [FOOD]: 'favorite', [OTHER_FOOD]: 'ok' },
      seasonings: { [SEASONING]: 'ok' },
    });
  });

  it('is empty for garbage', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      5,
      [],
      { foods: 'x', seasonings: [] },
    ])
      expect(sanitizeSelection(bad, known)).toEqual({
        foods: {},
        seasonings: {},
      });
  });

  it('does not treat prototype names as ids', () => {
    const out = sanitizeSelection(
      { foods: { toString: 'ok', __proto__: 'ok' } },
      known,
    );
    expect(out.foods).toEqual({});
  });
});

describe('sanitizeOverrides', () => {
  it('keeps the forms the settings screen produces, inside the limits', () => {
    const o = {
      sodiumMax: 1500,
      protein: { perKg: 1.6 },
      netCarbs: { g: 100 },
      fat: { g: 50 },
    };
    expect(sanitizeOverrides(o)).toEqual(o);
  });

  it('drops out-of-range, wrong-typed and unknown fields one by one', () => {
    expect(
      sanitizeOverrides({
        sodiumMax: 10,
        protein: { perKg: 99 },
        netCarbs: { g: 100 },
        fat: { g: -5 },
        kcal: 99999,
        admin: true,
      }),
    ).toEqual({ netCarbs: { g: 100 } });
    expect(sanitizeOverrides({ sodiumMax: '1500', protein: 1.6 })).toEqual({});
    expect(sanitizeOverrides({ sodiumMax: Number.NaN })).toEqual({});
  });

  it('is {} for garbage', () => {
    for (const bad of [null, 1, 'x', []])
      expect(sanitizeOverrides(bad)).toEqual({});
  });
});

describe('sanitizeKit', () => {
  const kit = () => ({
    id: 'k1',
    name: '  주중 도시락 ',
    selection: { foods: { [FOOD]: 'ok', gone: 'ok' }, seasonings: {} },
    styles: ['lowCarb', 'x'],
    createdAt: 1,
    updatedAt: 2,
  });

  it('cleans the name, selection and styles', () => {
    expect(sanitizeKit(kit(), known)).toEqual({
      id: 'k1',
      name: '주중 도시락',
      selection: { foods: { [FOOD]: 'ok' }, seasonings: {} },
      styles: ['lowCarb'],
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it('leaves styles out when none were saved', () => {
    const noStyles = Object.fromEntries(
      Object.entries(kit()).filter(([k]) => k !== 'styles'),
    );
    expect('styles' in sanitizeKit(noStyles, known)!).toBe(false);
  });

  it('rejects a name of 21 characters, an empty name, a missing id and bad times', () => {
    expect(
      sanitizeKit({ ...kit(), name: '가'.repeat(21) }, known),
    ).toBeUndefined();
    expect(
      sanitizeKit({ ...kit(), name: '가'.repeat(20) }, known),
    ).toBeDefined();
    expect(sanitizeKit({ ...kit(), name: '   ' }, known)).toBeUndefined();
    expect(sanitizeKit({ ...kit(), id: '' }, known)).toBeUndefined();
    expect(
      sanitizeKit({ ...kit(), createdAt: Number.NaN }, known),
    ).toBeUndefined();
    expect(sanitizeKit({ ...kit(), updatedAt: -1 }, known)).toBeUndefined();
    expect(sanitizeKit(null, known)).toBeUndefined();
  });
});

describe('sanitizeSavedCombo', () => {
  it('keeps a valid combo unchanged', () => {
    expect(sanitizeSavedCombo(combo(), known)).toEqual(combo());
  });

  it('drops the whole combo for any unusable part', () => {
    const bad: Array<[string, (c: ReturnType<typeof combo>) => unknown]> = [
      [
        'unknown food id',
        (c) => ({ ...c, items: [{ ...c.items[0], foodId: 'nope' }] }),
      ],
      [
        'seasoning id used as a food',
        (c) => ({ ...c, items: [{ ...c.items[0], foodId: SEASONING }] }),
      ],
      [
        'unknown seasoning id',
        (c) => ({ ...c, seasonings: [{ ...c.seasonings[0], id: 'nope' }] }),
      ],
      [
        'negative grams',
        (c) => ({ ...c, items: [{ ...c.items[0], grams: -1 }] }),
      ],
      [
        'NaN grams',
        (c) => ({ ...c, items: [{ ...c.items[0], grams: Number.NaN }] }),
      ],
      [
        'string grams',
        (c) => ({ ...c, items: [{ ...c.items[0], grams: '150' }] }),
      ],
      [
        'bad basis',
        (c) => ({ ...c, items: [{ ...c.items[0], basis: 'fried' }] }),
      ],
      ['no foods', (c) => ({ ...c, items: [] })],
      ['bad meal type', (c) => ({ ...c, mealType: 'snack' })],
      [
        'negative units',
        (c) => ({ ...c, seasonings: [{ ...c.seasonings[0], units: -1 }] }),
      ],
      [
        'negative total',
        (c) => ({ ...c, totals: { ...c.totals, sodium: -1 } }),
      ],
      [
        'missing total',
        (c) => ({ ...c, totals: { ...c.totals, kcal: undefined } }),
      ],
      [
        'infinite total',
        (c) => ({ ...c, totals: { ...c.totals, kcal: Infinity } }),
      ],
      ['items not an array', (c) => ({ ...c, items: 'x' })],
      ['no signature', (c) => ({ ...c, signature: '' })],
      ['bad savedAt', (c) => ({ ...c, savedAt: -5 })],
    ];
    for (const [label, mutate] of bad)
      expect(sanitizeSavedCombo(mutate(combo()), known), label).toBeUndefined();
  });

  it('is undefined for non-objects', () => {
    for (const bad of [null, 'x', 5, []])
      expect(sanitizeSavedCombo(bad, known)).toBeUndefined();
  });
});
