import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUuid } from '@/lib/id/newUuid';
import { newStarSnapshot } from '@/lib/plan/starSnapshot';
import { createAppStore } from '@/lib/store/appStore';
import {
  createFakeSupabase,
  is,
  type Row,
} from '@/lib/supabase/__fixtures__/fakeSupabase';
import {
  ACCOUNT_CACHE_PREFIX,
  LEGACY_SAVED_KEY,
  LEGACY_STATE_KEY,
  NO_ACCOUNT_CACHE_KEY,
  accountCacheKey,
  accountCacheOnly,
} from '@/lib/supabase/cacheOwner';
import { SYNC_DEBOUNCE_MS } from '@/lib/supabase/syncConstants';
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
import { LEGACY_CLAIM_KEY } from '@/lib/legacy/legacyClaim';
import {
  createAccountRuntime,
  pendingSavedStore,
  type CacheStorage,
} from './runtime';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const profileRow = (id: string, weight: number): Row => ({
  id,
  sex: 'female',
  birth_year: 1996,
  height_cm: 163,
  weight_kg: weight,
  activity_level: 2,
  goal: 'lose',
  meals_per_day: 3,
  styles: [],
  custom_targets: null,
  legacy_imported_at: null,
});
const pref = (uid: string, id: string): Row => ({
  user_id: uid,
  item_id: id,
  kind: 'food',
  status: 'ok',
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: CacheStorage & { data: Map<string, string> } = {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    keys: () => [...data.keys()],
  };
  return storage;
}

const LEGACY_STATE = JSON.stringify({
  version: 2,
  state: {
    profile: { sex: 'male', weightKg: 99 },
    styles: [],
    overrides: {},
    selection: { foods: { cod: 'ok' }, seasonings: {} },
    step: 0,
    kits: [],
  },
});
const LEGACY_SAVED = JSON.stringify({ version: 1, items: [] });

function setup(
  opts: {
    tables?: Record<string, Row[]>;
    storage?: Record<string, string>;
    uid?: string;
  } = {},
) {
  const fake = createFakeSupabase({
    uid: opts.uid ?? A,
    tables: opts.tables ?? {
      profiles: [profileRow(A, 60), profileRow(B, 70)],
      food_prefs: [pref(A, 'chicken-breast'), pref(B, 'white-rice')],
    },
  });
  const storage = memoryStorage(opts.storage);
  // the same wiring as the app-wide store: only per-user cache keys reach the storage
  const appStore = createAppStore(accountCacheOnly(storage));
  appStore.persist.setOptions({ name: NO_ACCOUNT_CACHE_KEY });
  const runtime = createAccountRuntime({
    client: fake.client,
    appStore,
    storage,
  });
  return { fake, storage, appStore, runtime };
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('account runtime: signed out', () => {
  it('a visitor needs no account load: signed-out at once, no data requests, nothing stored', async () => {
    const { fake, storage, appStore, runtime } = setup({
      storage: {
        [LEGACY_STATE_KEY]: LEGACY_STATE,
        [LEGACY_SAVED_KEY]: LEGACY_SAVED,
      },
    });
    expect(runtime.getSnapshot().session).toBe('unknown');
    await runtime.applySession(null);
    expect(runtime.getSnapshot()).toMatchObject({
      session: 'signed-out',
      uid: null,
      phase: 'idle',
    });
    expect(fake.calls).toEqual([]);
    appStore.getState().toggleFood('cod'); // an edit with nobody signed in is not saved anywhere
    expect([...storage.data.keys()].sort()).toEqual(
      [LEGACY_STATE_KEY, LEGACY_SAVED_KEY].sort(),
    );
    expect(storage.data.get(LEGACY_STATE_KEY)).toBe(LEGACY_STATE);
  });

  it("a visitor's ★ store is empty and ready (memory only)", async () => {
    const { runtime } = setup();
    await runtime.applySession(null);
    const saved = runtime.getSnapshot().savedStore;
    expect(saved.status()).toBe('ready');
    expect(saved.list()).toEqual([]);
  });
});

describe('account runtime: sign in', () => {
  it('loads the server data, keeps a per-user cache with the owner, and is ready', async () => {
    const { fake, storage, appStore, runtime } = setup();
    await runtime.applySession(A);
    expect(runtime.getSnapshot()).toMatchObject({
      session: 'signed-in',
      uid: A,
      phase: 'ready',
    });
    expect(appStore.getState().profile.weightKg).toBe(60);
    expect(appStore.getState().selection.foods).toEqual({
      'chicken-breast': 'ok',
    });
    expect(appStore.getState().ownerUid).toBe(A);
    const cached = JSON.parse(storage.data.get(accountCacheKey(A))!);
    expect(cached.state.ownerUid).toBe(A);
    expect(cached.state.profile.weightKg).toBe(60);
    expect(fake.writes()).toEqual([]);
  });

  it('(a) an old cache of this user never overwrites the server', async () => {
    const stale = JSON.stringify({
      version: 2,
      state: {
        ownerUid: A,
        profile: { sex: 'male', weightKg: 80 },
        styles: ['pescatarian'],
        overrides: {},
        selection: { foods: { 'white-rice': 'ok' }, seasonings: {} },
        step: 3,
        kits: [],
      },
    });
    const { fake, appStore, runtime } = setup({
      storage: { [accountCacheKey(A)]: stale },
    });
    await runtime.applySession(A);
    expect(appStore.getState().profile.weightKg).toBe(60);
    expect(appStore.getState().styles).toEqual([]);
    expect(appStore.getState().selection.foods).toEqual({
      'chicken-breast': 'ok',
    });
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toEqual([]);
  });

  it('a cache whose owner is someone else, or that has no owner, is deleted and not used', async () => {
    for (const owner of [B, undefined]) {
      const bad = JSON.stringify({
        version: 2,
        state: {
          ownerUid: owner,
          profile: { weightKg: 123 },
          styles: [],
          overrides: {},
          selection: { foods: { cod: 'ok' }, seasonings: {} },
          step: 0,
          kits: [],
        },
      });
      const { appStore, runtime, storage } = setup({
        storage: { [accountCacheKey(A)]: bad },
      });
      let seenDuringLoad: number | undefined = -1;
      runtime.subscribe(() => {
        if (runtime.getSnapshot().phase === 'loading')
          seenDuringLoad = appStore.getState().profile.weightKg;
      });
      await runtime.applySession(A);
      expect(seenDuringLoad).not.toBe(123); // the bad cache was never put into the store
      expect(appStore.getState().profile.weightKg).toBe(60);
      expect(
        JSON.parse(storage.data.get(accountCacheKey(A))!).state.ownerUid,
      ).toBe(A); // rewritten from the server
    }
  });

  it('the pre-login keys are never read as a cache and never overwritten', async () => {
    const { storage, appStore, runtime } = setup({
      storage: {
        [LEGACY_STATE_KEY]: LEGACY_STATE,
        [LEGACY_SAVED_KEY]: LEGACY_SAVED,
      },
    });
    await runtime.applySession(A);
    // the new account starts from the server (empty here for selection except its own), not from the old record
    expect(appStore.getState().profile.sex).toBe('female');
    expect(appStore.getState().selection.foods.cod).toBeUndefined();
    appStore.getState().toggleFood('cod');
    appStore.getState().toggleStyle('lowCarb');
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(storage.data.get(LEGACY_STATE_KEY)).toBe(LEGACY_STATE);
    expect(storage.data.get(LEGACY_SAVED_KEY)).toBe(LEGACY_SAVED);
  });

  it('a brand-new account starts empty even when the browser holds an old record', async () => {
    const { appStore, runtime } = setup({
      tables: {},
      storage: { [LEGACY_STATE_KEY]: LEGACY_STATE },
    });
    await runtime.applySession(A);
    expect(appStore.getState().profile).toEqual({});
    expect(appStore.getState().selection).toEqual({
      foods: {},
      seasonings: {},
    });
    expect(runtime.getSnapshot().phase).toBe('ready');
  });

  it('TOKEN_REFRESHED and repeated sign-in events of the same user do not reload', async () => {
    const { fake, runtime } = setup();
    const stop = runtime.start();
    fake.emitAuth('INITIAL_SESSION', A);
    await tick();
    const selects = fake.calls.length;
    fake.emitAuth('TOKEN_REFRESHED', A);
    fake.emitAuth('SIGNED_IN', A);
    await tick();
    expect(fake.calls.length).toBe(selects);
    stop();
  });

  it('a failed first load gives the error phase with the message, and the screens can retry', async () => {
    const { fake, runtime } = setup();
    fake.failWhen(is('select', 'profiles'));
    await runtime.applySession(A);
    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'error',
      error: 'boom',
    });
    await runtime.retry();
    expect(runtime.getSnapshot().phase).toBe('ready');
  });
});

