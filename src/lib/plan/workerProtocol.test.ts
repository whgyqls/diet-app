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
