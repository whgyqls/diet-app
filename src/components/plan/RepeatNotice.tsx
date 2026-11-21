'use client';

import { FOODS } from '@/lib/data/load';
import { repeatedFoods } from '@/lib/nutrition/repetition';
import type { Card } from '@/lib/plan/planState';

/** Banner when one food shows up in (nearly) every card of the meal. */
export function RepeatNotice({ cards }: { cards: Card[] }) {
  const repeats = repeatedFoods(cards.map((c) => c.combo));
  if (repeats.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="repeat-notice"
      className="mx-4 mb-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <ul className="list-disc pl-4">
        {repeats.map((r) => {
          const name = FOODS.find((f) => f.id === r.foodId)?.name ?? r.foodId;
          return (
            <li key={r.foodId}>
              {name}
              {r.grams !== undefined ? ` ${r.grams}g` : ''}이(가) 조합 {r.total}
              개 중 {r.count}개에 들어 있어요
            </li>
          );
        })}
      </ul>
      <p className="mt-1">재료를 더 고르면 조합이 다양해져요.</p>
    </div>
  );
}
