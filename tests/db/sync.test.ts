// The account sync against the real TEST project (npm run test:db): profile, selection, ingredient kits and the
// saved (★) combos through the same code the app runs, with a real signed-in user (RLS, grants, PostgREST).
// The guard runs first; the user is created for this run and deleted at the end.
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isUuid, newUuid } from '@/lib/id/newUuid';
import { createAppStore } from '@/lib/store/appStore';
import { createAccountSync } from '@/lib/supabase/accountSync';
import { createSupabaseSavedStore } from '@/lib/supabase/savedRemote';
import { newStarSnapshot } from '@/lib/plan/starSnapshot';
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
import {
  loadTestProject,
  testProjectConfigured,
  type TestProject,
} from '../helpers/testProjectGuard';

const noSession = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;
const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

let project: TestProject;
let admin: SupabaseClient;
let user: { id: string; client: SupabaseClient };

const rows = async (table: string, column: string) => {
  const { data, error } = await admin
    .from(table)
    .select('*')
    .eq(column, user.id);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as Record<string, unknown>[];
};

function newSync() {
  const store = createAppStore(memoryStorage());
  const sync = createAccountSync({
    client: user.client,
    uid: user.id,
    store,
    debounceMs: 5,
  });
  return { store, sync };
}

describe.skipIf(!testProjectConfigured())(
  'account sync on the test project',
  () => {
    beforeAll(async () => {
      project = loadTestProject(); // throws unless this is the marked test project
      admin = createClient(project.url, project.serviceKey, noSession);
      const email = `sync-${randomBytes(6).toString('hex')}@example.com`;
      const password = randomBytes(24).toString('base64url');
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (created.error || !created.data.user)
        throw new Error(`createUser: ${created.error?.message}`);
      const client = createClient(project.url, project.anonKey, noSession);
      const signIn = await client.auth.signInWithPassword({ email, password });
      if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
      user = { id: created.data.user.id, client };
    });

    afterAll(async () => {
      if (user) await admin.auth.admin.deleteUser(user.id);
    });

    it('first login creates the empty profiles row once; the app starts empty and ready', async () => {
      const { store, sync } = newSync();
      expect(await rows('profiles', 'id')).toEqual([]);
      await sync.start();
      expect(sync.phase()).toBe('ready');
      expect(sync.lastError()).toBeNull();
      const created = await rows('profiles', 'id');
      expect(created).toHaveLength(1);
      expect(created[0].weight_kg).toBeNull();
      expect(store.getState().profile).toEqual({});
      // a second app start (another tab) neither fails nor creates a second row
      const other = newSync();
      await other.sync.start();
      expect(other.sync.phase()).toBe('ready');
      expect(await rows('profiles', 'id')).toHaveLength(1);
      sync.stop();
      other.sync.stop();
    });

    it('profile, styles, overrides, selection and a kit written by the app are in the tables; a reload gives them back', async () => {
      const { store, sync } = newSync();
      await sync.start();
      const s = store.getState();
      s.setProfile({
        sex: 'female',
        birthYear: 1996,
        heightCm: 163,
        weightKg: 60.5,
        activityLevel: 2,
        goal: 'lose',
        mealsPerDay: 3,
      });
      s.toggleStyle('lowSodium');
      s.setOverrides({ sodiumMax: 1500, protein: { perKg: 1.6 } });
      s.toggleFood('chicken-breast');
      s.toggleFood('chicken-breast'); // -> favorite
      s.toggleFood('cabbage');
      s.toggleSeasoning('salt');
      expect(s.saveKit('주중 도시락', true)).toBeNull();
      const kitId = store.getState().kits[0].id;
      expect(isUuid(kitId)).toBe(true);
      await sync.flush();
      expect(sync.lastError()).toBeNull();

      const [profile] = await rows('profiles', 'id');
      expect(profile).toMatchObject({
        sex: 'female',
        birth_year: 1996,
        height_cm: 163,
        weight_kg: 60.5,
        goal: 'lose',
        styles: ['lowSodium'],
        custom_targets: { sodiumMax: 1500, protein: { perKg: 1.6 } },
      });
      const prefs = (await rows('food_prefs', 'user_id'))
        .map((r) => `${r.kind}:${r.item_id}:${r.status}`)
        .sort();
      expect(prefs).toEqual([
        'food:cabbage:ok',
        'food:chicken-breast:favorite',
        'seasoning:salt:ok',
      ]);
      const kits = await rows('ingredient_kits', 'user_id');
      expect(kits).toHaveLength(1);
      expect(kits[0]).toMatchObject({
        id: kitId,
        user_id: user.id,
        name: '주중 도시락',
        styles: ['lowSodium'],
      });
      expect(kits[0].selection).toMatchObject({
        foods: { 'chicken-breast': 'favorite', cabbage: 'ok' },
        seasonings: { salt: 'ok' },
      });

      // another browser: same data
      const second = newSync();
      await second.sync.start();
      expect(second.store.getState().profile).toMatchObject({
        weightKg: 60.5,
        goal: 'lose',
      });
      expect(second.store.getState().selection.foods).toEqual({
        'chicken-breast': 'favorite',
        cabbage: 'ok',
      });
      expect(second.store.getState().kits.map((k) => k.id)).toEqual([kitId]);
      sync.stop();
      second.sync.stop();
    });

    it('rename, selection change and delete reach the tables', async () => {
      const { store, sync } = newSync();
      await sync.start();
      const id = store.getState().kits[0].id;
      store.getState().renameKit(id, '새 이름');
      store.getState().toggleFood('white-rice');
      await sync.flush();
      expect((await rows('ingredient_kits', 'user_id'))[0].name).toBe(
        '새 이름',
      );
      expect(
        (await rows('food_prefs', 'user_id')).map((r) => r.item_id),
      ).toContain('white-rice');
      store.getState().deleteKit(id);
      await sync.flush();
      expect(await rows('ingredient_kits', 'user_id')).toEqual([]);
      expect(sync.lastError()).toBeNull();
      sync.stop();
    });

    it('a half-typed profile value ("19" on the way to a birth year) is not an error and is not stored', async () => {
      const { store, sync } = newSync();
      await sync.start();
      store.getState().setProfile({ birthYear: 19 });
      await sync.flush();
      expect(sync.lastError()).toBeNull();
      expect(store.getState().profile.birthYear).toBe(19); // the typing stays
      expect((await rows('profiles', 'id'))[0].birth_year).toBeNull();
      store.getState().setProfile({ birthYear: 1996 });
      await sync.flush();
      expect((await rows('profiles', 'id'))[0].birth_year).toBe(1996);
      sync.stop();
    });

    it('a kit name that is already taken fails, and the app goes back to the server state', async () => {
      const taken = await admin.from('ingredient_kits').insert({
        id: newUuid(),
        user_id: user.id,
        name: '같은 이름',
        selection: { foods: {}, seasonings: {} },
      });
      expect(taken.error).toBeNull();
      const { store, sync } = newSync();
      await sync.start();
      // the app does not know the name is taken: drop it from the local copy first, then save the same name
      store.setState({ kits: [] });
      await sync.flush(); // this deletes the server row too (the app removed its kit): reset the situation
      await admin.from('ingredient_kits').insert({
        id: newUuid(),
        user_id: user.id,
        name: '같은 이름',
        selection: { foods: {}, seasonings: {} },
      });
      expect(store.getState().saveKit('같은 이름', false)).toBeNull();
      await sync.flush();
      expect(sync.lastError()).toMatch(/duplicate|unique/i);
      expect(sync.phase()).toBe('ready');
      expect(store.getState().kits.map((k) => k.name)).toEqual(['같은 이름']); // the server's row
      sync.stop();
    });

    it('★: save, ignore a duplicate, unstar, addMany; rows carry the client uuid and the user', async () => {
      const profile = EXAMPLE_PROFILES[0].profile;
      const { targets } = calcDayTargets(
        profile,
        REF_YEAR,
        undefined,
        resolveStyles([], profile.goal),
      );
      const combos = generateMealOptions({
        foods: FOODS,
        seasonings: SEASONINGS,
        selection: selectAll(),
        targets: calcMealTargets(targets, 3)[1],
        count: 4,
      }).combos;
      const snap = (i: number) =>
        newStarSnapshot(combos[i], 'lunch', 'fp', 1_700_000_000_000 + i * 1000);
      const store = createSupabaseSavedStore(user.client, user.id);
      await store.refresh();
      expect(store.status()).toBe('ready');

      const first = snap(0);
      await expect(store.toggle(first)).resolves.toBe('added');
      let saved = await rows('saved_combos', 'user_id');
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        id: first.id,
        user_id: user.id,
        signature: first.signature,
        meal_type: 'lunch',
      });

      // the same signature saved from "another device" (a second store): ignored, no error, still one row
      const other = createSupabaseSavedStore(user.client, user.id);
      await other.refresh();
      await expect(other.addMany([snap(0)])).resolves.toEqual([]); // already there, seen by its own list
      const fresh = createSupabaseSavedStore(user.client, user.id);
      await fresh.refresh(); // the app waits for 'ready' before it shows anything
      await expect(fresh.toggle({ ...snap(0), id: newUuid() })).resolves.toBe(
        'removed',
      ); // loaded list has it: unstar
      expect(await rows('saved_combos', 'user_id')).toEqual([]);

      const ids = await store.addMany([snap(1), snap(2), snap(3)]);
      expect(ids).toHaveLength(3);
      saved = await rows('saved_combos', 'user_id');
      expect(saved.map((r) => r.id).sort()).toEqual([...ids].sort());
      // a row written outside the app with a food that does not exist is dropped when read
      const bad = {
        ...snap(0),
        id: newUuid(),
        signature: 'broken-sig',
        items: [{ foodId: 'no-such-food', name: 'x', grams: 1, basis: 'raw' }],
      };
      const insert = await admin.from('saved_combos').insert({
        id: bad.id,
        user_id: user.id,
        meal_type: 'lunch',
        signature: bad.signature,
        request_fingerprint: 'fp',
        items: bad.items,
        oils: [],
        seasonings: [],
        totals: bad.totals,
      });
      expect(insert.error).toBeNull();
      await store.refresh();
      expect(
        store
          .list()
          .map((s) => s.id)
          .sort(),
      ).toEqual([...ids].sort());
    });
  },
);
