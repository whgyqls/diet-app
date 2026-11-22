import { describe, expect, it } from 'vitest';
import { KNOWN_IDS } from '@/lib/data/knownIds';
import type { IngredientKit } from '@/lib/kits/kits';
import type { SavedCombo } from '@/lib/plan/savedCombos';
import {
  foodPrefRowsToSelection,
  kitRowToKit,
  kitRowsToKits,
  kitToInsertRow,
  profileRowToSettings,
  savedRowToCombo,
  savedRowsToCombos,
  savedToInsertRow,
  selectionToRpcArgs,
  settingsToProfileRow,
  type AccountSettings,
} from './mappers';

const known = KNOWN_IDS;
const omit = <T extends object>(o: T, ...keys: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const UID = '11111111-1111-4111-8111-111111111111';

const settings: AccountSettings = {
  profile: {
    sex: 'female',
    birthYear: 1996,
    heightCm: 163.5,
    weightKg: 60,
    activityLevel: 2,
    goal: 'lose',
    mealsPerDay: 3,
  },
  styles: ['lowCarb', 'lowSodium'],
  overrides: { sodiumMax: 1500, protein: { perKg: 1.6 } },
};

describe('profile mappers', () => {
  it('round-trips profile, styles and overrides', () => {
    const row = settingsToProfileRow(UID, settings);
    expect(row.id).toBe(UID);
    expect(row.birth_year).toBe(1996);
    const back = profileRowToSettings({ ...row, legacy_imported_at: null });
    expect(back).toEqual({ ...settings, legacyImportedAt: null });
  });

  it('writes null for missing fields and for empty overrides, and reads them back as a partial profile', () => {
    const row = settingsToProfileRow(UID, {
      profile: { sex: 'male' },
      styles: [],
      overrides: {},
    });
    expect(row).toMatchObject({
      sex: 'male',
      birth_year: null,
      goal: null,
      styles: [],
      custom_targets: null,
    });
    expect(profileRowToSettings({ ...row, legacy_imported_at: null })).toEqual({
      profile: { sex: 'male' },
      styles: [],
      overrides: {},
      legacyImportedAt: null,
    });
  });

  it('does not write legacy_imported_at (the restore flow owns it) but reads it as ms', () => {
    expect('legacy_imported_at' in settingsToProfileRow(UID, settings)).toBe(
      false,
    );
    const r = profileRowToSettings({
      legacy_imported_at: '2026-11-22T00:00:00.000Z',
    });
    expect(r.legacyImportedAt).toBe(Date.parse('2026-11-22T00:00:00.000Z'));
    expect(
      profileRowToSettings({ legacy_imported_at: 'garbage' }).legacyImportedAt,
    ).toBeNull();
  });

  it('does not trust the row: bad fields, styles and custom_targets are dropped', () => {
    const r = profileRowToSettings({
      id: UID,
      sex: 'x',
      birth_year: 1996,
      height_cm: 9999,
      weight_kg: 60,
      activity_level: 7,
      goal: 'lose',
      meals_per_day: 3,
      styles: ['lowCarb', 'keto', 5] as unknown as string[],
      custom_targets: { sodiumMax: 'lots', fat: { g: 40 }, evil: 1 },
    });
    expect(r.profile).toEqual({
      birthYear: 1996,
      weightKg: 60,
      goal: 'lose',
      mealsPerDay: 3,
    });
    expect(r.styles).toEqual(['lowCarb']);
    expect(r.overrides).toEqual({ fat: { g: 40 } });
  });

  it('handles a missing row (new account)', () => {
    expect(profileRowToSettings(null)).toEqual({
      profile: {},
      styles: [],
      overrides: {},
      legacyImportedAt: null,
    });
  });
});

describe('food_prefs mappers', () => {
  it('rows -> selection, dropping unknown ids, wrong kinds and bad statuses', () => {
    const sel = foodPrefRowsToSelection(
      [
        { item_id: 'chicken-breast', kind: 'food', status: 'favorite' },
        { item_id: 'salt', kind: 'seasoning', status: 'ok' },
        { item_id: 'salt', kind: 'food', status: 'ok' },
        { item_id: 'chicken-thigh', kind: 'seasoning', status: 'ok' },
        { item_id: 'nope', kind: 'food', status: 'ok' },
        { item_id: 'white-rice', kind: 'food', status: 'maybe' },
        { item_id: 'cabbage', kind: 'other', status: 'ok' },
        null as never,
      ],
      known,
    );
    expect(sel).toEqual({
      foods: { 'chicken-breast': 'favorite' },
      seasonings: { salt: 'ok' },
    });
    expect(foodPrefRowsToSelection(null, known)).toEqual({
      foods: {},
      seasonings: {},
    });
  });

  it('selection -> rpc args round-trips and does not share objects with the store', () => {
    const sel = {
      foods: { 'chicken-breast': 'ok' as const },
      seasonings: { salt: 'favorite' as const },
    };
    const args = selectionToRpcArgs(sel);
    expect(args).toEqual({ p_foods: sel.foods, p_seasonings: sel.seasonings });
    expect(args.p_foods).not.toBe(sel.foods);
    const rows = [
      ...Object.entries(args.p_foods).map(([item_id, status]) => ({
        item_id,
        kind: 'food',
        status,
      })),
      ...Object.entries(args.p_seasonings).map(([item_id, status]) => ({
        item_id,
        kind: 'seasoning',
        status,
      })),
    ];
    expect(foodPrefRowsToSelection(rows, known)).toEqual(sel);
  });
});

describe('kit mappers', () => {
  const kit: IngredientKit = {
    id: UID,
    name: '주중 도시락',
    selection: {
      foods: { 'chicken-breast': 'ok' },
      seasonings: { salt: 'favorite' },
    },
    styles: ['lowCarb'],
    createdAt: Date.parse('2026-11-01T00:00:00.000Z'),
    updatedAt: Date.parse('2026-11-02T00:00:00.000Z'),
  };
  const rowOf = (k: IngredientKit, updated = '2026-11-02T00:00:00.000Z') => {
    return {
      ...omit(kitToInsertRow(UID, k), 'user_id'),
      updated_at: updated,
    } as Parameters<typeof kitRowToKit>[0] & object;
  };

  it('round-trips a kit', () => {
    expect(kitRowToKit(rowOf(kit), known)).toEqual(kit);
  });

  it('null styles in the column means "not saved with the kit"', () => {
    const noStyles = omit(kit, 'styles') as IngredientKit;
    const row = rowOf(noStyles);
    expect(row.styles).toBeNull();
    const back = kitRowToKit(row, known)!;
    expect('styles' in back).toBe(false);
  });

  it('insert row carries the user id and does not share objects with the kit', () => {
    const ins = kitToInsertRow(UID, kit);
    expect(ins.user_id).toBe(UID);
    expect(ins.selection.foods).not.toBe(kit.selection.foods);
  });

  it('cleans or drops bad rows', () => {
    const row = rowOf(kit);
    expect(
      kitRowToKit(
        {
          ...row,
          selection: {
            foods: { gone: 'ok', 'white-rice': 'ok' },
            seasonings: {},
          },
        },
        known,
      )!.selection,
    ).toEqual({ foods: { 'white-rice': 'ok' }, seasonings: {} });
    expect(
      kitRowToKit({ ...row, selection: 'garbage' }, known)!.selection,
    ).toEqual({ foods: {}, seasonings: {} });
    expect(
      kitRowToKit({ ...row, name: '가'.repeat(21) }, known),
    ).toBeUndefined();
    expect(kitRowToKit({ ...row, created_at: 'nope' }, known)).toBeUndefined();
    expect(kitRowToKit(null, known)).toBeUndefined();
  });

  it('kitRowsToKits keeps the good rows, oldest first', () => {
    const later = {
      ...kit,
      id: 'b',
      name: '나중',
      createdAt: kit.createdAt + 1000,
    };
    const rows = [rowOf(later), { ...rowOf(kit), name: '' }, rowOf(kit)];
    expect(kitRowsToKits(rows, known).map((k) => k.name)).toEqual([
      '주중 도시락',
      '나중',
    ]);
  });
});

describe('saved_combos mappers', () => {
  const saved: SavedCombo = {
    id: UID,
    savedAt: Date.parse('2026-11-10T12:00:00.000Z'),
    mealType: 'dinner',
    requestFingerprint: 'fp',
    signature: 'chicken-breast:150|',
    items: [
      { foodId: 'chicken-breast', name: '닭가슴살', grams: 150, basis: 'raw' },
      { foodId: 'white-rice', name: '쌀밥', grams: 200, basis: 'cooked' },
    ],
    oils: [],
    seasonings: [{ id: 'salt', name: '소금', units: 0.5, unitLabel: '작은술' }],
    totals: {
      kcal: 612,
      protein: 45,
      carbs: 60,
      netCarbs: 55,
      fiber: 5,
      fat: 18,
      satFat: 3,
      sodium: 600,
      cholesterol: 90,
    },
  };
  const rowOf = (s: SavedCombo) => {
    return omit(savedToInsertRow(UID, s), 'user_id') as Parameters<
      typeof savedRowToCombo
    >[0] &
      object;
  };

  it('round-trips a saved combo, savedAt <-> created_at', () => {
    const ins = savedToInsertRow(UID, saved);
    expect(ins.user_id).toBe(UID);
    expect(ins.created_at).toBe('2026-11-10T12:00:00.000Z');
    expect(savedRowToCombo(rowOf(saved), known)).toEqual(saved);
  });

  it('drops rows with unknown ids, negative numbers, broken jsonb or a bad date', () => {
    const row = rowOf(saved);
    expect(
      savedRowToCombo(
        { ...row, items: [{ ...saved.items[0], foodId: 'nope' }] },
        known,
      ),
    ).toBeUndefined();
    expect(
      savedRowToCombo(
        { ...row, items: [{ ...saved.items[0], grams: -1 }] },
        known,
      ),
    ).toBeUndefined();
    expect(savedRowToCombo({ ...row, totals: 'x' }, known)).toBeUndefined();
    expect(
      savedRowToCombo({ ...row, seasonings: null }, known),
    ).toBeUndefined();
    expect(
      savedRowToCombo({ ...row, meal_type: 'snack' }, known),
    ).toBeUndefined();
    expect(
      savedRowToCombo({ ...row, created_at: 'nope' }, known),
    ).toBeUndefined();
    expect(savedRowToCombo(undefined, known)).toBeUndefined();
  });

  it('savedRowsToCombos drops bad rows and sorts newest first', () => {
    const older = {
      ...saved,
      id: 'older',
      signature: 's-old',
      savedAt: saved.savedAt - 5000,
    };
    const rows = [
      rowOf(older),
      { ...rowOf(saved), items: 'broken' },
      rowOf(saved),
    ];
    expect(savedRowsToCombos(rows, known).map((c) => c.id)).toEqual([
      UID,
      'older',
    ]);
    expect(savedRowsToCombos(null, known)).toEqual([]);
  });
});