describe('account runtime: start, stop, start (React Strict Mode in development)', () => {
  it('works after it was stopped and started again, which is how the page starts it', async () => {
    const { fake, runtime, appStore } = setup();
    const stop1 = runtime.start();
    stop1(); // the effect is cleaned up and run again
    const stop2 = runtime.start();
    fake.emitAuth('INITIAL_SESSION', A);
    await tick();
    expect(runtime.getSnapshot()).toMatchObject({
      session: 'signed-in',
      uid: A,
      phase: 'ready',
    });
    expect(appStore.getState().profile.weightKg).toBe(60);
    stop2();
  });

  it('a sign-in that was already set up is set up again after stop and start', async () => {
    const { fake, runtime, appStore, storage } = setup();
    const stop1 = runtime.start();
    fake.emitAuth('INITIAL_SESSION', A);
    await tick();
    expect(runtime.getSnapshot().phase).toBe('ready');
    stop1();
    expect(runtime.getSnapshot().session).toBe('unknown');
    const stop2 = runtime.start();
    fake.emitAuth('INITIAL_SESSION', A);
    await tick();
    expect(runtime.getSnapshot()).toMatchObject({
      session: 'signed-in',
      uid: A,
      phase: 'ready',
    });
    expect(appStore.getState().profile.weightKg).toBe(60);
    expect(
      JSON.parse(storage.data.get(accountCacheKey(A))!).state.ownerUid,
    ).toBe(A);
    stop2();
  });

  it('the fallback getSession also sets the account up when no event arrives', async () => {
    const { runtime } = setup();
    const stop = runtime.start();
    await tick();
    expect(runtime.getSnapshot()).toMatchObject({
      session: 'signed-in',
      uid: A,
      phase: 'ready',
    });
    stop();
  });

  it('a sign-in still being set up when stop is called does not finish', async () => {
    const { fake, runtime } = setup();
    const release = fake.holdWhen(is('select', 'profiles'));
    const stop = runtime.start();
    fake.emitAuth('INITIAL_SESSION', A);
    await tick();
    stop();
    release();
    await tick();
    expect(runtime.getSnapshot().session).toBe('unknown');
  });
});

