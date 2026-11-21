// Diet style presets -> resolved settings (PLAN.md 4.5). Pure functions.
// Several styles combine: exclusions are merged (union), numeric targets take the stricter side.
import type { DietStyle, Goal, StyleSettings } from '@/types/nutrition';
import { STYLE_RULES } from './constants';

const min = (a: number | undefined, b: number) =>
  a === undefined ? b : Math.min(a, b);
const max = (a: number | undefined, b: number) =>
  a === undefined ? b : Math.max(a, b);

export function resolveStyles(
  styles: readonly DietStyle[],
  goal: Goal,
): StyleSettings {
  const unique = [...new Set(styles)].sort();
  const out: StyleSettings = {
    styles: unique,
    excludedGroups: [],
    dropTotalCarbMin: false,
    lowCarbFill: false,
    requireTwoFiberSources: false,
    preferNoCarb: false,
  };
  const excluded = new Set<string>();

  for (const style of unique) {
    switch (style) {
      case 'lowCarb': {
        const r = STYLE_RULES.lowCarb;
        out.totalCarbRatioMax = min(
          out.totalCarbRatioMax,
          r.totalCarbRatioMax[goal],
        );
        out.fatMaxRatio = max(out.fatMaxRatio, r.fatMaxRatio);
        out.dropTotalCarbMin = true;
        out.lowCarbFill = true;
        out.preferNoCarb = true;
        break;
      }
      case 'lowSodium': {
        const r = STYLE_RULES.lowSodium;
        out.sodiumMax = min(out.sodiumMax, r.sodiumMax);
        out.seasoningBudgetRatio = min(
          out.seasoningBudgetRatio,
          r.seasoningBudgetRatio,
        );
        break;
      }
      case 'veggieForward': {
        const r = STYLE_RULES.veggieForward;
        out.fiberDayMin = max(out.fiberDayMin, r.fiberDayMin);
        out.requireTwoFiberSources = r.fiberSourcesPerMeal === 2;
        out.veggieStartG = max(out.veggieStartG, r.veggieStartG);
        out.netCarbMultiplier = min(out.netCarbMultiplier, r.netCarbMultiplier);
        break;
      }
      case 'highProtein': {
        const r = STYLE_RULES.highProtein;
        out.proteinPerKgBase = max(out.proteinPerKgBase, r.proteinPerKgBase);
        out.proteinPerKgFillMax = max(
          out.proteinPerKgFillMax,
          r.proteinPerKgFillMax,
        );
        break;
      }
      case 'pescatarian':
        for (const g of STYLE_RULES.pescatarian.excludedGroups) excluded.add(g);
        break;
      case 'lactoOvo':
        for (const g of STYLE_RULES.lactoOvo.excludedGroups) excluded.add(g);
        break;
    }
  }
  out.excludedGroups = [...excluded];
  return out;
}
