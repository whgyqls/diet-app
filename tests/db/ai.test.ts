// AI explanation tables and the daily limit function on the TEST project (npm run test:db).
// Needs supabase/migrations/0002_ai.sql applied there. The guard refuses anything but the marked test project.
import { randomBytes, randomInt } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadTestProject,
  testProjectConfigured,
} from '../helpers/testProjectGuard';

const noSession = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

describe.skipIf(!testProjectConfigured())('AI tables and limits', () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let url: string;
  let anonKey: string;
  const created: string[] = [];
  // A random far-away date per run: nothing else counts on it, and a crashed run cannot disturb the next one.
  const baseYear = 2100 + randomInt(0, 800);
  const day = (n: number) => `${baseYear}-01-${String(n).padStart(2, '0')}`;
  const hash = () => randomBytes(32).toString('hex');

  async function makeUser() {
    const email = `ai-${randomBytes(6).toString('hex')}@example.com`;
    const password = randomBytes(24).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    created.push(data.user.id);
    const client = createClient(url, anonKey, noSession);
    const s = await client.auth.signInWithPassword({ email, password });
    if (s.error) throw new Error(`signIn: ${s.error.message}`);
    return { id: data.user.id, client };
  }
  const consume = async (u: string, d: string, user: number, site: number) => {
    const { data, error } = await admin.rpc('ai_try_consume', {
      p_user: u,
      p_day: d,
      p_user_limit: user,
      p_site_limit: site,
    });
    if (error) throw new Error(error.message);
    return data as boolean;
  };
  const usage = async (u: string, d: string) => {
    const { data, error } = await admin
      .from('ai_usage')
      .select('count')
      .eq('user_id', u)
      .eq('day', d);
    if (error) throw new Error(error.message);
    return data.reduce((a, r) => a + r.count, 0);
  };

  beforeAll(() => {
    const p = loadTestProject();
    url = p.url;
    anonKey = p.anonKey;
    admin = createClient(p.url, p.serviceKey, noSession);
    anon = createClient(p.url, p.anonKey, noSession);
  });
  afterAll(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
  });

  it('is closed to anon and to signed-in users: no read, no write, no function', async () => {
    const u = await makeUser();
    for (const client of [anon, u.client]) {
      for (const table of ['ai_explanations', 'ai_usage']) {
        const r = await client.from(table).select('*');
        expect(r.error, `${table} select`).not.toBeNull();
      }
      const w1 = await client
        .from('ai_explanations')
        .insert({ combo_hash: hash(), model: 'm', text: 'x' });
      expect(w1.error).not.toBeNull();
      const w2 = await client
        .from('ai_usage')
        .insert({ user_id: u.id, day: day(1), count: 1 });
      expect(w2.error).not.toBeNull();
      const f = await client.rpc('ai_try_consume', {
        p_user: u.id,
        p_day: day(1),
        p_user_limit: 5,
        p_site_limit: 45,
      });
      expect(f.error).not.toBeNull();
    }
  });

  it('the cache keeps the first text when the same combo is stored twice (on conflict do nothing)', async () => {
    const h = hash();
    const put = (text: string) =>
      admin
        .from('ai_explanations')
        .upsert(
          { combo_hash: h, model: 'm/x', text },
          { onConflict: 'combo_hash', ignoreDuplicates: true },
        );
    expect((await put('첫 설명')).error).toBeNull();
    expect((await put('둘째 설명')).error).toBeNull();
    const { data } = await admin
      .from('ai_explanations')
      .select('text')
      .eq('combo_hash', h);
    expect(data).toEqual([{ text: '첫 설명' }]);
  });

  it('the cache refuses a hash of the wrong length and an empty or huge text', async () => {
    for (const row of [
      { combo_hash: 'short', model: 'm', text: 'x' },
      { combo_hash: hash(), model: 'm', text: '' },
      { combo_hash: hash(), model: 'm', text: 'x'.repeat(401) },
    ])
      expect(
        (await admin.from('ai_explanations').insert(row)).error,
      ).not.toBeNull();
  });

  it("counts up to the user's limit, then refuses", async () => {
    const u = await makeUser();
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++)
      results.push(await consume(u.id, day(2), 3, 1000));
    expect(results).toEqual([true, true, true, false]);
    expect(await usage(u.id, day(2))).toBe(3);
  });

  it('another user and another day are counted separately', async () => {
    const a = await makeUser();
    const b = await makeUser();
    expect(await consume(a.id, day(3), 1, 1000)).toBe(true);
    expect(await consume(a.id, day(3), 1, 1000)).toBe(false);
    expect(await consume(b.id, day(3), 1, 1000)).toBe(true);
    expect(await consume(a.id, day(4), 1, 1000)).toBe(true);
  });

  it('the site limit is shared by all users of the day', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    expect(await consume(a.id, day(5), 10, 2)).toBe(true);
    expect(await consume(b.id, day(5), 10, 2)).toBe(true);
    expect(await consume(c.id, day(5), 10, 2)).toBe(false);
    expect(await consume(a.id, day(5), 10, 2)).toBe(false);
    expect(await usage(c.id, day(5))).toBe(0);
  });

  it('parallel calls cannot go over the limits', async () => {
    const u = await makeUser();
    const r = await Promise.all(
      Array.from({ length: 12 }, () => consume(u.id, day(6), 4, 1000)),
    );
    expect(r.filter(Boolean)).toHaveLength(4);
    expect(await usage(u.id, day(6))).toBe(4);

    const users = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const r2 = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        consume(users[i % 3].id, day(7), 100, 5),
      ),
    );
    expect(r2.filter(Boolean)).toHaveLength(5);
    const total = (
      await Promise.all(users.map((x) => usage(x.id, day(7))))
    ).reduce((a, n) => a + n, 0);
    expect(total).toBe(5);
  });

  it("deleting the account removes the user's usage rows and keeps other users' rows", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await consume(a.id, day(8), 5, 1000);
    await consume(b.id, day(8), 5, 1000);
    expect(await usage(a.id, day(8))).toBe(1);
    expect((await admin.auth.admin.deleteUser(a.id)).error).toBeNull();
    expect(await usage(a.id, day(8))).toBe(0);
    expect(await usage(b.id, day(8))).toBe(1);
  });
});
