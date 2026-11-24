import { describe, expect, it } from 'vitest';
import { KNOWN_IDS } from '@/lib/data/knownIds';
import { generateDayPlan } from '@/lib/nutrition/generate';
import {
  comboSignature,
  signatureOf,
  snapshotOf,
  type SavedCombo,
} from '@/lib/plan/savedCombos';
import {
  EXAMPLE_PROFILES,
  FOODS,
  REF_YEAR,
  SEASONINGS,
  selectAll,
} from '@/lib/nutrition/test-fixtures';
import { isLegacyEmpty, readLegacyRecord } from './readLegacy';

const state = (s: Record<string, unknown>, version = 2) =>
  JSON.stringify({ state: s, version });
const combo = (over: Partial<SavedCombo> = {}): SavedCombo => ({
  id: 'c1',
  savedAt: 1000,
  mealType: 'lunch',
  requestFingerprint: 'fp',
  signature: 'cabbage:100,chicken-breast:150|',
  items: [
    { foodId: 'chicken-breast', name: '닭가슴살', grams: 150, basis: 'raw' },
    { foodId: 'cabbage', name: '양배추', grams: 100, basis: 'raw' },
  ],
  oils: [],
  seasonings: [],
  totals: {
    kcal: 1,
    protein: 1,
    carbs: 1,
    netCarbs: 1,
    fiber: 1,
    fat: 1,
    satFat: 1,
    sodium: 1,
    cholesterol: 1,
  },
  ...over,
});
const savedText = (items: unknown[]) => JSON.stringify({ items });

describe('readLegacyRecord', () => {
  it('nothing stored, or broken JSON: an empty record, no throw', () => {
    for (const [a, b] of [
      [null, null],
      ['', ''],
      ['{{', 'nope'],
      ['[]', '{"items":5}'],
      ['{"state":5}', '{}'],
    ] as const)
      expect(isLegacyEmpty(readLegacyRecord(a, b, KNOWN_IDS))).toBe(true);
  });

  it('keeps valid parts and drops unknown ids', () => {
    const r = readLegacyRecord(
      state({
        profile: { sex: 'male', birthYear: 1990, heightCm: 'tall' },
        styles: ['lowCarb', 'nonsense'],
        overrides: { sodiumMax: 1500, bogus: 1 },
        selection: {
          foods: { 'chicken-breast': 'ok', 'no-such-food': 'ok' },
          seasonings: { salt: 'favorite', 'no-such': 'ok' },
        },
      }),
      null,
      KNOWN_IDS,
    );
    expect(r.profile).toEqual({ sex: 'male', birthYear: 1990 });
    expect(r.styles).toEqual(['lowCarb']);
    expect(r.overrides).toEqual({ sodiumMax: 1500 });
    expect(r.selection).toEqual({
      foods: { 'chicken-breast': 'ok' },
      seasonings: { salt: 'favorite' },
    });
  });

  it('version 1: oils stored among the seasonings move to the foods; kits do not exist yet', () => {
    const r = readLegacyRecord(
      state(
        {
          selection: {
            foods: {},
            seasonings: { 'olive-oil': 'ok', salt: 'ok' },
          },
          kits: [{ id: 'k', name: 'x' }],
        },
        1,
      ),
      null,
      KNOWN_IDS,
    );
    expect(r.selection.foods).toEqual({ 'olive-oil': 'ok' });
    expect(r.selection.seasonings).toEqual({ salt: 'ok' });
    expect(r.kits).toEqual([]);
  });

  describe('kits', () => {
    const kit = (over: Record<string, unknown>) => ({
      id: 'k1',
      name: '내 세트',
      selection: { foods: { 'chicken-breast': 'ok' }, seasonings: {} },
      createdAt: 1,
      updatedAt: 2,
      ...over,
    });
    it('keeps a valid kit, drops a bad name, a broken shape and a second kit with the same name', () => {
      const r = readLegacyRecord(
        state({
          kits: [
            kit({}),
            kit({ id: 'k2', name: '내 세트' }), // same name
            kit({ id: 'k3', name: '' }),
            kit({ id: 'k4', name: 'x'.repeat(21) }),
            'garbage',
            kit({ id: 'k5', name: '다른 세트' }),
          ],
        }),
        null,
        KNOWN_IDS,
      );
      expect(r.kits.map((k) => k.name)).toEqual(['내 세트', '다른 세트']);
      expect(r.dropped.kits).toBe(4);
    });
  });

  describe('★ (saved combos)', () => {
    it('keeps a valid combo and counts what it drops', () => {
      const r = readLegacyRecord(
        null,
        savedText([
          combo(),
          combo({ id: 'bad', items: [] }),
          combo({ id: 'unknown', mealType: 'brunch' as never }),
          'garbage',
        ]),
        KNOWN_IDS,
      );
      expect(r.saved).toHaveLength(1);
      expect(r.dropped.saved).toBe(3);
      expect(r.signaturesCorrected).toBe(0);
    });

    it('uses the signature computed from the stored foods when the stored one differs', () => {
      const r = readLegacyRecord(
        null,
        savedText([combo({ signature: 'something-old' })]),
        KNOWN_IDS,
      );
      expect(r.saved[0].signature).toBe('cabbage:100,chicken-breast:150|');
      expect(r.signaturesCorrected).toBe(1);
    });

    it('drops a combo a table check would refuse (a value that is too big) so one row cannot fail a batch', () => {
      const big = combo({
        requestFingerprint: 'f'.repeat(1001),
      });
      const longName = combo({
        id: 'c2',
        items: [
          {
            foodId: 'chicken-breast',
            name: '닭'.repeat(6000),
            grams: 150,
            basis: 'raw',
          },
          { foodId: 'cabbage', name: '양배추', grams: 100, basis: 'raw' },
        ],
      });
      const r = readLegacyRecord(null, savedText([big, longName]), KNOWN_IDS);
      expect(r.saved).toEqual([]);
      expect(r.dropped.saved).toBe(2);
    });
  });

  it('a ★ made by the engine keeps its signature (stored = computed from its foods)', () => {
    const profile = EXAMPLE_PROFILES[0].profile;
    const plan = generateDayPlan({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: selectAll(),
      profile,
      refYear: REF_YEAR,
    });
    for (const m of plan.meals) {
      const c = m.combos[0];
      const snap = snapshotOf(c, {
        id: 'x',
        mealType: m.mealType,
        requestFingerprint: 'fp',
        savedAt: 5,
      });
      expect(snap.signature).toBe(comboSignature(c));
      expect(
        signatureOf(
          snap.items.map((i) => ({ foodId: i.foodId, grams: i.grams })),
          snap.oils.map((i) => ({ foodId: i.foodId, grams: i.grams })),
        ),
      ).toBe(snap.signature);
    }
    const r = readLegacyRecord(
      null,
      savedText(
        plan.meals.map((m, i) =>
          snapshotOf(m.combos[0], {
            id: `id${i}`,
            mealType: m.mealType,
            requestFingerprint: 'fp',
            savedAt: i + 1,
          }),
        ),
      ),
      KNOWN_IDS,
    );
    expect(r.signaturesCorrected).toBe(0);
    expect(r.saved).toHaveLength(plan.meals.length);
  });

  it('item order does not change the signature', () => {
    const a = signatureOf(
      [
        { foodId: 'b', grams: 1 },
        { foodId: 'a', grams: 2 },
      ],
      [],
    );
    const b = signatureOf(
      [
        { foodId: 'a', grams: 2 },
        { foodId: 'b', grams: 1 },
      ],
      [],
    );
    expect(a).toBe(b);
  });
});
