// "이전 기록 불러오기" against the Supabase TEST project (npm run test:db): the runner's writes are repeatable
// (no duplicates), a restore that stopped half way is finished by running it again, the undo puts the old
// values back, other users are never touched, and a row near the size limit still passes the table checks.
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KNOWN_IDS } from '@/lib/data/knownIds';
import { newUuid } from '@/lib/id/newUuid';
import { LEGACY_CLAIM_KEY } from '@/lib/legacy/legacyClaim';
import { planRestore } from '@/lib/legacy/planRestore';
import { readLegacyRecord } from '@/lib/legacy/readLegacy';
import {
  runRestore,
  undoRestore,
  type RestoreDeps,
} from '@/lib/legacy/restoreRunner';
import { createSupabaseSavedStore } from '@/lib/supabase/savedRemote';
import { ROW_JSON_MAX_BYTES } from '@/lib/supabase/syncConstants';
import {
  loadTestProject,
  testProjectConfigured,
  type TestProject,
} from '../helpers/testProjectGuard';

const noSession = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;
type User = { id: string; client: SupabaseClient };

let project: TestProject;
let admin: SupabaseClient;
const created: string[] = [];

async function makeUser(): Promise<User> {
  const email = `legacy-${randomBytes(6).toString('hex')}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const r = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (r.error || !r.data.user)
    throw new Error(`createUser: ${r.error?.message}`);
  created.push(r.data.user.id);
  const client = createClient(project.url, project.anonKey, noSession);
  const s = await client.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(`signIn: ${s.error.message}`);
  await client.from('profiles').upsert({ id: r.data.user.id });
  return { id: r.data.user.id, client };
}

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      m.set(k, v);
    },
    removeItem: (k: string): void => {
      m.delete(k);
    },
  };
};

const totals = {
  kcal: 400,
  protein: 40,
  carbs: 20,
  netCarbs: 15,
  fiber: 5,
  fat: 10,
  satFat: 2,
  sodium: 300,
  cholesterol: 90,
};
const combo = (n: number, extraItems = 0) => ({
  id: `old-${n}`,
  savedAt: 1000 + n,
  mealType: 'lunch' as const,
  requestFingerprint: 'fp',
  signature: `chicken-breast:${100 + n},cabbage:100|`,
  items: [
    {
      foodId: 'chicken-breast',
      name: '닭가슴살',
      grams: 100 + n,
      basis: 'raw' as const,
    },
    { foodId: 'cabbage', name: '양배추', grams: 100, basis: 'raw' as const },
    ...Array.from({ length: extraItems }, () => ({
      foodId: 'cabbage',
      name: '양배추',
      grams: 100,
      basis: 'raw' as const,
    })),
  ],
  oils: [],
  seasonings: [],
  totals,
});
const legacyText = (saved: unknown[]) => ({
  state: JSON.stringify({
    version: 2,
    state: {
      profile: {
        sex: 'male',
        birthYear: 1990,
        heightCm: 175,
        weightKg: 70,
        activityLevel: 2,
        goal: 'lose',
        mealsPerDay: 2,
      },
      styles: ['lowCarb'],
      overrides: { sodiumMax: 1500 },
      selection: {
        foods: { 'chicken-breast': 'ok', cabbage: 'favorite' },
        seasonings: { salt: 'ok' },
      },
      kits: [1, 2, 3].map((i) => ({
        id: `k${i}`,
        name: `세트 ${i}`,
        selection: { foods: { tofu: 'ok' }, seasonings: {} },
        createdAt: i,
        updatedAt: i,
      })),
    },
  }),
  saved: JSON.stringify({ items: saved }),
});

async function count(table: string, col: string, id: string) {
  const { count: c, error } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(col, id);
  if (error) throw new Error(error.message);
  return c ?? 0;
}

function depsFor(user: User, storage = memory(), failSavedOnce = false) {
  const store = createSupabaseSavedStore(user.client, user.id, KNOWN_IDS);
  let failed = !failSavedOnce;
  const savedStore = {
    ...store,
    addMany: async (list: Parameters<typeof store.addMany>[0]) => {
      if (!failed) {
        failed = true;
        throw new Error('stopped half way');
      }
      return store.addMany(list);
    },
  };
  const deps: RestoreDeps = {
    client: user.client,
    uid: user.id,
    savedStore,
    storage,
    before: {
      settings: { profile: {}, styles: [], overrides: {} },
      selection: { foods: {}, seasonings: {} },
    },
    reload: async () => store.refresh(),
    newId: () => newUuid(),
  };
  return { deps, storage };
}

const emptyAccount = () => ({
  profile: {},
  styles: [] as never[],
  overrides: {},
  selection: { foods: {}, seasonings: {} },
  kits: [],
  savedSignatures: new Set<string>(),
});

describe.skipIf(!testProjectConfigured())(
  'restore of the previous record',
  () => {
    beforeAll(() => {
      project = loadTestProject(); // throws unless this is the marked test project
      admin = createClient(project.url, project.serviceKey, noSession);
    });
    afterAll(async () => {
      for (const id of created) await admin.auth.admin.deleteUser(id);
    });

    it('writes everything once; running the same restore again adds nothing', async () => {
      const a = await makeUser();
      const b = await makeUser();
      const t = legacyText([combo(1), combo(2), combo(3)]);
      const record = readLegacyRecord(t.state, t.saved, KNOWN_IDS);
      const plan = planRestore(record, emptyAccount());
      const { deps } = depsFor(a);
      const first = await runRestore(deps, plan, false);
      expect(first.status).toBe('done');
      expect(await count('ingredient_kits', 'user_id', a.id)).toBe(3);
      expect(await count('saved_combos', 'user_id', a.id)).toBe(3);
      const { data: p } = await admin
        .from('profiles')
        .select('*')
        .eq('id', a.id)
        .single();
      expect(p).toMatchObject({
        sex: 'male',
        birth_year: 1990,
        styles: ['lowCarb'],
        custom_targets: { sodiumMax: 1500 },
      });
      expect(p!.legacy_imported_at).not.toBeNull();
      const { data: prefs } = await admin
        .from('food_prefs')
        .select('item_id,status')
        .eq('user_id', a.id);
      expect(prefs).toHaveLength(3);

      // again (as after a press that was not seen finishing)
      const again = await runRestore(depsFor(a, deps.storage).deps, plan, true);
      expect(again.status).toBe('done');
      expect(await count('ingredient_kits', 'user_id', a.id)).toBe(3);
      expect(await count('saved_combos', 'user_id', a.id)).toBe(3);
      // the other user has nothing
      expect(await count('ingredient_kits', 'user_id', b.id)).toBe(0);
      expect(await count('saved_combos', 'user_id', b.id)).toBe(0);
    });

    it('a restore that stopped after the kits is finished by running it again: no duplicate kits or ★', async () => {
      const a = await makeUser();
      const t = legacyText([combo(1), combo(2)]);
      const plan = planRestore(
        readLegacyRecord(t.state, t.saved, KNOWN_IDS),
        emptyAccount(),
      );
      const storage = memory();
      const stopped = await runRestore(
        depsFor(a, storage, true).deps,
        plan,
        false,
      );
      expect(stopped.status).toBe('failed');
      expect(await count('ingredient_kits', 'user_id', a.id)).toBe(3); // written before the stop
      expect(await count('saved_combos', 'user_id', a.id)).toBe(0);
      const { data: before } = await admin
        .from('profiles')
        .select('legacy_imported_at')
        .eq('id', a.id)
        .single();
      expect(before!.legacy_imported_at).toBeNull(); // not marked: the button is still there

      const finished = await runRestore(depsFor(a, storage).deps, plan, true);
      expect(finished).toEqual({ status: 'done', undo: null }); // finished, no undo
      expect(await count('ingredient_kits', 'user_id', a.id)).toBe(3);
      expect(await count('saved_combos', 'user_id', a.id)).toBe(2);
      const { data: after } = await admin
        .from('profiles')
        .select('legacy_imported_at')
        .eq('id', a.id)
        .single();
      expect(after!.legacy_imported_at).not.toBeNull();
    });

    it('merges with what the account has: same names and signatures are skipped, the account values are kept where the record has none', async () => {
      const a = await makeUser();
      await a.client.from('ingredient_kits').insert({
        id: newUuid(),
        user_id: a.id,
        name: '세트 1',
        selection: { foods: {}, seasonings: {} },
        styles: null,
      });
      await a.client.rpc('set_food_prefs', {
        p_foods: { egg: 'ok' },
        p_seasonings: { salt: 'ok' },
      });
      const t = legacyText([combo(1)]);
      const record = readLegacyRecord(
        JSON.stringify({
          version: 2,
          state: { kits: JSON.parse(t.state).state.kits },
        }), // no selection in the record
        t.saved,
        KNOWN_IDS,
      );
      const plan = planRestore(record, {
        ...emptyAccount(),
        selection: { foods: { egg: 'ok' }, seasonings: { salt: 'ok' } },
        kits: [
          {
            id: 'x',
            name: '세트 1',
            selection: { foods: {}, seasonings: {} },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });
      expect(plan.selection).toBeNull();
      expect(plan.skipped.kitsExisting).toBe(1);
      expect((await runRestore(depsFor(a).deps, plan, false)).status).toBe(
        'done',
      );
      expect(await count('ingredient_kits', 'user_id', a.id)).toBe(3); // 1 own + 2 new
      const { data: prefs } = await admin
        .from('food_prefs')
        .select('item_id')
        .eq('user_id', a.id);
      expect(prefs!.map((r) => r.item_id).sort()).toEqual(['egg', 'salt']); // untouched
    });

    it('the undo puts the old values back and removes only what the restore added', async () => {
      const a = await makeUser();
      await a.client.rpc('set_food_prefs', {
        p_foods: { egg: 'ok' },
        p_seasonings: {},
      });
      await a.client
        .from('profiles')
        .upsert({ id: a.id, sex: 'female', styles: ['lowSodium'] });
      const t = legacyText([combo(1), combo(2)]);
      const record = readLegacyRecord(t.state, t.saved, KNOWN_IDS);
      const before = {
        settings: {
          profile: { sex: 'female' as const },
          styles: ['lowSodium' as const],
          overrides: {},
        },
        selection: { foods: { egg: 'ok' as const }, seasonings: {} },
      };
      const plan = planRestore(record, {
        ...emptyAccount(),
        profile: before.settings.profile,
        styles: before.settings.styles,
        selection: before.selection,
      });
      const { deps, storage } = depsFor(a);
      deps.before = before;
      const out = await runRestore(deps, plan, false);
      if (out.status !== 'done' || !out.undo)
        throw new Error('expected an undo');
      expect(await count('saved_combos', 'user_id', a.id)).toBe(2);
      await undoRestore(deps, out.undo);
      expect(await count('ingredient_kits', 'user_id', a.id)).toBe(0);
      expect(await count('saved_combos', 'user_id', a.id)).toBe(0);
      const { data: p } = await admin
        .from('profiles')
        .select('*')
        .eq('id', a.id)
        .single();
      expect(p).toMatchObject({
        sex: 'female',
        styles: ['lowSodium'],
        legacy_imported_at: null,
      });
      const { data: prefs } = await admin
        .from('food_prefs')
        .select('item_id')
        .eq('user_id', a.id);
      expect(prefs!.map((r) => r.item_id)).toEqual(['egg']);
      expect(storage.getItem(LEGACY_CLAIM_KEY)).toBeNull();
    });

    it('a ★ near the size limit is accepted by the table, whatever makes it big; one over it is dropped before writing', async () => {
      const a = await makeUser();
      const bytes = (v: unknown) =>
        new TextEncoder().encode(JSON.stringify(v)).length;
      const grow = (make: (n: number) => unknown, target: number) => {
        let n = 1;
        while (bytes(make(n + 1)) < target) n += 1;
        return n;
      };
      // big because of one long name (items), and big because of many seasonings (many small objects: the
      // json stored by the table is larger than its text: a bound on the text must leave room for that)
      const longName = (n: number) => [
        {
          foodId: 'chicken-breast',
          name: '닭'.repeat(n),
          grams: 100,
          basis: 'raw' as const,
        },
        {
          foodId: 'cabbage',
          name: '양배추',
          grams: 100,
          basis: 'raw' as const,
        },
      ];
      const manySeasonings = (n: number) =>
        Array.from({ length: n }, () => ({
          id: 'salt',
          name: '소금',
          units: 1,
          unitLabel: '꼬집(0.5g)',
        }));
      const nameN = grow(longName, ROW_JSON_MAX_BYTES - 100);
      const seasN = grow(manySeasonings, ROW_JSON_MAX_BYTES - 100);
      const a1 = {
        ...combo(1),
        items: longName(nameN),
        signature: 'cabbage:100,chicken-breast:100|',
      };
      const a2 = {
        ...combo(2),
        seasonings: manySeasonings(seasN),
        signature: 'cabbage:100,chicken-breast:102|',
      };
      const over = {
        ...combo(3),
        seasonings: manySeasonings(seasN + 40),
        signature: 'cabbage:100,chicken-breast:103|',
      };
      const t = legacyText([a1, a2, over]);
      const record = readLegacyRecord(t.state, t.saved, KNOWN_IDS);
      // a1 / a2 keep the grams of combo(): signature recomputed from the foods
      expect(record.dropped.saved).toBe(1); // only the one over the limit
      expect(record.saved).toHaveLength(2);
      const plan = planRestore(record, emptyAccount());
      const out = await runRestore(depsFor(a).deps, plan, false);
      expect(out).toMatchObject({ status: 'done' });
      expect(await count('saved_combos', 'user_id', a.id)).toBe(2);
    });
  },
);
