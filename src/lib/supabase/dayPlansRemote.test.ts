import { beforeAll, describe, expect, it } from 'vitest';
import {
  daySetup,
  generateDayPlan,
  type DayRequest,
} from '@/lib/nutrition/generate';
import {
  EXAMPLE_PROFILES,
  FOODS,
  REF_YEAR,
  SEASONINGS,
  selectAll,
} from '@/lib/nutrition/test-fixtures';
import { dayPlanOf, type DayPlanData } from '@/lib/plan/dayPlans';
import { createFakeSupabase, is } from './__fixtures__/fakeSupabase';
import { deleteDayPlan, listDayPlans, saveDayPlan } from './dayPlansRemote';

const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const req: DayRequest = {
  foods: FOODS,
  seasonings: SEASONINGS,
  selection: selectAll(),
  profile: { ...EXAMPLE_PROFILES[0].profile, mealsPerDay: 2 },
  refYear: REF_YEAR,
};
let data: DayPlanData;
let other: DayPlanData;
beforeAll(() => {
  void daySetup(req);
  const plan = generateDayPlan(req);
  const pick = (i: number) =>
    plan.meals.map((m) => ({
      mealType: m.mealType,
      picked: { combo: m.combos[i] },
    }));
  data = dayPlanOf(pick(0), plan.totals)!;
  other = dayPlanOf(pick(1), plan.totals)!;
});

const row = (n: number, date: string, uid = UID, plan: unknown = data) => ({
  id: uuid(n),
  user_id: uid,
  date,
  plan,
});

describe('day plans remote', () => {
  it("lists the user's plans newest date first, asking only for that user's rows", async () => {
    const fake = createFakeSupabase({
      uid: UID,
      tables: {
        day_plans: [
          row(1, '2026-11-20'),
          row(2, '2026-11-24'),
          row(9, '2026-11-25', OTHER),
        ],
      },
    });
    const list = await listDayPlans(fake.client, UID);
    expect(list.map((p) => p.date)).toEqual(['2026-11-24', '2026-11-20']);
    const select = fake.calls.find(is('select', 'day_plans'))!;
    expect(select.filters).toContainEqual({ col: 'user_id', val: UID });
  });

  it('rejects when the request fails, and drops a damaged row without failing the rest', async () => {
    const fake = createFakeSupabase({
      uid: UID,
      tables: {
        day_plans: [row(1, '2026-11-20'), row(2, '2026-11-21', UID, { v: 9 })],
      },
    });
    expect((await listDayPlans(fake.client, UID)).map((p) => p.date)).toEqual([
      '2026-11-20',
    ]);
    fake.failWhen(is('select', 'day_plans'), { message: 'boom' });
    await expect(listDayPlans(fake.client, UID)).rejects.toThrow('boom');
  });

  it('saves a new date with one upsert on (user_id, date)', async () => {
    const fake = createFakeSupabase({ uid: UID });
    await saveDayPlan(fake.client, UID, '2026-11-24', data);
    const up = fake.calls.find(is('upsert', 'day_plans'))!;
    expect(up.options).toMatchObject({ onConflict: 'user_id,date' });
    expect(up.payload).toEqual({
      user_id: UID,
      date: '2026-11-24',
      plan: data,
    });
    expect(await listDayPlans(fake.client, UID)).toHaveLength(1);
  });

  it('saving a date again replaces that date only and keeps the other dates', async () => {
    const fake = createFakeSupabase({
      uid: UID,
      tables: { day_plans: [row(1, '2026-11-20'), row(2, '2026-11-24')] },
    });
    await saveDayPlan(fake.client, UID, '2026-11-24', other);
    const list = await listDayPlans(fake.client, UID);
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.date === '2026-11-24')!.plan).toEqual(other);
    expect(list.find((p) => p.date === '2026-11-20')!.plan).toEqual(data);
  });

  it('allows a future date inside the range, refuses a date outside it or not real, without a request', async () => {
    const fake = createFakeSupabase({ uid: UID });
    await saveDayPlan(fake.client, UID, '2099-12-31', data);
    for (const bad of [
      '2019-12-31',
      '2100-01-01',
      '2026-02-30',
      'tomorrow',
      '',
    ])
      await expect(saveDayPlan(fake.client, UID, bad, data)).rejects.toThrow(
        'invalid date',
      );
    expect(fake.calls.filter(is('upsert', 'day_plans'))).toHaveLength(1);
  });

  it('refuses a plan that is not the saved shape', async () => {
    const fake = createFakeSupabase({ uid: UID });
    await expect(
      saveDayPlan(fake.client, UID, '2026-11-24', {
        v: 1,
        meals: [],
      } as unknown as DayPlanData),
    ).rejects.toThrow();
    expect(fake.calls.filter(is('upsert', 'day_plans'))).toHaveLength(0);
  });

  it('rejects when saving fails', async () => {
    const fake = createFakeSupabase({ uid: UID });
    fake.failWhen(is('upsert', 'day_plans'), { message: 'no' });
    await expect(
      saveDayPlan(fake.client, UID, '2026-11-24', data),
    ).rejects.toThrow('no');
  });

  it('deletes only that date of that user, and rejects when it fails', async () => {
    const fake = createFakeSupabase({
      uid: UID,
      tables: { day_plans: [row(1, '2026-11-20'), row(2, '2026-11-24')] },
    });
    await deleteDayPlan(fake.client, UID, '2026-11-24');
    const del = fake.calls.find(is('delete', 'day_plans'))!;
    expect(del.filters).toEqual(
      expect.arrayContaining([
        { col: 'user_id', val: UID },
        { col: 'date', val: '2026-11-24' },
      ]),
    );
    expect((await listDayPlans(fake.client, UID)).map((p) => p.date)).toEqual([
      '2026-11-20',
    ]);
    fake.failWhen(is('delete', 'day_plans'), { message: 'no' });
    await expect(deleteDayPlan(fake.client, UID, '2026-11-20')).rejects.toThrow(
      'no',
    );
    expect(await listDayPlans(fake.client, UID)).toHaveLength(1);
  });
});
