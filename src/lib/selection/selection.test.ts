import { describe, expect, it } from 'vitest';
import { FOODS } from '@/lib/data/load';
import { isFoodExcludedByStyles } from '@/lib/nutrition/styleExclusion';
import { nutritionFacts } from '@/lib/nutrition/nutritionFacts';
import { OIL_GROUP } from '@/lib/nutrition/constants';
import {
  DEFAULT_STEP,
  STORAGE_KEY,
  createAppStore,
  type StateStorage,
} from '@/lib/store/appStore';
import {
  EMPTY_SELECTION,
  clearAll,
  cycleStatus,
  filterStepFoods,
  migrateSelection,
  selectAll,
  selectionProblems,
  stepFilters,
  toggleItem,
} from './selection';

const byCat = (c: string) => FOODS.filter((f) => f.category === c);
const none = () => false;

describe('toggle order', () => {
  it('cycles none -> ok -> favorite -> none', () => {
    expect(cycleStatus(undefined)).toBe('ok');
    expect(cycleStatus('ok')).toBe('favorite');
    expect(cycleStatus('favorite')).toBeUndefined();
  });
  it('removes the id on the third press', () => {
    let s = EMPTY_SELECTION;
    s = toggleItem(s, 'foods', 'chicken-breast');
    expect(s.foods['chicken-breast']).toBe('ok');
    s = toggleItem(s, 'foods', 'chicken-breast');
    expect(s.foods['chicken-breast']).toBe('favorite');
    s = toggleItem(s, 'foods', 'chicken-breast');
    expect('chicken-breast' in s.foods).toBe(false);
  });
  it('selectAll keeps favorites; clearAll removes only the given ids', () => {
    let s = toggleItem(toggleItem(EMPTY_SELECTION, 'foods', 'a'), 'foods', 'a');
    s = selectAll(s, 'foods', ['a', 'b']);
    expect(s.foods).toEqual({ a: 'favorite', b: 'ok' });
    s = clearAll(s, 'foods', ['b']);
    expect(s.foods).toEqual({ a: 'favorite' });
  });
});

describe('minimum condition', () => {
  const protein = byCat('protein')[0];
  const fiber = byCat('fiber')[0];
  it('needs protein and fiber; carb/fat/seasoning may be empty', () => {
    expect(selectionProblems(EMPTY_SELECTION, FOODS, none)).toEqual([
      'NEED_PROTEIN',
      'NEED_FIBER',
    ]);
    const onlyProtein = toggleItem(EMPTY_SELECTION, 'foods', protein.id);
    expect(selectionProblems(onlyProtein, FOODS, none)).toEqual(['NEED_FIBER']);
    const both = toggleItem(onlyProtein, 'foods', fiber.id);
    expect(selectionProblems(both, FOODS, none)).toEqual([]);
  });
  it('does not count foods excluded by the style', () => {
    const meat = FOODS.find((f) => f.group === '소고기')!;
    const s = toggleItem(
      toggleItem(EMPTY_SELECTION, 'foods', meat.id),
      'foods',
      fiber.id,
    );
    const ex = (f: (typeof FOODS)[number]) =>
      isFoodExcludedByStyles(f, ['pescatarian'], 'maintain');
    expect(selectionProblems(s, FOODS, ex)).toEqual(['NEED_PROTEIN']);
  });
});

describe('style exclusion', () => {
  const beef = FOODS.find((f) => f.group === '소고기')!;
  const fish = FOODS.find((f) => f.group === '생선')!;
  const egg = FOODS.find((f) => f.group === '달걀·콩')!;
  it('pescatarian excludes meat only', () => {
    expect(isFoodExcludedByStyles(beef, ['pescatarian'], 'lose')).toBe(true);
    expect(isFoodExcludedByStyles(fish, ['pescatarian'], 'lose')).toBe(false);
  });
  it('lacto-ovo also excludes fish; eggs/beans stay', () => {
    expect(isFoodExcludedByStyles(fish, ['lactoOvo'], 'lose')).toBe(true);
    expect(isFoodExcludedByStyles(egg, ['lactoOvo'], 'lose')).toBe(false);
  });
  it('no style excludes nothing', () => {
    expect(FOODS.some((f) => isFoodExcludedByStyles(f, [], 'lose'))).toBe(
      false,
    );
  });
});

describe('nutritionFacts', () => {
  it('scales per-serving values from per-100g', () => {
    const f = FOODS[0];
    const { serving, rows } = nutritionFacts(f);
    const kcal = rows.find((r) => r.key === 'kcal')!;
    expect(kcal.perServing).toBeCloseTo((f.per100g.kcal * serving) / 100, 1);
  });
});