describe('account runtime: sign out and user switch', () => {
  it('sign-out empties the store, deletes the cache, keeps the legacy keys, and stops saving', async () => {
    const { fake, storage, appStore, runtime } = setup({
      storage: { [LEGACY_STATE_KEY]: LEGACY_STATE },
    });
    await runtime.applySession(A);
    expect(storage.data.has(accountCacheKey(A))).toBe(true);
    await runtime.applySession(null);
    expect(runtime.getSnapshot()).toMatchObject({
      session: 'signed-out',
      uid: null,
    });
    expect(appStore.getState().profile).toEqual({});
    expect(appStore.getState().ownerUid).toBeNull();
    expect(storage.data.has(accountCacheKey(A))).toBe(false);
    expect(storage.data.get(LEGACY_STATE_KEY)).toBe(LEGACY_STATE);
    appStore.getState().toggleFood('cod');
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toEqual([]);
    expect([...storage.data.keys()]).toEqual([LEGACY_STATE_KEY]);
  });

  it("switching to another user: the first user's data is gone from memory and from storage", async () => {
    const { fake, storage, appStore, runtime } = setup();
    await runtime.applySession(A);
    appStore.getState().setStep(2);
    fake.setUid(B);
    await runtime.applySession(B);
    expect(runtime.getSnapshot()).toMatchObject({ uid: B, phase: 'ready' });
    expect(appStore.getState().profile.weightKg).toBe(70);
    expect(appStore.getState().selection.foods).toEqual({ 'white-rice': 'ok' });
    expect(appStore.getState().ownerUid).toBe(B);
    expect(appStore.getState().step).toBe(0);
    expect(
      [...storage.data.keys()].filter((k) =>
        k.startsWith(ACCOUNT_CACHE_PREFIX),
      ),
    ).toEqual([accountCacheKey(B)]);
  });

  it('edits are written for the signed-in user only: nothing reaches the server after sign-out or a switch', async () => {
    const { fake, appStore, runtime } = setup();
    await runtime.applySession(A);
    appStore.getState().toggleFood('cod');
    fake.setUid(B);
    await runtime.applySession(B); // A's waiting edit is dropped, not written as B
    await tick(10 * SYNC_DEBOUNCE_MS);
    expect(fake.writes()).toEqual([]);
    expect(fake.tables.food_prefs.filter((r) => r.user_id === B)).toEqual([
      pref(B, 'white-rice'),
    ]);
  });
});

