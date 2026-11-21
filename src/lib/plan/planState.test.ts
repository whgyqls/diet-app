import { beforeAll, describe, expect, it } from 'vitest';
import type { DayPlan, MealType } from '@/types/nutrition';
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
import { initialPlanState, planReducer, type PlanState } from './planState';

const req: DayRequest = {
  foods: FOODS,
  seasonings: SEASONINGS,
  selection: selectAll(),
  profile: { ...EXAMPLE_PROFILES[0].profile, mealsPerDay: 2 },
  refYear: REF_YEAR,
};
let plan: DayPlan;
let loaded: PlanState;

const setup = () => {
  const s = daySetup(req);
  return {
    targets: s.targets,
    profile: req.profile,
    settingFlags: s.settingFlags,
    includeFoods: s.includeFoods,
  };
};

beforeAll(() => {
  plan = generateDayPlan(req);
  loaded = planReducer(initialPlanState, {
    type: 'loaded',
    plan,
    base: setup(),
    fingerprint: 'fp1',
  })!;
});

const meal = (s: PlanState, m: MealType) =>
  s.meals.find((x) => x.mealType === m)!;
// 2 meals per day = lunch + dinner
const [FIRST, SECOND] = ['lunch', 'dinner'] as const;

describe('planReducer: loaded', () => {
  it('keeps the meals the plan has (2 meals = 2 entries) with up to 5 cards each', () => {
    expect(loaded.meals.map((m) => m.mealType)).toEqual(
      plan.meals.map((m) => m.mealType),
    );
    for (const m of loaded.meals) expect(m.cards).toHaveLength(5);
  });

  it('picks the first card of every meal; the day equals the plan', () => {
    for (const m of loaded.meals) {
      expect(m.picked?.cardId).toBe(m.cards[0].id);
      expect(m.picked?.combo).toBe(m.cards[0].combo);
    }
    expect(loaded.day.totals).toEqual(plan.totals);
  });

  it('seen holds the keys of all shown cards (no duplicates); locks start empty', () => {
    for (const m of loaded.meals) {
      expect(m.seen).toEqual(m.cards.map((c) => c.combo.key));
      expect(new Set(m.seen).size).toBe(m.seen.length);
      expect(m.locks).toEqual({ fibers: [] });
    }
    expect(loaded.compare).toEqual([]);
  });

  it('card ids are unique across meals', () => {
    const ids = loaded.meals.flatMap((m) => m.cards.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds no Set/Map anywhere (arrays and plain objects only)', () => {
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (v instanceof Set || v instanceof Map || typeof v === 'function')
        bad.push(path);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(loaded, 'state');
    expect(bad).toEqual([]);
  });
});

describe('planReducer: pick', () => {
  it('stores the picked combo object and refreshes the day totals immediately', () => {
    const m = meal(loaded, FIRST);
    const next = planReducer(loaded, {
      type: 'pick',
      meal: FIRST,
      cardId: m.cards[2].id,
    })!;
    expect(meal(next, FIRST).picked).toEqual({
      cardId: m.cards[2].id,
      combo: m.cards[2].combo,
    });
    const expectKcal =
      m.cards[2].combo.totals.kcal +
      meal(loaded, SECOND).cards[0].combo.totals.kcal;
    expect(next.day.totals.kcal).toBeCloseTo(expectKcal, 6);
    // cards and other meals are untouched
    expect(meal(next, FIRST).cards).toBe(m.cards);
    expect(meal(next, SECOND)).toBe(meal(loaded, SECOND));
  });

  it('ignores an unknown card id and a meal that is not in the plan', () => {
    expect(
      planReducer(loaded, { type: 'pick', meal: FIRST, cardId: 'nope' }),
    ).toBe(loaded);
    expect(
      planReducer(loaded, {
        type: 'pick',
        meal: 'breakfast',
        cardId: loaded.meals[0].cards[0].id,
      }),
    ).toBe(loaded);
  });
});

describe('planReducer: fingerprint', () => {
  it('same fingerprint keeps the state; a different one resets it', () => {
    expect(
      planReducer(loaded, { type: 'fingerprint', fingerprint: 'fp1' }),
    ).toBe(loaded);
    expect(
      planReducer(loaded, { type: 'fingerprint', fingerprint: 'fp2' }),
    ).toBe(initialPlanState);
  });
});
