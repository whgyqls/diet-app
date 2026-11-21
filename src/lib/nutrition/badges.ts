// Bonus badges for nutrients outside a food's own category (PLAN.md 1-4, 5-3-1).
import type { Food } from '@/types/food';
import type { PortionedFood } from '@/types/nutrition';
import {
  BONUS_FIBER_MIN_PER100G,
  BONUS_PROTEIN_MIN_PER100G,
} from './constants';

export type BonusBadge = 'PROTEIN_RICH' | 'FIBER_RICH';

export const BONUS_BADGE_LABELS: Record<BonusBadge, string> = {
  PROTEIN_RICH: '단백질도 풍부',
  FIBER_RICH: '식이섬유 풍부',
};

const BADGE_NUTRIENT = {
  PROTEIN_RICH: 'protein',
  FIBER_RICH: 'fiber',
} as const;

export function bonusBadges(food: Food): BonusBadge[] {
  const out: BonusBadge[] = [];
  if (
    food.category !== 'protein' &&
    food.per100g.protein >= BONUS_PROTEIN_MIN_PER100G
  )
    out.push('PROTEIN_RICH');
  if (
    food.category !== 'fiber' &&
    food.per100g.fiber >= BONUS_FIBER_MIN_PER100G
  )
    out.push('FIBER_RICH');
  return out;
}

export type BadgeContribution = {
  nutrient: 'protein' | 'fiber';
  total: number; // meal total from all foods
  items: { food: Food; amount: number }[]; // what each badge food adds, e.g. "단백질 32g 중 렌틸콩 10g"
};

export function badgeContributions(
  items: PortionedFood[],
): BadgeContribution[] {
  const out: BadgeContribution[] = [];
  for (const badge of ['PROTEIN_RICH', 'FIBER_RICH'] as const) {
    const nutrient = BADGE_NUTRIENT[badge];
    const amountOf = (i: PortionedFood) =>
      (i.food.per100g[nutrient] * i.grams) / 100;
    const contributors = items
      .filter((i) => bonusBadges(i.food).includes(badge))
      .map((i) => ({ food: i.food, amount: amountOf(i) }));
    if (contributors.length === 0) continue;
    out.push({
      nutrient,
      total: items.reduce((a, i) => a + amountOf(i), 0),
      items: contributors,
    });
  }
  return out;
}
