// RLS and privilege tests against the Supabase TEST project (npm run test:db).
// The guard runs first and refuses anything that is not the marked test project. Users A and B are created
// with random emails for this run and deleted at the end, even when a test fails.
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadTestProject,
  testProjectConfigured,
  type TestProject,
} from '../helpers/testProjectGuard';

const TABLES = [
  'profiles',
  'food_prefs',
  'ingredient_kits',
  'saved_combos',
] as const;
const noSession = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

type User = { id: string; email: string; client: SupabaseClient };

let project: TestProject;
let admin: SupabaseClient;
let anon: SupabaseClient;
let A: User;
let B: User;
const created: string[] = [];

const kitRow = (userId: string, name: string) => ({
  id: crypto.randomUUID(),
  user_id: userId,
  name,
  selection: { foods: { 'chicken-breast': 'ok' }, seasonings: {} },
  styles: null,
});
const savedRow = (userId: string, signature: string) => ({
  id: crypto.randomUUID(),
  user_id: userId,
  meal_type: 'lunch',
  signature,
  request_fingerprint: 'fp',
  items: [
    { foodId: 'chicken-breast', name: '닭가슴살', grams: 150, basis: 'raw' },
  ],
  oils: [],
  seasonings: [],
  totals: { kcal: 1 },
});

