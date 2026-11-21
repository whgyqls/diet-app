// Messages between the plan screen and the plan worker, plus the pure parts around them
// (what the worker runs, which responses the screen still wants). The worker file is a thin wrapper.
import { FOODS, SEASONINGS } from '@/lib/data/load';
import { daySetup, generateDayPlan } from '@/lib/nutrition/generate';
import {
  generateMealOptions,
  type MealOptionsResult,
} from '@/lib/nutrition/mealOptions';
import type {
  DayPlan,
  MealCombo,
  MealTargets,
  MealType,
  Selection,
} from '@/types/nutrition';
import type { DayBase } from './planState';
import type { PlanInputs } from './requestFingerprint';

export type DayRequestMsg = {
  kind: 'day';
  id: number;
  refYear: number;
  inputs: PlanInputs;
};
/** Reroll one meal: new cards that skip `seen`, keep `locked`, and lean away from the other meals. */
export type MealRequestMsg = {
  kind: 'meal';
  id: number;
  meal: MealType;
  targets: MealTargets;
  selection: Selection;
  locked: string[];
  seen: string[];
  count: number;
  otherPicked: MealCombo[];
};
export type WorkerRequest = DayRequestMsg | MealRequestMsg;

export type WorkerResponse =
  | { ok: true; kind: 'day'; id: number; plan: DayPlan; base: DayBase }
  | {
      ok: true;
      kind: 'meal';
      id: number;
      meal: MealType;
      result: MealOptionsResult;
    }
  | {
      ok: false;
      kind: WorkerRequest['kind'];
      id: number;
      meal?: MealType;
      error: string;
    };

/** Runs a request. Never throws: an exception becomes `{ ok: false }`. */
export function runWorkerRequest(req: WorkerRequest): WorkerResponse {
  try {
    return req.kind === 'day' ? runDay(req) : runMeal(req);
  } catch (e) {
    return {
      ok: false,
      kind: req.kind,
      id: req.id,
      ...(req.kind === 'meal' ? { meal: req.meal } : {}),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function runDay(req: DayRequestMsg): WorkerResponse {
  const { inputs } = req;
  const dayReq = {
    foods: FOODS,
    seasonings: SEASONINGS,
    selection: inputs.selection,
    profile: inputs.profile,
    refYear: req.refYear,
    conditions: { styles: inputs.styles, overrides: inputs.overrides },
  };
  const plan = generateDayPlan(dayReq);
  const setup = daySetup(dayReq);
  return {
    ok: true,
    kind: 'day',
    id: req.id,
    plan,
    base: {
      targets: setup.targets,
      profile: inputs.profile,
      settingFlags: setup.settingFlags,
      includeFoods: setup.includeFoods,
      reason: plan.reason,
    },
  };
}

function runMeal(req: MealRequestMsg): WorkerResponse {
  const result = generateMealOptions({
    foods: FOODS,
    seasonings: SEASONINGS,
    selection: req.selection,
    targets: req.targets,
    locked: req.locked,
    seen: req.seen,
    count: req.count,
    dayContext: { otherPicked: req.otherPicked },
  });
  return { ok: true, kind: 'meal', id: req.id, meal: req.meal, result };
}

export type ResponseRef =
  { kind: 'day'; id: number } | { kind: 'meal'; meal: MealType; id: number };

/**
 * Which responses are still wanted. Stale ones are ignored instead of terminating the worker.
 * The latest id is kept per meal, so rerolling lunch while breakfast is still running kills neither.
 * Starting a day recalculation releases every pending meal request.
 */
export function createRequestTracker() {
  let counter = 0;
  let dayLatest: number | null = null;
  const mealLatest: Partial<Record<MealType, number>> = {};
  return {
    startDay(): number {
      dayLatest = ++counter;
      for (const k of Object.keys(mealLatest) as MealType[])
        delete mealLatest[k];
      return dayLatest;
    },
    startMeal(meal: MealType): number {
      mealLatest[meal] = ++counter;
      return mealLatest[meal]!;
    },
    /** True (once) when the response is the latest of its request; marks it as no longer pending. */
    accept(ref: ResponseRef): boolean {
      if (ref.kind === 'day') {
        if (dayLatest !== ref.id) return false;
        dayLatest = null;
        return true;
      }
      if (mealLatest[ref.meal] !== ref.id) return false;
      delete mealLatest[ref.meal];
      return true;
    },
    latestDayId: () => dayLatest,
    latestMealId: (meal: MealType) => mealLatest[meal],
    isDayPending: () => dayLatest !== null,
    isMealPending: (meal: MealType) => mealLatest[meal] !== undefined,
  };
}
