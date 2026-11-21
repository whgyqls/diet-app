import { describe, expect, it } from 'vitest';
import { EXAMPLE_PROFILES, selectAll } from '@/lib/nutrition/test-fixtures';
import {
  createRequestTracker,
  runWorkerRequest,
  type WorkerRequest,
} from './workerProtocol';

describe('createRequestTracker', () => {
  it('accepts only the latest day response', () => {
    const t = createRequestTracker();
    const a = t.startDay();
    const b = t.startDay();
    expect(t.accept({ kind: 'day', id: a })).toBe(false);
    expect(t.isDayPending()).toBe(true);
    expect(t.accept({ kind: 'day', id: b })).toBe(true);
    expect(t.isDayPending()).toBe(false);
    expect(t.accept({ kind: 'day', id: b })).toBe(false); // no replay
  });

  it('keeps the latest request id per meal: a lunch reroll does not kill a breakfast reroll', () => {
    const t = createRequestTracker();
    const bf = t.startMeal('breakfast');
    const ln = t.startMeal('lunch');
    expect(t.isMealPending('breakfast')).toBe(true);
    expect(t.isMealPending('lunch')).toBe(true);
    expect(t.accept({ kind: 'meal', meal: 'breakfast', id: bf })).toBe(true);
    expect(t.accept({ kind: 'meal', meal: 'lunch', id: ln })).toBe(true);
  });

  it('a newer request for the same meal makes the older response stale', () => {
    const t = createRequestTracker();
    const first = t.startMeal('dinner');
    const second = t.startMeal('dinner');
    expect(t.accept({ kind: 'meal', meal: 'dinner', id: first })).toBe(false);
    expect(t.isMealPending('dinner')).toBe(true);
    expect(t.accept({ kind: 'meal', meal: 'dinner', id: second })).toBe(true);
  });

  it('starting a day recalculation releases every pending meal and drops their responses', () => {
    const t = createRequestTracker();
    const bf = t.startMeal('breakfast');
    const ln = t.startMeal('lunch');
    const day = t.startDay();
    expect(t.isMealPending('breakfast')).toBe(false);
    expect(t.isMealPending('lunch')).toBe(false);
    expect(t.accept({ kind: 'meal', meal: 'breakfast', id: bf })).toBe(false);
    expect(t.accept({ kind: 'meal', meal: 'lunch', id: ln })).toBe(false);
    expect(t.accept({ kind: 'day', id: day })).toBe(true);
  });

  it('a response of the wrong kind or an unknown meal is rejected', () => {
    const t = createRequestTracker();
    const id = t.startMeal('lunch');
    expect(t.accept({ kind: 'day', id })).toBe(false);
    expect(t.accept({ kind: 'meal', meal: 'dinner', id })).toBe(false);
  });
});

describe('runWorkerRequest', () => {
  const profile = { ...EXAMPLE_PROFILES[0].profile, mealsPerDay: 2 as const };

  it('day: returns the day plan and the base needed to re-summarize it', () => {
    const req: WorkerRequest = {
      kind: 'day',
      id: 7,
      refYear: 2026,
      inputs: { profile, styles: [], overrides: {}, selection: selectAll() },
    };
    const res = runWorkerRequest(req);
    if (!res.ok || res.kind !== 'day') throw new Error('expected a day result');
    expect(res.id).toBe(7);
    expect(res.plan.meals.map((m) => m.mealType)).toEqual(['lunch', 'dinner']);
    expect(res.base.profile).toEqual(profile);
    expect(res.base.targets).toEqual(res.plan.targets);
    expect(res.base.includeFoods).toEqual([]);
  });

  it('day: an engine failure reason comes back inside the plan, not as an error', () => {
    const res = runWorkerRequest({
      kind: 'day',
      id: 1,
      refYear: 2026,
      inputs: {
        profile,
        styles: [],
        overrides: {},
        selection: { foods: {}, seasonings: {} },
      },
    });
    if (!res.ok || res.kind !== 'day') throw new Error('expected a day result');
    expect(res.plan.reason).toBe('NEED_PROTEIN');
  });

  it('an exception becomes an error response with the same id', () => {
    const res = runWorkerRequest({
      kind: 'day',
      id: 3,
      refYear: 2026,
      inputs: null as never,
    });
    expect(res).toMatchObject({ ok: false, id: 3 });
  });
});