async function makeUser(label: string): Promise<User> {
  const email = `rls-${label}-${randomBytes(6).toString('hex')}@example.com`;
  const password = randomBytes(24).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`createUser ${label}: ${error?.message}`);
  created.push(data.user.id);
  const client = createClient(project.url, project.anonKey, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn ${label}: ${signIn.error.message}`);
  return { id: data.user.id, email, client };
}

/** Rows of a user, read with the service key (sees everything). */
async function countAs(table: string, column: string, userId: string) {
  const { count, error } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, userId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count;
}

const ownerColumn = (t: (typeof TABLES)[number]) =>
  t === 'profiles' ? 'id' : 'user_id';

describe.skipIf(!testProjectConfigured())('RLS on the test project', () => {
  beforeAll(async () => {
    project = loadTestProject(); // throws unless this is the marked test project
    admin = createClient(project.url, project.serviceKey, noSession);
    anon = createClient(project.url, project.anonKey, noSession);
    A = await makeUser('a');
    B = await makeUser('b');

    // Each user's own data, written as that user.
    for (const u of [A, B]) {
      const p = await u.client
        .from('profiles')
        .insert({ id: u.id, weight_kg: 60 });
      if (p.error) throw new Error(`seed profile: ${p.error.message}`);
      const k = await u.client
        .from('ingredient_kits')
        .insert(kitRow(u.id, '내 세트'));
      if (k.error) throw new Error(`seed kit: ${k.error.message}`);
      const s = await u.client
        .from('saved_combos')
        .insert(savedRow(u.id, `own-${u.id}`));
      if (s.error) throw new Error(`seed saved: ${s.error.message}`);
    }
    const a = await A.client.rpc('set_food_prefs', {
      p_foods: { 'chicken-breast': 'ok', cabbage: 'favorite' },
      p_seasonings: { salt: 'ok' },
    });
    if (a.error) throw new Error(`seed A prefs: ${a.error.message}`);
    const b = await B.client.rpc('set_food_prefs', {
      p_foods: { 'white-rice': 'ok' },
      p_seasonings: {},
    });
    if (b.error) throw new Error(`seed B prefs: ${b.error.message}`);
  });

  afterAll(async () => {
    for (const id of created) await admin?.auth.admin.deleteUser(id);
  });

  it('1. A reads only its own rows in every table', async () => {
    for (const t of TABLES) {
      const own = await A.client.from(t).select('*');
      expect(own.error, t).toBeNull();
      expect(own.data!.length, t).toBeGreaterThan(0);
      expect(
        own.data!.every((r) => r[ownerColumn(t)] === A.id),
        t,
      ).toBe(true);
      const other = await A.client.from(t).select('*').eq(ownerColumn(t), B.id);
      expect(other.error, t).toBeNull();
      expect(other.data, t).toEqual([]);
    }
  });

  it('1. A cannot update or delete B rows (0 rows affected, B rows unchanged)', async () => {
    const up = await A.client
      .from('profiles')
      .update({ weight_kg: 99 })
      .eq('id', B.id)
      .select();
    expect(up.error).toBeNull();
    expect(up.data).toEqual([]);
    const upKit = await A.client
      .from('ingredient_kits')
      .update({ name: '뺏기' })
      .eq('user_id', B.id)
      .select();
    expect(upKit.data).toEqual([]);
    for (const t of ['profiles', 'ingredient_kits', 'saved_combos'] as const) {
      const del = await A.client
        .from(t)
        .delete()
        .eq(ownerColumn(t), B.id)
        .select();
      expect(del.error, t).toBeNull();
      expect(del.data, t).toEqual([]);
      expect(await countAs(t, ownerColumn(t), B.id), t).toBe(1);
    }
    const b = await admin
      .from('profiles')
      .select('weight_kg')
      .eq('id', B.id)
      .single();
    expect(Number(b.data!.weight_kg)).toBe(60);
  });

  it('1. A cannot insert rows with user_id = B', async () => {
    const kit = await A.client
      .from('ingredient_kits')
      .insert(kitRow(B.id, '남의 세트'));
    expect(kit.error?.code).toBe('42501');
    const saved = await A.client
      .from('saved_combos')
      .insert(savedRow(B.id, 'b-forged'));
    expect(saved.error?.code).toBe('42501');
  });

  it('1-2. A cannot move its own rows to B, and cannot write food_prefs directly', async () => {
    const kit = await A.client
      .from('ingredient_kits')
      .update({ user_id: B.id })
      .eq('user_id', A.id);
    expect(kit.error?.code).toBe('42501');
    const prof = await A.client
      .from('profiles')
      .update({ id: B.id })
      .eq('id', A.id);
    expect(['42501', '23505']).toContain(prof.error?.code);
    // saved_combos has no update privilege at all
    const saved = await A.client
      .from('saved_combos')
      .update({ user_id: B.id })
      .eq('user_id', A.id);
    expect(saved.error?.code).toBe('42501');
    const ins = await A.client.from('food_prefs').insert({
      user_id: A.id,
      item_id: 'lettuce',
      kind: 'food',
      status: 'ok',
    });
    expect(ins.error?.code).toBe('42501');
    const del = await A.client.from('food_prefs').delete().eq('user_id', A.id);
    expect(del.error?.code).toBe('42501');
    expect(await countAs('ingredient_kits', 'user_id', A.id)).toBe(1);
    expect(await countAs('food_prefs', 'user_id', A.id)).toBe(3);
  });

  it('1-3. set_food_prefs rejects 501 items, a 65-char id and non-objects, keeping the old rows', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 501 }, (_, i) => [`f${i}`, 'ok']),
    );
    const cases: [string, unknown, unknown][] = [
      ['501 items', many, {}],
      ['65-char id', { ['x'.repeat(65)]: 'ok' }, {}],
      ['bad status', { 'chicken-breast': 'maybe' }, {}],
      ['array', [], {}],
      ['null', null, {}],
    ];
    for (const [label, p_foods, p_seasonings] of cases) {
      const r = await A.client.rpc('set_food_prefs', { p_foods, p_seasonings });
      expect(r.error, label).not.toBeNull();
      expect(await countAs('food_prefs', 'user_id', A.id), label).toBe(3);
    }
  });

  it('2. A cannot create or upsert a profile with id = B', async () => {
    const ins = await A.client.from('profiles').insert({ id: B.id });
    expect(['42501', '23505']).toContain(ins.error?.code);
    const ups = await A.client
      .from('profiles')
      .upsert({ id: B.id, weight_kg: 1 });
    expect(ups.error?.code).toBe('42501');
    const b = await admin
      .from('profiles')
      .select('weight_kg')
      .eq('id', B.id)
      .single();
    expect(Number(b.data!.weight_kg)).toBe(60);
  });

  it('3. set_food_prefs by A leaves B rows alone', async () => {
    const before = await admin
      .from('food_prefs')
      .select('item_id,status')
      .eq('user_id', B.id);
    const r = await A.client.rpc('set_food_prefs', {
      p_foods: { 'chicken-breast': 'favorite' },
      p_seasonings: {},
    });
    expect(r.error).toBeNull();
    expect(await countAs('food_prefs', 'user_id', A.id)).toBe(1);
    const after = await admin
      .from('food_prefs')
      .select('item_id,status')
      .eq('user_id', B.id);
    expect(after.data).toEqual(before.data);
    expect(after.data).toEqual([{ item_id: 'white-rice', status: 'ok' }]);
  });

  it('4. UNIQUE(user_id, signature) is per user', async () => {
    const a = await A.client
      .from('saved_combos')
      .insert(savedRow(A.id, 'shared-sig'));
    expect(a.error).toBeNull();
    const b = await B.client
      .from('saved_combos')
      .insert(savedRow(B.id, 'shared-sig'));
    expect(b.error).toBeNull();
    const again = await A.client
      .from('saved_combos')
      .insert(savedRow(A.id, 'shared-sig'));
    expect(again.error?.code).toBe('23505');
    // unstar: delete by (user_id, signature) removes only A's
    const del = await A.client
      .from('saved_combos')
      .delete()
      .eq('user_id', A.id)
      .eq('signature', 'shared-sig')
      .select();
    expect(del.data).toHaveLength(1);
    const left = await admin
      .from('saved_combos')
      .select('user_id')
      .eq('signature', 'shared-sig');
    expect(left.data).toEqual([{ user_id: B.id }]);
  });

  it('5. anon (not logged in) can read and write nothing', async () => {
    for (const t of TABLES) {
      const r = await anon.from(t).select('*');
      expect(r.error?.code, t).toBe('42501');
    }
    const ins = await anon.from('profiles').insert({ id: A.id });
    expect(ins.error?.code).toBe('42501');
    const rpc = await anon.rpc('set_food_prefs', {
      p_foods: {},
      p_seasonings: {},
    });
    expect(rpc.error?.code).toBe('42501');
  });

  it('6. deleting user A removes all of A rows and none of B rows (cascade)', async () => {
    const bBefore = await Promise.all(
      TABLES.map((t) => countAs(t, ownerColumn(t), B.id)),
    );
    const del = await admin.auth.admin.deleteUser(A.id);
    expect(del.error).toBeNull();
    for (const t of TABLES)
      expect(await countAs(t, ownerColumn(t), A.id), t).toBe(0);
    const bAfter = await Promise.all(
      TABLES.map((t) => countAs(t, ownerColumn(t), B.id)),
    );
    expect(bAfter).toEqual(bBefore);
  });
});
