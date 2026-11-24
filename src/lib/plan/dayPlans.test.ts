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
import type { DayPlan } from '@/types/nutrition';
import {
  DAY_PLAN_MAX_DATE,
  DAY_PLAN_MIN_DATE,
  dateLabel,
  dayPlanDataSchema,
  dayPlanOf,
  isValidDateText,
  localDateText,
  savedDayPlansFromRows,
} from './dayPlans';

const req: DayRequest = {
  foods: FOODS,
  seasonings: SEASONINGS,
  selection: selectAll(),
  profile: { ...EXAMPLE_PROFILES[0].profile, mealsPerDay: 2 },
  refYear: REF_YEAR,
};
let plan: DayPlan;
beforeAll(() => {
  void daySetup(req);
  plan = generateDayPlan(req);
});
const picked = () =>
  plan.meals.map((m) => ({
    mealType: m.mealType,
    picked: { combo: m.combos[0] },
  }));

describe('dates', () => {
  it("localDateText is the browser's own calendar date, also late at night and just after midnight", () => {
    expect(localDateText(new Date(2026, 10, 24, 23, 59, 59))).toBe(
      '2026-11-24',
    );
    expect(localDateText(new Date(2026, 10, 25, 0, 0, 0))).toBe('2026-11-25');
    expect(localDateText(new Date(2026, 0, 5, 12))).toBe('2026-01-05'); // padded
  });
  it('accepts real dates inside the range, future ones too, and nothing else', () => {
    for (const ok of [
      DAY_PLAN_MIN_DATE,
      DAY_PLAN_MAX_DATE,
      '2026-11-24',
      '2024-02-29',
      '2099-06-30',
    ])
      expect(isValidDateText(ok), ok).toBe(true);
    for (const bad of [
      '2019-12-31',
      '2100-01-01',
      '2025-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      '2026-1-5',
      '',
      '11/24/2026',
      '2026-11-24T00:00',
    ])
      expect(isValidDateText(bad), bad).toBe(false);
  });
  it('dateLabel adds the weekday of that calendar date', () => {
    expect(dateLabel('2026-11-24')).toBe('2026-11-24 (화)');
    expect(dateLabel('2026-11-29')).toBe('2026-11-29 (일)');
    expect(dateLabel('2020-01-01')).toBe('2020-01-01 (수)');
  });
});

describe('dayPlanOf', () => {
  it('keeps the picked combo of every meal with names, grams, basis and totals', () => {
    const data = dayPlanOf(picked(), plan.totals)!;
    expect(data.v).toBe(1);
    expect(data.meals.map((m) => m.mealType)).toEqual(
      plan.meals.map((m) => m.mealType),
    );
    const first = plan.meals[0].combos[0];
    expect(data.meals[0].items).toEqual(
      first.items.map((i) => ({
        foodId: i.food.id,
        name: i.food.name,
        grams: i.grams,
        basis: i.food.basis,
      })),
    );
    expect(data.meals[0].totals).toEqual(first.totals);
    expect(data.totals).toEqual(plan.totals);
    expect(dayPlanDataSchema.safeParse(data).success).toBe(true);
  });
  it('leaves out a meal without a picked combo, and is null when none has one', () => {
    const [a, b] = picked();
    expect(
      dayPlanOf([a, { mealType: b.mealType }], plan.totals)!.meals,
    ).toHaveLength(1);
    expect(dayPlanOf([{ mealType: 'lunch' }], plan.totals)).toBeNull();
    expect(dayPlanOf([], plan.totals)).toBeNull();
  });
  it('carries nothing about the person: no profile, targets or ids of the cards', () => {
    const text = JSON.stringify(dayPlanOf(picked(), plan.totals));
    for (const w of [
      'targets',
      'profile',
      'weightKg',
      'birthYear',
      'heightCm',
      'key',
      'requestFingerprint',
      'savedAt',
    ])
      expect(text).not.toContain(w);
  });
  it('is a copy: changing the plan later does not change the snapshot', () => {
    const data = dayPlanOf(picked(), plan.totals)!;
    const before = data.totals.kcal;
    plan.totals.kcal += 1000;
    expect(data.totals.kcal).toBe(before);
    plan.totals.kcal -= 1000;
  });
});

describe('savedDayPlansFromRows', () => {
  const uuid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const good = () => dayPlanOf(picked(), plan.totals)!;
  const row = (n: number, date: string, p: unknown = good()) => ({
    id: uuid(n),
    date,
    plan: p,
  });

  it('lists the newest date first', () => {
    const out = savedDayPlansFromRows([
      row(1, '2026-11-20'),
      row(2, '2026-11-24'),
      row(3, '2026-11-22'),
    ]);
    expect(out.map((x) => x.date)).toEqual([
      '2026-11-24',
      '2026-11-22',
      '2026-11-20',
    ]);
  });
  it('drops rows that are not what was saved: bad id, date, plan or size', () => {
    const out = savedDayPlansFromRows([
      row(1, '2026-11-20'),
      { id: 'not-a-uuid', date: '2026-11-21', plan: good() },
      row(3, '2026-02-31'),
      row(4, '2026-11-23', { v: 2 }),
      row(5, '2026-11-24', { ...good(), meals: [] }),
      row(6, '2026-11-25', { ...good(), totals: { kcal: 'x' } }),
      row(7, '2026-11-26', {
        ...good(),
        meals: [
          {
            ...good().meals[0],
            items: Array(9).fill(good().meals[0].items[0]),
          },
        ],
      }),
      null,
      'x',
    ]);
    expect(out.map((x) => x.date)).toEqual(['2026-11-20']);
  });
  it('returns nothing for something that is not a list', () => {
    expect(savedDayPlansFromRows(null)).toEqual([]);
    expect(savedDayPlansFromRows({})).toEqual([]);
  });
});
