'use client';

import { bonusBadges } from '@/lib/nutrition/badges';
import { foodHighlights } from '@/lib/nutrition/highlights';
import type { Pref } from '@/lib/selection/selection';
import { BASIS_LABELS, EXCLUDED_BY_STYLE_TEXT } from '@/lib/ui-labels';
import type { Food } from '@/types/food';

const STATUS_TEXT: Record<'none' | 'ok' | 'favorite', string> = {
  none: '선택 안 함',
  ok: '먹을 수 있음',
  favorite: '좋아함',
};

export function FoodCard({
  food,
  status,
  excluded,
  onToggle,
  onInfo,
}: {
  food: Food;
  status: Pref;
  excluded: boolean;
  onToggle: () => void;
  onInfo: () => void;
}) {
  const h = foodHighlights(food);
  const badges = bonusBadges(food);
  const state = status ?? 'none';
  return (
    <li
      className={`flex items-stretch overflow-hidden rounded-xl border ${
        state === 'none'
          ? 'border-neutral-300 dark:border-neutral-700'
          : 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950'
      } ${excluded ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={`${food.name}, ${STATUS_TEXT[state]}`}
        className="flex min-h-16 flex-1 flex-col gap-1 p-3 text-left"
      >
        <span className="flex items-center gap-2 font-semibold">
          <span aria-hidden className="w-5 text-emerald-700">
            {state === 'favorite' ? '♥' : state === 'ok' ? '✓' : '○'}
          </span>
          {food.name}
          <span className="text-xs font-normal text-neutral-600 dark:text-neutral-400">
            {BASIS_LABELS[food.basis]}
          </span>
        </span>
        <span className="text-xs text-neutral-700 dark:text-neutral-300">
          {h.keyLine.text}
        </span>
        {(h.chips.length > 0 || badges.length > 0) && (
          <span className="flex flex-wrap gap-1">
            {h.chips.map((c) => (
              <span
                key={c.code}
                className={`rounded-full px-2 py-0.5 text-xs ${
                  c.kind === 'caution'
                    ? 'bg-amber-100 text-amber-900'
                    : c.kind === 'bonus'
                      ? 'bg-sky-100 text-sky-900'
                      : 'bg-emerald-100 text-emerald-900'
                }`}
              >
                {c.label}
              </span>
            ))}
          </span>
        )}
        {food.note && (
          <span className="text-xs text-neutral-600 dark:text-neutral-400">
            {food.note}
          </span>
        )}
        {excluded && (
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
            {EXCLUDED_BY_STYLE_TEXT}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onInfo}
        aria-label={`${food.name} 영양성분 보기`}
        className="flex min-h-11 w-12 shrink-0 items-start justify-center pt-3 text-lg"
      >
        ⓘ
      </button>
    </li>
  );
}