describe('account runtime: saving', () => {
  it('flush writes waiting edits at once (before a logout); hasUnsavedChanges tells while they wait', async () => {
    const { fake, appStore, runtime } = setup();
    await runtime.applySession(A);
    expect(runtime.hasUnsavedChanges()).toBe(false);
    appStore.getState().setProfile({ weightKg: 58 });
    expect(runtime.hasUnsavedChanges()).toBe(true);
    expect(runtime.getSnapshot().save).toBe('pending');
    await runtime.flush();
    expect(fake.tables.profiles.find((r) => r.id === A)!.weight_kg).toBe(58);
    expect(runtime.hasUnsavedChanges()).toBe(false);
    expect(runtime.getSnapshot().save).toBe('idle');
  });

  it('an edit made on the onboarding form halfway ("19") is not sent as is, and the typing is not undone', async () => {
    const { fake, appStore, runtime } = setup();
    await runtime.applySession(A);
    for (const y of [1, 19, 199, 1996])
      appStore.getState().setProfile({ birthYear: y });
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(runtime.getSnapshot().error).toBeNull();
    expect(appStore.getState().profile.birthYear).toBe(1996);
    expect(fake.tables.profiles.find((r) => r.id === A)!.birth_year).toBe(1996);
  });
});

describe('saved kits and stars get uuid ids and reach the server', () => {
  it('saveKit makes a uuid id, and the kit row is written with that id for this user', async () => {
    const { fake, appStore, runtime } = setup();
    await runtime.applySession(A);
    appStore.getState().toggleFood('cod');
    appStore.getState().toggleStyle('pescatarian');
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(appStore.getState().saveKit('주중 도시락', true)).toBeNull();
    const kit = appStore.getState().kits[0];
    expect(isUuid(kit.id)).toBe(true);
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(runtime.getSnapshot().error).toBeNull();
    const rows = fake.tables.ingredient_kits;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: kit.id,
      user_id: A,
      name: '주중 도시락',
      styles: ['pescatarian'],
    });
    expect((rows[0].selection as { foods: object }).foods).toMatchObject({
      cod: 'ok',
    });
    // and it comes back from the server after a reload of the account data
    await runtime.retry();
    expect(appStore.getState().kits.map((k) => k.id)).toEqual([kit.id]);
  });

  it('rename and delete of a saved kit reach the server too', async () => {
    const { fake, appStore, runtime } = setup();
    await runtime.applySession(A);
    appStore.getState().saveKit('하나', false);
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    const id = appStore.getState().kits[0].id;
    appStore.getState().renameKit(id, '둘');
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(fake.tables.ingredient_kits[0].name).toBe('둘');
    appStore.getState().deleteKit(id);
    await tick(SYNC_DEBOUNCE_MS);
    await tick();
    expect(fake.tables.ingredient_kits).toEqual([]);
  });

  it('a ★ snapshot gets a uuid id and the saved_combos row keeps exactly that id', async () => {
    const { fake, runtime } = setup();
    await runtime.applySession(A);
    const profile = EXAMPLE_PROFILES[0].profile;
    const { targets } = calcDayTargets(
      profile,
      REF_YEAR,
      undefined,
      resolveStyles([], profile.goal),
    );
    const combo = generateMealOptions({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: selectAll(),
      targets: calcMealTargets(targets, 3)[1],
      count: 1,
    }).combos[0];
    const snap = newStarSnapshot(combo, 'lunch', 'fp', 1_700_000_000_000);
    expect(isUuid(snap.id)).toBe(true);
    const store = runtime.getSnapshot().savedStore;
    await vi.advanceTimersByTimeAsync(0);
    await expect(store.toggle(snap)).resolves.toBe('added');
    expect(fake.tables.saved_combos).toHaveLength(1);
    expect(fake.tables.saved_combos[0]).toMatchObject({
      id: snap.id,
      user_id: A,
      signature: snap.signature,
      meal_type: 'lunch',
    });
    expect(store.list()[0].id).toBe(snap.id); // the same id in the list and on the server
  });
});

describe('stores read by React (useSyncExternalStore)', () => {
  it('list() and status() give the same value on every call, so React does not loop', async () => {
    // the store shown before the session is known
    expect(pendingSavedStore.list()).toBe(pendingSavedStore.list());
    expect(pendingSavedStore.status()).toBe('loading');
    // the visitor's store, the signed-in store while loading and after
    const { runtime } = setup();
    expect(runtime.getSnapshot().savedStore).toBe(pendingSavedStore);
    await runtime.applySession(null);
    const visitor = runtime.getSnapshot().savedStore;
    expect(visitor.list()).toBe(visitor.list());
    await runtime.applySession(A);
    const mine = runtime.getSnapshot().savedStore;
    expect(mine.list()).toBe(mine.list());
    await tick();
    expect(mine.list()).toBe(mine.list());
    // and the snapshot object itself only changes when something changed
    expect(runtime.getSnapshot()).toBe(runtime.getSnapshot());
  });

  it('the pending store refuses changes instead of pretending', async () => {
    await expect(pendingSavedStore.toggle({} as never)).rejects.toThrow(
      'account not ready',
    );
    await expect(pendingSavedStore.remove('x')).rejects.toThrow();
    await expect(pendingSavedStore.addMany([])).rejects.toThrow();
  });
});

