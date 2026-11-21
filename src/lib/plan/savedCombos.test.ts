import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { MealCombo } from '@/types/nutrition';
import { generateMealOptions } from '@/lib/nutrition/mealOptions';
import { resolveStyles } from '@/lib/nutrition/styles';
import { calcDayTargets, calcMealTargets } from '@/lib/nutrition/targets';
import {
  EXAMPLE_PROFILES,
  FOODS,
  REF_YEAR,
  SEASONINGS,
  selectAll,
} from '@/lib/nutrition/test-fixtures';
import type { StateStorage } from '@/lib/store/safeStorage';
import {
  SAVED_STORAGE_KEY,
  comboSignature,
  createSavedStore,
  snapshotOf,
} from './savedCombos';

let combos: MealCombo[];
beforeAll(() => {
  const profile = EXAMPLE_PROFILES[0].profile;
  const { targets } = calcDayTargets(
    profile,
    REF_YEAR,
    undefined,
    resolveStyles([], profile.goal),
  );
  const lunch = calcMealTargets(targets, 3)[1];
  combos = generateMealOptions({
    foods: FOODS,
    seasonings: SEASONINGS,
    selection: selectAll(),
    targets: lunch,
    count: 5,
  }).combos;
});

function memory(): StateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
const snap = (i: number, id = `s${i}`, at = 1000 + i) =>
  snapshotOf(combos[i], {
    id,
    mealType: 'lunch',
    requestFingerprint: 'fp',
    savedAt: at,
  });

describe('snapshotOf', () => {
  it('copies foods (id, name, grams, basis), oils, seasonings and totals; no references to engine objects', () => {
    const c = combos[0];
    const s = snapshotOf(c, {
      id: 'x',
      mealType: 'dinner',
      requestFingerprint: 'fp9',
      savedAt: 42,
    });
    expect(s).toMatchObject({
      id: 'x',
      mealType: 'dinner',
      requestFingerprint: 'fp9',
      savedAt: 42,
    });
    expect(s.items).toEqual(
      c.items.map((i) => ({
        foodId: i.food.id,
        name: i.food.name,
        grams: i.grams,
        basis: i.food.basis,
      })),
    );
    expect(s.oils).toHaveLength(c.oils.length);
    expect(s.seasonings).toEqual(
      c.seasonings.picks.map((p) => ({
        id: p.seasoning.id,
        name: p.seasoning.name,
        units: p.units,
        unitLabel: p.seasoning.unit.label,
      })),
    );
    expect(s.totals.kcal).toBe(c.totals.kcal);
    expect(s.totals).not.toBe(c.totals);
    // plain data: survives JSON (no Food objects inside)
    expect(JSON.parse(JSON.stringify(s)).items).toEqual(s.items);
    expect(JSON.stringify(s)).not.toContain('per100g');
  });
});

describe('comboSignature', () => {
  it('is stable for the same combo and differs when a weight differs', () => {
    expect(comboSignature(combos[0])).toBe(comboSignature(combos[0]));
    expect(comboSignature(combos[0])).not.toBe(comboSignature(combos[1]));
    const heavier: MealCombo = {
      ...combos[0],
      items: combos[0].items.map((i, n) =>
        n === 0 ? { ...i, grams: i.grams + 10 } : i,
      ),
    };
    expect(comboSignature(heavier)).not.toBe(comboSignature(combos[0]));
  });

  it('does not depend on the order of the items', () => {
    const reversed: MealCombo = {
      ...combos[0],
      items: [...combos[0].items].reverse(),
    };
    expect(comboSignature(reversed)).toBe(comboSignature(combos[0]));
  });

  it('is stored in the snapshot', () => {
    expect(snap(0).signature).toBe(comboSignature(combos[0]));
  });
});

describe('createSavedStore', () => {
  it('adds, lists (newest first) and finds by signature', () => {
    const st = createSavedStore(memory());
    expect(st.list()).toEqual([]);
    expect(st.add(snap(0))).toBe(true);
    expect(st.add(snap(1))).toBe(true);
    expect(st.list().map((s) => s.id)).toEqual(['s1', 's0']);
    expect(st.has(comboSignature(combos[0]))).toBe(true);
    expect(st.has('nope')).toBe(false);
  });

  it('refuses the same signature twice', () => {
    const st = createSavedStore(memory());
    expect(st.add(snap(0, 'a'))).toBe(true);
    expect(st.add(snap(0, 'b'))).toBe(false);
    expect(st.list()).toHaveLength(1);
  });

  it('removes by id and by signature', () => {
    const st = createSavedStore(memory());
    st.add(snap(0));
    st.add(snap(1));
    st.remove('s0');
    expect(st.list().map((s) => s.id)).toEqual(['s1']);
    st.removeBySignature(comboSignature(combos[1]));
    expect(st.list()).toEqual([]);
    expect(() => st.remove('missing')).not.toThrow();
  });

  it('survives a "reload": a new store on the same storage sees the snapshots', () => {
    const storage = memory();
    createSavedStore(storage).add(snap(2));
    const again = createSavedStore(storage);
    expect(again.list()).toHaveLength(1);
    expect(again.list()[0].items).toEqual(snap(2).items);
  });

  it('keeps the list reference stable until something changes (for useSyncExternalStore)', () => {
    const st = createSavedStore(memory());
    st.add(snap(0));
    const a = st.list();
    expect(st.list()).toBe(a);
    st.add(snap(1));
    expect(st.list()).not.toBe(a);
  });

  it('notifies subscribers on add and remove, and not after unsubscribe', () => {
    const st = createSavedStore(memory());
    const fn = vi.fn();
    const off = st.subscribe(fn);
    st.add(snap(0));
    st.remove('s0');
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    st.add(snap(1));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not notify when nothing changed (duplicate add, unknown remove)', () => {
    const st = createSavedStore(memory());
    st.add(snap(0));
    const fn = vi.fn();
    st.subscribe(fn);
    st.add(snap(0, 'other'));
    st.remove('missing');
    expect(fn).not.toHaveBeenCalled();
  });

  it('ignores broken stored data', () => {
    for (const bad of [
      '{not json',
      '123',
      '{"version":1,"items":"x"}',
      '{"version":1,"items":[{"id":1}]}',
    ]) {
      const storage = memory();
      storage.setItem(SAVED_STORAGE_KEY, bad);
      expect(createSavedStore(storage).list()).toEqual([]);
    }
  });

  it('works in memory when storage throws (private mode, quota)', () => {
    const broken: StateStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const st = createSavedStore(broken);
    expect(() => st.add(snap(0))).not.toThrow();
    expect(st.list()).toHaveLength(1);
    expect(() => st.remove('s0')).not.toThrow();
    expect(st.list()).toEqual([]);
  });
});
