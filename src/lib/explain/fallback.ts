// The sentence shown when the AI is unavailable. Built from the same input, no AI, only numbers it contains.
import { BASIS_SHORT, GOAL_LABELS } from '@/lib/ui-labels';
import type { ExplainInput } from './types';

export function fallbackText(input: ExplainInput): string {
  const foods = input.items
    .map((i) => `${i.name} ${i.grams}g(${BASIS_SHORT[i.basis]})`)
    .join(', ');
  const t = input.totals;
  return `${foods} 조합이에요. 합계는 ${t.kcal}kcal, 단백질 ${t.protein}g, 식이섬유 ${t.fiber}g이고, ${GOAL_LABELS[input.goal]} 목표에 맞춰 분량을 계산했어요.`;
}
