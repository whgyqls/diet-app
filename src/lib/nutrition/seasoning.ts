// Sodium budget -> salty seasoning suggestion (PLAN.md 5-3). Oils are handled by portions.ts.
import type { Seasoning } from '@/types/food';
import type {
  MealTargets,
  Selection,
  SeasoningResult,
  SeasoningUse,
} from '@/types/nutrition';
import {
  MAX_SALTY_SEASONINGS_PER_MEAL,
  SEASONING_SODIUM_BUDGET_RATIO,
} from './constants';

export function isSalty(s: Seasoning): boolean {
  return !s.free && !s.oil && s.perUnit.sodium > 0;
}

type Option = {
  uses: SeasoningUse[];
  sodium: number;
  units: number;
  favorites: number;
  key: string;
};

function options(salty: Seasoning[], prefs: Selection['seasonings']): Option[] {
  const singles: SeasoningUse[][] = [];
  for (const s of salty)
    for (let u = 1; u <= s.maxUnitsPerMeal; u++)
      singles.push([{ seasoning: s, units: u }]);
  const sets: SeasoningUse[][] = [...singles];
  if (MAX_SALTY_SEASONINGS_PER_MEAL >= 2) {
    for (let i = 0; i < singles.length; i++)
      for (let j = i + 1; j < singles.length; j++)
        if (singles[i][0].seasoning !== singles[j][0].seasoning)
          sets.push([singles[i][0], singles[j][0]]);
  }
  return sets.map((uses) => ({
    uses,
    sodium: uses.reduce((a, x) => a + x.seasoning.perUnit.sodium * x.units, 0),
    units: uses.reduce((a, x) => a + x.units, 0),
    favorites: uses.filter((x) => prefs[x.seasoning.id] === 'favorite').length,
    key: uses.map((x) => `${x.seasoning.id}x${x.units}`).join('+'),
  }));
}

/**
 * Prepares the user's seasoning options once; the returned function suggests seasonings for one meal.
 * Free (no-sodium) seasonings come first. Budget = meal sodium cap - sodium already in the food (and oils);
 * salty seasonings (at most MAX_SALTY_SEASONINGS_PER_MEAL kind) may use SEASONING_SODIUM_BUDGET_RATIO of it.
 * The default diet only keeps below the cap; it does not try to reach a sodium minimum.
 * Among salty options that fit: favorites first, then the most sodium allowed, fewer units, id.
 */
export function seasoningPlanner(
  seasonings: Seasoning[],
  prefs: Selection['seasonings'],
): (foodSodium: number, t: MealTargets) => SeasoningResult {
  const selected = seasonings.filter((s) => prefs[s.id]);
  const free = selected.filter((s) => s.free);
  const ranked = options(selected.filter(isSalty), prefs).sort(
    (a, b) =>
      b.favorites - a.favorites ||
      b.sodium - a.sodium ||
      a.units - b.units ||
      a.key.localeCompare(b.key),
  );
  return (foodSodium, t) => {
    const budget = t.sodiumMax - foodSodium;
    const allowed = Math.max(0, budget) * SEASONING_SODIUM_BUDGET_RATIO;
    if (ranked.length === 0)
      return { budget, allowed, picks: [], free, reason: 'NO_SALTY_SELECTED' };
    const best = ranked.find((o) => o.sodium <= allowed);
    if (!best)
      return { budget, allowed, picks: [], free, reason: 'NO_SODIUM_BUDGET' };
    return { budget, allowed, picks: best.uses, free };
  };
}

export function recommendSeasonings(
  foodSodium: number,
  t: MealTargets,
  seasonings: Seasoning[],
  prefs: Selection['seasonings'],
): SeasoningResult {
  return seasoningPlanner(seasonings, prefs)(foodSodium, t);
}
