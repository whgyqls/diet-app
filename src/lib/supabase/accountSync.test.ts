import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IngredientKit } from '@/lib/kits/kits';
import { createFakeSupabase, is, type Row } from './__fixtures__/fakeSupabase';
import { createAccountSync, type AccountStore } from './accountSync';
import { SYNC_DEBOUNCE_MS } from './syncConstants';
import { cloneSyncState, type SyncState } from './syncDiff';

const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const KIT_ID = '33333333-3333-4333-8333-333333333333';

// what the server holds
const PROFILE_ROW: Row = {
  id: UID,
  sex: 'female',
  birth_year: 1996,
  height_cm: 163,
  weight_kg: 60,
  activity_level: 2,
  goal: 'lose',
  meals_per_day: 3,
  styles: ['lowCarb'],
  custom_targets: { sodiumMax: 1500 },
  legacy_imported_at: null,
};
const PREF_ROWS: Row[] = [
  { user_id: UID, item_id: 'chicken-breast', kind: 'food', status: 'favorite' },
  { user_id: UID, item_id: 'cabbage', kind: 'food', status: 'ok' },
  { user_id: UID, item_id: 'salt', kind: 'seasoning', status: 'ok' },
];
const KIT_ROW: Row = {
  id: KIT_ID,
  user_id: UID,
  name: '주중 도시락',
  selection: { foods: { 'chicken-breast': 'ok' }, seasonings: {} },
  styles: null,
  created_at: '2026-11-20T00:00:00.000Z',
  updated_at: '2026-11-20T00:00:00.000Z',
};
/** The same data as the app sees it after mapping. */
const SERVER: SyncState = {
  profile: {
    sex: 'female',
    birthYear: 1996,
    heightCm: 163,
    weightKg: 60,
    activityLevel: 2,
    goal: 'lose',
    mealsPerDay: 3,
  },
  styles: ['lowCarb'],
  overrides: { sodiumMax: 1500 },
  selection: {
    foods: { 'chicken-breast': 'favorite', cabbage: 'ok' },
    seasonings: { salt: 'ok' },
  },
  kits: [
    {
      id: KIT_ID,
      name: '주중 도시락',
      selection: { foods: { 'chicken-breast': 'ok' }, seasonings: {} },
      createdAt: Date.parse('2026-11-20T00:00:00.000Z'),
      updatedAt: Date.parse('2026-11-20T00:00:00.000Z'),
    },
  ],
};
/** An old cache in the browser that differs from the server everywhere. */
const STALE: SyncState = {
  profile: { sex: 'male', weightKg: 80 },
  styles: ['pescatarian'],
  overrides: {},
  selection: { foods: { 'white-rice': 'ok' }, seasonings: {} },
  kits: [],
};
const EMPTY: SyncState = {
  profile: {},
  styles: [],
  overrides: {},
  selection: { foods: {}, seasonings: {} },
  kits: [],
};

const serverTables = () => ({
  profiles: [PROFILE_ROW],
  food_prefs: PREF_ROWS,
  ingredient_kits: [KIT_ROW],
});

function memoryStore(initial: SyncState) {
  let state = cloneSyncState(initial);
  const ls = new Set<() => void>();
  const store: AccountStore & { edit: (f: (s: SyncState) => void) => void } = {
    getState: () => state,
    setState: (p) => {
      state = { ...state, ...p };
      ls.forEach((f) => f());
    },
    subscribe: (f) => {
      ls.add(f);
      return () => void ls.delete(f);
    },
    /** An edit the way the app makes it: a new state object. */
    edit: (f) => {
      const next = cloneSyncState(state);
      f(next);
      store.setState(next);
    },
  };
  return store;
}

function setup(
  tables: Record<string, Row[]> = serverTables(),
  cache: SyncState = STALE,
) {
  const fake = createFakeSupabase({ uid: UID, tables });
  const store = memoryStore(cache);
  const sync = createAccountSync({ client: fake.client, uid: UID, store });
  return { fake, store, sync };
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const synced = (s: SyncState) => cloneSyncState(s);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('accountSync (a): an old cache never overwrites the server', () => {
  it('after the load the store holds the server values, and nothing was written', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    expect(sync.phase()).toBe('ready');
    expect(synced(store.getState())).toEqual(SERVER);
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toEqual([]);
    expect(fake.tables.profiles[0].weight_kg).toBe(60);
  });

  it("reads only the user's rows, each query with the user id", async () => {
    const tables = serverTables();
    tables.food_prefs = [
      ...PREF_ROWS,
      { user_id: OTHER, item_id: 'white-rice', kind: 'food', status: 'ok' },
    ];
    const { fake, store, sync } = setup(tables);
    await sync.start();
    expect(store.getState().selection.foods['white-rice']).toBeUndefined();
    for (const c of fake.calls.filter((x) => x.kind === 'select'))
      expect(
        c.filters.some(
          (f) => (f.col === 'user_id' || f.col === 'id') && f.val === UID,
        ),
        c.table,
      ).toBe(true);
  });
});

