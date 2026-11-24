// Why a day cannot reach its kcal target, as codes (PLAN.md 4.2). Pure functions. The numbers come from the
// engine (the best combo of every meal), never from the screen or the AI.
import type { Food } from '@/types/food';
import type {
  DayTargets,
  KcalFill,
  KcalFillContext,
  KcalGapReason,
} from '@/types/nutrition';
import { KCAL_FILL_MIN_RATIO, OIL_GROUP } from './constants';

/**
 * Reasons in the order they are shown. `selected` = the foods the plan could use (already without excluded
 * ones). PORTION_LIMITS is always last: it is true for every selection.
 */
export function kcalGapReasons(
  selected: readonly Pick<Food, 'category' | 'group'>[],
  targets: Pick<DayTargets, 'carbTopUp' | 'rules'>,
  carbForbidden: boolean,
): KcalGapReason[] {
  const has = (f: (x: Pick<Food, 'category' | 'group'>) => boolean) =>
    selected.some(f);
  const reasons: KcalGapReason[] = [];
  if (!has((f) => f.category === 'carb') && !carbForbidden)
    reasons.push('NO_CARB_FOOD');
  if (targets.rules.preferNoCarb) reasons.push('LOW_CARB_STYLE');
  if (!targets.carbTopUp) reasons.push('USER_CARB_LIMIT');
  if (!has((f) => f.category === 'fat' && f.group !== OIL_GROUP))
    reasons.push('NO_FAT_SOURCE');
  if (!has((f) => f.category === 'fat' && f.group === OIL_GROUP))
    reasons.push('NO_OIL');
  reasons.push('PORTION_LIMITS');
  return reasons;
}

/** The explanation when the day is below the fill minimum, else undefined. */
export function kcalFillOf(
  kcal: number,
  target: number,
  ctx: KcalFillContext,
): KcalFill | undefined {
  if (target <= 0 || kcal >= target * KCAL_FILL_MIN_RATIO) return undefined;
  const ceilingRatio = ctx.ceilingKcal / target;
  const selection = ceilingRatio < KCAL_FILL_MIN_RATIO;
  return {
    ratio: kcal / target,
    ceilingRatio,
    cause: selection ? 'SELECTION' : 'CHOICE',
    reasons: selection ? ctx.reasons : [],
  };
}
