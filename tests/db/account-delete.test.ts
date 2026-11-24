// Account deletion on the Supabase TEST project (npm run test:db): deleting user A through the admin API
// removes all of A's rows (ON DELETE CASCADE) and leaves user B untouched.
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadTestProject,
  testProjectConfigured,
} from '../helpers/testProjectGuard';

const TABLES: [string, string][] = [
  ['profiles', 'id'],
  ['food_prefs', 'user_id'],
  ['ingredient_kits', 'user_id'],
  ['saved_combos', 'user_id'],
];

describe.skipIf(!testProjectConfigured())('account deletion (cascade)', () => {
  let admin: SupabaseClient;
  const created: string[] = [];

  async function makeUser(): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({
      email: `del-${randomBytes(6).toString('hex')}@example.com`,
      password: randomBytes(24).toString('base64url'),
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(error?.message);
    created.push(data.user.id);
    const id = data.user.id;
    const ok = (r: { error: { message: string } | null }) => {
      if (r.error) throw new Error(r.error.message);
    };
    ok(await admin.from('profiles').insert({ id }));
    ok(
      await admin
        .from('food_prefs')
        .insert({
          user_id: id,
          item_id: 'chicken-breast',
          kind: 'food',
          status: 'ok',
        }),
    );
    ok(
      await admin.from('ingredient_kits').insert({
        id: crypto.randomUUID(),
        user_id: id,
        name: 'kit',
        selection: { foods: {}, seasonings: {} },
        styles: null,
      }),
    );
    ok(
      await admin.from('saved_combos').insert({
        id: crypto.randomUUID(),
        user_id: id,
        meal_type: 'lunch',
        signature: 's',
        request_fingerprint: 'fp',
        items: [],
        oils: [],
        seasonings: [],
        totals: {},
      }),
    );
    return id;
  }

  const count = async (table: string, col: string, id: string) => {
    const { count, error } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(col, id);
    if (error) throw new Error(error.message);
    return count;
  };

  beforeAll(() => {
    const project = loadTestProject(); // throws unless this is the marked test project
    admin = createClient(project.url, project.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });
  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
  });

  it("deleting A removes A's rows in every table and keeps B's", async () => {
    const a = await makeUser();
    const b = await makeUser();
    for (const [t, c] of TABLES) {
      expect(await count(t, c, a)).toBe(1);
      expect(await count(t, c, b)).toBe(1);
    }
    const { error } = await admin.auth.admin.deleteUser(a);
    expect(error).toBeNull();
    for (const [t, c] of TABLES) {
      expect(await count(t, c, a)).toBe(0);
      expect(await count(t, c, b)).toBe(1);
    }
    expect((await admin.auth.admin.getUserById(a)).data.user).toBeNull();
    expect((await admin.auth.admin.getUserById(b)).data.user?.id).toBe(b);
  });
});