describe('accountSync (b): values read from the server are not written back', () => {
  it('no write after the load, after a reload, after a flush, after the debounce', async () => {
    const { fake, sync } = setup();
    await sync.start();
    await sync.reload();
    await sync.flush();
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toEqual([]);
    expect(sync.saveStatus()).toBe('idle');
    expect(sync.hasUnsavedChanges()).toBe(false);
  });

  it('a reload that brings changes made on another device does not write them back', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    fake.tables.profiles[0].weight_kg = 58; // changed elsewhere
    await sync.reload();
    expect(store.getState().profile.weightKg).toBe(58);
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toEqual([]);
  });
});

describe('accountSync (c): one edit gives exactly one write', () => {
  it('nothing before the debounce, one profile upsert after it', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    store.edit((s) => (s.profile.weightKg = 59));
    expect(sync.saveStatus()).toBe('pending');
    expect(sync.hasUnsavedChanges()).toBe(true);
    await tick(SYNC_DEBOUNCE_MS - 1);
    expect(fake.writes()).toEqual([]);
    await tick(1);
    await tick();
    const writes = fake.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      kind: 'upsert',
      table: 'profiles',
      options: { onConflict: 'id' },
    });
    expect(writes[0].payload).toMatchObject({
      id: UID,
      weight_kg: 59,
      styles: ['lowCarb'],
    });
    expect(fake.tables.profiles[0].weight_kg).toBe(59);
    expect(sync.saveStatus()).toBe('idle');
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toHaveLength(1);
  });

  it('several quick edits of the profile are written once, with the last value', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    for (const w of [59, 58, 57]) {
      store.edit((s) => (s.profile.weightKg = w));
      await tick(SYNC_DEBOUNCE_MS / 2);
    }
    await tick(SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toHaveLength(1);
    expect(fake.tables.profiles[0].weight_kg).toBe(57);
  });

  it('a selection edit is one set_food_prefs call with the whole selection', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    store.edit((s) => (s.selection.foods['white-rice'] = 'ok'));
    await tick(SYNC_DEBOUNCE_MS);
    const writes = fake.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: 'rpc', table: 'set_food_prefs' });
    expect(writes[0].payload).toEqual({
      p_foods: {
        'chicken-breast': 'favorite',
        cabbage: 'ok',
        'white-rice': 'ok',
      },
      p_seasonings: { salt: 'ok' },
    });
  });

  it('an edit taken back before the debounce writes nothing', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    store.edit((s) => (s.profile.weightKg = 59));
    store.edit((s) => (s.profile.weightKg = 60));
    expect(sync.saveStatus()).toBe('idle');
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toEqual([]);
  });

  it('flush writes at once without waiting for the debounce', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    store.edit((s) => (s.styles = []));
    await sync.flush();
    expect(fake.writes()).toHaveLength(1);
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toHaveLength(1);
  });

  it('an edit made while a write runs is written after it, with the newest value', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    const release = fake.holdWhen(is('upsert', 'profiles'));
    store.edit((s) => (s.profile.weightKg = 59));
    await tick(SYNC_DEBOUNCE_MS);
    expect(sync.saveStatus()).toBe('saving');
    store.edit((s) => (s.profile.weightKg = 55));
    release();
    await tick();
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(fake.writes()).toHaveLength(2);
    expect(fake.tables.profiles[0].weight_kg).toBe(55);
    expect(sync.saveStatus()).toBe('idle');
  });
});

describe('accountSync (d): edits made while loading are not written', () => {
  it('the load replaces them and nothing is written', async () => {
    const { fake, store, sync } = setup();
    const release = fake.holdWhen(is('select', 'profiles'));
    const started = sync.start();
    await tick();
    expect(sync.phase()).toBe('loading');
    store.edit((s) => (s.profile.weightKg = 99));
    store.edit((s) => (s.selection.foods['white-rice'] = 'favorite'));
    release();
    await started;
    expect(synced(store.getState())).toEqual(SERVER);
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toEqual([]);
  });

  it('nothing is written while the first load failed (error phase), even after edits', async () => {
    const { fake, store, sync } = setup();
    fake.failWhen(is('select', 'food_prefs'));
    await sync.start();
    expect(sync.phase()).toBe('error');
    expect(sync.lastError()).toBe('boom');
    expect(synced(store.getState())).toEqual(STALE); // the cache is kept for the read-only screen
    store.edit((s) => (s.profile.weightKg = 99));
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toEqual([]);
    await sync.reload();
    expect(sync.phase()).toBe('ready');
    expect(synced(store.getState())).toEqual(SERVER);
  });
});

