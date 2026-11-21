import { describe, expect, it } from 'vitest';
import type { DayPlan } from '@/types/nutrition';
import { summarizeDay, type SummarizeDayInput } from './day';
import { generateDayPlan } from './generate';
import { resolveStyles } from './styles';
import { calcDayTargets } from './targets';
import {
  EXAMPLE_PROFILES,
  FOODS,
  REF_YEAR,
  SEASONINGS,
  selectAll,
} from './test-fixtures';

const profile = EXAMPLE_PROFILES[0].profile;
const plan: DayPlan = generateDayPlan({
  foods: FOODS,
  seasonings: SEASONINGS,
  selection: selectAll(),
  profile,
  refYear: REF_YEAR,
});

function inputFor(
  p: DayPlan,
  picked: (number | undefined)[],
): SummarizeDayInput {
  const { flags: settingFlags } = calcDayTargets(
    profile,
    REF_YEAR,
    undefined,
    resolveStyles([], profile.goal),
  );
  return {
    targets: p.targets,
    profile,
    settingFlags,
    includeFoods: [],
    meals: p.meals.map((m, i) => ({
      mealType: m.mealType,
      targets: m.targets,
      combos: m.combos,
      picked: picked[i] === undefined ? undefined : m.combos[picked[i]!],
    })),
  };
}

describe('summarizeDay', () => {
  it('without picked, uses combos[0] and reproduces generateDayPlan', () => {
    const out = summarizeDay(inputFor(plan, [undefined, undefined, undefined]));
    expect(JSON.parse(JSON.stringify(out))).toEqual(
      JSON.parse(JSON.stringify(plan)),
    );
  });

  it('picked overrides combos[0]: totals are the sum of the picked combos', () => {
    const out = summarizeDay(inputFor(plan, [1, 2, 0]));
    const chosen = [
      plan.meals[0].combos[1],
      plan.meals[1].combos[2],
      plan.meals[2].combos[0],
    ];
    const kcal = chosen.reduce((a, c) => a + c.totals.kcal, 0);
    expect(out.totals.kcal).toBeCloseTo(kcal, 6);
    expect(out.totals.kcal).not.toBeCloseTo(plan.totals.kcal, 3);
    // meals (card lists) are not reordered or changed
    expect(out.meals.map((m) => m.combos)).toEqual(
      plan.meals.map((m) => m.combos),
    );
  });

  it('recomputes flags, shortfalls and unmetTargets from the picked meals', () => {
    const out = summarizeDay(inputFor(plan, [1, 1, 1]));
    expect(out.flagDetails.map((f) => f.code)).toEqual(out.flags);
    for (const k of out.shortfalls)
      expect(k.amount).toBeLessThan(k.reference * 0.9 + 1e-9);
    for (const u of out.unmetTargets) expect(u.short).toBeGreaterThan(0);
  });

  it('a meal without combos means no plan: no intake flags or unmet targets (totals sum only the meals that have combos)', () => {
    const empty: DayPlan = {
      ...plan,
      meals: plan.meals.map((m, i) => ({
        ...m,
        combos: i === 0 ? [] : m.combos,
      })),
    };
    const out = summarizeDay({
      ...inputFor(empty, [undefined, undefined, undefined]),
      reason: 'NO_MATCH',
    });
    expect(out.totals.kcal).toBeCloseTo(
      plan.meals[1].combos[0].totals.kcal + plan.meals[2].combos[0].totals.kcal,
      6,
    );
    expect(out.unmetTargets).toEqual([]);
    expect(out.flagDetails.every((f) => f.basis === 'setting')).toBe(true);
    expect(out.reason).toBe('NO_MATCH');
  });

  it('reports includeFoods that the picked meals do not contain', () => {
    const out = summarizeDay({
      ...inputFor(plan, [0, 0, 0]),
      includeFoods: ['__not_in_plan__'],
    });
    expect(out.missingIncludes).toEqual(['__not_in_plan__']);
  });
});
