'use client';

import { useEffect } from 'react';
import { nutritionFacts } from '@/lib/nutrition/nutritionFacts';
import { BASIS_LABELS } from '@/lib/ui-labels';
import type { Food } from '@/types/food';

export function FactsSheet({
  food,
  onClose,
}: {
  food: Food;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const { serving, rows } = nutritionFacts(food);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${food.name} 영양성분`}
        className="mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {food.name}
            <span className="ml-2 text-xs font-normal">
              {BASIS_LABELS[food.basis]}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="min-h-11 min-w-11 text-xl"
          >
            ✕
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-600 dark:text-neutral-400">
              <th className="py-1">성분</th>
              <th className="py-1 text-right">100g</th>
              <th className="py-1 text-right">1회 {serving}g</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className="border-t border-neutral-200 dark:border-neutral-800"
              >
                <td className="py-1.5">{r.label}</td>
                <td className="py-1.5 text-right">
                  {r.per100g === undefined ? '-' : `${r.per100g}${r.unit}`}
                </td>
                <td className="py-1.5 text-right">
                  {r.perServing === undefined
                    ? '-'
                    : `${r.perServing}${r.unit}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 min-h-12 w-full rounded-lg border border-neutral-300 font-medium dark:border-neutral-600"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