// ---- Phase 4b: meal requests ----
import { generateMealOptions } from '@/lib/nutrition/mealOptions';
import { resolveStyles } from '@/lib/nutrition/styles';
import { calcDayTargets, calcMealTargets } from '@/lib/nutrition/targets';
import { FOODS, REF_YEAR, SEASONINGS } from '@/lib/nutrition/test-fixtures';

describe('runWorkerRequest: meal', () => {
  const profile = EXAMPLE_PROFILES[1].profile;
  const lunch = calcMealTargets(
    calcDayTargets(
      profile,
      REF_YEAR,
      undefined,
      resolveStyles([], profile.goal),
    ).targets,
    3,
  )[1];
  const base = {
    kind: 'meal' as const,
    id: 11,
    meal: 'lunch' as const,
    targets: lunch,
    selection: selectAll(),
    locked: [] as string[],
    seen: [] as string[],
    count: 4,
    otherPicked: [],
  };

  it('returns the same combos as the engine for the same request, tagged with id and meal', () => {
    const res = runWorkerRequest(base);
    if (!res.ok || res.kind !== 'meal')
      throw new Error('expected a meal result');
    expect(res.id).toBe(11);
    expect(res.meal).toBe('lunch');
    const direct = generateMealOptions({
      foods: FOODS,
      seasonings: SEASONINGS,
      selection: base.selection,
      targets: lunch,
      count: 4,
    });
    expect(res.result.combos.map((c) => c.key)).toEqual(
      direct.combos.map((c) => c.key),
    );
    expect(res.result.exhausted).toBe(false);
  });

  it('passes locked and seen on to the engine', () => {
    const first = runWorkerRequest({ ...base, locked: ['cabbage'] });
    if (!first.ok || first.kind !== 'meal')
      throw new Error('expected a meal result');
    for (const c of first.result.combos)
      expect(c.items.map((i) => i.food.id)).toContain('cabbage');
    const seen = first.result.combos.map((c) => c.key);
    const again = runWorkerRequest({ ...base, locked: ['cabbage'], seen });
    if (!again.ok || again.kind !== 'meal')
      throw new Error('expected a meal result');
    for (const c of again.result.combos) expect(seen).not.toContain(c.key);
  });

  it('applies otherPicked as context (a different protein group first)', () => {
    const plain = runWorkerRequest({ ...base, count: 5 });
    if (!plain.ok || plain.kind !== 'meal')
      throw new Error('expected a meal result');
    const withCtx = runWorkerRequest({
      ...base,
      count: 5,
      otherPicked: [plain.result.combos[0]],
    });
    if (!withCtx.ok || withCtx.kind !== 'meal')
      throw new Error('expected a meal result');
    const group = (c: (typeof plain.result.combos)[number]) =>
      c.items.find((i) => i.food.category === 'protein')!.food.group;
    expect(group(withCtx.result.combos[0])).not.toBe(
      group(plain.result.combos[0]),
    );
  });

  it('an engine failure reason comes back in the result (NEED_FIBER), not as an error', () => {
    const res = runWorkerRequest({
      ...base,
      selection: { foods: { 'chicken-breast': 'ok' }, seasonings: {} },
    });
    if (!res.ok || res.kind !== 'meal')
      throw new Error('expected a meal result');
    expect(res.result).toMatchObject({ combos: [], reason: 'NEED_FIBER' });
  });

  it('an exception becomes an error response carrying kind, id and meal', () => {
    const res = runWorkerRequest({ ...base, targets: null as never });
    expect(res).toMatchObject({
      ok: false,
      kind: 'meal',
      id: 11,
      meal: 'lunch',
    });
  });
});
