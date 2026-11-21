import { describe, expect, it } from 'vitest';
import type { Selection } from '@/types/nutrition';
import {
  KIT_NAME_MAX,
  applyKit,
  createKit,
  deleteKit,
  kitItemCount,
  renameKit,
  validateKitName,
  type IngredientKit,
  type KnownIds,
} from './kits';

const KNOWN: KnownIds = {
  foods: new Set(['cod', 'salmon', 'cabbage', 'olive-oil', 'walnut']),
  seasonings: new Set(['salt', 'pepper']),
  oilIds: ['olive-oil'],
};

const sel = (
  foods: Selection['foods'],
  seasonings: Selection['seasonings'] = {},
): Selection => ({ foods, seasonings });

const kit = (over: Partial<IngredientKit> = {}): IngredientKit => ({
  id: 'k1',
  name: '평일',
  selection: sel({ cod: 'ok', cabbage: 'favorite' }, { salt: 'ok' }),
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('validateKitName', () => {
  it('needs 1 to KIT_NAME_MAX characters after trimming', () => {
    expect(validateKitName('   ', [])).toBe('EMPTY');
    expect(validateKitName('가'.repeat(KIT_NAME_MAX), [])).toBeNull();
    expect(validateKitName('가'.repeat(KIT_NAME_MAX + 1), [])).toBe('TOO_LONG');
  });

  it('rejects a name another kit already uses (trimmed), except the kit being renamed', () => {
    expect(validateKitName(' 평일 ', [kit()])).toBe('DUPLICATE');
    expect(validateKitName('평일', [kit()], 'k1')).toBeNull();
    expect(validateKitName('주말', [kit()])).toBeNull();
  });
});

describe('createKit / renameKit / deleteKit', () => {
  it('creates a kit with a trimmed name, a copy of the selection and styles only when asked', () => {
    const s = sel({ cod: 'ok' });
    const a = createKit({ id: 'a', name: ' 아침 ', selection: s, now: 5 });
    expect(a).toEqual({
      id: 'a',
      name: '아침',
      selection: s,
      createdAt: 5,
      updatedAt: 5,
    });
    expect(a.selection).not.toBe(s);
    expect(a.selection.foods).not.toBe(s.foods);
    const b = createKit({
      id: 'b',
      name: '페스코',
      selection: s,
      styles: ['pescatarian'],
      now: 5,
    });
    expect(b.styles).toEqual(['pescatarian']);
  });

  it('renames by id and bumps updatedAt; deletes by id', () => {
    const kits = [kit(), kit({ id: 'k2', name: '주말' })];
    const renamed = renameKit(kits, 'k2', ' 휴일 ', 9);
    expect(renamed.map((k) => k.name)).toEqual(['평일', '휴일']);
    expect(renamed[1].updatedAt).toBe(9);
    expect(renamed[0]).toBe(kits[0]);
    expect(deleteKit(kits, 'k1').map((k) => k.id)).toEqual(['k2']);
  });

  it('counts the selected foods and seasonings', () => {
    expect(kitItemCount(kit())).toBe(3);
  });
});

describe('applyKit', () => {
  const current = {
    selection: sel({ salmon: 'favorite', cod: 'favorite' }, { pepper: 'ok' }),
    styles: ['lowSodium' as const],
  };

  it('"replace" swaps the selection for the kit and keeps styles when the kit has none', () => {
    const r = applyKit(current, kit(), 'replace', KNOWN);
    expect(r.selection).toEqual(
      sel({ cod: 'ok', cabbage: 'favorite' }, { salt: 'ok' }),
    );
    expect(r.styles).toEqual(['lowSodium']);
  });

  it('"merge" keeps both, and favorite wins when both have the same item', () => {
    const r = applyKit(current, kit(), 'merge', KNOWN);
    expect(r.selection).toEqual(
      sel(
        { salmon: 'favorite', cod: 'favorite', cabbage: 'favorite' },
        { pepper: 'ok', salt: 'ok' },
      ),
    );
    const r2 = applyKit(
      { ...current, selection: sel({ cabbage: 'ok' }) },
      kit(),
      'merge',
      KNOWN,
    );
    expect(r2.selection.foods.cabbage).toBe('favorite');
  });

  it('styles saved with the kit: replace swaps them, merge adds them', () => {
    const k = kit({ styles: ['pescatarian', 'lowSodium'] });
    expect(applyKit(current, k, 'replace', KNOWN).styles).toEqual([
      'pescatarian',
      'lowSodium',
    ]);
    expect(applyKit(current, k, 'merge', KNOWN).styles).toEqual([
      'lowSodium',
      'pescatarian',
    ]);
    expect(
      applyKit(current, kit({ styles: [] }), 'replace', KNOWN).styles,
    ).toEqual([]);
  });

  it('drops ids that are no longer in the data and moves old oil seasonings to foods', () => {
    const old = kit({
      selection: sel(
        { cod: 'ok', 'gone-food': 'ok' },
        { 'olive-oil': 'favorite', 'gone-sauce': 'ok' },
      ),
    });
    const r = applyKit(current, old, 'replace', KNOWN);
    expect(r.selection).toEqual(sel({ cod: 'ok', 'olive-oil': 'favorite' }));
  });
});