describe('account cache guard', () => {
  it('accountCacheOnly lets only per-user keys through', () => {
    const storage = memoryStorage({ [LEGACY_STATE_KEY]: 'old' });
    const guarded = accountCacheOnly(storage);
    expect(guarded.getItem(LEGACY_STATE_KEY)).toBeNull();
    guarded.setItem(LEGACY_STATE_KEY, 'overwritten');
    guarded.setItem(NO_ACCOUNT_CACHE_KEY, 'x');
    guarded.setItem(accountCacheKey(A), 'mine');
    guarded.removeItem(LEGACY_STATE_KEY);
    expect(storage.data.get(LEGACY_STATE_KEY)).toBe('old');
    expect(storage.data.has(NO_ACCOUNT_CACHE_KEY)).toBe(false);
    expect(guarded.getItem(accountCacheKey(A))).toBe('mine');
    guarded.removeItem(accountCacheKey(A));
    expect(storage.data.has(accountCacheKey(A))).toBe(false);
  });
});

describe('account runtime: the "이전 기록 불러오기" offer (PLAN.md 9.2)', () => {
  const OLD = {
    [LEGACY_STATE_KEY]: LEGACY_STATE,
    [LEGACY_SAVED_KEY]: LEGACY_SAVED,
  };
  const claim = (uid: string) => JSON.stringify({ uid, at: 1 });

  it('is offered to a signed-in account when the browser holds a record nobody claimed', async () => {
    const { runtime } = setup({ storage: OLD });
    expect(runtime.legacyOffer()).toBeNull(); // not signed in yet
    await runtime.applySession(A);
    const offer = runtime.legacyOffer();
    expect(offer).not.toBeNull();
    expect(offer!.resumed).toBe(false);
    expect(offer!.plan.hasChanges).toBe(true);
  });

  it('is not offered when the record is empty or broken', async () => {
    for (const storage of [
      {} as Record<string, string>,
      { [LEGACY_STATE_KEY]: '{{' },
      { [LEGACY_STATE_KEY]: JSON.stringify({ version: 2, state: {} }) },
    ]) {
      const { runtime } = setup({ storage });
      await runtime.applySession(A);
      expect(runtime.legacyOffer()).toBeNull();
    }
  });

  it('is not offered when another account holds the claim, and the record is not even read', async () => {
    const { runtime, storage } = setup({
      storage: { ...OLD, [LEGACY_CLAIM_KEY]: claim(B) },
    });
    await runtime.applySession(A);
    const read = vi.spyOn(storage, 'getItem');
    expect(runtime.legacyOffer()).toBeNull();
    expect(read).not.toHaveBeenCalledWith(LEGACY_STATE_KEY);
    expect(read).not.toHaveBeenCalledWith(LEGACY_SAVED_KEY);
  });

  it('my own claim: offered again and marked as resumed (a restore of mine stopped half way)', async () => {
    const { runtime } = setup({
      storage: { ...OLD, [LEGACY_CLAIM_KEY]: claim(A) },
    });
    await runtime.applySession(A);
    expect(runtime.legacyOffer()?.resumed).toBe(true);
  });

  it('is not offered once the account has loaded a record (on any device)', async () => {
    const { runtime } = setup({
      storage: OLD,
      tables: {
        profiles: [
          { ...profileRow(A, 60), legacy_imported_at: '2026-11-24T00:00:00Z' },
        ],
        food_prefs: [],
      },
    });
    await runtime.applySession(A);
    expect(runtime.getSnapshot().legacyImportedAt).not.toBeNull();
    expect(runtime.legacyOffer()).toBeNull();
  });

  it('a new account does not get the old record copied: its data stays empty until the button is used', async () => {
    const { appStore, runtime } = setup({
      storage: OLD,
      tables: { profiles: [profileRow(A, 60)], food_prefs: [] },
    });
    await runtime.applySession(A);
    expect(appStore.getState().selection.foods).toEqual({});
    expect(appStore.getState().profile.weightKg).toBe(60); // the server's, not the old record's 99
  });
});
