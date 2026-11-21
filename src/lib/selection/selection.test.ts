import { describe, expect, it } from 'vitest';
import { FOODS } from '@/lib/data/load';
import { isFoodExcludedByStyles } from '@/lib/nutrition/styleExclusion';
import { nutritionFacts } from '@/lib/nutrition/nutritionFacts';
import { createAppStore, type StateStorage } from '@/lib/store/appStore';
import {
  EMPTY_SELECTION,
  clearAll,
  cycleStatus,
  selectAll,
  selectionProblems,
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
  it('toggling a style twice removes it', () => {
    const s = createAppStore(memory());
    s.getState().toggleStyle('lowCarb');
    s.getState().toggleStyle('lowCarb');
    expect(s.getState().styles).toEqual([]);
  });
});
