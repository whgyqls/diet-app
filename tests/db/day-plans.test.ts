// day_plans on the TEST project (npm run test:db): owner-only access (RLS), one row per user and date,
// the date range and size checks. Needs supabase/migrations/0004_day_plans.sql applied there.
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadTestProject,
  testProjectConfigured,
} from '../helpers/testProjectGuard';

const noSession = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;
type User = { id: string; client: SupabaseClient };

describe.skipIf(!testProjectConfigured())(
  'day_plans on the test project',
  () => {
    let admin: SupabaseClient;
    let anon: SupabaseClient;
    let url: string;
    let anonKey: string;
    let A: User;
    let B: User;
    const created: string[] = [];
    const plan = (kcal = 1800) => ({ v: 1, meals: [], totals: { kcal } });

    async function makeUser(): Promise<User> {
      const email = `dp-${randomBytes(6).toString('hex')}@example.com`;
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
    const rows = async (uid: string) => {
      const { data, error } = await admin
        .from('day_plans')
        .select('date, plan')
        .eq('user_id', uid)
        .order('date');
      if (error) throw new Error(error.message);
      return data as { date: string; plan: { totals: { kcal: number } } }[];
    };
    const save = (u: User, date: string, p: unknown = plan()) =>
      u.client
        .from('day_plans')
        .upsert(
          { user_id: u.id, date, plan: p },
          { onConflict: 'user_id,date' },
        );

    beforeAll(async () => {
      const p = loadTestProject();
      url = p.url;
      anonKey = p.anonKey;
      admin = createClient(p.url, p.serviceKey, noSession);
      anon = createClient(p.url, p.anonKey, noSession);
      A = await makeUser();
      B = await makeUser();
    });
    afterAll(async () => {
      for (const id of created) await admin.auth.admin.deleteUser(id);
    });

    it('a user saves, reads and deletes their own plans', async () => {
      expect((await save(A, '2026-11-24')).error).toBeNull();
      const own = await A.client
        .from('day_plans')
        .select('date')
        .eq('user_id', A.id);
      expect(own.data).toEqual([{ date: '2026-11-24' }]);
      const del = await A.client
        .from('day_plans')
        .delete()
        .eq('user_id', A.id)
        .eq('date', '2026-11-24');
      expect(del.error).toBeNull();
      expect(await rows(A.id)).toEqual([]);
    });

    it('saving a date again replaces that date only: one row per user and date, other dates stay', async () => {
      expect((await save(A, '2026-11-20', plan(1500))).error).toBeNull();
      expect((await save(A, '2026-11-24', plan(1800))).error).toBeNull();
      expect((await save(A, '2026-11-24', plan(2100))).error).toBeNull();
      const r = await rows(A.id);
      expect(r.map((x) => [x.date, x.plan.totals.kcal])).toEqual([
        ['2026-11-20', 1500],
        ['2026-11-24', 2100],
      ]);
      // a plain insert of an existing date is a conflict
      const dup = await A.client
        .from('day_plans')
        .insert({ user_id: A.id, date: '2026-11-24', plan: plan() });
      expect(dup.error?.code).toBe('23505');
    });

    it("another user cannot see, change, move or delete someone's plans, nor write one for them", async () => {
      await save(A, '2026-11-24', plan(1800));
      expect(
        (await B.client.from('day_plans').select('*').eq('user_id', A.id)).data,
      ).toEqual([]);
      expect((await B.client.from('day_plans').select('*')).data).toEqual([]);
      await B.client
        .from('day_plans')
        .update({ plan: plan(1) })
        .eq('user_id', A.id);
      await B.client.from('day_plans').delete().eq('user_id', A.id);
      expect(
        (await rows(A.id)).find((x) => x.date === '2026-11-24')!.plan.totals
          .kcal,
      ).toBe(1800);
      const forA = await B.client
        .from('day_plans')
        .insert({ user_id: A.id, date: '2026-12-01', plan: plan() });
      expect(forA.error?.code).toBe('42501');
      // an owner cannot hand a row to someone else either
      const move = await A.client
        .from('day_plans')
        .update({ user_id: B.id })
        .eq('user_id', A.id)
        .eq('date', '2026-11-24');
      expect(move.error?.code).toBe('42501');
      expect(await rows(B.id)).toEqual([]);
    });

    it('anon gets nothing', async () => {
      expect((await anon.from('day_plans').select('*')).error).not.toBeNull();
      expect(
        (
          await anon
            .from('day_plans')
            .insert({ user_id: A.id, date: '2026-12-02', plan: plan() })
        ).error,
      ).not.toBeNull();
    });

    it('accepts the whole date range, future dates too, and refuses dates outside it', async () => {
      for (const d of ['2020-01-01', '2026-12-31', '2099-12-31'])
        expect((await save(B, d)).error, d).toBeNull();
      for (const d of ['2019-12-31', '2100-01-01'])
        expect((await save(B, d)).error?.code, d).toBe('23514');
    });

    it('keeps the plan an object under 32 KB', async () => {
      for (const bad of [[], 'text', 5])
        expect((await save(B, '2026-05-05', bad)).error?.code).toBe('23514');
      const big = { v: 1, pad: 'x'.repeat(40_000) };
      expect((await save(B, '2026-05-06', big)).error?.code).toBe('23514');
      expect(
        (await save(B, '2026-05-07', { v: 1, pad: 'x'.repeat(1000) })).error,
      ).toBeNull();
    });
  },
);