describe('store persistence', () => {
  function memory(): StateStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  }
  it('saves immediately and restores after a "reload"', async () => {
    const storage = memory();
    const a = createAppStore(storage);
    a.getState().toggleFood('chicken-breast');
    a.getState().toggleFood('chicken-breast');
    a.getState().toggleStyle('pescatarian');
    a.getState().setStep(2);
    const b = createAppStore(storage);
    await b.persist.rehydrate();
    expect(b.getState().selection.foods['chicken-breast']).toBe('favorite');
    expect(b.getState().styles).toEqual(['pescatarian']);
    expect(b.getState().step).toBe(2);
  });
  it('re-entering /select starts at the first step and keeps the saved choices', async () => {
    const storage = memory();
    const a = createAppStore(storage);
    a.getState().toggleFood('chicken-breast');
    a.getState().toggleSeasoning('salt');
    a.getState().toggleStyle('lowSodium');
    a.getState().setStep(4); // the user finished on the seasoning step last time

    const b = createAppStore(storage);
    await b.persist.rehydrate();
    expect(b.getState().step).toBe(4); // the saved step comes back...
    b.getState().startSelection(); // ...and entering the screen resets it
    expect(b.getState().step).toBe(DEFAULT_STEP);
    expect(DEFAULT_STEP).toBe(0); // 0 = protein, the first of STEPS
    expect(b.getState().selection.foods['chicken-breast']).toBe('ok');
    expect(b.getState().selection.seasonings['salt']).toBe('ok');
    expect(b.getState().styles).toEqual(['lowSodium']);
  });

  it('toggling a style twice removes it', () => {
    const s = createAppStore(memory());
    s.getState().toggleStyle('lowCarb');
    s.getState().toggleStyle('lowCarb');
    expect(s.getState().styles).toEqual([]);
  });

  it('moves oils picked as seasonings in a version-1 save over to foods', async () => {
    const storage = memory();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          profile: {},
          styles: [],
          overrides: {},
          selection: {
            foods: { cod: 'ok' },
            seasonings: { 'olive-oil': 'favorite', salt: 'ok' },
          },
          step: 4,
        },
      }),
    );
    const s = createAppStore(storage);
    await s.persist.rehydrate();
    expect(s.getState().selection).toEqual({
      foods: { cod: 'ok', 'olive-oil': 'favorite' },
      seasonings: { salt: 'ok' },
    });
    expect(s.getState().kits).toEqual([]);
  });

  it('replaceSelection swaps the whole selection (reset / undo)', () => {
    const s = createAppStore(memory());
    s.getState().toggleFood('cod');
    const before = s.getState().selection;
    s.getState().replaceSelection(EMPTY_SELECTION);
    expect(s.getState().selection).toEqual(EMPTY_SELECTION);
    s.getState().replaceSelection(before);
    expect(s.getState().selection.foods).toEqual({ cod: 'ok' });
  });

  it('saves, renames, loads and deletes ingredient kits, and keeps them after a reload', async () => {
    const storage = memory();
    const a = createAppStore(storage);
    a.getState().toggleFood('cod');
    a.getState().toggleStyle('pescatarian');
    expect(a.getState().saveKit('평일', true)).toBeNull();
    expect(a.getState().saveKit(' 평일 ', false)).toBe('DUPLICATE');
    const id = a.getState().kits[0].id;
    expect(a.getState().renameKit(id, '주중')).toBeNull();
    a.getState().replaceSelection(EMPTY_SELECTION);
    a.getState().toggleStyle('pescatarian');

    const b = createAppStore(storage);
    await b.persist.rehydrate();
    expect(b.getState().kits.map((k) => k.name)).toEqual(['주중']);
    b.getState().loadKit(id, 'replace');
    expect(b.getState().selection.foods).toEqual({ cod: 'ok' });
    expect(b.getState().styles).toEqual(['pescatarian']);
    b.getState().deleteKit(id);
    expect(b.getState().kits).toEqual([]);
  });
});

describe('migrateSelection', () => {
  it('moves the given ids from seasonings to foods, keeping the status, and leaves the rest', () => {
    const r = migrateSelection(
      {
        foods: { cod: 'ok' },
        seasonings: { 'olive-oil': 'favorite', 'sesame-oil': 'ok', salt: 'ok' },
      },
      ['olive-oil', 'perilla-oil', 'sesame-oil'],
    );
    expect(r).toEqual({
      foods: { cod: 'ok', 'olive-oil': 'favorite', 'sesame-oil': 'ok' },
      seasonings: { salt: 'ok' },
    });
  });

  it('keeps a status already set on the food side', () => {
    const r = migrateSelection(
      { foods: { 'olive-oil': 'favorite' }, seasonings: { 'olive-oil': 'ok' } },
      ['olive-oil'],
    );
    expect(r).toEqual({ foods: { 'olive-oil': 'favorite' }, seasonings: {} });
  });
});

describe('filterStepFoods (fat step: whole foods vs oils)', () => {
  const fat = byCat('fat');
  it('splits the fat step into nuts/seeds/avocado and oils', () => {
    const whole = filterStepFoods(fat, 'fat', 'whole');
    const oils = filterStepFoods(fat, 'fat', 'oil');
    expect(oils.map((f) => f.id).sort()).toEqual([
      'olive-oil',
      'perilla-oil',
      'sesame-oil',
    ]);
    expect(whole).toHaveLength(13);
    expect(whole.some((f) => f.group === OIL_GROUP)).toBe(false);
    expect(filterStepFoods(fat, 'fat', null)).toHaveLength(16);
  });
  it('filters other steps by group', () => {
    const fish = filterStepFoods(byCat('protein'), 'protein', '생선');
    expect(fish.length).toBeGreaterThan(0);
    expect(fish.every((f) => f.group === '생선')).toBe(true);
  });
  it('lists the filter chips: fixed two for the fat step, groups elsewhere', () => {
    expect(stepFilters(fat, 'fat')).toEqual([
      { key: 'whole', label: '견과·씨앗·아보카도' },
      { key: 'oil', label: '기름' },
    ]);
    expect(stepFilters(byCat('protein'), 'protein')[0]).toEqual({
      key: '닭',
      label: '닭',
    });
  });
});
