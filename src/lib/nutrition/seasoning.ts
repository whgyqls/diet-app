// Sodium budget -> salty seasoning suggestion (PLAN.md 5-3). Oils are handled by portions.ts.
import type { Seasoning } from '@/types/food';
import type {
  MealTargets,
  Selection,
  SeasoningResult,
  SeasoningUse,
} from '@/types/nutrition';
import {
  MAX_SALTY_SEASONINGS_BELOW_SODIUM_MIN,
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

function options(
  salty: Seasoning[],
  prefs: Selection['seasonings'],
  maxKinds: number,
): Option[] {
  const singles: SeasoningUse[][] = [];
  for (const s of salty)
    for (let u = 1; u <= s.maxUnitsPerMeal; u++)
      singles.push([{ seasoning: s, units: u }]);
  const sets: SeasoningUse[][] = maxKinds >= 1 ? [...singles] : [];
  if (maxKinds >= 2) {
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
 * salty seasonings may use SEASONING_SODIUM_BUDGET_RATIO of it, or more when the meal would stay below its
 * share of the sodium minimum (1,500 mg/day). At most MAX_SALTY_SEASONINGS_PER_MEAL kind; only when one kind
 * cannot bring the meal up to its sodium minimum, up to MAX_SALTY_SEASONINGS_BELOW_SODIUM_MIN kinds.
 * Among salty options that fit: favorites first, then the most sodium allowed, fewer units, id.
 */
export function seasoningPlanner(
  seasonings: Seasoning[],
  prefs: Selection['seasonings'],
): (foodSodium: number, t: MealTargets) => SeasoningResult {
  const selected = seasonings.filter((s) => prefs[s.id]);
  const free = selected.filter((s) => s.free);
  const rank = (maxKinds: number) =>
    options(selected.filter(isSalty), prefs, maxKinds).sort(
      (a, b) =>
        b.favorites - a.favorites ||
        b.sodium - a.sodium ||
        a.units - b.units ||
        a.key.localeCompare(b.key),
    );
  const ranked = rank(MAX_SALTY_SEASONINGS_PER_MEAL);
  const rankedBelowMin = rank(MAX_SALTY_SEASONINGS_BELOW_SODIUM_MIN);
  return (foodSodium, t) => {
    const budget = t.sodiumMax - foodSodium;
    // Normally 60% of the budget; reported `allowed` also covers what reaching the sodium minimum takes.
    const allowed = Math.min(
      Math.max(0, budget),
      Math.max(
        Math.max(0, budget) * SEASONING_SODIUM_BUDGET_RATIO,
        t.sodiumMin - foodSodium,
      ),
    );
    if (ranked.length === 0)
      return { budget, allowed, picks: [], free, reason: 'NO_SALTY_SELECTED' };
    let best = ranked.find((o) => o.sodium <= allowed);
    if (foodSodium + (best?.sodium ?? 0) < t.sodiumMin) {
      // Below the sodium minimum: take the smallest option (1-2 kinds, within the whole budget) that reaches it,
      // favorites first; if none reaches it, the largest that fits.
      const fits = rankedBelowMin.filter(
        (o) => o.sodium <= Math.max(0, budget),
      );
      const need = t.sodiumMin - foodSodium;
      const reaching = fits
        .filter((o) => o.sodium >= need)
        .sort(
          (a, b) =>
            b.favorites - a.favorites ||
            a.sodium - b.sodium ||
            a.units - b.units ||
            a.key.localeCompare(b.key),
        );
      const more = reaching[0] ?? fits[0];
      if (more && (!best || more.sodium > best.sodium)) best = more;
    }
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
