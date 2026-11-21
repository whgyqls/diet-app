// Card lists for one meal (reroll, lock + reroll) with the rest of the day as soft context (PLAN.md 3.3, 5-6). Pure.
import type { GenerateFailReason, MealCombo } from '@/types/nutrition';
import {
  COMBOS_PER_MEAL,
  DAY_CONTEXT_PROTEIN_GROUP_PENALTY,
  DAY_CONTEXT_REPEAT_PENALTY,
} from './constants';
import {
  comboProteinGroup,
  mealCandidates,
  pickDiverse,
  type MealRequest,
} from './generate';

/** The combos already chosen for the OTHER meals of the day (never the meal being rerolled). */
export type DayContext = { otherPicked: MealCombo[] };

/**
 * Soft cost of a combo given the other meals: a protein group an other meal already uses, and every
 * food it shares with them. Same ideas as the day planner's priorities 2-3, but as a nudge.
 */
export function dayContextPenalty(c: MealCombo, ctx: DayContext): number {
  const group = comboProteinGroup(c);
  let p = 0;
  for (const o of ctx.otherPicked) {
    if (group !== undefined && comboProteinGroup(o) === group)
      p += DAY_CONTEXT_PROTEIN_GROUP_PENALTY;
    const ids = new Set(o.items.map((i) => i.food.id));
    p +=
      DAY_CONTEXT_REPEAT_PENALTY *
      c.items.filter((i) => ids.has(i.food.id)).length;
  }
  return p;
}

export type MealOptionsRequest = MealRequest & { dayContext?: DayContext };

export type MealOptionsResult = {
  combos: MealCombo[];
  /** Fewer combos than requested: no more new combos exist for this selection, locks and seen list. */
  exhausted: boolean;
  reason?: GenerateFailReason;
};

export function generateMealOptions(
  req: MealOptionsRequest,
): MealOptionsResult {
  const count = req.count ?? COMBOS_PER_MEAL;
  const { candidates, reason } = mealCandidates(req);
  if (reason) return { combos: [], exhausted: true, reason };

  const ctx = req.dayContext;
  const penalty =
    ctx && ctx.otherPicked.length > 0
      ? (c: MealCombo) => dayContextPenalty(c, ctx)
      : undefined;
  const ranked = penalty
    ? [...candidates].sort(
        (a, b) =>
          a.score.total + penalty(a) - (b.score.total + penalty(b)) ||
          a.key.localeCompare(b.key),
      )
    : candidates;
  const combos = pickDiverse(ranked, count, penalty);
  // Empty: either nothing can be built at all (impossible lock/selection) or everything was seen already.
  // A reroll always has the picked key in `seen`, so look again without `seen` to tell them apart.
  const impossible =
    combos.length === 0 &&
    mealCandidates({ ...req, seen: [] }).candidates.length === 0;
  return {
    combos,
    exhausted: combos.length < count,
    ...(impossible ? { reason: 'NO_MATCH' as const } : {}),
  };
}
