// Which foods a style combination leaves out of recommendations (PLAN.md 4.5).
import type { Food } from '@/types/food';
import type { DietStyle, Goal } from '@/types/nutrition';
import { resolveStyles } from './styles';

export function isFoodExcludedByStyles(
  food: Pick<Food, 'group'>,
  styles: readonly DietStyle[],
  goal: Goal,
): boolean {
  return resolveStyles(styles, goal).excludedGroups.includes(food.group);
}
