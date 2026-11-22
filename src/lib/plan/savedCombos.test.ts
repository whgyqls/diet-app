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
  createLocalSavedStore,
  isSaved,
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

describe('createLocalSavedStore', () => {
  it('stars (toggle), lists newest first and finds by signature', async () => {
    const st = createLocalSavedStore(memory());
    expect(st.list()).toEqual([]);
    expect(await st.toggle(snap(0))).toBe('added');
    expect(await st.toggle(snap(1))).toBe('added');
    expect(st.list().map((s) => s.id)).toEqual(['s1', 's0']);
    expect(isSaved(st.list(), comboSignature(combos[0]))).toBe(true);
    expect(isSaved(st.list(), 'nope')).toBe(false);
  });

  it('is already updated when the call returns its promise (optimistic)', () => {
    const st = createLocalSavedStore(memory());
    void st.toggle(snap(0));
    expect(st.list()).toHaveLength(1);
    void st.remove('s0');
    expect(st.list()).toHaveLength(0);
  });

  it('refuses the same signature twice: toggle removes it, addMany skips it', async () => {
    const st = createLocalSavedStore(memory());
    expect(await st.toggle(snap(0, 'a'))).toBe('added');
    expect(await st.addMany([snap(0, 'b')])).toEqual([]);
    expect(st.list().map((s) => s.id)).toEqual(['a']);
    expect(await st.toggle(snap(0, 'c'))).toBe('removed');
    expect(st.list()).toEqual([]);
  });

  it('removes by id and by signature (the star)', async () => {
    const st = createLocalSavedStore(memory());
    await st.toggle(snap(0));
    await st.toggle(snap(1));
    await st.remove('s0');
    expect(st.list().map((s) => s.id)).toEqual(['s1']);
    await st.toggle(snap(1, 'other-id'));
    expect(st.list()).toEqual([]);
    await expect(st.remove('missing')).resolves.toBeUndefined();
  });

  it('addMany adds only unseen signatures (also inside the list) and returns the ids it added', async () => {
    const st = createLocalSavedStore(memory());
    await st.toggle(snap(0, 'keep'));
    const ids = await st.addMany([
      snap(0, 'dup-of-existing'),
      snap(1, 'n1'),
      snap(1, 'dup-in-list'),
      snap(2, 'n2'),
    ]);
    expect(ids).toEqual(['n1', 'n2']);
    expect(st.list().map((s) => s.id)).toEqual(['n1', 'n2', 'keep']);
    await st.addMany([]);
    expect(st.list()).toHaveLength(3);
  });

  it('survives a "reload": a new store on the same storage sees the snapshots', async () => {
    const storage = memory();
    await createLocalSavedStore(storage).toggle(snap(2));
    const again = createLocalSavedStore(storage);
    expect(again.list()).toHaveLength(1);
    expect(again.list()[0].items).toEqual(snap(2).items);
  });

  it('keeps the list reference stable until something changes (for useSyncExternalStore)', async () => {
    const st = createLocalSavedStore(memory());
    await st.toggle(snap(0));
    const a = st.list();
    expect(st.list()).toBe(a);
    await st.toggle(snap(1));
    expect(st.list()).not.toBe(a);
  });

  it('notifies subscribers on every change, and not after unsubscribe', async () => {
    const st = createLocalSavedStore(memory());
    const fn = vi.fn();
    const off = st.subscribe(fn);
    await st.toggle(snap(0));
    await st.remove('s0');
    await st.addMany([snap(3)]);
    expect(fn).toHaveBeenCalledTimes(3);
    off();
    await st.toggle(snap(1));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not notify when nothing changed (unknown remove, addMany of known signatures)', async () => {
    const st = createLocalSavedStore(memory());
    await st.toggle(snap(0));
    const fn = vi.fn();
    st.subscribe(fn);
    await st.addMany([snap(0, 'other')]);
    await st.remove('missing');
    expect(fn).not.toHaveBeenCalled();
  });

  it('is always ready, and refresh reads the storage again', async () => {
    const storage = memory();
    const st = createLocalSavedStore(storage);
    expect(st.status()).toBe('ready');
    await st.toggle(snap(0));
    storage.setItem(
      SAVED_STORAGE_KEY,
      JSON.stringify({ version: 1, items: [snap(1)] }),
    );
    const fn = vi.fn();
    st.subscribe(fn);
    await st.refresh();
    expect(st.list().map((s) => s.id)).toEqual(['s1']);
    expect(fn).toHaveBeenCalledTimes(1);
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
      expect(createLocalSavedStore(storage).list()).toEqual([]);
    }
  });

  it('works in memory when storage throws (private mode, quota)', async () => {
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
    const st = createLocalSavedStore(broken);
    await expect(st.toggle(snap(0))).resolves.toBe('added');
    expect(st.list()).toHaveLength(1);
    await expect(st.remove('s0')).resolves.toBeUndefined();
    expect(st.list()).toEqual([]);
  });
});