describe('accountSync (e): a failed write is rolled back', () => {
  it('the server values come back, the error is kept, no retry loop', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    fake.failWhen(is('upsert', 'profiles'));
    store.edit((s) => (s.profile.weightKg = 59));
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(fake.writes()).toHaveLength(1); // the failed attempt
    expect(sync.lastError()).toBe('boom');
    expect(sync.phase()).toBe('ready');
    expect(store.getState().profile.weightKg).toBe(60); // rolled back to the server value
    expect(sync.saveStatus()).toBe('idle');
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toHaveLength(1);
    // the next edit works and clears the error
    store.edit((s) => (s.profile.weightKg = 58));
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(fake.writes()).toHaveLength(2);
    expect(fake.tables.profiles[0].weight_kg).toBe(58);
    expect(sync.lastError()).toBeNull();
  });

  it('when the reload after a failed write also fails, the phase is error', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    fake.failWhen(is('rpc', 'set_food_prefs'));
    fake.failWhen(is('select', 'profiles'));
    store.edit((s) => (s.selection.foods['white-rice'] = 'ok'));
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(sync.phase()).toBe('error');
  });

  it('a kit name taken on another device: the write fails and the server state comes back', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    fake.tables.ingredient_kits.push({
      ...KIT_ROW,
      id: '44444444-4444-4444-8444-444444444444',
      name: '주말',
    });
    const kit: IngredientKit = {
      ...SERVER.kits[0],
      id: '55555555-5555-4555-8555-555555555555',
      name: '주말',
    };
    store.edit((s) => s.kits.push(kit));
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(sync.lastError()).toMatch(/duplicate/);
    expect(
      store
        .getState()
        .kits.map((k) => k.name)
        .sort(),
    ).toEqual(['주말', '주중 도시락']);
    expect(store.getState().kits.find((k) => k.name === '주말')!.id).toBe(
      '44444444-4444-4444-8444-444444444444',
    );
  });
});

describe('accountSync: first login and kits', () => {
  it('first login (no profiles row): one upsert of the bare row that ignores duplicates, nothing else', async () => {
    const { fake, store, sync } = setup({}, EMPTY);
    await sync.start();
    expect(sync.phase()).toBe('ready');
    const writes = fake.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      kind: 'upsert',
      table: 'profiles',
      payload: { id: UID },
      options: { onConflict: 'id', ignoreDuplicates: true },
    });
    expect(fake.tables.profiles).toEqual([{ id: UID }]);
    expect(synced(store.getState())).toEqual(EMPTY);
    expect(sync.legacyImportedAt()).toBeNull();
  });

  it('an existing profiles row is not touched on load', async () => {
    const { fake, sync } = setup();
    await sync.start();
    expect(fake.writes().filter(is('upsert', 'profiles'))).toEqual([]);
  });

  it('reads legacy_imported_at with the profile', async () => {
    const { sync } = setup({
      ...serverTables(),
      profiles: [
        { ...PROFILE_ROW, legacy_imported_at: '2026-11-22T00:00:00.000Z' },
      ],
    });
    await sync.start();
    expect(sync.legacyImportedAt()).toBe(
      Date.parse('2026-11-22T00:00:00.000Z'),
    );
  });

  it('kit changes are written as delete, then update, then add, each by user id', async () => {
    const second = {
      ...KIT_ROW,
      id: '66666666-6666-4666-8666-666666666666',
      name: '주말',
    };
    const { fake, store, sync } = setup({
      ...serverTables(),
      ingredient_kits: [KIT_ROW, second],
    });
    await sync.start();
    const added: IngredientKit = {
      ...SERVER.kits[0],
      id: '77777777-7777-4777-8777-777777777777',
      name: '새 세트',
    };
    store.edit((s) => {
      s.kits = s.kits
        .filter((k) => k.id !== second.id)
        .map((k) => ({ ...k, name: '이름 바꿈' }));
      s.kits.push(added);
    });
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(fake.writes().map((c) => c.kind)).toEqual([
      'delete',
      'update',
      'insert',
    ]);
    for (const c of fake.writes().filter((x) => x.kind !== 'insert'))
      expect(c.filters).toContainEqual({ col: 'user_id', val: UID });
    expect((fake.writes()[2].payload as Row).user_id).toBe(UID);
    expect(fake.tables.ingredient_kits.map((k) => k.name).sort()).toEqual([
      '새 세트',
      '이름 바꿈',
    ]);
  });
});

describe('accountSync: lifecycle', () => {
  it('start twice loads once; phases are reported to subscribers', async () => {
    const { fake, sync } = setup();
    const seen: string[] = [];
    sync.subscribe(() => seen.push(sync.phase()));
    await Promise.all([sync.start(), sync.start()]);
    expect(fake.calls.filter(is('select', 'profiles'))).toHaveLength(1);
    expect(seen[0]).toBe('loading');
    expect(seen.at(-1)).toBe('ready');
  });

  it('stop drops a waiting write and stops listening', async () => {
    const { fake, store, sync } = setup();
    await sync.start();
    store.edit((s) => (s.profile.weightKg = 59));
    sync.stop();
    await tick(10 * SYNC_DEBOUNCE_MS);
    store.edit((s) => (s.profile.weightKg = 58));
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toEqual([]);
  });

  it('clearError clears the message', async () => {
    const { fake, sync } = setup();
    fake.failWhen(is('select', 'profiles'));
    await sync.start();
    expect(sync.lastError()).toBe('boom');
    sync.clearError();
    expect(sync.lastError()).toBeNull();
  });
});
