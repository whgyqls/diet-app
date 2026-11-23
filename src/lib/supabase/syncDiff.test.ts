import { describe, expect, it } from 'vitest';
import type { IngredientKit } from '@/lib/kits/kits';
import {
  NO_SYNC_OPS,
  cloneSyncState,
  diffForSync,
  hasSyncOps,
  toSyncState,
  type SyncState,
} from './syncDiff';

const kit = (over: Partial<IngredientKit> = {}): IngredientKit => ({
  id: 'k1',
  name: '주중 도시락',
  selection: { foods: { 'chicken-breast': 'ok' }, seasonings: { salt: 'ok' } },
  styles: ['lowCarb'],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const base = (): SyncState => ({
  profile: {
    sex: 'female',
    birthYear: 1996,
    heightCm: 163,
    weightKg: 60,
    activityLevel: 2,
    goal: 'lose',
    mealsPerDay: 3,
  },
  styles: ['lowCarb', 'lowSodium'],
  overrides: { sodiumMax: 1500, protein: { perKg: 1.6 } },
  selection: {
    foods: { 'chicken-breast': 'ok', cabbage: 'favorite' },
    seasonings: { salt: 'ok' },
  },
  kits: [kit()],
});

const edit = (f: (s: SyncState) => void): SyncState => {
  const s = cloneSyncState(base());
  f(s);
  return s;
};

describe('diffForSync: nothing to write', () => {
  it('the same state, the same reference, or an equal copy (no echo of loaded values)', () => {
    const s = base();
    expect(diffForSync(s, s)).toEqual(NO_SYNC_OPS);
    expect(diffForSync(base(), base())).toEqual(NO_SYNC_OPS);
    expect(hasSyncOps(diffForSync(cloneSyncState(s), s))).toBe(false);
  });

  it('only the order of the styles differs', () => {
    expect(
      hasSyncOps(
        diffForSync(
          base(),
          edit((s) => (s.styles = ['lowSodium', 'lowCarb'])),
        ),
      ),
    ).toBe(false);
  });

  it('only the key order of the selection differs', () => {
    const cur = edit((s) => {
      s.selection = {
        seasonings: { salt: 'ok' },
        foods: { cabbage: 'favorite', 'chicken-breast': 'ok' },
      };
    });
    expect(hasSyncOps(diffForSync(base(), cur))).toBe(false);
  });

  it('a kit that differs only in its timestamps is not an update (the database sets them)', () => {
    const cur = edit(
      (s) => (s.kits = [kit({ createdAt: 999, updatedAt: 999 })]),
    );
    expect(hasSyncOps(diffForSync(base(), cur))).toBe(false);
  });

  it('a field that is undefined equals a missing field', () => {
    const last = edit((s) => (s.profile = { sex: 'male' }));
    const cur = edit((s) => (s.profile = { sex: 'male', goal: undefined }));
    expect(hasSyncOps(diffForSync(last, cur))).toBe(false);
  });
});

describe('diffForSync: settings (profiles row)', () => {
  it('a profile field, the styles or the overrides changed', () => {
    for (const f of [
      (s: SyncState) => (s.profile.weightKg = 59),
      (s: SyncState) => delete s.profile.goal,
      (s: SyncState) => (s.profile.sex = 'male'),
      (s: SyncState) => s.styles.push('highProtein'),
      (s: SyncState) => (s.styles = []),
      (s: SyncState) => (s.overrides.sodiumMax = 1400),
      (s: SyncState) => (s.overrides = {}),
      (s: SyncState) => (s.overrides.fat = { g: 50 }),
      (s: SyncState) => (s.overrides.protein = { perKg: 1.8 }),
    ]) {
      const ops = diffForSync(base(), edit(f));
      expect(ops.settings, f.toString()).toBe(true);
      expect(ops.selection).toBe(false);
      expect(ops.kitsAdded).toEqual([]);
    }
  });
});

describe('diffForSync: selection (food_prefs)', () => {
  it('a food or seasoning added, removed or changed', () => {
    for (const f of [
      (s: SyncState) => (s.selection.foods['white-rice'] = 'ok'),
      (s: SyncState) => delete s.selection.foods.cabbage,
      (s: SyncState) => (s.selection.foods.cabbage = 'ok'),
      (s: SyncState) => (s.selection.seasonings = {}),
      (s: SyncState) => (s.selection.seasonings['soy-sauce'] = 'favorite'),
    ]) {
      const ops = diffForSync(base(), edit(f));
      expect(ops.selection, f.toString()).toBe(true);
      expect(ops.settings).toBe(false);
    }
  });
});

describe('diffForSync: kits', () => {
  it('a new kit is added', () => {
    const added = kit({ id: 'k2', name: '주말' });
    const ops = diffForSync(
      base(),
      edit((s) => s.kits.push(added)),
    );
    expect(ops.kitsAdded).toEqual([added]);
    expect(ops.kitsUpdated).toEqual([]);
    expect(ops.kitsDeleted).toEqual([]);
  });

  it('a removed kit is deleted by id', () => {
    const ops = diffForSync(
      base(),
      edit((s) => (s.kits = [])),
    );
    expect(ops.kitsDeleted).toEqual(['k1']);
    expect(ops.kitsAdded).toEqual([]);
  });

  it('a renamed kit is updated, whatever happens to the timestamp', () => {
    const renamed = kit({ name: '새 이름', updatedAt: 50 });
    const ops = diffForSync(
      base(),
      edit((s) => (s.kits = [renamed])),
    );
    expect(ops.kitsUpdated).toEqual([renamed]);
    expect(ops.kitsAdded).toEqual([]);
    expect(ops.kitsDeleted).toEqual([]);
  });

  it('changed content or styles of a kit is an update; "styles not saved" differs from an empty list', () => {
    for (const k of [
      kit({ selection: { foods: {}, seasonings: {} } }),
      kit({ styles: ['lowSodium'] }),
      kit({ styles: [] }),
      kit({ styles: undefined }),
    ])
      expect(
        diffForSync(
          base(),
          edit((s) => (s.kits = [k])),
        ).kitsUpdated,
        JSON.stringify(k.styles),
      ).toHaveLength(1);
    const noStyles = edit((s) => (s.kits = [kit({ styles: undefined })]));
    expect(hasSyncOps(diffForSync(noStyles, cloneSyncState(noStyles)))).toBe(
      false,
    );
  });

  it('replacing a kit by a new one with the same name is a delete plus an add (different id)', () => {
    const again = kit({ id: 'k9' });
    const ops = diffForSync(
      base(),
      edit((s) => (s.kits = [again])),
    );
    expect(ops.kitsDeleted).toEqual(['k1']);
    expect(ops.kitsAdded).toEqual([again]);
  });
});

describe('diffForSync: several changes, helpers', () => {
  it('reports every group that changed', () => {
    const cur = edit((s) => {
      s.profile.weightKg = 58;
      s.selection.foods['white-rice'] = 'ok';
      s.kits.push(kit({ id: 'k2', name: '주말' }));
    });
    const ops = diffForSync(base(), cur);
    expect(ops.settings).toBe(true);
    expect(ops.selection).toBe(true);
    expect(ops.kitsAdded.map((k) => k.id)).toEqual(['k2']);
    expect(hasSyncOps(ops)).toBe(true);
  });

  it('is stable: diffing twice gives the same result', () => {
    const cur = edit((s) => (s.profile.weightKg = 58));
    expect(diffForSync(base(), cur)).toEqual(diffForSync(base(), cur));
  });

  it('toSyncState keeps only the synced parts (not step or actions)', () => {
    const whole = { ...base(), step: 3, toggleFood: () => {} };
    const picked = toSyncState(whole);
    expect(Object.keys(picked).sort()).toEqual([
      'kits',
      'overrides',
      'profile',
      'selection',
      'styles',
    ]);
  });

  it('cloneSyncState is independent of the original', () => {
    const live = base();
    const copy = cloneSyncState(live);
    live.profile.weightKg = 1;
    live.selection.foods['white-rice'] = 'ok';
    live.kits[0].name = 'changed';
    expect(copy).toEqual(base());
    expect(diffForSync(copy, live).settings).toBe(true);
  });

  it('NO_SYNC_OPS is frozen and has no operations', () => {
    expect(hasSyncOps(NO_SYNC_OPS)).toBe(false);
    expect(Object.isFrozen(NO_SYNC_OPS)).toBe(true);
  });
});
